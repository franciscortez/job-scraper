import { createRequester } from '../platform/requests.js';
import { emit } from '../logging/logging.js';
import { JOB_HEADERS, JOB_COLUMN, JOB_INDEX, MAX_RECHECKS_PER_RUN, RECHECK_INTERVAL_MS } from '../config/settings.js';
import { rowJob } from '../jobs/job-rows.js';
import { readJobTabs } from '../spreadsheet/job-tabs.js';
import { safeJobUrl, inspectJob } from './parsing.js';

const SKIPPED_STATUSES = ['Applied', 'Interviewing', 'Closed'];
const checkedTime = value =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : null;
const fetchable = row => {
  try {
    safeJobUrl(String(row[JOB_INDEX['URL']]), String(row[0]));
    return true;
  } catch {
    return false;
  }
};

/** Recheck a bounded slice of saved rows; only Availability and Last Checked are written. */
export function recheckSavedJobs(tables, io, started, budget = { check() {} }) {
  const now = io.now();
  const candidates = readJobTabs(tables)
    .filter(({ row }) => {
      const time = checkedTime(row[JOB_INDEX['Last Checked']]);
      return !SKIPPED_STATUSES.includes(row[JOB_INDEX['Status']]) &&
        row[JOB_INDEX['Availability']] !== 'Closed' &&
        fetchable(row) &&
        (time === null || now - time >= RECHECK_INTERVAL_MS);
    })
    // Never-checked rows first, then the oldest check; newest ID breaks ties.
    .sort((a, b) =>
      (checkedTime(a.row[JOB_INDEX['Last Checked']]) ?? -Infinity) -
        (checkedTime(b.row[JOB_INDEX['Last Checked']]) ?? -Infinity) ||
      Number(b.row[0]) - Number(a.row[0]))
    .slice(0, MAX_RECHECKS_PER_RUN);
  const request = createRequester(io, started, 'recheck');
  const errors = [];
  let checked = 0;
  let closed = 0;
  for (const { tab, row, rowNumber } of candidates) {
    const job = rowJob(row);
    let state = null;
    try {
      budget.check('recheck');
      state = inspectJob(request(() => safeJobUrl(job.url, job.id), { jobId: job.id }), job).state;
    } catch (error) {
      if (error.deferred || error.stop) {
        if (error.stop && !error.deferred) errors.push(`Recheck ${job.id}: ${error.message}`);
        emit(io, 'recheck.stopped', { jobId: job.id, error: error.message }, 'warn');
        break;
      }
      errors.push(`Recheck ${job.id}: ${error.message}`);
    }
    // Re-read after network work so a shifted or edited row is never overwritten.
    const current = tab.getRange(rowNumber, 1, 1, JOB_HEADERS.length).getValues()[0];
    if (String(current[0]) !== job.id) continue;
    const availability = ['Open', 'Closed'].includes(state) ? state : current[JOB_INDEX['Availability']];
    tab.getRange(rowNumber, JOB_COLUMN['Availability'], 1, 2).setValues([[availability, new Date(io.now())]]);
    checked++;
    if (state === 'Closed') closed++;
    emit(io, 'job.rechecked', { jobId: job.id, availability: state || 'Unknown' });
  }
  emit(io, 'recheck.completed', { candidates: candidates.length, checked, closed, errors: errors.length });
  return { checked, closed, errors };
}
