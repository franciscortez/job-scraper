import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunBudget } from '../src/platform/budget.js';
import { verifyJobs } from '../src/scraper/verification.js';
import { NETWORK_BUDGET_MS, RUN_BUDGET_MS, FINALIZE_RESERVE_MS } from '../src/config/settings.js';

test('shared work deadline reserves finalization time and uses exact boundary', () => {
  let time = RUN_BUDGET_MS - FINALIZE_RESERVE_MS - 1;
  const budget = createRunBudget(0, () => time);
  assert.doesNotThrow(() => budget.check('cleanup'));
  time++;
  assert.throws(() => budget.check('cleanup'), e => e.deferred && e.stage === 'cleanup');
});

test('deferred detail requests do not advance cursor or manufacture checked records', () => {
  let time = NETWORK_BUDGET_MS - 500;
  const io = { now:()=>time, sleep:ms=>{time+=ms;}, fetch:()=>{throw new Error('Unexpected fetch');} };
  const result = verifyJobs([{id:'123',title:'React Developer',url:'https://www.onlinejobs.ph/jobseekers/job/react-123'}],io,0,{secondary:'456'});
  assert.equal(result.deferred,true); assert.equal(result.results.size,0);
  assert.equal(result.cursors.secondary,'456'); assert.equal(result.remaining,1);
});
