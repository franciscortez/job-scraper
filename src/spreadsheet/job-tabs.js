import { JOB_HEADERS, JOB_INDEX } from '../config/settings.js';
import { mergeJobs, cell } from '../jobs/job-rows.js';
import { sheet, rows, formatJobs, showOpenJobs, saveJobs } from './sheets.js';

const tableKey = (name) => `employmentTable:${name}`;
const viewKey = (name) => `employmentView:${name}`;

export function openJobTabs(book, types) {
  if (book.getSheetByName('Jobs'))
    throw new Error('Run setup to migrate Jobs into employment tabs first.');
  return types.map((type) => ({ type, tab: sheet(book, type, JOB_HEADERS) }));
}

export function readJobTabs(tables) {
  const entries = tables.flatMap(({ type, tab }) =>
    rows(tab, Math.max(JOB_HEADERS.length, tab.getLastColumn())).map((row, index) => ({
      type,
      tab,
      row,
      index,
    })),
  );
  // Validate once across all tabs so a job cannot silently appear in multiple places.
  mergeJobs(
    entries.map((entry) => entry.row),
    [],
    new Date(),
  );
  return entries;
}

/** Preserve the original Jobs table until all destination rows have been verified. */
export function migrateJobTabs(book, types, log = () => {}) {
  const properties = PropertiesService.getDocumentProperties();
  const legacy = book.getSheetByName('Jobs');
  // Preflight every target before converting any formula view.
  for (const type of types) {
    const tab = book.getSheetByName(type);
    if (!tab || !tab.getLastRow()) continue;
    const id = String(tab.getSheetId());
    if (
      properties.getProperty(tableKey(type)) !== id &&
      properties.getProperty(viewKey(type)) !== id
    ) {
      throw new Error(
        `${type} tab already contains unrelated content. Rename it before running setup.`,
      );
    }
  }
  let source = [];
  let sourceHeaders = JOB_HEADERS;
  if (legacy) {
    sheet(book, 'Jobs', JOB_HEADERS);
    sourceHeaders = legacy
      .getRange(1, 1, 1, Math.max(JOB_HEADERS.length, legacy.getLastColumn()))
      .getValues()[0];
    source = rows(legacy, sourceHeaders.length);
    mergeJobs(source, [], new Date());
    for (const row of source) {
      if (!types.includes(row[JOB_INDEX['Employment Type']])) {
        throw new Error(`Job ${row[0]} has unsupported employment type. Jobs has been preserved.`);
      }
    }
  }
  const tables = types.map((type) => {
    const tab = book.getSheetByName(type) || book.insertSheet(type);
    const id = String(tab.getSheetId());
    if (
      properties.getProperty(viewKey(type)) === id &&
      properties.getProperty(tableKey(type)) !== id
    ) {
      // These are generated formula results; original records remain in Jobs.
      if (!legacy) throw new Error('Cannot convert formula views without the original Jobs table.');
      tab.getRange(1, 1, tab.getMaxRows(), tab.getMaxColumns()).clearContent();
    }
    if (!tab.getLastRow()) {
      if (tab.getMaxColumns() < sourceHeaders.length)
        tab.insertColumnsAfter(tab.getMaxColumns(), sourceHeaders.length - tab.getMaxColumns());
      tab.getRange(1, 1, 1, sourceHeaders.length).setValues([sourceHeaders]);
    }
    sheet(book, type, JOB_HEADERS);
    // Apply data formats before copying or reading a partially migrated destination.
    // Otherwise Sheets may return numeric IDs or serial numbers instead of Dates.
    formatJobs(tab);
    properties.setProperty(tableKey(type), id);
    properties.deleteProperty(viewKey(type));
    return { type, tab };
  });
  if (legacy) {
    const existing = readJobTabs(tables);
    const byId = new Map(existing.map((entry) => [String(entry.row[0]), entry]));
    // A retry may find copies from an interrupted migration. Never overwrite conflicting edits.
    for (const row of source) {
      const found = byId.get(String(row[0]));
      if (found && (found.type !== row[4] || !sameRow(found.row, row))) {
        const differences = rowDifferences(found.row, row);
        log('migration.conflict', { jobId: String(row[0]), tab: found.type, differences }, 'error');
        throw new Error(`Migration conflict for job ${row[0]} (${differences.map(item => item.column).join(', ') || 'Employment Type'}). Original Jobs table preserved.`);
      }
    }
    for (const { type, tab } of tables) {
      const additions = source.filter((row) => row[4] === type && !byId.has(String(row[0])));
      appendRows(tab, additions, sourceHeaders);
    }
    SpreadsheetApp.flush();
    const copied = new Map(readJobTabs(tables).map((entry) => [String(entry.row[0]), entry.row]));
    const mismatches = source.filter(row => !sameRow(copied.get(String(row[0])), row));
    if (mismatches.length) {
      const details = mismatches.slice(0, 5).map(row => ({
        jobId: String(row[0]), differences: rowDifferences(copied.get(String(row[0])), row),
      }));
      log('migration.verification_failed', { count: mismatches.length, samples: details }, 'error');
      throw new Error(`Migration verification failed for ${mismatches.length} job(s); first job ${details[0].jobId}: ${details[0].differences.map(item => item.column).join(', ')}. Original Jobs table preserved.`);
    }
    const latestSource = rows(legacy, sourceHeaders.length);
    if (
      latestSource.length !== source.length ||
      !latestSource.every((row, index) => sameRow(row, source[index]))
    ) {
      throw new Error(
        'Jobs changed during migration. Original table preserved; resolve changes before retrying.',
      );
    }
    book.deleteSheet(legacy);
  }
  for (const { tab } of tables) {
    tab.setFrozenRows(1);
    tab.getRange(1, 1, 1, JOB_HEADERS.length).setFontWeight('bold').setBackground('#d9ead3');
    formatJobs(tab);
    showOpenJobs(tab);
    JOB_HEADERS.forEach((name, index) =>
      tab.setColumnWidth(
        index + 1,
        ['Title', 'Description Snippet', 'Match Reason', 'Match Location'].includes(name)
          ? 350
          : name === 'URL'
            ? 250
            : 150,
      ),
    );
  }
  return tables;
}

