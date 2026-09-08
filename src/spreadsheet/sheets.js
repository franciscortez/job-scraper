import { restoreJobColumns } from './restore-columns.js';
import { JOB_HEADERS, STATUSES, JOB_COLUMN, JOB_INDEX } from '../config/settings.js';
import { cell, expiredRow } from '../jobs/job-rows.js';
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
  if (headers === JOB_HEADERS) restoreJobColumns(tab);
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

export function showOpenJobs(tab) {
  if (!tab.getFilter()) tab.getRange(1, 1, tab.getMaxRows(), JOB_HEADERS.length).createFilter();
  // A legacy filter may cover only the original 13 columns.
  if (tab.getFilter().getRange().getNumColumns() < JOB_HEADERS.length) {
    tab.getFilter().remove();
    tab.getRange(1, 1, tab.getMaxRows(), JOB_HEADERS.length).createFilter();
  }
  tab
    .getFilter()
    .setColumnFilterCriteria(
      JOB_COLUMN['Availability'],
      SpreadsheetApp.newFilterCriteria().whenTextEqualTo('Open').build(),
    );
}

export function formatJobs(tab) {
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
        .requireValueInList(STATUSES, true)
        .setAllowInvalid(false)
        .build(),
    );
}

export function rows(tab, width) {
  return tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, width).getValues() : [];
}

export function logRun(tab, values) {
  tab.appendRow(values.map(cell));
  tab.getRange(tab.getLastRow(), 1, 1, values.length).setWrap(true);
}

export function removeExpiredJobs(jobs, beforeCleanup, now) {
  let removed = 0;
  // Delete bottom-up so entire rows, including their tracking cells, move together.
  for (let i = beforeCleanup.length - 1; i >= 0; i--) {
    if (!expiredRow(beforeCleanup[i], now)) continue;
    const end = i;
    while (i > 0 && expiredRow(beforeCleanup[i - 1], now)) i--;
    jobs.deleteRows(i + 2, end - i + 1);
    removed += end - i + 1;
  }
  if (jobs.getMaxRows() < 2) jobs.insertRowsAfter(1, 1);
  return removed;
}

export function saveJobs(jobs, existing, merged) {
  const needed = merged.rows.length + 1;
  if (needed > jobs.getMaxRows()) {
    jobs.insertRowsAfter(jobs.getMaxRows(), needed - jobs.getMaxRows());
    formatJobs(jobs);
    if (jobs.getFilter()) {
      jobs.getFilter().remove();
      jobs.getRange(1, 1, jobs.getMaxRows(), JOB_HEADERS.length).createFilter();
    }
  }
  if (merged.rows.length) {
    // Never write existing Status/Notes cells, even with stale snapshot data.
    if (existing.length)
      jobs
        .getRange(2, JOB_COLUMN['Job ID'], existing.length, JOB_INDEX['Status'])
        .setValues(
          merged.rows
            .slice(0, existing.length)
            .map((row) => row.slice(0, JOB_INDEX['Status']).map(cell)),
        );
    if (merged.added)
      jobs
        .getRange(existing.length + 2, 1, merged.added, JOB_HEADERS.length)
        .setValues(merged.rows.slice(existing.length).map((row) => row.map(cell)));
    jobs
      .getRange(
        2,
        JOB_COLUMN['Availability'],
        merged.rows.length,
        JOB_HEADERS.length - JOB_INDEX['Availability'],
      )
      .setValues(
        merged.rows.map((row) =>
          row.slice(JOB_INDEX['Availability'], JOB_HEADERS.length).map(cell),
        ),
      );
    jobs.getRange(2, JOB_COLUMN['Match Score'], merged.rows.length, 1).setNumberFormat('0');
    // Sort every used column, keeping tracking and custom columns attached to IDs.
    jobs
      .getRange(
        2,
        JOB_COLUMN['Job ID'],
        merged.rows.length,
        Math.max(JOB_HEADERS.length, jobs.getLastColumn()),
      )
      .sort([
        { column: JOB_COLUMN['Match Score'], ascending: false },
        { column: JOB_COLUMN['Posted Date Text'], ascending: false },
        { column: JOB_COLUMN['Job ID'], ascending: false },
      ]);
    showOpenJobs(jobs);
    SpreadsheetApp.flush();
  }
}
