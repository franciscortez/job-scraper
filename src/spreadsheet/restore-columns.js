import { JOB_HEADERS, JOB_COLUMN, STATUSES } from '../config/settings.js';

/** Recover sheets partially changed by the withdrawn two-status migration. */
export function restoreJobColumns(tab) {
  const simplified = [...JOB_HEADERS.slice(0, 7), 'Status', ...JOB_HEADERS.slice(7, 11), ...JOB_HEADERS.slice(12)];
  const actual = tab.getRange(1, 1, 1, JOB_HEADERS.length).getValues()[0];
  const moved = actual.every((name, index) => name === simplified[index]);
  if (!moved && !actual.every((name, index) => name === JOB_HEADERS[index])) return;
  // Destination is expressed in pre-move coordinates: moving H before M puts it in L.
  if (moved) {
    tab.moveColumns(tab.getRange(1, 8, tab.getMaxRows(), 1), 13);
    SpreadsheetApp.flush();
  }
  const count = Math.max(0, tab.getLastRow() - 1);
  const range = tab.getRange(2, JOB_COLUMN['Status'], tab.getMaxRows() - 1, 1);
  range.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  SpreadsheetApp.flush();
  if (count) {
    const values = tab.getRange(2, JOB_COLUMN['Status'], count, 1).getValues();
    values.forEach(([status], index) => {
      if (status === 'Not Applied') tab.getRange(index + 2, JOB_COLUMN['Status'], 1, 1).setValues([['New']]);
    });
  }
  tab.showColumns(1, JOB_HEADERS.length);
}
