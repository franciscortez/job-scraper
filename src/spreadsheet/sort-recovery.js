const keyFor = tab => `pendingJobSort:${tab.getSheetId()}`;

/** Recover only columns whose journal and unique header markers agree. */
export function recoverJobSort(tab, log = () => {}) {
  const properties = PropertiesService.getDocumentProperties();
  const key = keyFor(tab);
  const raw = properties.getProperty(key);
  if (!raw) return;
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error(`${tab.getName()}: invalid sort recovery journal.`); }
  const { start, token, phase } = state;
  if (!Number.isInteger(start) || start < 2 || typeof token !== 'string' || !token.startsWith('job-sort:') ||
      !['prepared', 'marked', 'deleting'].includes(phase))
    throw new Error(`${tab.getName()}: invalid sort recovery journal.`);
  const columns = tab.getMaxColumns();
  if (columns === start - 1 && ['prepared', 'deleting'].includes(phase)) {
    properties.deleteProperty(key);
    log('sort.recovered', { tab: tab.getName(), action: 'journal-cleared' });
    return;
  }
  if (columns !== start + 1) throw new Error(`${tab.getName()}: sort helper ownership unclear; columns retained.`);
  const headers = tab.getRange(1, start, 1, 2).getValues()[0];
  if (headers[0] !== `${token}:date` || headers[1] !== `${token}:id`)
    throw new Error(`${tab.getName()}: sort helper ownership unclear; columns retained.`);
  // Journal deletion first so a lost response after delete can safely resume.
  properties.setProperty(key, JSON.stringify({ ...state, phase: 'deleting' }));
  tab.deleteColumns(start, 2);
  SpreadsheetApp.flush();
  properties.deleteProperty(key);
  log('sort.recovered', { tab: tab.getName(), action: 'helpers-removed' });
}

export function startJobSort(tab, start) {
  const properties = PropertiesService.getDocumentProperties();
  const key = keyFor(tab);
  const token = `job-sort:${Utilities.getUuid()}`;
  const state = { start, token, phase: 'prepared' };
  properties.setProperty(key, JSON.stringify(state));
  tab.insertColumnsAfter(start - 1, 2);
  tab.getRange(1, start, 1, 2).setValues([[`${token}:date`, `${token}:id`]]);
  SpreadsheetApp.flush();
  properties.setProperty(key, JSON.stringify({ ...state, phase: 'marked' }));
}
