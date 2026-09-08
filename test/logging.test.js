import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logging/logging.js';
import { collect, verifyJobs } from '../src/core.js';

const search = { keywords: 'developer', type: 'All', pages: 1, label: 'developer [All]' };
const empty = { status: 200, body: '<p>Displaying 0 out of 0 job</p>' };
function environment(responses) {
  let time = 0;
  const logs = [];
  return {
    logs,
    now: () => time,
    sleep: (ms) => {
      time += ms;
    },
    fetch: () => responses.shift(),
    log: createLogger('test', {
      now: () => time,
      executionId: 'test-run',
      sink: (line) => logs.push(JSON.parse(line)),
    }),
  };
}

test('logger emits JSON envelope and tolerates serialization failures', () => {
  const records = [];
  const log = createLogger('setup', {
    now: () => 0,
    executionId: 'fixed',
    sink: (line) => records.push(JSON.parse(line)),
  });
  log('started', { count: 2 });
  assert.deepEqual(records[0], {
    timestamp: '1970-01-01T00:00:00.000Z',
    executionId: 'fixed',
    operation: 'setup',
    level: 'info',
    event: 'started',
    details: { count: 2 },
  });
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => log('invalid', circular));
  assert.equal(records.length, 1);
});

test('request logs show retries, partial failure, source blocking, and exhausted budget', () => {
  const retry = environment([{ status: 503, body: '' }, empty]);
  assert.equal(collect([search], retry).pages, 1);
  assert.equal(retry.logs.filter((record) => record.event === 'request.retry').length, 1);
  const partial = environment([{ status: 400, body: '' }, empty]);
  const result = collect([search, { ...search, label: 'React [All]' }], partial);
  assert.equal(result.partial, true);
  assert.equal(result.pages, 1);
  assert.ok(partial.logs.some((record) => record.event === 'search.failed'));
  const blocked = environment([{ status: 429, body: '' }]);
  assert.equal(collect([search], blocked).stop, true);
  assert.equal(blocked.logs.find((record) => record.event === 'search.failed').details.stop, true);
  const budget = environment([]);
  collect([search], budget, -240000);
  assert.match(
    budget.logs.find((record) => record.event === 'search.failed').details.error,
    /budget/,
  );
});

test('job logs report closed, unknown, and budget stop without raw response bodies', () => {
  const job = {
    id: '123',
    title: 'React Developer',
    url: 'https://www.onlinejobs.ph/jobseekers/job/developer-123',
  };
  const closed = environment([{ status: 404, body: 'private response' }]);
  verifyJobs([job], closed);
  assert.equal(
    closed.logs.find((record) => record.event === 'job.checked').details.availability,
    'Closed',
  );
  assert.ok(!JSON.stringify(closed.logs).includes('private response'));
  const unknown = environment([{ status: 403, body: '' }]);
  verifyJobs([job], unknown);
  assert.equal(
    unknown.logs.find((record) => record.event === 'job.checked').details.availability,
    'Unknown',
  );
  const budget = environment([]);
  verifyJobs([job], budget, -240000);
  assert.ok(budget.logs.some((record) => record.event === 'verification.budget_exhausted'));
});

test('throwing optional observer does not change collector or verifier behavior', () => {
  const io = environment([empty, { status: 404, body: '' }]);
  io.log = () => {
    throw new Error('Observer unavailable');
  };
  assert.equal(collect([search], io).partial, false);
  const result = verifyJobs(
    [
      {
        id: '123',
        title: 'Developer',
        url: 'https://www.onlinejobs.ph/jobseekers/job/developer-123',
      },
    ],
    io,
  );
  assert.equal(result.results.get('123').state, 'Closed');
});
