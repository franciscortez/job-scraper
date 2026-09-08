import { openApplications, applicationRows, moveApplications } from '../spreadsheet/applications.js';
import { openJobTabs, readJobTabs, saveJobTabs } from '../spreadsheet/job-tabs.js';
import {
  SEARCH_HEADERS,
  JOB_HEADERS,
  RUN_HEADERS,
  RETENTION_MS,
  JOB_COLUMN,
  JOB_INDEX,
  JOB_TAB_TYPES,
} from '../config/settings.js';
import { readSearches, selectSearches } from './searches.js';
import { mergeJobs, postedTime, rowJob, applyVerification } from '../jobs/job-rows.js';
import {
  spreadsheet,
  sheet,
  rows,
  showOpenJobs,
  logRun,
  removeExpiredJobs,
} from '../spreadsheet/sheets.js';
import { applyProfile } from '../spreadsheet/profile.js';
import { locked, createIo } from '../platform/runtime.js';
import { collect } from './collection.js';
import { verifyJobs } from './verification.js';
export function runScraper(log = () => {}) {
  const book = spreadsheet();
  const runs = sheet(book, 'Runs', RUN_HEADERS);
  return locked(
    () => {
      const started = new Date();
      let result;
      let moved = 0;
      let checked = 0;
      let added = 0,
        updated = 0,
        removed = 0;
      let outcome = 'Failed';
      let errorText = '';
      try {
        const tables = openJobTabs(book, JOB_TAB_TYPES);
        const applications = openApplications(book);
        moved = moveApplications(tables, applications, log);
        const applicationIds = new Set(applicationRows(applications).map(row => String(row[0])));
        const beforeCleanup = readJobTabs(tables);
        for (const { tab } of tables) {
          removed += removeExpiredJobs(tab, rows(tab, JOB_HEADERS.length), started.getTime());
        }
        log('cleanup.completed', { removed, existing: beforeCleanup.length });
        const remaining = readJobTabs(tables).map((entry) => entry.row);
        for (const { tab } of tables) {
          const count = Math.max(0, tab.getLastRow() - 1);
          if (count)
            tab
              .getRange(2, JOB_COLUMN['Availability'], count, 1)
              .setValues(Array.from({ length: count }, () => ['Unknown']));
          showOpenJobs(tab);
        }
        const searchTab = sheet(book, 'Searches', SEARCH_HEADERS);
        applyProfile(searchTab);
        const properties = PropertiesService.getDocumentProperties();
        const selection = selectSearches(
          readSearches(rows(searchTab, 4)),
          properties.getProperty('secondarySearchCursor') || '',
        );
        const searches = selection.searches;
        log('searches.selected', {
          searches: searches.map((search) => ({
            keyword: search.keywords,
            type: search.type,
            maxPages: search.pages,
          })),
        });
        if (!searches.length) {
          outcome = 'Skipped';
          errorText = 'No enabled searches with keywords.';
        } else {
          const io = createIo(log);
          result = collect(searches, io, started.getTime());
          const { candidates, recent } = prepareCandidates(remaining, result.jobs.filter(job => !applicationIds.has(String(job.id))), Date.now());
          log('candidates.prepared', {
            discovered: result.jobs.length,
            recent: recent.length,
            candidates: candidates.size,
          });
          const verification = verifyCandidates(result, candidates, io, started, properties);
          checked = verification.results.size;
          if (result.stop) log('verification.skipped', { reason: verification.errors[0] }, 'warn');
          result.errors.push(...verification.errors);
          result.partial ||= verification.errors.length > 0;
          const merged = saveVerifiedJobs(tables, recent, verification);
          log('jobs.saved', {
            added: merged.added,
            updated: merged.updated,
            total: merged.rows.length,
          });
          persistCursors(properties, verification, selection, result.stop, log);
          added = merged.added;
          updated = merged.updated;
          outcome = scraperOutcome(result, verification);
          errorText = result.errors.join('\n');
        }
      } catch (error) {
        moved = error.moved ?? moved;
        errorText = error.message;
        log('scraper.failed', { error: errorText }, 'error');
      }
      log(
        'scraper.completed',
        {
          outcome,
          durationMs: Date.now() - started.getTime(),
          pages: result?.pages || 0,
          checked,
          added,
          updated,
          removed,
          moved,
          errors: errorText ? errorText.split('\n') : [],
        },
        outcome === 'Failed' ? 'error' : outcome === 'Success' ? 'info' : 'warn',
      );
      logRun(runs, [
        started,
        (Date.now() - started.getTime()) / 1000,
        result?.processed || 0,
        result?.pages || 0,
        added,
        updated,
        outcome,
        errorText,
        removed,
      ]);
      book.toast(
        `${outcome}: ${added} added, ${updated} updated, ${moved} moved to Applications, ${removed} expired rows removed. ${errorText ? 'See Runs for details.' : ''}`,
        'Job Tracker',
        8,
      );
      return { outcome, added, updated, removed, moved, error: errorText };
    },
    () => {
      log('scraper.skipped', { reason: 'Another tracker operation is running.' }, 'warn');
      log(
        'scraper.completed',
        {
          outcome: 'Skipped',
          durationMs: 0,
          pages: 0,
          checked: 0,
          added: 0,
          updated: 0,
          removed: 0,
          errors: ['Another tracker operation is running.'],
        },
        'warn',
      );
      logRun(runs, [
        new Date(),
        0,
        0,
        0,
        0,
        0,
        'Skipped',
        'Another tracker operation is running.',
        0,
      ]);
      return { outcome: 'Skipped' };
    },
  );
}

