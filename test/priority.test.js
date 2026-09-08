import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankMatch, readSearches, selectSearches, DEFAULT_SEARCHES, verifyJobs, isPreferredCandidate } from '../src/core.js';

const base = { title: 'Software Developer', skills: '', snippet: '' };
test('preferred skills score five each, secondary skills one, with equal description weight', () => {
  const detail = rankMatch(base, 'Next JS, Codex, Claude Code, Supabase, React, Google App Script');
  assert.equal(detail.score, 22);
  assert.match(detail.location, /Next.js: Description/);
  assert.match(detail.location, /Apps Script: Description/);
  const title = rankMatch({ ...base, title: 'Next.js Codex Claude Code Supabase React Apps Script Developer' });
  assert.equal(title.score, detail.score);
});

test('aliases and repeated words contribute once per skill', () => {
  const result = rankMatch({ ...base, title: 'NextJS Developer', skills: 'Next JS', snippet: 'next.js' }, 'Next-JS next js Google App Script Google Apps Script Apps Script');
  assert.equal(result.score, 6);
  assert.equal(result.skills.filter(skill => skill === 'Next.js').length, 1);
  assert.match(result.location, /Next.js: Title, Tags, Summary, Description/);
});

test('generic title qualifies through explicit technical responsibilities in description', () => {
  assert.equal(rankMatch({ ...base, title: 'Technical Specialist' }, 'Build web applications using Supabase.').score, 5);
  assert.equal(rankMatch({ ...base, title: 'Virtual Assistant' }, 'Use AI to create social posts. Familiarity with Supabase is welcome.').score, 0);
  assert.equal(rankMatch({ ...base, title: 'Content Writer' }, 'Write articles about Claude Code.').score, 0);
});

test('AI-assisted development bonus applies once and not to generic or negated AI usage', () => {
  assert.equal(rankMatch(base, 'React. AI-assisted coding and vibe coding.').score, 4);
  assert.equal(rankMatch(base, 'React. AI-powered software development.').score, 4);
  for (const text of ['AI content creation', 'No AI-assisted coding permitted', 'AI-assisted development is prohibited', 'Do not use vibe coding']) {
    assert.equal(rankMatch(base, `React. ${text}.`).score, 1);
  }
  assert.equal(rankMatch(base, 'AI-assisted development').score, 0);
});

test('n8n and GHL do not add credit or disqualify other skills', () => {
  assert.equal(rankMatch(base, 'n8n GoHighLevel GHL').score, 0);
  assert.equal(rankMatch(base, 'React n8n GoHighLevel GHL').score, 1);
});

test('five-query scheduler keeps preferred searches and rotates all secondary searches', () => {
  const searches = readSearches(DEFAULT_SEARCHES);
  let cursor = '';
  const secondary = new Set();
  for (let i = 0; i < 5; i++) {
    const selected = selectSearches(searches, cursor);
    assert.equal(selected.searches.length, 5);
    assert.deepEqual(new Set(selected.searches.slice(0, 4).map(search => search.keywords)), new Set(['Supabase', 'Next.js', 'Codex', 'Claude Code']));
    secondary.add(selected.searches[4].keywords);
    cursor = selected.cursor;
  }
  assert.deepEqual(secondary, new Set(['developer', 'React', 'Laravel', 'automation', 'Google Apps Script']));
});

test('disabled preferred searches stay off, duplicate aliases collapse, spare slots fill', () => {
  const rows = DEFAULT_SEARCHES.map(row => row.slice());
  rows.find(row => row[1] === 'Codex')[0] = false;
  rows.push([true, 'Next JS', 'All', 2], [true, 'Google App Script', 'All', 2]);
  const searches = readSearches(rows);
  assert.equal(searches.length, 8);
  const selected = selectSearches(searches);
  assert.equal(selected.searches.length, 5);
  assert.ok(selected.searches.every(search => search.keywords !== 'Codex'));
});

function candidate(id, preferred) {
  return { ...base, id: String(id), url: `https://www.onlinejobs.ph/jobseekers/job/developer-${id}`, skills: preferred ? 'Next.js' : 'React' };
}
const io = { now: () => 0, sleep() {}, fetch: () => ({ status: 410 }) };
test('50-job batch reserves 38 preferred and 12 exploration checks with independent rotation', () => {
  const jobs = [...Array.from({ length: 80 }, (_, i) => candidate(i + 1, true)), ...Array.from({ length: 30 }, (_, i) => candidate(i + 100, false))];
  const first = verifyJobs(jobs, io);
  assert.equal(first.results.size, 50);
  assert.equal([...first.results.keys()].filter(id => Number(id) < 100).length, 38);
  const second = verifyJobs(jobs, io, 0, first.cursors);
  assert.ok([...second.results.keys()].every(id => !first.results.has(id)));
  assert.equal(second.results.size, 50);
});

test('unused slots transfer between groups without exceeding 50', () => {
  for (const [preferredCount, secondaryCount] of [[60, 2], [2, 60], [0, 60], [60, 0]]) {
    const jobs = [...Array.from({ length: preferredCount }, (_, i) => candidate(i + 1, true)), ...Array.from({ length: secondaryCount }, (_, i) => candidate(i + 100, false))];
    assert.equal(verifyJobs(jobs, io).results.size, 50);
  }
});

test('preferred discovery and previous description matches guide checks before detail fetch', () => {
  assert.equal(isPreferredCandidate({ ...base, matches: ['Claude Code [All]'] }), true);
  assert.equal(isPreferredCandidate({ ...base, priorSkills: ['Supabase'] }), true);
  assert.equal(isPreferredCandidate({ ...base, matches: ['automation [All]'], skills: 'n8n' }), false);
});

test('content creation with Claude Code cannot qualify or receive preferred slots', () => {
  for (const title of ['YouTube Creation using Claude Code', 'YouTube Automation Specialist', 'Content Developer', 'Video Editor', 'Scriptwriter']) {
    const job = { ...base, title, skills: 'Claude Code', matches: ['Claude Code [All]'] };
    assert.equal(rankMatch(job, 'Write scripts for videos using Claude Code.').score, 0, title);
    assert.equal(isPreferredCandidate(job), false, title);
  }
  for (const title of ['Automation Specialist', 'AI Workflow Specialist', 'Technical Specialist']) {
    assert.equal(rankMatch({ ...base, title }, 'Write YouTube scripts with Claude Code.').score, 0);
    assert.equal(rankMatch({ ...base, title }, 'Build web applications with Claude Code and Supabase.').score, 10);
  }
  assert.equal(rankMatch({ ...base, title: 'Software Developer - YouTube API' }, 'Build applications with Next.js and Claude Code.').score, 10);
});
