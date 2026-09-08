import { writeRecordColumns } from './job-records.js';
import { restoreJobColumns } from './restore-columns.js';
import { JOB_HEADERS, STATUSES, APPLICATION_STATUSES, JOB_COLUMN, JOB_INDEX } from '../config/settings.js';
import { cell, expiredRow, expiredApplication } from '../jobs/job-rows.js';
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

export function logRun(tab, values) {
  tab.appendRow(values.map(cell));
  tab.getRange(tab.getLastRow(), 1, 1, values.length).setWrap(true);
}

export function removeExpiredJobs(jobs, beforeCleanup, now) {
  let removed = 0;
  // Re-read each row so an Applied edit after the initial scan survives cleanup.
  for (let i = beforeCleanup.length - 1; i >= 0; i--) {
    const { rowNumber, row } = beforeCleanup[i];
    const current = jobs.getRange(rowNumber, 1, 1, JOB_HEADERS.length).getValues()[0];
    if (String(current[0]) !== String(row[0])) throw new Error(`${jobs.getName()}!A${rowNumber}: job changed during cleanup; retry refresh.`);
    if (current[JOB_INDEX['Status']] === 'Applied' || !expiredRow(current, now)) continue;
    jobs.deleteRows(rowNumber, 1);
    removed++;
  }
  if (jobs.getMaxRows() < 2) jobs.insertRowsAfter(1, 1);
  return removed;
}

export function removeExpiredApplications(tab, beforeCleanup, now) {
  let removed = 0;
  // Re-read each row so a status change away from Applied during the run survives cleanup.
  for (let i = beforeCleanup.length - 1; i >= 0; i--) {
    const { rowNumber, row } = beforeCleanup[i];
    const current = tab.getRange(rowNumber, 1, 1, JOB_HEADERS.length).getValues()[0];
    if (String(current[0]) !== String(row[0])) throw new Error(`${tab.getName()}!A${rowNumber}: job changed during cleanup; retry refresh.`);
    if (!expiredApplication(current, now)) continue;
    tab.deleteRows(rowNumber, 1);
    removed++;
  }
  if (tab.getMaxRows() < 2) tab.insertRowsAfter(1, 1);
  return removed;
}

export function saveJobs(jobs, existing, merged) {
  const appendStart = jobs.getLastRow() + 1;
  const needed = appendStart + merged.added - 1;
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
    const byId = new Map(merged.rows.map(row => [String(row[0]), row]));
    writeRecordColumns(jobs, existing, JOB_COLUMN['Job ID'], JOB_INDEX['Status'],
      entry => byId.get(String(entry.row[0])).slice(0, JOB_INDEX['Status']).map(cell));
    writeRecordColumns(jobs, existing, JOB_COLUMN['Availability'], JOB_HEADERS.length - JOB_INDEX['Availability'],
      entry => byId.get(String(entry.row[0])).slice(JOB_INDEX['Availability'], JOB_HEADERS.length).map(cell));
    if (merged.added)
      jobs.getRange(appendStart, 1, merged.added, JOB_HEADERS.length)
        .setValues(merged.rows.slice(existing.length).map(row => row.slice(0, JOB_HEADERS.length).map(cell)));
    jobs.getRange(2, JOB_COLUMN['Match Score'], jobs.getLastRow() - 1, 1).setNumberFormat('0');
    // Sort every used column, keeping tracking and custom columns attached to IDs.
    jobs
      .getRange(
        2,
        JOB_COLUMN['Job ID'],
        jobs.getLastRow() - 1,
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