function prepareCandidates(remaining, discovered, now) {
  const candidates = new Map(
    remaining.map((row) => [String(row[JOB_INDEX['Job ID']]), { ...rowJob(row), tracked: true }]),
  );
  const recent = discovered.filter((job) => {
    const posted = postedTime(job.posted);
    return posted !== null && posted <= now && now - posted < RETENTION_MS;
  });
  for (const job of recent) {
    const previous = candidates.get(job.id);
    candidates.set(job.id, {
      ...job,
      checked: previous?.checked,
      priorSkills: previous?.priorSkills || [],
    });
  }
  return { candidates, recent };
}

function verifyCandidates(result, candidates, io, started, properties) {
  const verification = result.stop
    ? {
        results: new Map(),
        errors: ['Availability verification skipped after source access failure.'],
      }
    : verifyJobs([...candidates.values()], io, started.getTime(), {
        preferred: properties.getProperty('preferredJobCursor') || '',
        secondary: properties.getProperty('secondaryJobCursor') || '',
      });
  return verification;
}

function saveVerifiedJobs(tables, recent, verification) {
  const accepted = recent
    .filter((job) => verification.results.get(job.id)?.state === 'Open')
    .map((job) => {
      const check = verification.results.get(job.id);
      return { ...job, title: check.title, type: check.type };
    });
  // Read again after network work so edits made during fetching survive.
  const existing = readJobTabs(tables);
  const merged = mergeJobs(
    existing.map((entry) => entry.row),
    accepted,
    new Date(),
  );
  // Rechecked jobs can change type even when absent from this run's search pages.
  for (const row of merged.rows) {
    const check = verification.results.get(String(row[0]));
    if (check?.state === 'Open') row[JOB_INDEX['Employment Type']] = check.type;
  }
  applyVerification(merged.rows, verification.results);
  saveJobTabs(tables, existing, merged);
  return merged;
}

function persistCursors(properties, verification, selection, stopped, log) {
  if (verification.cursors?.preferred)
    properties.setProperty('preferredJobCursor', verification.cursors.preferred);
  if (verification.cursors?.secondary)
    properties.setProperty('secondaryJobCursor', verification.cursors.secondary);
  if (!stopped && selection.cursor)
    properties.setProperty('secondarySearchCursor', selection.cursor);
  log('cursors.saved', {
    preferred: verification.cursors?.preferred || '',
    secondary: verification.cursors?.secondary || '',
    search: !stopped ? selection.cursor : null,
  });
}

function scraperOutcome(collection, verification) {
  if (collection.partial) return collection.pages ? 'Partial' : 'Failed';
  return verification.limited ? 'Limited' : 'Success';
}
