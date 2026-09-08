import { DEFAULT_SEARCHES } from '../config/settings.js';
import { normalizeSearchKeyword } from '../scraper/searches.js';
import { rows } from './sheets.js';
export function applyProfile(searches) {
  const properties = PropertiesService.getDocumentProperties();
  const version = properties.getProperty('resumeSearchesVersion');
  if (version === '4') return;
  if (version === '1') {
    const existing = rows(searches, 4);
    // Migrate only the employment filter, preserving keywords, enabled flags and limits.
    if (existing.length)
      searches
        .getRange(2, 3, existing.length, 1)
        .setValues(existing.map((row) => [String(row[1] || '').trim() ? 'All' : row[2]]));
  } else if (!['2', '3'].includes(version)) {
    if (searches.getLastRow() > 1)
      searches.getRange(2, 1, searches.getLastRow() - 1, 4).clearContent();
    searches.getRange(2, 1, DEFAULT_SEARCHES.length, 4).setValues(DEFAULT_SEARCHES);
  }
  rows(searches, 4).forEach((row, index) => {
    if (/\b(?:n8n|gohighlevel|go\s+high\s+level|ghl)\b/i.test(String(row[1]))) {
      searches.getRange(index + 2, 1, 1, 2).setValues([[false, '']]);
    }
  });
  const existingKeys = new Set(rows(searches, 4).map((row) => normalizeSearchKeyword(row[1])));
  const additions = DEFAULT_SEARCHES.filter(
    (row) => !existingKeys.has(normalizeSearchKeyword(row[1])),
  );
  if (additions.length) {
    const end = searches.getLastRow() + additions.length;
    if (end > searches.getMaxRows())
      searches.insertRowsAfter(searches.getMaxRows(), end - searches.getMaxRows());
    searches.getRange(searches.getLastRow() + 1, 1, additions.length, 4).setValues(additions);
  }
  properties.deleteProperty('jobCheckCursor');
  properties.deleteProperty('preferredJobCursor');
  properties.deleteProperty('secondaryJobCursor');
  properties.deleteProperty('secondarySearchCursor');
  properties.setProperty('resumeSearchesVersion', '4');
}
