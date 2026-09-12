import { recoverJobSort, startJobSort } from './sort-recovery.js';
import { restoreJobColumns } from './restore-columns.js';
import { JOB_HEADERS, STATUSES, APPLICATION_STATUSES, JOB_COLUMN, JOB_INDEX, RUN_LOG_RETENTION_MS } from '../config/settings.js';
import { cell, postedTime } from '../jobs/job-rows.js';
export function spreadsheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Use this script bound to the job tracker spreadsheet.');
  return book;
}

export function sheet(book, name, headers, create = false) {
  let tab = book.getSheetByName(name);
  if (!tab && create) tab = book.insertSheet(name);
  if (!tab) throw new Error(`Missing ${name} tab. Run setup first.`);
  if (tab.getMaxColumns() < headers.length)
    tab.insertColumnsAfter(tab.getMaxColumns(), headers.length - tab.getMaxColumns());
  if (tab.getLastRow() === 0 && create) tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (headers === JOB_HEADERS && create) restoreJobColumns(tab);
  const actual = tab.getRange(1, 1, 1, headers.length).getValues()[0];
  const legacyLength =
    (headers === JOB_HEADERS ? [16, 13] : name === 'Runs' ? [8] : []).find(
      (length) =>
        actual.slice(0, length).every((header, index) => header === headers[index]) &&
        actual.slice(length).every((header) => header === ''),
    ) ?? headers.length;
  if (legacyLength < headers.length) {
    tab
      .getRange(1, legacyLength + 1, 1, headers.length - legacyLength)
      .setValues([headers.slice(legacyLength)]);
    wrapText(tab, headers.length);
    return tab;
  }
  if (actual.some((header, index) => header !== headers[index]))
    throw new Error(`${name} headers changed. Restore original header order.`);
  wrapText(tab, headers.length);
  return tab;
}

function wrapText(tab, width) {
  tab.getRange(1, 1, tab.getMaxRows(), Math.max(width, tab.getLastColumn())).setWrap(true);
}

/** Remove the old automatic Open-only filter once, preserving user filters. */
export function prepareJobFilter(tab) {
  const properties = PropertiesService.getDocumentProperties();
  const key = `appendOnlyFilter:${tab.getSheetId()}`;
  let filter = tab.getFilter();
  if (properties.getProperty(key) !== '1') {
    const criteria = filter && filter.getRange().getNumColumns() >= JOB_COLUMN['Availability']
      ? filter.getColumnFilterCriteria(JOB_COLUMN['Availability']) : null;
    if (criteria && String(criteria.getCriteriaType()) === 'TEXT_EQUAL_TO' &&
        criteria.getCriteriaValues()[0] === 'Open') {
      filter.removeColumnFilterCriteria(JOB_COLUMN['Availability']);
    }
    properties.setProperty(key, '1');
  }
  const width = Math.max(JOB_HEADERS.length, tab.getLastColumn());
  if (filter && (filter.getRange().getNumRows() < tab.getMaxRows() ||
      filter.getRange().getNumColumns() < width)) {
    const criteria = Array.from({ length: filter.getRange().getNumColumns() },
      (_, index) => filter.getColumnFilterCriteria(index + 1));
    filter.remove();
    tab.getRange(1, 1, tab.getMaxRows(), width).createFilter();
    filter = tab.getFilter();
    criteria.forEach((value, index) => {
      if (value) filter.setColumnFilterCriteria(index + 1, value);
    });
  }
  if (!filter) tab.getRange(1, 1, tab.getMaxRows(), width).createFilter();
}

