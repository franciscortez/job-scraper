import { migrateJobTabs, openJobTabs } from './job-tabs.js';
import {
  SEARCH_HEADERS,
  JOB_HEADERS,
  RUN_HEADERS,
  TYPES,
  JOB_TAB_TYPES,
} from '../config/settings.js';
import { readSearches } from '../scraper/searches.js';
import { spreadsheet, sheet, rows } from './sheets.js';
import { applyProfile } from './profile.js';
import { locked } from '../platform/runtime.js';
export function setup(log = () => {}) {
  return locked(() => {
    const book = spreadsheet();
    migrateJobTabs(book, JOB_TAB_TYPES, log);
    book.setSpreadsheetTimeZone('Asia/Manila');
    for (const [name, headers] of [
      ['Searches', SEARCH_HEADERS],
      ['Runs', RUN_HEADERS],
    ]) {
      const tab = sheet(book, name, headers, true);
      tab.setFrozenRows(1);
      tab
        .getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#d9ead3')
        .setWrap(true);
      headers.forEach((_header, index) => tab.setColumnWidth(index + 1, 150));
      if (!tab.getFilter()) tab.getRange(1, 1, tab.getMaxRows(), headers.length).createFilter();
    }
    const searches = book.getSheetByName('Searches');
    applyProfile(searches);
    searches
      .getRange(2, 1, searches.getMaxRows() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    searches
      .getRange(2, 3, searches.getMaxRows() - 1, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(TYPES, true)
          .setAllowInvalid(false)
          .build(),
      );
    searches
      .getRange(2, 4, searches.getMaxRows() - 1, 1)
      .setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(['1', '2', '3'], true)
          .setAllowInvalid(false)
          .build(),
      );
    searches.setColumnWidth(2, 300);
    const runs = book.getSheetByName('Runs');
    runs.setColumnWidth(1, 190);
    runs.setColumnWidth(8, 450);
    runs.getRange(2, 1, runs.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    runs.getRange(2, 8, runs.getMaxRows() - 1, 1).setWrap(true);
    // Menu creation belongs to the spreadsheet's onOpen trigger, not editor setup.

    book.toast(
      'Resume searches ready for all employment types. Jobs 14 days old are removed on refresh. Run now to verify open jobs.',
      'Tracker ready',
      10,
    );
  });
}

export function enableHourlyRefresh() {
  return locked(() => {
    const book = spreadsheet();
    const searches = readSearches(rows(sheet(book, 'Searches', SEARCH_HEADERS), 4));
    openJobTabs(book, JOB_TAB_TYPES);
    sheet(book, 'Runs', RUN_HEADERS);
    if (!searches.length) throw new Error('Add and enable at least one keyword search first.');
    const triggers = ScriptApp.getProjectTriggers().filter(
      (trigger) => trigger.getHandlerFunction() === 'runScraper',
    );
    if (!triggers.length) ScriptApp.newTrigger('runScraper').timeBased().everyHours(1).create();
    for (const duplicate of triggers.slice(1)) ScriptApp.deleteTrigger(duplicate);
    book.toast('Hourly refresh enabled for this Google account.', 'Job Tracker', 5);
  });
}

export function disableHourlyRefresh() {
  return locked(() => {
    for (const trigger of ScriptApp.getProjectTriggers()) {
      if (trigger.getHandlerFunction() === 'runScraper') ScriptApp.deleteTrigger(trigger);
    }
    spreadsheet().toast('Hourly refresh disabled for this Google account.', 'Job Tracker', 5);
  });
}

/** Explicit manual reset: never called by setup or scheduled scraping. */
export function clearJobs(log = () => {}) {
  return locked(() => {
    const book = spreadsheet();
    const tables = openJobTabs(book, JOB_TAB_TYPES);
    let removed = 0;
    for (const { tab } of tables) {
      const count = Math.max(0, tab.getLastRow() - 1);
      if (count)
        tab.getRange(2, 1, count, Math.max(JOB_HEADERS.length, tab.getLastColumn())).clearContent();
      removed += count;
    }
    const properties = PropertiesService.getDocumentProperties();
    for (const key of [
      'jobCheckCursor',
      'preferredJobCursor',
      'secondaryJobCursor',
      'secondarySearchCursor',
    ]) {
      properties.deleteProperty(key);
    }
    SpreadsheetApp.flush();
    const remaining = tables
      .flatMap(({ tab }) => rows(tab, JOB_HEADERS.length))
      .filter((row) => row.some((value) => value !== '')).length;
    if (remaining) throw new Error('Jobs reset could not be verified.');
    log('jobs.cleared', { removed, remaining });
    book.toast(`${removed} job rows cleared.`, 'Job Tracker', 5);
    return { outcome: 'Success', removed, remaining };
  });
}
