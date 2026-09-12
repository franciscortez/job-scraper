import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEARCHES, RETENTION_MS, postedTime, expiredRow, matchedSkills, inspectJob, verifyJobs, searchUrl } from '../src/core.js';

const job = { id: '123', title: 'React Developer', type: 'Part Time', snippet: '', skills: 'TypeScript', url: 'https://www.onlinejobs.ph/jobseekers/job/react-developer-123' };
const detail = (description = 'Build React applications.', title = 'React Developer', type = 'Part Time') => `<h1 class="job__title" data-jobid="123">${title}</h1><h3>Please <a>login</a> or <a>register</a> as jobseeker to apply for this job.</h3><dd><h3>TYPE OF WORK</h3><p>${type}</p></dd><p id="job-description" data-jobid="123">${description}</p>`;
const response = body => ({ status: 200, body });

test('profile matches technical skills and rejects unrelated roles', () => {
  assert.equal(DEFAULT_SEARCHES.length, 9);
  assert.deepEqual(matchedSkills(job), ['React', 'TypeScript']);
  assert.deepEqual(matchedSkills({ ...job, title: 'Social Media Manager' }), []);
  assert.deepEqual(matchedSkills({ title: 'Automation Specialist', skills: '', snippet: 'n8n, GoHighLevel, GHL, Go High Level' }), []);
  assert.deepEqual(matchedSkills({ title: 'React Developer', skills: 'React', snippet: 'n8n and GoHighLevel' }), ['React']);
  assert.ok(DEFAULT_SEARCHES.every(row => row[2] === 'All'));
});

test('14-day boundary uses Manila posting time, validates dates, falls back only for old rows', () => {
  const posted = postedTime('2026-09-01 08:00:00');
  assert.equal(posted, Date.parse('2026-09-01T00:00:00Z'));
  const row = []; row[5] = '2026-09-01 08:00:00'; row[9] = new Date(posted + 10000);
  assert.equal(expiredRow(row, posted + RETENTION_MS - 1), false);
  assert.equal(expiredRow(row, posted + RETENTION_MS), true);
  assert.equal(postedTime('2026-02-30 08:00:00'), null);
  assert.equal(postedTime('2026-09-01 25:00:00'), null);
  row[5] = ''; assert.equal(expiredRow(row, row[9].getTime() + RETENTION_MS), true);
  row[9] = ''; assert.equal(expiredRow(row, Date.now()), false);
});

test('open accepts all employment types while requiring identity, application control and resume skills', () => {
  assert.equal(inspectJob(response(detail()), job).state, 'Open');
  assert.throws(() => inspectJob(response(detail().replaceAll('data-jobid="123"', 'data-jobid="999"')), job), /identity/);
  assert.throws(() => inspectJob(response(detail().replace(/<h3>Please.*?<\/h3>/, '')), job), /application control/);
  for (const type of ['Full Time', 'Part Time', 'Gig', 'Any']) assert.equal(inspectJob(response(detail('React', 'React Developer', type)), job).state, 'Open');
  assert.equal(inspectJob(response(detail('React', 'Social Media Manager')), job).state, 'Not a match');
  assert.equal(inspectJob(response(detail('React', 'React Developer', '')), job).state, 'Not a match');
  assert.equal(inspectJob(response(detail('Part-time React work', 'React Developer', 'Any')), job).state, 'Open');
});

test('All search requests include full-time, part-time and gig filters', () => {
  const url = new URL(searchUrl({ keywords: 'React', type: 'All' }));
  for (const flag of ['fullTime', 'partTime', 'gig']) assert.equal(url.searchParams.get(flag), 'on');
});

test('closed notices beat generic application links without misreading unrelated wording', () => {
  assert.equal(inspectJob(response(detail('This position is no longer available.')), job).state, 'Closed');
  assert.equal(inspectJob(response(detail('', 'React Developer - NO LONGER AVAILABLE')), job).state, 'Closed');
  assert.equal(inspectJob(response(detail('This job is NOT closed. React work.')), job).state, 'Open');
  assert.equal(inspectJob(response(detail('Previous developer is no longer available.')), job).state, 'Open');
  assert.equal(inspectJob({ status: 404 }, job).state, 'Closed');
  assert.equal(inspectJob({ status: 410 }, job).state, 'Closed');
  assert.throws(() => inspectJob(response('<title>Just a moment</title>'), job), /challenge/);
});

test('verification stops on rate limit and does not falsely mark remaining jobs open', () => {
  let calls = 0, time = 0;
  const result = verifyJobs([job, { ...job, id: '456', url: job.url.replace('123', '456') }], { now: () => time, sleep: ms => { time += ms; }, fetch: () => { calls++; return { status: 429 }; } });
  assert.equal(calls, 1); assert.equal(result.results.get('456').state, 'Unknown');
  assert.equal(result.results.has('123'), false); assert.match(result.errors[0], /429/);
});

test('checks at most 50 unique jobs and rotates through remaining candidates', () => {
  const jobs = Array.from({ length: 120 }, (_, i) => ({ ...job, id: String(i + 1), url: `https://www.onlinejobs.ph/jobseekers/job/developer-${i + 1}` }));
  let calls = 0;
  const io = { now: () => 0, sleep() {}, fetch: () => { calls++; return { status: 410 }; } };
  const first = verifyJobs([...jobs, jobs[0]], io);
  assert.equal(calls, 50); assert.equal(first.results.size, 50); assert.equal(first.limited, true);
  const second = verifyJobs(jobs, io, 0, first.cursors);
  assert.equal(calls, 100); assert.ok([...second.results.keys()].every(id => !first.results.has(id)));
  const third = verifyJobs(jobs, io, 0, second.cursors);
  assert.equal(calls, 150); assert.equal(new Set([...first.results.keys(), ...second.results.keys(), ...third.results.keys()]).size, 120);
});

test('cursor resumes safely when previous job disappears and wraps after the last ID', () => {
  const jobs = ['10', '8', '4'].map(id => ({ ...job, id, url: `https://www.onlinejobs.ph/jobseekers/job/developer-${id}` }));
  const io = { now: () => 0, sleep() {}, fetch: () => ({ status: 410 }) };
  assert.deepEqual([...verifyJobs(jobs, io, 0, { secondary: '9' }).results.keys()], ['8', '4', '10']);
  assert.deepEqual([...verifyJobs(jobs, io, 0, { secondary: '1' }).results.keys()], ['10', '8', '4']);
});

test('verification honors shared time budget and retries server failures', () => {
  let time = 239500, calls = 0;
  const io = { now: () => time, sleep: ms => { time += ms; }, fetch: () => { calls++; return calls < 3 ? { status: 503 } : response(detail()); } };
  assert.equal(verifyJobs([job], io, 0).results.size, 0);
  assert.equal(calls, 0);
  time = 0;
  assert.equal(verifyJobs([job], io, 0).results.get('123').state, 'Open'); assert.equal(calls, 3);
});
