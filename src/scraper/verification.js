import { createRequester } from '../platform/requests.js';
import { emit } from '../logging/logging.js';
import {
  MAX_JOB_CHECKS_PER_RUN,
  NETWORK_BUDGET_MS,
  PREFERRED_JOB_SLOTS,
  SECONDARY_JOB_SLOTS,
} from '../config/settings.js';
import { isPreferredCandidate } from '../jobs/matching.js';
import { safeJobUrl, inspectJob } from './parsing.js';
export function verifyJobs(jobs, io, started = io.now(), cursors = {}) {
  const results = new Map();
  const errors = [];
  let deferred = false;
  // Stable ID ordering makes the cursor work even when search results change.
  const ordered = [...new Map(jobs.map((job) => [job.id, job])).values()].sort(
    (a, b) => Number(b.id) - Number(a.id),
  );
  const rotate = (items, afterId) => {
    const nextIndex = afterId ? items.findIndex((job) => Number(job.id) < Number(afterId)) : 0;
    const offset = nextIndex < 0 ? 0 : nextIndex;
    return [...items.slice(offset), ...items.slice(0, offset)];
  };
  const preferred = rotate(ordered.filter(isPreferredCandidate), cursors.preferred);
  const secondary = rotate(
    ordered.filter((job) => !isPreferredCandidate(job)),
    cursors.secondary,
  );
  const preferredCount = Math.min(
    preferred.length,
    PREFERRED_JOB_SLOTS + Math.max(0, SECONDARY_JOB_SLOTS - secondary.length),
  );
  const batch = [
    ...preferred.slice(0, preferredCount),
    ...secondary.slice(0, MAX_JOB_CHECKS_PER_RUN - preferredCount),
  ];
  emit(io, 'verification.batch', {
    candidates: ordered.length,
    preferred: preferredCount,
    secondary: batch.length - preferredCount,
    selected: batch.length,
  });
  const request = createRequester(io, started, 'detail');
  const nextCursors = { ...cursors };
  for (const job of batch) {
    if (io.now() - started >= NETWORK_BUDGET_MS) {
      deferred = true;
      errors.push('Network budget reached; remaining candidates deferred until a later run.');
      emit(io, 'verification.budget_exhausted', { checked: results.size }, 'warn');
      break;
    }
    try {
      const response = request(() => safeJobUrl(job.url, job.id), { jobId: job.id });
      results.set(job.id, { ...inspectJob(response, job), checked: new Date(io.now()) });
      const check = results.get(job.id);
      emit(io, 'job.checked', {
        jobId: job.id,
        availability: check.state,
        score: check.score || 0,
        skills: check.skills,
      });
      nextCursors[isPreferredCandidate(job) ? 'preferred' : 'secondary'] = job.id;
    } catch (error) {
      if (error.deferred) {
        deferred = true;
        errors.push(error.message);
        break;
      }
      emit(
        io,
        'job.checked',
        {
          jobId: job.id,
          availability: 'Unknown',
          score: 0,
          error: error.message,
          stop: Boolean(error.stop),
        },
        'error',
      );
      errors.push(`Job ${job.id}: ${error.message}`);
      results.set(job.id, { state: 'Unknown', checked: new Date(io.now()), skills: [] });
      nextCursors[isPreferredCandidate(job) ? 'preferred' : 'secondary'] = job.id;
      if (error.stop) break;
    }
  }
  emit(io, 'verification.completed', {
    checked: results.size,
    errors: errors.length,
    deferred: Math.max(0, ordered.length - results.size),
    limited: ordered.length > batch.length,
  });
  return { results, errors, cursors: nextCursors, deferred, remaining: ordered.length - results.size, limited: deferred || ordered.length > batch.length };
}
