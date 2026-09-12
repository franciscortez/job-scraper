import { JOB_HEADERS, JOB_INDEX } from '../config/settings.js';
import { expiredRow } from '../jobs/job-rows.js';
import { readJobTabs } from './job-tabs.js';
import { sheet, rows } from './sheets.js';

export function openExpiredJobs(book) {
  const properties = PropertiesService.getDocumentProperties();
  const prior = properties.getProperty('expiredIdsSheet');
  const existing = book.getSheetByName('Expired IDs');
  if (prior && (!existing || String(existing.getSheetId()) !== prior || existing.getLastRow() < 1))
    throw new Error('Expired IDs history is missing or replaced. Restore the original ledger before refreshing.');
  const tab = sheet(book, 'Expired IDs', ['Job ID'], !prior);
  expiredIds(tab);
  if (!prior) properties.setProperty('expiredIdsSheet', String(tab.getSheetId()));
  return tab;
}

export function expiredIds(tab) {
  const ids = new Set();
  const count = tab.getLastRow() - 1;
  const width = Math.max(1, tab.getLastColumn());
  const values = rows(tab, width);
  const formulas = count > 0 ? tab.getRange(2, 1, count, width).getFormulas() : [];
  values.forEach((row, index) => {
    if (formulas[index].some(Boolean) || row.slice(1).some(value => value !== '' && value != null))
      throw new Error(`Expired IDs!A${index + 2}: unexpected formula or extra data.`);
    if (row.every(value => value === '' || value == null)) return;
    const id = String(row[0] ?? '');
    if (!/^\d+$/.test(id)) throw new Error(`Expired IDs!A${index + 2}: invalid Job ID.`);
    if (ids.has(id)) throw new Error(`Expired IDs!A${index + 2}: duplicate Job ID.`);
    ids.add(id);
  });
  return ids;
}

/** Record expired identity durably before deleting its discovery row. */
export function removeExpiredJobs(tables, history, now, log = () => {}, budget = { check() {} }) {
  const known = expiredIds(history);
  const entries = readJobTabs(tables);
  let removed = 0;
  try {
    // Reverse physical order preserves positions when rows are deleted.
    for (const entry of entries.filter(entry => entry.row[JOB_INDEX['Status']] !== 'Applied' && expiredRow(entry.row, now)).reverse()) {
      budget.check('cleanup');
      const { tab, rowNumber } = entry;
      const readCurrent = () => {
        const row = tab.getRange(rowNumber, 1, 1, JOB_HEADERS.length).getValues()[0];
        if (String(row[0]) !== String(entry.row[0]))
          throw new Error(`${tab.getName()}!A${rowNumber}: job changed during cleanup; retry refresh.`);
        return row;
      };
      const eligible = row => row[JOB_INDEX['Status']] !== 'Applied' && expiredRow(row, now);
      const current = readCurrent();
      if (!eligible(current)) continue;
      const id = String(current[0]);
      if (!known.has(id)) {
        const next = history.getLastRow() + 1;
        if (next > history.getMaxRows()) history.insertRowsAfter(history.getMaxRows(), 1);
        const range = history.getRange(next, 1, 1, 1);
        range.setNumberFormat('@').setValues([[id]]);
        SpreadsheetApp.flush();
        if (String(range.getValues()[0][0]) !== id)
          throw new Error(`Could not record expired job ${id}. Source retained.`);
        known.add(id);
      }
      // A user may mark Applied or edit the posting date while the ID is recorded.
      if (!eligible(readCurrent())) continue;
      tab.deleteRows(rowNumber, 1);
      removed++;
      if (tab.getMaxRows() < 2) tab.insertRowsAfter(1, 1);
    }
  } catch (error) {
    error.removed = removed;
    throw error;
  }
  log('cleanup.completed', { removed, expiredIds: known.size });
  return removed;
}
