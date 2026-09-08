import { APPLICATION_STATUSES, JOB_HEADERS, JOB_INDEX } from '../config/settings.js';
import { mergeJobs } from '../jobs/job-rows.js';
import { appendRows, readJobTabs, rowDifferences } from './job-tabs.js';
import { formatJobs, rows } from './sheets.js';

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
  const values = rows(tab, Math.max(JOB_HEADERS.length, tab.getLastColumn()));
  mergeJobs(values, [], new Date());
  return values;
}

export function moveApplications(tables, destination, log = () => {}) {
  const sources = readJobTabs(tables);
  const existing = new Map(applicationRows(destination).map(row => [String(row[0]), row]));
  // Single transfer timestamp per run: Last Seen in Applications marks arrival time
  // and starts the 14-day stale-Applied clock.
  const transferredAt = new Date();
  let moved = 0;
  for (const source of sources) {
    const id = String(source.row[0]);
    const applied = source.row[JOB_INDEX['Status']] === 'Applied';
    if (!applied && !existing.has(id)) continue;
    try {
      const destinationRow = source.row.slice();
      destinationRow[JOB_INDEX['Last Seen']] = transferredAt;
      const prior = existing.get(id);
      if (!applied || (prior && !isResumableTransfer(prior, source.row)))
        throw new Error(`Application conflict for job ${id}. Both rows retained.`);
      if (!prior) {
        const headers = source.tab.getRange(1, 1, 1, source.row.length).getValues()[0];
        appendRows(destination, [destinationRow], headers, APPLICATION_STATUSES);
        SpreadsheetApp.flush();
      }
      const expected = prior || destinationRow;
      const copied = applicationRows(destination).find(row => String(row[0]) === id);
      if (rowDifferences(copied, expected).length)
        throw new Error(`Could not verify application ${id}. Source retained.`);
      const latest = rows(source.tab, Math.max(JOB_HEADERS.length, source.tab.getLastColumn()));
      const index = latest.findIndex(row => String(row[0]) === id);
      if (index < 0 || rowDifferences(latest[index], source.row).length)
        throw new Error(`Job ${id} changed during transfer. Source retained; resolve conflict before retrying.`);
      source.tab.deleteRows(index + 2, 1);
      if (source.tab.getMaxRows() < 2) source.tab.insertRowsAfter(1, 1);
      existing.set(id, copied);
      moved++;
      log('application.moved', { jobId: id, moved });
    } catch (error) {
      log('applications.transfer_failed', { jobId: id, moved, error: error.message }, 'error');
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
  const differences = rowDifferences(prior, source);
  if (!differences.length) return true;
  return (
    differences.length === 1 &&
    differences[0].column === 'Last Seen' &&
    prior[JOB_INDEX['Last Seen']] instanceof Date
  );
}
