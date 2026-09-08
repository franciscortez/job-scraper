import {
  ORIGIN,
  TYPES,
  PREFERRED_SKILLS,
  MAX_SEARCHES_PER_RUN,
  PREFERRED_SEARCH_SLOTS,
} from '../config/settings.js';
export function normalizeSearchKeyword(keyword) {
  const text = String(keyword || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (/^next[ .-]*js$/i.test(text)) return 'next.js';
  if (/^(?:google )?apps? script$/i.test(text)) return 'apps script';
  return text.toLowerCase();
}

export function isPreferredSearch(search) {
  return PREFERRED_SKILLS.some(
    (skill) => normalizeSearchKeyword(skill) === normalizeSearchKeyword(search.keywords),
  );
}

export function selectSearches(searches, afterKey = '') {
  const key = (search) => `${normalizeSearchKeyword(search.keywords)} [${search.type}]`;
  const preferred = searches.filter(isPreferredSearch);
  const secondary = searches
    .filter((search) => !isPreferredSearch(search))
    .sort((a, b) => key(a).localeCompare(key(b)));
  const index = afterKey
    ? secondary.findIndex((search) => key(search).localeCompare(afterKey) > 0)
    : 0;
  const offset = index < 0 ? 0 : index;
  const rotated = [...secondary.slice(offset), ...secondary.slice(0, offset)];
  const chosenPreferred = preferred.slice(0, PREFERRED_SEARCH_SLOTS);
  const chosenSecondary = rotated.slice(0, MAX_SEARCHES_PER_RUN - chosenPreferred.length);
  const selected = [
    ...chosenPreferred,
    ...chosenSecondary,
    ...preferred.slice(PREFERRED_SEARCH_SLOTS),
  ].slice(0, MAX_SEARCHES_PER_RUN);
  return {
    searches: selected,
    cursor: chosenSecondary.length ? key(chosenSecondary[chosenSecondary.length - 1]) : afterKey,
  };
}

export function readSearches(rows) {
  const searches = [];
  rows.forEach((row, index) => {
    if (
      !(row[0] === true || String(row[0]).toLowerCase() === 'true') ||
      !String(row[1] || '').trim()
    )
      return;
    const keywords = String(row[1]).trim();
    const type = String(row[2] || 'All').trim();
    const pages = row[3] === '' || row[3] == null ? 3 : Number(row[3]);
    if (!TYPES.includes(type) || !Number.isInteger(pages) || pages < 1 || pages > 3) {
      throw new Error(
        `Searches row ${index + 2}: use supported employment type and Max Pages 1–3.`,
      );
    }
    const search = { keywords, type, pages, label: `${keywords} [${type}]` };
    if (
      !searches.some(
        (item) =>
          normalizeSearchKeyword(item.keywords) === normalizeSearchKeyword(keywords) &&
          item.type === type,
      )
    )
      searches.push(search);
  });
  return searches;
}

export function searchUrl(search) {
  const flags =
    search.type === 'All'
      ? ['gig', 'partTime', 'fullTime']
      : [{ Gig: 'gig', 'Part Time': 'partTime', 'Full Time': 'fullTime' }[search.type]];
  return `${ORIGIN}/jobseekers/jobsearch?jobkeyword=${encodeURIComponent(search.keywords)}&isFromJobsearchForm=1&${flags.map((flag) => `${flag}=on`).join('&')}`;
}
