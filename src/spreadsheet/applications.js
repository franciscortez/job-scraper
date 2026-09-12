import { APPLICATION_STATUSES, JOB_HEADERS, JOB_INDEX } from '../config/settings.js';
import { readJobRecords, validateJobRecords } from './job-records.js';
import { appendRows, readJobTabs, rowDifferences } from './job-tabs.js';
import { formatJobs } from './sheets.js';

export function openApplications(book) {
  let tab = book.getSheetByName('Applications');
  if (tab?.getLastRow()) {
    const headers = tab.getRange(1, 1, 1, JOB_HEADERS.length).getValues()[0];
    if (headers.some((name, index) => name !== JOB_HEADERS[index]))
      throw new Error('Applications contains unrelated content or changed headers. Rename it or restore headers.');
  } else {
    tab ||= book.insertSheet('Applications');
    if (tab.getMaxColumns() < JOB_HEADERS.length)
      tab.insertColumnsAfter(tab.getMaxColumns(), JOB_HEADERS.length - tab.getMaxColumns());
    tab.getRange(1, 1, 1, JOB_HEADERS.length).setValues([JOB_HEADERS]);
  }
  if (tab.getMaxRows() < 2) tab.insertRowsAfter(1, 1);
  formatJobs(tab, APPLICATION_STATUSES);
  tab.setFrozenRows(1);
  tab.getRange(1, 1, 1, JOB_HEADERS.length).setFontWeight('bold').setBackground('#d9ead3');
  // Applications remain visible regardless of availability or application outcome.
  if (tab.getFilter()) tab.getFilter().remove();
  return tab;
}

export function applicationRows(tab) {
  return validateJobRecords(readJobRecords(tab)).map(entry => entry.row);
}

export function moveApplications(tables, destination, log = () => {}, budget = { check() {} }) {
  const sources = readJobTabs(tables);
  const existing = new Map(applicationRows(destination).map(row => [String(row[0]), row]));
  // Single transfer timestamp per run: Last Seen in Applications marks arrival time.
  const transferredAt = new Date();
  let moved = 0;
  for (const source of sources) {
    const id = String(source.row[0]);
    const applied = source.row[JOB_INDEX['Status']] === 'Applied';
    if (!applied && !existing.has(id)) continue;
    try {
      budget.check('application transfers');
      const original = transferRecord(source);
      const destinationRow = source.row.slice();
      destinationRow[JOB_INDEX['Last Seen']] = transferredAt;
      const priorRow = existing.get(id);
      const priorEntry = priorRow ? validateJobRecords(readJobRecords(destination)).find(entry => String(entry.row[0]) === id) : null;
      const prior = priorEntry ? transferRecord(priorEntry) : null;
      if (!applied || (prior && !isResumableTransfer(prior, original)))
        throw new Error(`Application conflict for job ${id}. Both rows retained.`);
      if (!prior) {
        const headers = source.tab.getRange(1, 1, 1, source.row.length).getValues()[0];
        const targetRow = destination.getLastRow() + 1;
        appendRows(destination, [destinationRow], headers, APPLICATION_STATUSES);
        // Native contents copy preserves formulas and adjusts relative references.
        if (original.formulas.some(Boolean)) {
          source.tab.getRange(source.rowNumber, 1, 1, source.row.length)
            .copyTo(destination.getRange(targetRow, 1, 1, source.row.length), { contentsOnly: true });
          destination.getRange(targetRow, JOB_INDEX['Last Seen'] + 1, 1, 1).setValues([[transferredAt]]);
        }
        SpreadsheetApp.flush();
      }
      const expected = prior || { row: destinationRow, formulas: original.formulas.map((formula, index) => index === JOB_INDEX['Last Seen'] ? '' : formula) };
      const copyEntry = validateJobRecords(readJobRecords(destination)).find(entry => String(entry.row[0]) === id);
      const copied = copyEntry ? transferRecord(copyEntry) : null;
      if (!copied || transferDifferences(copied, expected).length)
        throw new Error(`Could not verify application ${id}. Source retained.`);
      const latest = validateJobRecords(readJobRecords(source.tab)).find(entry => String(entry.row[0]) === id);
      if (!latest || transferDifferences(transferRecord(latest), original).length)
        throw new Error(`Job ${id} changed during transfer. Source retained; resolve conflict before retrying.`);
      source.tab.deleteRows(latest.rowNumber, 1);
      if (source.tab.getMaxRows() < 2) source.tab.insertRowsAfter(1, 1);
      existing.set(id, copied.row);
      moved++;
      log('application.moved', { jobId: id, moved });
    } catch (error) {
      log(error.deferred ? 'work.deferred' : 'applications.transfer_failed',
        { stage: 'application transfers', jobId: id, moved, error: error.message }, error.deferred ? 'warn' : 'error');
      error.moved = moved;
      throw error;
    }
  }
  log('applications.transferred', { moved });
  return moved;
}

// A retry after an interrupted delete finds the stamped copy (Last Seen =
// transfer time) while the source still holds the pre-transfer Last Seen.
// That single-column difference resumes safely; anything else is a conflict.
function isResumableTransfer(prior, source) {
  const differences = transferDifferences(prior, source);
  if (!differences.length) return true;
  return (
    differences.length === 1 &&
    differences[0].column === 'Last Seen' &&
    prior.row[JOB_INDEX['Last Seen']] instanceof Date
  );
}

function transferRecord(entry) {
  return { row: entry.row, formulas: entry.tab.getRange(entry.rowNumber, 1, 1, entry.row.length).getFormulasR1C1()[0] };
}

function transferDifferences(left, right) {
  const formulaDifferences = [];
  const width = Math.max(left.row.length, right.row.length);
  const leftValues = left.row.slice(), rightValues = right.row.slice();
  for (let index = 0; index < width; index++) {
    const a = left.formulas[index] || '', b = right.formulas[index] || '';
    if (a !== b) formulaDifferences.push({ column: JOB_HEADERS[index] || `Custom column ${index + 1}` });
    if (a || b) leftValues[index] = rightValues[index] = '';
  }
  return [...formulaDifferences, ...rowDifferences(leftValues, rightValues)];
}
