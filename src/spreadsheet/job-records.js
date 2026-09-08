import { JOB_HEADERS, JOB_INDEX } from '../config/settings.js';

/** Read occupied job rows without losing their physical sheet positions. */
export function readJobRecords(tab) {
  const count = tab.getLastRow() - 1;
  if (count <= 0) return [];
  const range = tab.getRange(2, 1, count, Math.max(JOB_HEADERS.length, tab.getLastColumn()));
  const values = range.getValues();
  const occupied = values.map(row => row.some(value => value !== '' && value != null));
  // Formula reads are only needed to distinguish apparently empty rows.
  const formulas = occupied.every(Boolean) ? null : range.getFormulas();
  return values.flatMap((row, index) =>
    occupied[index] || formulas[index].some(Boolean)
      ? [{ tab, row, rowNumber: index + 2 }]
      : [],
  );
}

/** Validate a single table or a combined discovery-table scope. */
export function validateJobRecords(entries) {
  const seen = new Map();
  const names = new Map();
  for (const entry of entries) {
    if (!names.has(entry.tab)) names.set(entry.tab, entry.tab.getName());
    const location = `${names.get(entry.tab)}!A${entry.rowNumber}`;
    const value = entry.row[JOB_INDEX['Job ID']];
    const id = String(value ?? '');
    if (!/^\d+$/.test(id)) {
      const reason = id === '' ? 'missing Job ID on a non-empty row' : 'invalid Job ID; expected digits only';
      throw new Error(`${location}: ${reason}.`);
    }
    if (seen.has(id))
      throw new Error(`Duplicate Job ID ${id}: ${seen.get(id)} and ${location}.`);
    seen.set(id, location);
  }
  return entries;
}

/** Batch only adjacent occupied rows; never fill gaps with scraper values. */
export function writeRecordColumns(tab, entries, column, width, valuesFor) {
  let start = 0;
  while (start < entries.length) {
    let end = start + 1;
    while (end < entries.length && entries[end].rowNumber === entries[end - 1].rowNumber + 1) end++;
    tab.getRange(entries[start].rowNumber, column, end - start, width)
      .setValues(entries.slice(start, end).map(valuesFor));
    start = end;
  }
}
