import { createRunBudget } from '../platform/budget.js';
import { openExpiredJobs, expiredIds, removeExpiredJobs } from '../spreadsheet/expiry.js';
import { openApplications, applicationRows, moveApplications } from '../spreadsheet/applications.js';
import { openJobTabs, readJobTabs, appendRows } from '../spreadsheet/job-tabs.js';
import {
  SEARCH_HEADERS,
  JOB_HEADERS,
  RUN_HEADERS,
  RETENTION_MS,
  JOB_TAB_TYPES,
} from '../config/settings.js';
import { readSearches, selectSearches } from './searches.js';
import { mergeJobs, postedTime, applyVerification } from '../jobs/job-rows.js';
import {
  spreadsheet,
  sheet,
  rows,
  prepareJobFilter,
  sortJobsByDate,
  logRun,
  pruneRunLogs,
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
      const budget = createRunBudget(started.getTime());
      let result;
      let moved = 0;
      let checked = 0;
      let skippedKnown = 0;
      let added = 0,
        updated = 0,
        removed = 0;
      let outcome = 'Failed';
      let errorText = '';
      try {
        pruneRunLogs(runs, started.getTime());
        budget.check('initialization');
        const history = openExpiredJobs(book);
        const excludedIds = expiredIds(history);
        const tables = openJobTabs(book, JOB_TAB_TYPES, log);
        const applications = openApplications(book);
        moved = moveApplications(tables, applications, log, budget);
        budget.check('cleanup');
        removed = removeExpiredJobs(tables, history, started.getTime(), log, budget);
        for (const id of expiredIds(history)) excludedIds.add(id);
        const knownIds = new Set([
          ...excludedIds,
          ...readJobTabs(tables).map(entry => String(entry.row[0])),
          ...applicationRows(applications).map(row => String(row[0])),
        ]);
        budget.check('search preparation');
        for (const { tab } of tables) prepareJobFilter(tab);
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
          skippedKnown = result.jobs.filter(job => knownIds.has(String(job.id))).length;
          const { candidates, recent } = prepareCandidates(
            result.jobs.filter(job => !knownIds.has(String(job.id))), Date.now());
          log('candidates.prepared', {
            discovered: result.jobs.length,
            skippedKnown,
            recent: recent.length,
            candidates: candidates.size,
          });
          const verification = verifyCandidates(result, candidates, io, started, properties);
          checked = verification.results.size;
          for (const search of searches) {
            const discovered = result.jobs.filter(job => job.matches.includes(search.label));
            const eligible = discovered.filter(job => candidates.has(job.id));
            log('search.coverage', {
              search: search.label,
              discovered: discovered.length,
              skippedKnown: discovered.filter(job => knownIds.has(String(job.id))).length,
              eligible: eligible.length,
              checked: eligible.filter(job => verification.results.has(job.id)).length,
              deferred: eligible.filter(job => !verification.results.has(job.id)).length,
            });
          }
          if (result.stop) log('verification.skipped', { reason: verification.errors[0] }, 'warn');
          result.errors.push(...verification.errors);
          result.partial ||= verification.errors.length > 0;
          const merged = saveVerifiedJobs(tables, applications, recent, verification, excludedIds, budget);
          log('jobs.saved', {
            added: merged.added,
            updated: merged.updated,
            total: merged.rows.length,
          });
          added = merged.added;
          persistCursors(properties, verification, selection, result.stop, log);
          updated = merged.updated;
          outcome = scraperOutcome(result, verification);
          if (outcome !== 'Failed') {
            for (const { tab } of tables) sortJobsByDate(tab, budget, log);
          }
          errorText = result.errors.join('\n');
        }
      } catch (error) {
        outcome = error.deferred ? 'Limited' : 'Failed';
        if (error.deferred) log('work.deferred', { stage: error.stage }, 'warn');
        moved = error.moved ?? moved;
        added = error.added ?? added;
        removed = error.removed ?? removed;
        errorText = error.message;
        if (!error.deferred) log('scraper.failed', { error: errorText }, 'error');
      }
      log(
        'scraper.completed',
        {
          outcome,
          durationMs: Date.now() - started.getTime(),
          pages: result?.pages || 0,
          checked,
          skippedKnown,
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
        `${outcome}: ${added} added, ${skippedKnown} already saved, ${moved} moved to Applications. ${removed} expired jobs removed; newest posts first. ${errorText ? 'See Runs for details.' : ''}`,
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

function prepareCandidates(discovered, now) {
  const recent = discovered.filter((job) => {
    const posted = postedTime(job.posted);
    return posted !== null && posted <= now && now - posted < RETENTION_MS;
  });
  return { candidates: new Map(recent.map(job => [job.id, job])), recent };
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

function saveVerifiedJobs(tables, applications, recent, verification, excludedIds, budget) {
  budget.check('saving new jobs');
  // Read again after network work: user edits and newly inserted IDs must survive.
  const existing = readJobTabs(tables);
  const knownIds = new Set([
    ...excludedIds,
    ...existing.map(entry => String(entry.row[0])),
    ...applicationRows(applications).map(row => String(row[0])),
  ]);
  const accepted = recent
    .filter(job => !knownIds.has(String(job.id)) && verification.results.get(job.id)?.state === 'Open')
    .map(job => {
      const check = verification.results.get(job.id);
      return { ...job, title: check.title, type: check.type };
    });
  const additions = mergeJobs([], accepted, new Date());
  applyVerification(additions.rows, verification.results);
  let added = 0;
  try {
    for (const { type, tab } of tables) {
      const batch = additions.rows.filter(row => row[4] === type);
      if (batch.length) budget.check('appending jobs');
      appendRows(tab, batch, JOB_HEADERS);
      added += batch.length;
      prepareJobFilter(tab);
    }
    SpreadsheetApp.flush();
  } catch (error) {
    error.added = added;
    throw error;
  }
  return { rows: [...existing.map(entry => entry.row), ...additions.rows], added, updated: 0 };
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
  if (collection.deferred || verification.deferred) return 'Limited';
  if (collection.partial) return collection.pages ? 'Partial' : 'Failed';
  return verification.limited ? 'Limited' : 'Success';
}
