import { RUN_BUDGET_MS, FINALIZE_RESERVE_MS } from '../config/settings.js';

export function deferredWork(stage) {
  return Object.assign(new Error(`Run budget reached; ${stage} deferred until next refresh.`), {
    deferred: true, stop: true, stage,
  });
}

/** Cooperative deadline; an in-flight Google call cannot be interrupted. */
export function createRunBudget(started = Date.now(), now = () => Date.now()) {
  return {
    check(stage) {
      if (now() - started >= RUN_BUDGET_MS - FINALIZE_RESERVE_MS) throw deferredWork(stage);
    },
  };
}
