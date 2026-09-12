import { postedTime } from '../jobs/job-rows.js';
import { createRequester, assertBudget } from '../platform/requests.js';
import { emit } from '../logging/logging.js';
import { safeSearchUrl, parsePage } from './parsing.js';
import { searchUrl } from './searches.js';
export function collect(searches, io, start = io.now()) {
  const jobs = new Map();
  const errors = [];
  let pages = 0,
    processed = 0;
  let deferred = false;
  let partial = false,
    stop = false;
  const request = createRequester(io, start, 'search');
  const budget = () =>
    assertBudget(io, start, 'Network budget reached; remaining pages skipped.');
  for (const search of searches) {
    emit(io, 'search.started', { search: search.label, maxPages: search.pages });
    let url = searchUrl(search);
    const seen = new Set();
    let oldest = null;
    let searchPages = 0;
    try {
      for (let page = 0; page < search.pages && url; page++) {
        budget();
        if (seen.has(url)) throw new Error('Repeated pagination URL.');
        seen.add(url);
        const response = request(() => safeSearchUrl(url), {
          search: search.label,
          page: page + 1,
        });
        budget();
        let parsed;
        try {
          parsed = parsePage(response.body);
        } catch (error) {
          if (/Access challenge/.test(error.message)) error.stop = true;
          throw error;
        }
        pages++;
        searchPages++;
        for (const job of parsed.jobs) {
          const date = postedTime(job.posted);
          if (date !== null) oldest = oldest === null ? date : Math.min(oldest, date);
        }
        emit(io, 'search.page', { search: search.label, page: page + 1, jobs: parsed.jobs.length });
        for (const job of parsed.jobs) {
          const previous = jobs.get(job.id);
          jobs.set(job.id, {
            ...job,
            matches: [...new Set([...(previous?.matches || []), search.label])],
          });
        }
        url = parsed.next;
      }
      processed++;
      emit(io, 'search.completed', { search: search.label, pages: searchPages, oldestPosted: oldest === null ? null : new Date(oldest).toISOString(), morePages: Boolean(url) });
    } catch (error) {
      emit(
        io,
        'search.failed',
        { search: search.label, error: error.message, stop: Boolean(error.stop) },
        'error',
      );
      deferred ||= Boolean(error.deferred);
      partial = true;
      errors.push(`${search.label}: ${error.message}`);
      if (error.stop) {
        stop = true;
        break;
      }
    }
  }
  emit(io, 'collection.completed', { pages, processed, candidates: jobs.size, partial, stop });
  return { jobs: [...jobs.values()], pages, processed, partial, stop, errors, deferred };
}
