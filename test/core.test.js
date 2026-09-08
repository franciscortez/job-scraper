import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePage, readSearches, searchUrl, safeSearchUrl, mergeJobs, collect, cell } from '../src/core.js';

const html = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8');
const empty = '<p>Displaying 0 out of 0 job</p>';
const search = { keywords: 'developer', type: 'All', pages: 3, label: 'developer [All]' };
function fake(responses, step = 0) {
  let time = 0;
  const calls = [], sleeps = [];
  return { calls, sleeps, now: () => time, sleep: ms => { time += ms; sleeps.push(ms); }, fetch: url => {
    calls.push(url); time += step;
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected extra fetch');
    return next;
  } };
}
const ok = body => ({ status: 200, body });

test('parses source-shaped cards, nested links, optional fields and entities', () => {
  const page = parsePage(html);
  assert.equal(page.jobs.length, 2);
  assert.deepEqual(page.jobs[0], {
    id: '12345', title: 'Frontend & UI Developer', url: 'https://www.onlinejobs.ph/jobseekers/job/frontend-developer-12345',
    salary: '$50/hour', type: 'Full Time', posted: '2026-09-08 10:09:25',
    snippet: 'Build interfaces. Work with React & TypeScript…', skills: 'React, TypeScript',
  });
  assert.equal(page.jobs[1].salary, '');
  assert.equal(page.jobs[1].skills, '');
  assert.equal(page.jobs[1].snippet, 'Organize “projects”.');
  assert.equal(page.jobs[1].posted, '2026-09-08 09:00:00');
  assert.equal(page.next, 'https://www.onlinejobs.ph/jobseekers/jobsearch/30?jobkeyword=developer&fullTime=on');
});

test('zero results accepted; blocked or changed markup rejected', () => {
  assert.deepEqual(parsePage(empty), { jobs: [], next: null });
  assert.throws(() => parsePage('<title>Just a moment...</title>'), /Access challenge/);
  assert.throws(() => parsePage('<p>Sign in</p>'), /Expected job cards/);
  assert.throws(() => parsePage(html.replace('frontend-developer-12345', 'invalid')), /missing ID/);
  assert.throws(() => parsePage(html.replace('Frontend &amp; UI Developer', '')), /missing ID or title/);
});

test('pagination cannot fetch external origins or other paths', () => {
  assert.equal(safeSearchUrl('/jobseekers/jobsearch/30?q=x'), 'https://www.onlinejobs.ph/jobseekers/jobsearch/30?q=x');
  for (const url of ['https://evil.test/jobseekers/jobsearch', 'https://www.onlinejobs.ph.evil.test/jobseekers/jobsearch', '/jobseekers/jobsearch/../../private', '//evil.test/jobseekers/jobsearch']) assert.throws(() => safeSearchUrl(url));
});

test('search settings validate limits, ignore blank/disabled and encode keywords', () => {
  assert.deepEqual(readSearches([[false, 'x'], [true, '  ']]), []);
  const [item] = readSearches([[true, ' C++ & UI ', 'Part Time', 2]]);
  assert.equal(item.keywords, 'C++ & UI');
  assert.match(searchUrl(item), /jobkeyword=C%2B%2B%20%26%20UI/);
  assert.match(searchUrl(item), /partTime=on/);
  assert.doesNotMatch(searchUrl(item), /fullTime=on/);
  assert.equal(readSearches([[true, 'x'], [true, 'x']]).length, 1);
  assert.throws(() => readSearches([[true, 'x', 'All', 4]]), /Max Pages/);
  assert.throws(() => readSearches([[true, 'x', 'Contract']]), /employment type/);
  assert.equal(readSearches(Array.from({ length: 9 }, (_, i) => [true, `x${i}`])).length, 9);
});

test('merge preserves tracking and first seen; deduplicates and keeps absent jobs', () => {
  const initial = parsePage(html).jobs.map(job => ({ ...job, matches: ['developer [All]'] }));
  const firstDate = new Date('2026-09-08T00:00:00Z');
  const first = mergeJobs([], [...initial, initial[0]], firstDate);
  assert.equal(first.added, 2);
  first.rows[0][11] = 'Applied'; first.rows[0][12] = 'Interview Friday';
  const nextDate = new Date('2026-09-08T01:00:00Z');
  const second = mergeJobs(first.rows, [{ ...initial[0], title: 'Updated title', matches: ['frontend [All]'] }], nextDate);
  assert.equal(second.added, 0); assert.equal(second.updated, 1);
  assert.equal(second.rows.length, 2);
  assert.equal(second.rows[0][1], 'Updated title');
  assert.equal(second.rows[0][9], firstDate);
  assert.equal(second.rows[0][10], nextDate);
  assert.deepEqual([second.rows[0][11], second.rows[0][12]], ['Applied', 'Interview Friday']);
  assert.equal(second.rows[0][8], 'developer [All]\nfrontend [All]');
  assert.deepEqual(second.rows[1], first.rows[1]);
  assert.throws(() => mergeJobs([first.rows[0], first.rows[0]], [], nextDate), /duplicate IDs/);
});

test('formula-like scraped values are written literally', () => {
  for (const text of ['=IMPORTXML("x")', '+cmd', '-5', '@test', ' \t=1']) assert.equal(cell(text), "'" + text);
  assert.equal(cell('Normal text'), 'Normal text');
  assert.equal(cell(0), 0);
});

test('collector follows next links and combines overlapping searches', () => {
  const io = fake([ok(html), ok(empty), ok(html), ok(empty)]);
  const result = collect([search, { ...search, label: 'frontend [All]' }], io);
  assert.equal(result.pages, 4); assert.equal(result.processed, 2);
  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs[0].matches, ['developer [All]', 'frontend [All]']);
  assert.ok(io.calls[1].includes('/30?'));
  assert.equal(io.sleeps.length, 3);
});

test('collector caps pages and stops pagination loops', () => {
  assert.equal(collect([{ ...search, pages: 1 }], fake([ok(html)])).pages, 1);
  const result = collect([search], fake([ok(html), ok(html)]));
  assert.equal(result.pages, 2); assert.equal(result.partial, true);
  assert.match(result.errors[0], /Repeated pagination/);
});

test('transient server errors retry twice with backoff', () => {
  const io = fake([{ status: 500 }, { status: 503 }, ok(empty)]);
  assert.equal(collect([search], io).partial, false);
  assert.equal(io.calls.length, 3);
  assert.ok(io.sleeps.includes(2000));
  const failure = collect([search], fake([{ status: 500 }, { status: 500 }, { status: 500 }]));
  assert.equal(failure.partial, true);
});

test('rate limits, auth blocks and challenges stop entire run', () => {
  for (const response of [{ status: 429 }, { status: 403 }, { status: 401 }, ok('<title>Just a moment</title>')]) {
    const io = fake([response]);
    const result = collect([search, search], io);
    assert.equal(result.stop, true); assert.equal(io.calls.length, 1);
  }
});

test('partial failure retains successful pages and continues other searches', () => {
  const io = fake([ok(html), { status: 404 }, ok(empty)]);
  const result = collect([search, search], io);
  assert.equal(result.partial, true); assert.equal(result.jobs.length, 2);
  assert.equal(result.processed, 1);
});

test('time budget prevents further fetches', () => {
  const io = fake([ok(html)], 240000);
  const result = collect([search, search], io);
  assert.equal(result.stop, true); assert.equal(io.calls.length, 1);
  assert.match(result.errors[0], /budget/);
});