// Compare known column semantics, while keeping Notes and custom values strict.
function sameValue(left, right, index) {
  left ??= '';
  right ??= '';
  if (left === right) return true;
  if (left instanceof Date && right instanceof Date) {
    return Math.abs(left.getTime() - right.getTime()) <= 1;
  }
  if (typeof left === 'string' && typeof right === 'string' && left === cell(right)) return true;
  const textColumn = index < JOB_INDEX['First Seen'];
  const numberAndString = (typeof left === 'number' && typeof right === 'string') || (typeof right === 'number' && typeof left === 'string');
  if (textColumn && numberAndString) return String(left) === String(right);
  if (index === JOB_INDEX['Match Score'] && numberAndString && left !== '' && right !== '') {
    return Number.isFinite(Number(left)) && Number(left) === Number(right);
  }
  return false;
}

export function rowDifferences(left, right) {
  if (!left) return [{ column: 'Missing destination row', sourceType: 'row', destinationType: 'missing' }];
  const differences = [];
  const type = value => value instanceof Date ? 'Date' : typeof value;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (!sameValue(left[index], right[index], index)) {
      differences.push({ column: JOB_HEADERS[index] || `Custom column ${index + 1}`, sourceType: type(right[index]), destinationType: type(left[index]) });
    }
  }
  return differences;
}

function sameRow(left, right) {
  return rowDifferences(left, right).length === 0;
}

function appendRows(tab, additions, headers) {
  if (!additions.length) return;
  const width = Math.max(JOB_HEADERS.length, ...additions.map((row) => row.length));
  if (tab.getMaxColumns() < width)
    tab.insertColumnsAfter(tab.getMaxColumns(), width - tab.getMaxColumns());
  if (width > JOB_HEADERS.length) {
    const actual = tab.getRange(1, 1, 1, width).getValues()[0];
    for (let index = JOB_HEADERS.length; index < width; index++) {
      if (actual[index] && actual[index] !== headers[index])
        throw new Error('Custom column headers differ between employment tabs.');
    }
    tab
      .getRange(1, JOB_HEADERS.length + 1, 1, width - JOB_HEADERS.length)
      .setValues([headers.slice(JOB_HEADERS.length, width)]);
  }
  const start = tab.getLastRow() + 1;
  if (start + additions.length - 1 > tab.getMaxRows())
    tab.insertRowsAfter(tab.getMaxRows(), start + additions.length - 1 - tab.getMaxRows());
  formatJobs(tab);
  tab
    .getRange(start, 1, additions.length, width)
    .setValues(
      additions.map((row) => Array.from({ length: width }, (_, index) => cell(row[index] ?? ''))),
    );
}

/** Save normal updates in place; move verified type changes with their tracking cells. */
export function saveJobTabs(tables, existing, merged) {
  const byId = new Map(existing.map((entry) => [String(entry.row[0]), entry]));
  const moves = [];
  for (const row of merged.rows) {
    const previous = byId.get(String(row[0]));
    if (!tables.some((table) => table.type === row[4]))
      throw new Error(`Unsupported employment type for job ${row[0]}.`);
    if (previous && previous.type !== row[4]) moves.push({ previous, row });
  }
  // Copy moved rows first. On a write failure, their source records remain available.
  for (const { previous, row } of moves) {
    const destination = tables.find((table) => table.type === row[4]).tab;
    const headers = previous.tab.getRange(1, 1, 1, previous.row.length).getValues()[0];
    const complete = [
      ...row.slice(0, JOB_HEADERS.length),
      ...previous.row.slice(JOB_HEADERS.length),
    ];
    appendRows(destination, [complete], headers);
    SpreadsheetApp.flush();
    const copied = rows(destination, complete.length).find(
      (value) => String(value[0]) === String(row[0]),
    );
    if (!sameRow(copied, complete))
      throw new Error(`Could not verify move for job ${row[0]}. Source retained.`);
  }
  for (const { tab } of tables) {
    const outgoing = moves
      .filter((move) => move.previous.tab === tab)
      .sort((a, b) => b.previous.index - a.previous.index);
    for (const move of outgoing) tab.deleteRows(move.previous.index + 2, 1);
    if (tab.getMaxRows() < 2) tab.insertRowsAfter(1, 1);
  }
  for (const { type, tab } of tables) {
    const current = rows(tab, JOB_HEADERS.length);
    const wanted = new Map(
      merged.rows.filter((row) => row[4] === type).map((row) => [String(row[0]), row]),
    );
    const ordered = current.map((row) => wanted.get(String(row[0])) || row);
    const ids = new Set(current.map((row) => String(row[0])));
    const additions = [...wanted.values()].filter((row) => !ids.has(String(row[0])));
    saveJobs(tab, current, { rows: [...ordered, ...additions], added: additions.length });
  }
}
