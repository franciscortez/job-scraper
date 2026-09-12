import { deferredWork } from './budget.js';
import { NETWORK_BUDGET_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '../config/settings.js';
import { emit } from '../logging/logging.js';

export function assertBudget(io, started, message) {
  if (io.now() - started >= NETWORK_BUDGET_MS) {
    throw Object.assign(deferredWork('network requests'), { message });
  }
}

/** Search and detail requests retain their different pacing and status policies. */
export function createRequester(io, started, kind) {
  let attempts = 0;
  const isSearch = kind === 'search';
  const budgetMessage = isSearch
    ? 'Network budget reached; remaining pages skipped.'
    : 'Network budget reached.';
  return (getUrl, context = {}) => {
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      if (isSearch) {
        if (attempts++) io.sleep(REQUEST_DELAY_MS);
      } else {
        io.sleep(REQUEST_DELAY_MS * (retry ? 2 ** retry : 1));
      }
      assertBudget(io, started, budgetMessage);
      const response = io.fetch(getUrl());
      emit(io, 'request.completed', {
        kind,
        ...context,
        attempt: retry + 1,
        status: response.status,
      });
      if ([401, 403, 429].includes(response.status)) {
        const action = isSearch ? 'run stopped' : 'verification stopped';
        throw Object.assign(new Error(`HTTP ${response.status}; ${action}.`), { stop: true });
      }
      if (response.status >= 500 && retry < MAX_RETRIES) {
        emit(
          io,
          'request.retry',
          { kind, ...context, attempt: retry + 1, status: response.status },
          'warn',
        );
        if (isSearch) io.sleep(REQUEST_DELAY_MS * 2 ** retry);
        continue;
      }
      if (isSearch && response.status !== 200)
        throw new Error(`HTTP ${response.status} fetching search.`);
      return response;
    }
  };
}