/** Native whole-row sorting preserves formulas and custom cells. */
export function sortJobsByDate(tab, budget = { check() {} }, log = () => {}) {
  budget.check('sorting');
  recoverJobSort(tab, log);
  const count = tab.getLastRow() - 1;
  if (count < 2) return;
  // Dedicated columns beyond the entire grid cannot overwrite custom data.
  const start = tab.getMaxColumns() + 1;
  const rows = tab.getRange(2, 1, count, JOB_HEADERS.length).getValues();
  // Both sentinels sort below every valid JavaScript date timestamp.
  const emptyDate = Number.MIN_SAFE_INTEGER;
  const keys = rows.map(row => [
    row[0] === '' ? emptyDate : postedTime(row[JOB_INDEX['Posted Date Text']]) ?? emptyDate + 1,
    Number(row[0]) || 0,
  ]);
  startJobSort(tab, start);
  try {
    tab.getRange(2, start, count, 2).setValues(keys);
    tab.getRange(2, 1, count, start + 1).sort([
      { column: start, ascending: false },
      { column: start + 1, ascending: false },
    ]);
  } finally {
    recoverJobSort(tab, log);
  }
}

export function formatJobs(tab, statuses = STATUSES) {
  wrapText(tab, JOB_HEADERS.length);
  tab.showColumns(1, JOB_HEADERS.length);
  const count = tab.getMaxRows() - 1;
  tab.getRange(2, JOB_COLUMN['Job ID'], count, 9).setNumberFormat('@');
  tab.getRange(2, JOB_COLUMN['First Seen'], count, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  tab.getRange(2, JOB_COLUMN['Description Snippet'], count, 3).setWrap(true);
  tab.getRange(2, JOB_COLUMN['Notes'], count, 1).setWrap(true);
  tab.getRange(2, JOB_COLUMN['Last Checked'], count, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  tab.getRange(2, JOB_COLUMN['Matched Skills'], count, 1).setWrap(true);
  tab.getRange(2, JOB_COLUMN['Match Score'], count, 1).setNumberFormat('0');
  tab.getRange(2, JOB_COLUMN['Match Reason'], count, 2).setWrap(true);
  tab
    .getRange(2, JOB_COLUMN['Status'], count, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(statuses, true)
        .setAllowInvalid(false)
        .build(),
    );
  if (statuses === APPLICATION_STATUSES) formatApplicationLayout(tab);
}

function formatApplicationLayout(tab) {
  const count = tab.getMaxRows() - 1;
  const width = Math.max(JOB_HEADERS.length, tab.getLastColumn());
  tab.getRange(2, 1, count, width)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setVerticalAlignment('top');
  tab.setRowHeightsForced(2, count, 60);
  tab.setRowHeightsForced(1, 1, 44);
  tab.getRange(1, 1, 1, width).setWrap(true).setVerticalAlignment('middle');
  JOB_HEADERS.forEach((name, index) => {
    const pixels = ['Title', 'Description Snippet', 'Notes'].includes(name) ? 300
      : ['URL', 'Skills', 'Matched Skills', 'Match Reason', 'Match Location'].includes(name) ? 220
      : ['Posted Date Text', 'First Seen', 'Last Seen', 'Last Checked'].includes(name) ? 180
      : 140;
    tab.setColumnWidth(index + 1, pixels);
  });
  tab.getRange(2, 1, count, width).setBackgrounds(
    Array.from({ length: count }, (_, index) => Array(width).fill(index % 2 ? '#f3f6fa' : '#ffffff')),
  );
}

export function rows(tab, width) {
  return tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, width).getValues() : [];
}

// Call only while holding the scraper lock. Delete bottom-up so physical rows stay valid.
export function pruneRunLogs(tab, now = Date.now()) {
  const timestamps = rows(tab, 1);
  let removed = 0;
  let count = 0;
  for (let index = timestamps.length - 1; index >= -1; index--) {
    const value = timestamps[index]?.[0];
    // Unknown timestamps cannot safely establish age; retain them for inspection.
    const expired = value instanceof Date && Number.isFinite(value.getTime()) &&
      value.getTime() <= now - RUN_LOG_RETENTION_MS;
    if (expired) count++;
    else if (count) {
      tab.deleteRows(index + 3, count);
      removed += count;
      count = 0;
    }
  }
  return removed;
}

export function logRun(tab, values) {
  tab.appendRow(values.map(cell));
  tab.getRange(tab.getLastRow(), 1, 1, values.length).setWrap(true);
}
