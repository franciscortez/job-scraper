import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, runScraper, enableHourlyRefresh, disableHourlyRefresh } from '../src/app.js';
import { readJobRecords } from '../src/spreadsheet/job-records.js';
import { pruneRunLogs } from '../src/spreadsheet/sheets.js';

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const fixture = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8').replaceAll('2026-09-08', today).replaceAll('10:09:25', '00:00:00').replaceAll('09:00:00', '00:00:00').replace('>Assistant <', '>Backend Developer <');
let book, triggers, held, releases, fetches, onFetch;
const fluent = () => new Proxy({}, { get: () => () => fluent() });
class Tab {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxColumns = 26; this.filter = null; this.writes = []; }
  getName() { return this.name; }
  getSheetId() { return this.name.split('').reduce((value, letter) => value * 31 + letter.charCodeAt(0), 0); }
  getLastRow() { let end = this.data.length; while (end && !this.data[end - 1].some(value => value !== '' && value != null)) end--; return end; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertColumnsAfter(column, n) {
    this.maxColumns += n;
    for (const row of this.data) if (row.length > column) row.splice(column, 0, ...Array(n).fill(''));
  }
  deleteColumns(column, n) {
    this.maxColumns -= n;
    for (const row of this.data) {
      row.splice(column - 1, n);
      while (row.length && row.at(-1) === undefined) row.pop();
    }
  }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
  insertRowsAfter(_row, n) { this.maxRows += n; }
  insertRowBefore(row) { this.data.splice(row - 1, 0, []); this.maxRows += 1; }
  deleteRows(row, n) { this.data.splice(row - 1, n); this.maxRows -= n; }
  showColumns(start, count) { this.visible = [start, count]; }
  hideColumns(start, count) { this.hidden = [start, count]; }
  moveColumns(range, destination) {
    for (const row of this.data) row.splice(destination > range.column ? destination - 2 : destination - 1, 0, ...row.splice(range.column - 1, 1));
  }
  setFrozenRows() {}
  setRowHeightsForced() {}
  setColumnWidth() {}
  getFilter() { return this.filter; }
  appendRow(row) { this.data.push(row); }
  getRange(row, column, count, width) {
    const tab = this;
    const range = {
      column,
      clearDataValidations() { return range; },
      getDataValidations() { return Array.from({length: count}, () => [{ getCriteriaValues: () => [['Not Applied', 'Applied']] }]); },
      setFormula(formula) { return range.setValues([[formula]]); },
      getFormulas() { return range.getValues().map(cells => cells.map(value => typeof value === 'string' && value.startsWith('=') ? value : '')); },
      getFormulasR1C1() { return range.getFormulas(); },
      copyTo(target) { target.setValues(Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => tab.data[row - 1 + i]?.[column - 1 + j] ?? ''))); },
      getValues() { return Array.from({ length: count }, (_, i) => Array.from({ length: width }, (_, j) => tab.data[row - 1 + i]?.[column - 1 + j] ?? '')); },
      setValues(values) {
        assert.equal(values.length, count);
        tab.writes.push({ row, column, count, width });
        values.forEach((cells, i) => {
          assert.equal(cells.length, width);
          tab.data[row - 1 + i] ||= [];
          cells.forEach((value, j) => { tab.data[row - 1 + i][column - 1 + j] = value; });
        });
        return range;
      },
      clearContent() { for (let i = 0; i < count; i++) for (let j = 0; j < width; j++) if (tab.data[row - 1 + i]) tab.data[row - 1 + i][column - 1 + j] = ''; return range; },
      sort(rules) {
        assert.equal(column, 1);
        assert.ok(width >= tab.getLastColumn(), 'Sort must include custom columns');
        const sorted = tab.data.slice(row - 1, row - 1 + count).sort((a, b) => {
          for (const rule of rules) {
            const x = a[rule.column - 1] ?? '', y = b[rule.column - 1] ?? '';
            const comparison = x < y ? -1 : x > y ? 1 : 0;
            if (comparison) return rule.ascending ? comparison : -comparison;
          }
          return 0;
        });
        tab.data.splice(row - 1, count, ...sorted); return range;
      },
      createFilter() {
        const criteria = new Map();
        tab.filter = {
          remove: () => { tab.filter = null; },
          getRange: () => ({ getNumColumns: () => width, getNumRows: () => count }),
          getColumnFilterCriteria: column => criteria.get(column) || null,
          setColumnFilterCriteria: (column, value) => criteria.set(column, value),
          removeColumnFilterCriteria: column => criteria.delete(column),
        };
        return range;
      },
    };
    for (const method of ['setFontWeight', 'setBackground', 'setDataValidation', 'setNumberFormat', 'setWrap', 'setWrapStrategy', 'setVerticalAlignment', 'setBackgrounds']) range[method] = () => range;
    return range;
  }
}

beforeEach(() => {
  book = {
    tabs: new Map(),
    getSheetByName(name) { return this.tabs.get(name); },
    insertSheet(name) { const tab = new Tab(name); this.tabs.set(name, tab); return tab; },
    deleteSheet(tab) { this.tabs.delete(tab.name); },
    setSpreadsheetTimeZone() {}, toast() {},
  };
  held = false; releases = 0; fetches = 0; onFetch = () => {};
  triggers = [];
  globalThis.SpreadsheetApp = { WrapStrategy: { CLIP: 'CLIP' }, getActiveSpreadsheet: () => book, getUi: fluent, newDataValidation: fluent, newFilterCriteria: fluent, flush() {} };
  const properties = new Map();
  globalThis.PropertiesService = { getDocumentProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value), deleteProperty: key => properties.delete(key) }) };
  globalThis.LockService = { getScriptLock: () => ({ tryLock: () => !held, releaseLock: () => { releases++; } }) };
  globalThis.Utilities = { sleep() {}, getUuid: () => 'test-sort-token' };
  globalThis.UrlFetchApp = { fetch: (url, options) => {
    fetches++; onFetch();
    assert.equal(options.followRedirects, false);
    const id = url.match(/-(\d+)$/)?.[1];
    const detail = `<h1 class="job__title" data-jobid="${id}">React Developer</h1><h3>Please <a>login</a> or <a>register</a> as jobseeker to apply for this job.</h3><dd><h3>TYPE OF WORK</h3><p>Part Time</p></dd><p id="job-description" data-jobid="${id}">Develop React applications with TypeScript.</p>`;
    return { getResponseCode: () => 200, getContentText: () => id ? detail : fixture };
  } };
  globalThis.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: target => { triggers = triggers.filter(trigger => trigger !== target); },
    newTrigger: name => ({ timeBased: () => ({ everyHours: hours => ({ create: () => {
      assert.equal(hours, 1); triggers.push({ getHandlerFunction: () => name });
    } }) }) }),
  };
});

function configure() { setup(); book.getSheetByName('Searches').data = [book.getSheetByName('Searches').data[0], [true, 'developer', 'Part Time', 1]]; }

test('run retention deletes only timestamps at least 24 hours old across sparse unsorted rows', () => {
  configure();
  const tab = book.tabs.get('Runs');
  const header = tab.data[0];
  const now = Date.UTC(2026, 8, 12, 8);
  const day = 24 * 60 * 60 * 1000;
  const recent = [new Date(now - day + 1), 'recent'];
  const invalid = ['unknown', 'keep'];
  const future = [new Date(now + 1), 'future'];
  tab.data = [header, [new Date(now - day - 1)], [], recent,
    [new Date(now - day)], [new Date(now - 2 * day)], invalid, future];
  assert.equal(pruneRunLogs(tab, now), 3);
  assert.deepEqual(tab.data, [header, [], recent, invalid, future]);
  assert.equal(pruneRunLogs(tab, now), 0);
});

test('scraper prunes old run history and still records failed runs', () => {
  configure();
  const tab = book.tabs.get('Runs');
  const header = tab.data[0];
  tab.appendRow([new Date(Date.now() - 25 * 3600000), 'old']);
  book.getSheetByName('Searches').data[1][3] = 99;
  assert.equal(runScraper().outcome, 'Failed');
  assert.equal(tab.data.length, 2);
  assert.deepEqual(tab.data[0], header);
  assert.equal(tab.data[1][6], 'Failed');
});

test('lock contention retains old logs until a run holds the lock', () => {
  configure();
  const tab = book.tabs.get('Runs');
  const old = [new Date(Date.now() - 25 * 3600000), 'old'];
  tab.appendRow(old);
  held = true;
  runScraper();
  assert.equal(tab.data[1][6], 'Skipped');
  assert.deepEqual(tab.data[2], old);
  held = false;
  runScraper();
  assert.equal(tab.data.some(row => row[1] === 'old'), false);
});

test('newest run is logged first below the header', () => {
  configure();
  runScraper();
  const first = book.tabs.get('Runs').data[1][0].getTime();
  runScraper();
  const tab = book.tabs.get('Runs');
  assert.equal(tab.data.length, 3);
  assert.ok(tab.data[1][0].getTime() >= first);
  assert.equal(tab.data[2][0].getTime(), first);
});

test('setup and scraping work without a spreadsheet UI context', () => {
  globalThis.SpreadsheetApp.getUi = () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); };
  configure();
  assert.equal(book.tabs.size, 8);
  assert.equal(runScraper().outcome, 'Success');
  assert.doesNotThrow(enableHourlyRefresh);
  assert.doesNotThrow(disableHourlyRefresh);
});

test('setup repeats without overwriting searches or job tracking', () => {
  configure(); runScraper();
  book.getSheetByName('Part Time').data[1][11] = 'Applied';
  setup();
  assert.equal(book.tabs.size, 8);
  assert.deepEqual(book.getSheetByName('Searches').data[1], [true, 'developer', 'Part Time', 1]);
  assert.equal(book.getSheetByName('Part Time').data[1][11], 'Applied');
});

test('manual repeat skips known jobs and never rewrites existing cells', () => {
  configure();
  assert.equal(runScraper().added, 2);
  const jobs = book.getSheetByName('Part Time');
  jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Call Friday';
  jobs.writes = [];
  onFetch = () => { jobs.data[1][12] = 'Edited while fetching'; };
  const result = runScraper();
  assert.equal(result.added, 0); assert.equal(result.updated, 0);
  assert.equal(jobs.data.length, 3);
  assert.deepEqual([jobs.data[1][11], jobs.data[1][12]], ['Saved', 'Edited while fetching']);
  assert.ok(jobs.writes.every(write => write.column > 26));
  assert.equal(jobs.data[1][13], 'Open');
  assert.equal(book.getSheetByName('Runs').data[1][6], 'Success');
});

test('unconfigured tracker logs skipped without making requests', () => {
  configure(); book.getSheetByName('Searches').data[1][0] = false;
  assert.equal(runScraper().outcome, 'Skipped'); assert.equal(fetches, 0);
  assert.throws(enableHourlyRefresh, /at least one/);
});

test('lock contention logs skipped and performs no fetch or job write', () => {
  configure(); held = true;
  const before = releases;
  assert.equal(runScraper().outcome, 'Skipped');
  assert.equal(fetches, 0); assert.equal(releases, before);
});

test('bad headers and invalid settings produce visible failure', () => {
  configure(); book.getSheetByName('Searches').data[1][3] = 99;
  assert.equal(runScraper().outcome, 'Failed'); assert.equal(fetches, 0);
  book.getSheetByName('Searches').data[0][1] = 'Renamed';
  assert.match(runScraper().error, /headers changed/);
});

test('repeated trigger setup retains one scraper trigger and unrelated triggers', () => {
  configure(); enableHourlyRefresh(); enableHourlyRefresh();
  assert.equal(triggers.length, 1);
  triggers.push({ getHandlerFunction: () => 'unrelated' }, { getHandlerFunction: () => 'runScraper' });
  enableHourlyRefresh(); assert.equal(triggers.length, 2);
  disableHourlyRefresh(); disableHourlyRefresh();
  assert.equal(triggers.length, 1); assert.equal(triggers[0].getHandlerFunction(), 'unrelated');
});

test('source failure preserves existing rows and records failure', () => {
  configure(); runScraper();
  const before = JSON.stringify(book.getSheetByName('Part Time').data.map(row => row.slice(0, 13)));
  globalThis.UrlFetchApp.fetch = () => ({ getResponseCode: () => 403, getContentText: () => 'Blocked' });
  assert.equal(runScraper().outcome, 'Failed');
  assert.equal(JSON.stringify(book.getSheetByName('Part Time').data.map(row => row.slice(0, 13))), before);
  assert.equal(book.getSheetByName('Part Time').data[1][13], 'Open');
  assert.match(book.getSheetByName('Runs').data[1][7], /HTTP 403/);
});

test('setup seeds nine All-type searches from resume only once', () => {
  setup(); const searches = book.getSheetByName('Searches');
  assert.deepEqual(searches.data.slice(1).map(row => row[1]), ['developer', 'React', 'Supabase', 'Laravel', 'automation', 'Next.js', 'Codex', 'Claude Code', 'Google Apps Script']);
  assert.ok(searches.data.slice(1).every(row => row[2] === 'All'));
  searches.data[1][1] = 'custom developer'; setup();
  assert.equal(searches.data[1][1], 'custom developer');
});

test('existing part-time profile migrates to All without losing user search settings', () => {
  configure();
  const searches = book.getSheetByName('Searches');
  searches.data[1] = [false, 'custom Node.js', 'Part Time', 1];
  PropertiesService.getDocumentProperties().setProperty('resumeSearchesVersion', '1');
  setup();
  assert.deepEqual(searches.data[1], [false, 'custom Node.js', 'All', 1]);
  searches.data[1][2] = 'Gig'; setup();
  assert.equal(searches.data[1][2], 'Gig');
});

test('keyword migration clears n8n and GoHighLevel searches while preserving other searches', () => {
  configure();
  const searches = book.getSheetByName('Searches');
  searches.data = [searches.data[0], [true, 'n8n automation', 'All', 1], [true, 'GHL', 'Gig', 2], [false, 'Go High Level developer', 'All', 1], [true, 'React', 'Part Time', 1]];
  PropertiesService.getDocumentProperties().setProperty('resumeSearchesVersion', '2');
  setup();
  assert.deepEqual(searches.data[1], [false, '', 'All', 1]);
  assert.deepEqual(searches.data[2], [false, '', 'Gig', 2]);
  assert.deepEqual(searches.data[3], [false, '', 'All', 1]);
  assert.deepEqual(searches.data[4], [true, 'React', 'Part Time', 1]);
});

test('expired discovery rows are removed even with searches disabled', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time');
  jobs.data[1][5] = '2020-01-01 00:00:00'; jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Old note';
  const keptId = jobs.data[2][0];
  book.getSheetByName('Searches').data[1][0] = false;
  const result = runScraper();
  assert.equal(result.removed, 1); assert.equal(jobs.data.length, 2); assert.equal(jobs.data[1][0], keptId);
  assert.equal(book.getSheetByName('Runs').data[1][8], 1);
});

test('legacy headers migrate without losing notes', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[0] = jobs.data[0].slice(0, 13);
  jobs.data[1][12] = 'Keep this note';
  book.getSheetByName('Runs').data[0] = book.getSheetByName('Runs').data[0].slice(0, 8);
  setup(); assert.equal(jobs.data[0].length, 19); assert.equal(jobs.data[1][12], 'Keep this note');
});

test('expired rows are removed and old search results never reinsert them', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time');
  jobs.data[1][5] = '2020-01-01 00:00:00';
  jobs.data[2][5] = '2020-01-01 00:00:00';
  let detailCalls = 0;
  globalThis.UrlFetchApp.fetch = url => {
    if (!url.includes('/jobsearch')) detailCalls++;
    return { getResponseCode: () => 200, getContentText: () => fixture.replaceAll(today, '2020-01-01') };
  };
  const result = runScraper();
  assert.equal(result.removed, 2); assert.equal(result.added, 0); assert.equal(jobs.data.length, 1); assert.equal(detailCalls, 0);
});

test('known jobs retain stored availability without detail rechecks', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][12] = 'Keep until expiration';
  globalThis.UrlFetchApp.fetch = url => ({ getResponseCode: () => url.includes('/jobsearch') ? 200 : 410, getContentText: () => fixture });
  const result = runScraper();
  assert.equal(result.added, 0); assert.equal(jobs.data[1][13], 'Open'); assert.equal(jobs.data[1][12], 'Keep until expiration');
});

test('new rows expand sheet when capacity is exhausted', () => {
  configure(); book.getSheetByName('Part Time').maxRows = 2;
  assert.equal(runScraper().added, 2);
  assert.equal(book.getSheetByName('Part Time').getMaxRows(), 3);
});

test('run persists the 50-job cursor even when every checked job is closed', () => {
  configure();
  const page = Array.from({ length: 52 }, (_, i) => `<a href="/jobseekers/job/react-developer-${i + 1}"><div class="jobpost-cat-box"><h4>React Developer <span class="badge">Part Time</span></h4><p data-temp="${today} 00:00:00"></p><div class="desc">React work</div></div></a>`).join('');
  const checked = [];
  globalThis.UrlFetchApp.fetch = url => {
    if (!url.includes('/jobsearch')) checked.push(url.match(/-(\d+)$/)[1]);
    return { getResponseCode: () => url.includes('/jobsearch') ? 200 : 410, getContentText: () => page };
  };
  assert.equal(runScraper().outcome, 'Limited');
  assert.equal(checked.length, 50); assert.equal(checked[0], '52');
  assert.equal(PropertiesService.getDocumentProperties().getProperty('secondaryJobCursor'), '3');
  assert.equal(runScraper().outcome, 'Limited');
  assert.equal(checked.length, 100); assert.equal(checked[50], '2');
});

test('priority migration preserves disabled aliases and page limits and resets only scraper cursors', () => {
  configure();
  const searches = book.getSheetByName('Searches');
  searches.data = [searches.data[0], [false, 'Next JS', 'Gig', 3], [true, 'custom PHP', 'All', 2], [false, 'Google App Script', 'All', 1]];
  const properties = PropertiesService.getDocumentProperties();
  properties.setProperty('resumeSearchesVersion', '3');
  properties.setProperty('jobCheckCursor', '123'); properties.setProperty('unrelated', 'preserved');
  setup();
  assert.deepEqual(searches.data[1], [false, 'Next JS', 'Gig', 3]);
  assert.deepEqual(searches.data[2], [true, 'custom PHP', 'All', 2]);
  assert.equal(searches.data.filter(row => /next/i.test(row[1])).length, 1);
  assert.equal(searches.data.filter(row => /app.*script/i.test(row[1])).length, 1);
  assert.equal(properties.getProperty('jobCheckCursor'), undefined);
  assert.equal(properties.getProperty('unrelated'), 'preserved');
  const length = searches.data.length; setup(); assert.equal(searches.data.length, length);
});

test('16-column Jobs migration appends priority columns', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[0] = jobs.data[0].slice(0, 16);
  jobs.data[1][12] = 'Keep note';
  setup();
  assert.equal(jobs.data[0][16], 'Match Score'); assert.equal(jobs.data[1][12], 'Keep note');
});

test('description-only matches enter Jobs and later runs preserve original scoring', () => {
  configure();
  let boosted = false;
  globalThis.UrlFetchApp.fetch = url => {
    const id = url.match(/-(\d+)$/)?.[1];
    const skills = id === '12345' && boosted ? 'Next JS, Supabase, Claude Code' : 'React';
    return { getResponseCode: () => 200, getContentText: () => id
      ? `<h1 class="job__title" data-jobid="${id}">Technical Specialist</h1><h3>Please login or register as jobseeker to apply for this job.</h3><dd><h3>TYPE OF WORK</h3><p>Gig</p></dd><p id="job-description" data-jobid="${id}">Build software applications with ${skills}.</p>`
      : fixture.replace(/Frontend &amp; UI Developer|Backend Developer/g, 'Technical Specialist') };
  };
  assert.equal(runScraper().added, 2);
  const jobs = book.getSheetByName('Gig');
  const target = jobs.data.find(row => row[0] === '12345');
  target[11] = 'Saved'; target[12] = 'Keep note'; target[19] = 'Custom extra';
  const before = target.slice();
  boosted = true; assert.equal(runScraper().added, 0);
  assert.deepEqual(jobs.data.find(row => row[0] === '12345'), before);
});

test('JSON progress records share execution ID and match persisted totals', t => {
  const logs = [];
  t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  setup();
  logs.length = 0;
  const result = runScraper();
  assert.equal(new Set(logs.map(record => record.executionId)).size, 1);
  assert.ok(logs.every(record => record.operation === 'runScraper' && Number.isFinite(Date.parse(record.timestamp))));
  for (const event of ['operation.started', 'searches.selected', 'search.page', 'candidates.prepared', 'verification.batch', 'job.checked', 'jobs.saved', 'cursors.saved', 'scraper.completed', 'operation.completed']) {
    assert.ok(logs.some(record => record.event === event), event);
  }
  const summary = logs.find(record => record.event === 'scraper.completed').details;
  assert.equal(summary.added, result.added);
  assert.equal(summary.updated, result.updated);
  assert.equal(summary.checked, logs.filter(record => record.event === 'job.checked').length);
  assert.ok(summary.pages > 0);
  assert.ok(logs.filter(record => record.event === 'job.checked').every(record => record.details.availability === 'Open' && record.details.score > 0));
  assert.ok(!JSON.stringify(logs).includes('Develop React applications'));
});

test('JSON logs cover disabled searches, contention, and failure before sheet access', t => {
  const logs = [];
  t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  setup();
  book.tabs.get('Searches').data.slice(1).forEach(row => { row[0] = false; });
  assert.equal(runScraper().outcome, 'Skipped');
  assert.equal(logs.find(record => record.event === 'scraper.completed').details.checked, 0);
  logs.length = 0;
  held = true;
  runScraper();
  assert.ok(logs.some(record => record.event === 'scraper.skipped'));
  logs.length = 0;
  globalThis.SpreadsheetApp.getActiveSpreadsheet = () => null;
  assert.throws(runScraper, /bound to/);
  assert.equal(logs.at(-1).event, 'operation.failed');
});

test('console failure cannot interrupt writes, return values, or lock release', t => {
  t.mock.method(console, 'log', () => { throw new Error('Log sink unavailable'); });
  setup();
  const before = releases;
  const result = runScraper();
  assert.equal(result.outcome, 'Success');
  assert.equal(book.tabs.get('Part Time').data.length, result.added + 1);
  assert.equal(releases, before + 1);
});

test('manual clear removes all Jobs content including hidden tracking and custom cells only', async t => {
  t.mock.method(console, 'log', () => {});
  const { clearJobs } = await import('../src/app.js');
  setup(); runScraper();
  const jobs = book.tabs.get('Part Time');
  jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Private note'; jobs.data[1][19] = 'Custom';
  const searches = JSON.stringify(book.tabs.get('Searches').data);
  const runs = JSON.stringify(book.tabs.get('Runs').data);
  const header = jobs.data[0].slice();
  const result = clearJobs();
  assert.equal(result.outcome, 'Success');
  assert.equal(result.remaining, 0);
  assert.ok(result.removed > 0);
  assert.deepEqual(jobs.data[0], header);
  assert.ok(jobs.data.slice(1).every(row => row.every(value => value === '')));
  assert.equal(JSON.stringify(book.tabs.get('Searches').data), searches);
  assert.equal(JSON.stringify(book.tabs.get('Runs').data), runs);
});



test('setup creates editable job tables and never creates a central Jobs sheet', t => {
  t.mock.method(console, 'log', () => {});
  setup(); runScraper();
  assert.equal(book.getSheetByName('Jobs'), undefined);
  for (const name of ['Part Time', 'Full Time', 'Gig', 'Any']) {
    assert.equal(book.tabs.get(name).data[0][0], 'Job ID');
    assert.ok(!JSON.stringify(book.tabs.get(name).data).includes('FILTER('));
  }
  const before = JSON.stringify(book.tabs.get('Part Time').data);
  setup();
  assert.equal(JSON.stringify(book.tabs.get('Part Time').data), before);
});

test('migration preserves tracking and custom data, then removes central Jobs', async t => {
  t.mock.method(console, 'log', () => {});
  const { JOB_HEADERS } = await import('../src/config/settings.js');
  const legacy = book.insertSheet('Jobs');
  legacy.data = [[...JOB_HEADERS, 'Custom']];
  for (const [index,type] of ['Part Time', 'Full Time', 'Gig', 'Any'].entries()) {
    const row = Array(20).fill(''); row[0] = String(index + 1); row[1] = 'Developer'; row[4] = type;
    row[9] = new Date(); row[11] = 'Applied'; row[12] = `Note ${index}`; row[19] = 'Custom value';
    legacy.data.push(row);
  }
  const expected = legacy.data.slice(1).map(row => row.slice());
  const view = book.insertSheet('Part Time'); view.data = [['View only'], JOB_HEADERS.slice(), ['=FILTER(...)']];
  PropertiesService.getDocumentProperties().setProperty('employmentView:Part Time', String(view.getSheetId()));
  setup();
  assert.equal(book.getSheetByName('Jobs'), undefined);
  for (const row of expected) assert.deepEqual(book.tabs.get(row[4]).data[1].slice(0, row.length), row);
  setup();
  for (const row of expected) assert.equal(book.tabs.get(row[4]).getLastRow(), 2);
});

test('migration stops on unrelated tabs and preserves source on destination failure', async t => {
  t.mock.method(console, 'log', () => {});
  const { JOB_HEADERS } = await import('../src/config/settings.js');
  const legacy = book.insertSheet('Jobs'); legacy.data = [JOB_HEADERS.slice()];
  const row = Array(19).fill(''); row[0] = '1'; row[4] = 'Part Time'; legacy.data.push(row);
  const conflict = book.insertSheet('Gig'); conflict.data = [['Unrelated data']];
  assert.throws(setup, /unrelated content/);
  assert.equal(legacy.getLastRow(), 2); assert.equal(conflict.data[0][0], 'Unrelated data');
  book.deleteSheet(conflict);
  const originalDelete = book.deleteSheet;
  book.deleteSheet = () => { throw new Error('Delete failed'); };
  assert.throws(setup, /Delete failed/);
  assert.equal(book.getSheetByName('Jobs'), legacy);
  assert.equal(book.tabs.get('Part Time').data[1][0], '1');
  book.deleteSheet = originalDelete;
  setup();
  assert.equal(book.getSheetByName('Jobs'), undefined);
  assert.equal(book.tabs.get('Part Time').getLastRow(), 2);
});

test('known job keeps original employment tab and all details', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const source = book.tabs.get('Part Time');
  source.data[1][12] = 'Keep note'; source.data[1][19] = 'Extra';
  const before = source.data.map(row => row.slice());
  const original = UrlFetchApp.fetch;
  UrlFetchApp.fetch = (url, options) => {
    assert.ok(url.includes('/jobsearch'), 'Known IDs must not receive detail checks');
    return original(url, options);
  };
  assert.equal(runScraper().added, 0);
  assert.deepEqual(source.data, before);
  assert.equal(book.tabs.get('Full Time').getLastRow(), 1);
});

test('cross-tab duplicates fail before network calls and each tab is cleared', async t => {
  t.mock.method(console, 'log', () => {});
  const { clearJobs } = await import('../src/app.js');
  configure(); runScraper();
  const duplicate = book.tabs.get('Part Time').data[1].slice(); duplicate[4] = 'Gig';
  book.tabs.get('Gig').data.push(duplicate);
  const before = fetches;
  assert.equal(runScraper().outcome, 'Failed'); assert.equal(fetches, before);
  clearJobs();
  for (const type of ['Part Time', 'Full Time', 'Gig', 'Any']) assert.equal(book.tabs.get(type).getLastRow(), 1);
});


test('rollback restores partially moved Status and shows all original columns', async t => {
  t.mock.method(console, 'log', () => {});
  const { JOB_HEADERS } = await import('../src/config/settings.js');
  setup(); runScraper();
  const tab = book.tabs.get('Part Time');
  tab.data[1][11] = 'Applied'; tab.data[1][12] = 'Keep note'; tab.data[1][19] = 'Extra';
  const original = tab.data.map(row => row.slice());
  tab.moveColumns(tab.getRange(1, 12, tab.getMaxRows(), 1), 8);
  setup();
  assert.deepEqual(tab.data[0], JOB_HEADERS);
  assert.deepEqual(tab.data, original);
  assert.deepEqual(tab.visible, [1, 19]);
  setup(); assert.deepEqual(tab.data, original);
});

test('Applied jobs transfer before expiry, stay permanent, and are never rediscovered or cleared', async () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time');
  const original = jobs.data[1].slice();
  const ids = [];
  for (const [index, name] of ['Part Time', 'Full Time', 'Gig', 'Any'].entries()) {
    const tab = book.getSheetByName(name);
    const row = original.slice();
    row[0] = index ? String(90000 + index) : original[0]; ids.push(String(row[0]));
    row[4] = name; row[5] = '2020-01-01 00:00:00'; row[11] = 'Applied'; row[12] = 'Follow up'; row[19] = 'Custom value';
    tab.data[0][19] = 'Custom';
    if (index === 0) tab.data[1] = row; else tab.data.push(row);
  }
  const result = runScraper();
  assert.equal(result.moved, 4); assert.equal(result.removed, 0); assert.equal(result.added, 0);
  const apps = book.getSheetByName('Applications');
  assert.equal(apps.data.length, 5); assert.equal(apps.filter, null);
  for (const row of apps.data.slice(1)) {
    assert.equal(row[11], 'Applied'); assert.equal(row[12], 'Follow up'); assert.equal(row[19], 'Custom value');
  }
  const { APPLICATION_STATUSES } = await import('../src/config/settings.js');
  for (const status of APPLICATION_STATUSES) {
    apps.data[1][11] = status;
    onFetch = () => { assert.equal(apps.data[1][11], status); };
    assert.equal(runScraper().moved, 0);
    assert.equal(apps.data[1][11], status);
    for (const name of ['Part Time', 'Full Time', 'Gig', 'Any'])
      assert.ok(book.getSheetByName(name).data.slice(1).every(row => !ids.includes(String(row[0]))));
  }
  const { clearJobs } = await import('../src/app.js');
  clearJobs(); assert.equal(apps.data.length, 5);
});

test('transfer runs with disabled searches and before network failure; first refresh creates tab', () => {
  configure(); runScraper();
  book.deleteSheet(book.getSheetByName('Applications'));
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  book.getSheetByName('Searches').data[1][0] = false;
  assert.equal(runScraper().moved, 1);
  jobs.data[1][11] = 'Applied';
  book.getSheetByName('Searches').data[1][0] = true;
  onFetch = () => { throw new Error('Offline'); };
  assert.equal(runScraper().moved, 1);
  assert.equal(book.getSheetByName('Applications').data.length, 3);
});

test('interrupted transfer retries matching copy without duplicates; conflicts preserve both rows', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  const remove = jobs.deleteRows;
  jobs.deleteRows = () => { throw new Error('Delete interrupted'); };
  assert.equal(runScraper().outcome, 'Failed');
  const apps = book.getSheetByName('Applications'); assert.equal(apps.data.length, 2);
  apps.data[1][12] = 'Changed destination';
  jobs.deleteRows = remove;
  assert.match(runScraper().error, /conflict/);
  assert.equal(jobs.data.length, 3);
  apps.data[1][12] = jobs.data[1][12];
  assert.equal(runScraper().moved, 1);
  assert.equal(apps.data.length, 2);
});

test('failed copy verification and concurrent source edits never delete source', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  const apps = book.getSheetByName('Applications');
  let changed = false;
  SpreadsheetApp.flush = () => {
    if (apps.data.length > 1 && !changed) { jobs.data[1][12] = 'Concurrent edit'; changed = true; }
  };
  assert.match(runScraper().error, /changed during transfer/);
  assert.equal(jobs.data[1][12], 'Concurrent edit'); assert.equal(jobs.data.length, 3);
  apps.data[1][12] = jobs.data[1][12];
  assert.equal(runScraper().moved, 1);
});

test('late Applied edits transfer next run without expiry', () => {
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const id = jobs.data[1][0];
  onFetch = () => { jobs.data.find(row => row[0] === id)[11] = 'Applied'; };
  assert.equal(runScraper().moved, 0);
  onFetch = () => {};
  assert.equal(runScraper().moved, 1);
});

test('unrelated Applications content blocks refresh without deleting jobs', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][5] = '2020-01-01 00:00:00';
  const apps = book.getSheetByName('Applications'); apps.data = [['Personal notes']];
  assert.match(runScraper().error, /unrelated content/);
  assert.deepEqual(apps.data, [['Personal notes']]); assert.equal(jobs.data.length, 3);
});

test('destination write failure retains source and retry succeeds', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  const apps = book.getSheetByName('Applications');
  const getRange = apps.getRange;
  apps.getRange = function(row, column, count, width) {
    const range = getRange.call(this, row, column, count, width);
    if (row > 1 && width >= 19) range.setValues = () => { throw new Error('Write failed'); };
    return range;
  };
  assert.match(runScraper().error, /Write failed/);
  assert.equal(jobs.data.length, 3); assert.equal(apps.data.length, 1);
  apps.getRange = getRange;
  assert.equal(runScraper().moved, 1);
});

test('verification mismatch retains source', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  const apps = book.getSheetByName('Applications');
  SpreadsheetApp.flush = () => { if (apps.data.length > 1) apps.data[1][12] = 'Corrupted copy'; };
  assert.match(runScraper().error, /Could not verify/);
  assert.equal(jobs.data.length, 3);
});

test('transfer stamps Last Seen as arrival time', () => {
  configure(); runScraper();
  const before = Date.now();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  assert.equal(runScraper().moved, 1);
  const apps = book.getSheetByName('Applications');
  const stamped = apps.data[1][10];
  assert.ok(stamped instanceof Date);
  assert.ok(stamped.getTime() >= before - 1000 && stamped.getTime() <= Date.now() + 1000);
});

test('all application statuses stay permanently including stale Applied', async () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  assert.equal(runScraper().moved, 1);
  const apps = book.getSheetByName('Applications');
  const old = new Date(Date.now() - 14 * 24 * 3600000 - 1000);
  apps.data[1][10] = old;
  apps.data[1][11] = 'Applied';
  book.getSheetByName('Searches').data[1][0] = false;
  const result = runScraper();
  assert.equal(result.removed, 0);
  assert.equal(apps.data.length, 2);
  assert.equal(book.getSheetByName('Runs').data[1][8], 0);
  const { APPLICATION_STATUSES } = await import('../src/config/settings.js');
  const kept = APPLICATION_STATUSES.filter(value => value !== 'Applied');
  kept.forEach((status, index) => {
    const fresh = [String(77101 + index), 'Old job', 'https://example.com', '', 'Part Time', '2020-01-01 00:00:00', '', '', '', new Date(0), old, status, '', 'Open', new Date(0), '', 0, '', ''];
    apps.data.push(fresh);
  });
  assert.equal(runScraper().removed, 0);
  assert.equal(apps.data.length, 6);
});

// Blank rows must remain empty; logical record positions are not sheet positions.
const blankJobRow = () => Array(20).fill('');
function trackedRows(tab) {
  return new Map(readJobRecords(tab).map(({ row }) => [String(row[0]), [row[11], row[12], row[19] ?? '']]));
}

test('hidden row 6 and consecutive leading gaps survive refresh without detaching tracking', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  jobs.data[0][19] = 'Custom';
  const originals = jobs.data.slice(1);
  originals.forEach((row, index) => { row[11] = 'Saved'; row[12] = `Note ${index}`; row[19] = `Extra ${index}`; });
  jobs.data = [jobs.data[0], blankJobRow(), blankJobRow(), originals[0], blankJobRow(), blankJobRow(), originals[1]];
  jobs.hiddenRows = [6]; // Read APIs include filtered/hidden rows, just as Sheets does.
  const expected = trackedRows(jobs);
  const capacity = jobs.getMaxRows();
  jobs.writes = [];
  assert.equal(runScraper().outcome, 'Success');
  assert.deepEqual(trackedRows(jobs), expected);
  assert.equal(jobs.getMaxRows(), capacity, 'No blank rows deleted');
  assert.equal(jobs.data.slice(1).filter(row => row.every(value => value === '')).length, 4);
  assert.ok(jobs.writes.every(write => write.column > 26));
  assert.equal(runScraper().outcome, 'Success', 'Next refresh must not find fabricated Unknown-only rows');
});

test('new jobs append beyond sparse records and extend sheet capacity safely', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const kept = jobs.data[1]; kept[11] = 'Saved'; kept[12] = 'Keep attached';
  jobs.data = [jobs.data[0], blankJobRow(), blankJobRow(), kept];
  jobs.maxRows = 4;
  jobs.writes = [];
  const result = runScraper();
  assert.equal(result.added, 1);
  assert.equal(result.updated, 0);
  assert.ok(jobs.writes.some(write => write.row === 5 && write.width === 19));
  assert.equal(jobs.getMaxRows(), 5);
  assert.equal(trackedRows(jobs).get(String(kept[0]))[1], 'Keep attached');
  assert.equal(readJobRecords(jobs).length, 2);
});

test('gap inserted during fetching is reread before updates', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time'); jobs.data[0][19] = 'Custom';
  jobs.data[2][11] = 'Saved'; jobs.data[2][12] = 'Before'; jobs.data[2][19] = 'Extra';
  const id = String(jobs.data[2][0]);
  let changed = false;
  onFetch = () => {
    if (changed) return;
    changed = true;
    jobs.data.splice(1, 0, blankJobRow());
    jobs.data.find(row => String(row[0]) === id)[12] = 'Edited during fetch';
  };
  assert.equal(runScraper().outcome, 'Success');
  assert.deepEqual(trackedRows(jobs).get(id), ['Saved', 'Edited during fetch', 'Extra']);
  assert.equal(readJobRecords(jobs).length, 2);
});

for (const [label, column, value] of [['Notes-only', 12, 'Private note'], ['custom-only', 19, 'Private custom'], ['whitespace', 0, ' '], ['invalid ID', 0, 'secret-invalid-value'], ['zero custom value', 19, 0]]) {
  test(`${label} row still fails at exact cell without leaking contents`, t => {
    const logs = []; t.mock.method(console, 'log', line => logs.push(line));
    configure(); runScraper();
    const jobs = book.tabs.get('Part Time');
    const bad = blankJobRow(); bad[column] = value;
    jobs.data.splice(1, 0, blankJobRow(), bad);
    const before = fetches;
    const result = runScraper();
    assert.equal(result.outcome, 'Failed'); assert.equal(fetches, before);
    assert.match(result.error, /^Part Time!A3: (missing|invalid) Job ID/);
    assert.equal(book.tabs.get('Runs').data[1][7], result.error);
    assert.ok(logs.some(line => line.includes('scraper.failed') && line.includes('Part Time!A3')));
    assert.ok(!logs.join('').includes('Private'));
    assert.ok(!logs.join('').includes('secret-invalid-value'));
  });
}

for (const name of ['Part Time', 'Applications']) {
  test(`formula returning empty string in ${name} is not an empty row`, t => {
    t.mock.method(console, 'log', () => {});
    configure();
    const tab = book.tabs.get(name);
    tab.data.push(blankJobRow());
    const getRange = tab.getRange;
    tab.getLastRow = () => 2; // Sheets counts the formula even when its result is empty.
    tab.getRange = function(row, column, count, width) {
      const range = getRange.call(this, row, column, count, width);
      const formulas = range.getFormulas;
      range.getFormulas = () => {
        const values = formulas();
        if (row === 2 && column === 1 && width >= 20) values[0][19] = '=""';
        return values;
      };
      return range;
    };
    const result = runScraper();
    assert.equal(result.outcome, 'Failed'); assert.equal(fetches, 0);
    assert.equal(result.error, `${name}!A2: missing Job ID on a non-empty row.`);
  });
}

test('duplicates report physical locations across discovery tabs and within Applications', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const source = book.tabs.get('Part Time'); const copy = source.data[1].slice();
  const gig = book.tabs.get('Gig'); gig.data.push(blankJobRow(), copy);
  const before = fetches;
  assert.equal(runScraper().error, `Duplicate Job ID ${copy[0]}: Part Time!A2 and Gig!A3.`);
  assert.equal(fetches, before);
  gig.data = [gig.data[0]];
  const apps = book.tabs.get('Applications'); apps.data.push(blankJobRow(), copy, blankJobRow(), copy.slice());
  assert.equal(runScraper().error, `Duplicate Job ID ${copy[0]}: Applications!A3 and Applications!A5.`);
  assert.equal(fetches, before);
});

test('sparse Applications transfers resume after interruption and preserve other rows', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  jobs.data[0][19] = 'Custom';
  jobs.data.slice(1).forEach((row, i) => { row[11] = 'Applied'; row[12] = `Applied ${i}`; row[19] = `Extra ${i}`; });
  jobs.data.splice(1, 0, blankJobRow()); jobs.data.splice(3, 0, blankJobRow());
  const expected = trackedRows(jobs);
  const apps = book.tabs.get('Applications'); apps.data.push(blankJobRow());
  const remove = jobs.deleteRows;
  jobs.deleteRows = () => { throw new Error('Interrupted'); };
  assert.match(runScraper().error, /Interrupted/);
  apps.data.splice(1, 0, blankJobRow());
  jobs.deleteRows = remove;
  assert.equal(runScraper().moved, 2);
  assert.deepEqual(trackedRows(apps), expected);
  assert.equal(readJobRecords(jobs).length, 0);
  assert.equal(runScraper().moved, 0);
});

test('expiry removes old discovery rows across gaps but keeps Applications', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const kept = jobs.data[1]; kept[11] = 'Saved'; kept[12] = 'Survivor';
  const old = jobs.data[2].slice(); old[0] = '70001'; old[5] = '2020-01-01 00:00:00';
  const otherOld = old.slice(); otherOld[0] = '70002';
  jobs.data = [jobs.data[0], blankJobRow(), old, blankJobRow(), otherOld, blankJobRow(), kept];
  const apps = book.tabs.get('Applications');
  const stale = old.slice(); stale[0] = '80001'; stale[10] = new Date(0); stale[11] = 'Applied';
  const progressed = stale.slice(); progressed[0] = '80002'; progressed[11] = 'Interviewing'; progressed[12] = 'Keep application';
  apps.data.push(blankJobRow(), stale, blankJobRow(), progressed);
  const result = runScraper();
  assert.equal(result.outcome, 'Success'); assert.equal(result.removed, 2);
  assert.equal(trackedRows(jobs).get(String(kept[0]))[1], 'Survivor');
  assert.ok(!trackedRows(jobs).has('70001')); assert.ok(!trackedRows(jobs).has('70002'));
  assert.equal(trackedRows(apps).size, 2);
  assert.deepEqual(trackedRows(apps).get('80002'), ['Interviewing', 'Keep application', '']);
});

test('setup and legacy migration tolerate gaps and retry existing copies', async t => {
  t.mock.method(console, 'log', () => {});
  const { JOB_HEADERS } = await import('../src/config/settings.js');
  const legacy = book.insertSheet('Jobs');
  const row = blankJobRow(); row[0] = '90001'; row[4] = 'Part Time'; row[11] = 'Saved'; row[12] = 'Legacy note'; row[19] = 'Custom value';
  legacy.data = [[...JOB_HEADERS, 'Custom'], blankJobRow(), row, blankJobRow()];
  const remove = book.deleteSheet;
  book.deleteSheet = () => { throw new Error('Interrupted migration'); };
  assert.throws(setup, /Interrupted migration/);
  const target = book.tabs.get('Part Time'); target.data.splice(1, 0, blankJobRow(), blankJobRow());
  book.deleteSheet = remove;
  setup();
  assert.equal(book.getSheetByName('Jobs'), undefined);
  assert.deepEqual(trackedRows(target).get('90001'), ['Saved', 'Legacy note', 'Custom value']);
  assert.equal(readJobRecords(target)[0].rowNumber, 2);
  const before = target.data.map(row => row.slice());
  setup(); assert.deepEqual(target.data, before);
});

test('skipped refresh never fills blank rows with availability values', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  jobs.data.splice(1, 0, blankJobRow(), blankJobRow());
  book.tabs.get('Searches').data[1][0] = false;
  assert.equal(runScraper().outcome, 'Skipped');
  assert.ok(jobs.data[1].every(value => value === ''));
  assert.ok(jobs.data[2].every(value => value === ''));
  assert.equal(runScraper().outcome, 'Skipped');
});

function searchCards(ids, posted = `${today} 00:00:00`) {
  return ids.map(id => `<a href="/jobseekers/job/react-developer-${id}"><div class="jobpost-cat-box"><h4>React Developer <span class="badge">Part Time</span></h4><p data-temp="${posted}"></p><div class="desc">Build React applications</div></div></a>`).join('');
}

function mockDiscovery(ids) {
  const original = UrlFetchApp.fetch;
  const checked = [];
  UrlFetchApp.fetch = (url, options) => {
    if (url.includes('/jobsearch')) return { getResponseCode: () => 200, getContentText: () => searchCards(ids) };
    checked.push(url.match(/-(\d+)$/)[1]);
    return original(url, options);
  };
  return checked;
}

test('120 unseen jobs accumulate over capped runs and repeats make zero detail checks', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const checked = mockDiscovery(Array.from({ length: 120 }, (_, i) => String(i + 1)));
  assert.equal(runScraper().added, 50);
  const jobs = book.tabs.get('Part Time');
  jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Keep me';
  const original = jobs.data[1].slice();
  assert.equal(runScraper().added, 50);
  assert.equal(runScraper().added, 20);
  assert.equal(readJobRecords(jobs).length, 120);
  assert.equal(new Set(checked).size, 120);
  assert.equal(checked.length, 120);
  assert.equal(runScraper().added, 0);
  assert.equal(checked.length, 120);
  assert.deepEqual(jobs.data.find(row => row[0] === original[0]), original);
  assert.equal(jobs.getFilter().getColumnFilterCriteria(14), null);
});

test('date sorting keeps formulas and custom cells attached; bad dates and blanks go last', async t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const jobs = book.tabs.get('Part Time');
  jobs.data[0][19] = 'Custom'; jobs.data[0][29] = 'Beyond initial grid'; jobs.maxColumns = 30;
  const makeRow = (id, date, score) => {
    const row = Array(30).fill('');
    row[0] = id; row[4] = 'Part Time'; row[5] = date; row[11] = 'Saved'; row[12] = `Note ${id}`;
    row[16] = score; row[19] = '=1+1'; row[29] = `Extra ${id}`;
    return row;
  };
  jobs.data.push(makeRow('9', 'invalid', 99), makeRow('10', '2026-09-01 12:00:00', 100),
    blankJobRow(), makeRow('2', '2026-09-02 08:00:00', 0), makeRow('11', '2026-09-02 08:00:00', 1), makeRow('1', '', 1000));
  const expected = new Map(readJobRecords(jobs).map(({ row }) => [row[0], row]));
  UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => '<p>Displaying 0 out of 0 job</p>' });
  jobs.writes = [];
  assert.equal(runScraper().added, 0);
  assert.deepEqual(readJobRecords(jobs).map(({ row }) => row[0]), ['11', '2', '10', '9', '1']);
  for (const { row } of readJobRecords(jobs)) assert.deepEqual(row, expected.get(row[0]));
  assert.ok(jobs.data.at(-1).every(value => value === ''));
  assert.equal(jobs.getMaxColumns(), 30);
  assert.ok(jobs.writes.every(write => write.column === 31));
});

test('sort failure removes helper columns, retains saved data, and reports Failed', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const before = jobs.data.map(row => row.slice());
  const getRange = jobs.getRange;
  jobs.getRange = function(...args) {
    const range = getRange.apply(this, args);
    range.sort = () => { throw new Error('Sort failed'); };
    return range;
  };
  assert.equal(runScraper().outcome, 'Failed');
  assert.equal(jobs.getMaxColumns(), 26);
  assert.deepEqual(jobs.data, before);
});

const textCriteria = value => ({ getCriteriaType: () => 'TEXT_EQUAL_TO', getCriteriaValues: () => [value] });

test('first refresh removes legacy Open filter once and preserves other and later user filters', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  PropertiesService.getDocumentProperties().deleteProperty(`appendOnlyFilter:${jobs.getSheetId()}`);
  jobs.getFilter().setColumnFilterCriteria(14, textCriteria('Open'));
  const saved = textCriteria('Saved'); jobs.getFilter().setColumnFilterCriteria(12, saved);
  jobs.data[1][13] = 'Unknown';
  book.tabs.get('Searches').data[1][0] = false;
  assert.equal(runScraper().outcome, 'Skipped');
  assert.equal(jobs.getFilter().getColumnFilterCriteria(14), null);
  assert.equal(jobs.getFilter().getColumnFilterCriteria(12), saved);
  assert.equal(jobs.data[1][13], 'Unknown');
  const manual = textCriteria('Open'); jobs.getFilter().setColumnFilterCriteria(14, manual);
  runScraper();
  assert.equal(jobs.getFilter().getColumnFilterCriteria(14), manual);
});

test('filter expansion preserves user criteria and supports legacy 13-column filters', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const jobs = book.tabs.get('Part Time'); jobs.maxRows = 2;
  jobs.getFilter().remove(); jobs.getRange(1, 1, 2, 13).createFilter();
  PropertiesService.getDocumentProperties().deleteProperty(`appendOnlyFilter:${jobs.getSheetId()}`);
  const saved = textCriteria('Saved'); jobs.getFilter().setColumnFilterCriteria(12, saved);
  assert.equal(runScraper().added, 2);
  assert.equal(jobs.getFilter().getRange().getNumRows(), 3);
  assert.equal(jobs.getFilter().getRange().getNumColumns(), 19);
  assert.equal(jobs.getFilter().getColumnFilterCriteria(12), saved);
});

for (const destination of ['Gig', 'Applications']) {
  test(`ID inserted in ${destination} during fetching is excluded before append`, t => {
    t.mock.method(console, 'log', () => {});
    configure();
    let inserted = false;
    onFetch = () => {
      if (inserted) return;
      inserted = true;
      const row = Array(19).fill(''); row[0] = '12345'; row[4] = 'Gig'; row[11] = 'Saved'; row[12] = 'Concurrent';
      book.tabs.get(destination).data.push(row);
    };
    assert.equal(runScraper().added, 1);
    const all = ['Part Time', 'Full Time', 'Gig', 'Any', 'Applications'].flatMap(name => readJobRecords(book.tabs.get(name)));
    assert.equal(all.filter(({ row }) => row[0] === '12345').length, 1);
    assert.equal(book.tabs.get(destination).data[1][12], 'Concurrent');
  });
}

test('partial append failure retries without duplicating the completed tab', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const original = UrlFetchApp.fetch;
  UrlFetchApp.fetch = (url, options) => {
    const response = original(url, options);
    return { ...response, getContentText: () => url.endsWith('-12345') ? response.getContentText().replace('<p>Part Time</p>', '<p>Full Time</p>') : response.getContentText() };
  };
  const full = book.tabs.get('Full Time'); const getRange = full.getRange;
  full.getRange = function(row, column, count, width) {
    const range = getRange.call(this, row, column, count, width);
    if (row > 1 && column === 1 && width === 19) range.setValues = () => { throw new Error('Append failed'); };
    return range;
  };
  const failed = runScraper();
  assert.equal(failed.outcome, 'Failed'); assert.equal(failed.added, 1);
  full.getRange = getRange;
  assert.equal(runScraper().added, 1);
  assert.equal(readJobRecords(book.tabs.get('Part Time')).length, 1);
  assert.equal(readJobRecords(full).length, 1);
  assert.equal(runScraper().added, 0);
});

test('saved append followed by an error is deduplicated on retry', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const jobs = book.tabs.get('Part Time'); const getRange = jobs.getRange;
  let failed = false;
  jobs.getRange = function(row, column, count, width) {
    const range = getRange.call(this, row, column, count, width);
    const set = range.setValues;
    if (row > 1 && column === 1 && width === 19) range.setValues = values => {
      const result = set(values);
      if (!failed) { failed = true; throw new Error('Response lost after write'); }
      return result;
    };
    return range;
  };
  assert.equal(runScraper().outcome, 'Failed');
  assert.equal(runScraper().added, 0);
  assert.equal(readJobRecords(jobs).length, 2);
});

test('unseen old, missing, invalid, and future dates never receive detail checks', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  const dates = ['2020-01-01 00:00:00', '', 'invalid', '2999-01-01 00:00:00'];
  let detailCalls = 0;
  UrlFetchApp.fetch = url => {
    if (!url.includes('/jobsearch')) detailCalls++;
    return { getResponseCode: () => 200, getContentText: () => dates.map((date, i) => searchCards([String(i + 1)], date)).join('') };
  };
  assert.equal(runScraper().added, 0); assert.equal(detailCalls, 0);
});

test('closed and unverified unseen jobs are not appended', t => {
  t.mock.method(console, 'log', () => {});
  configure();
  UrlFetchApp.fetch = url => ({ getResponseCode: () => url.includes('/jobsearch') ? 200 : url.endsWith('-1') ? 410 : 403,
    getContentText: () => searchCards(['1', '2']) });
  assert.equal(runScraper().added, 0);
  assert.equal(readJobRecords(book.tabs.get('Part Time')).length, 0);
});

test('new-post cutoff excludes exactly 14 days but accepts one second younger', t => {
  t.mock.method(console, 'log', () => {});
  const now = Math.floor(Date.now() / 1000) * 1000;
  t.mock.method(Date, 'now', () => now);
  configure();
  const age = 14 * 24 * 3600000;
  const posted = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const original = UrlFetchApp.fetch;
  const checked = [];
  UrlFetchApp.fetch = (url, options) => {
    if (url.includes('/jobsearch')) return { getResponseCode: () => 200, getContentText: () =>
      searchCards(['1'], posted(now - age)) + searchCards(['2'], posted(now - age + 1000)) };
    checked.push(url.match(/-(\d+)$/)[1]);
    return original(url, options);
  };
  assert.equal(runScraper().added, 1);
  assert.deepEqual(checked, ['2']);
});

test('ordinary refresh never repairs or rewrites legacy status values', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  jobs.data[1][11] = 'Not Applied';
  const id = jobs.data[1][0];
  assert.equal(runScraper().added, 0);
  assert.equal(jobs.data.find(row => row[0] === id)[11], 'Not Applied');
  setup();
  assert.equal(jobs.data.find(row => row[0] === id)[11], 'New');
});

test('September 11 posting expires September 25 at the same Manila time', async t => {
  t.mock.method(console, 'log', () => {});
  const { removeExpiredJobs, expiredIds } = await import('../src/spreadsheet/expiry.js');
  configure();
  const tab = book.tabs.get('Part Time');
  const row = Array(19).fill('');
  row[0] = '11001'; row[4] = 'Part Time'; row[5] = '2026-09-11 08:00:00'; row[11] = 'Saved'; row[12] = 'Expires too';
  tab.data.push(row);
  const tables = [{ type: 'Part Time', tab }]; const history = book.tabs.get('Expired IDs');
  const deadline = Date.parse('2026-09-25T08:00:00+08:00');
  assert.equal(removeExpiredJobs(tables, history, deadline - 1), 0);
  assert.equal(removeExpiredJobs(tables, history, deadline), 1);
  assert.equal(tab.getLastRow(), 1);
  assert.deepEqual([...expiredIds(history)], ['11001']);
});

test('expired identity never returns with a fresh source date, even after manual clear', async t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const id = jobs.data[1][0]; jobs.data[1][5] = '2020-01-01 00:00:00';
  const checked = mockDiscovery([id]);
  assert.equal(runScraper().removed, 1);
  assert.equal(runScraper().added, 0);
  assert.equal(checked.length, 0);
  const { clearJobs } = await import('../src/app.js');
  clearJobs();
  assert.equal(runScraper().added, 0);
  assert.equal(checked.length, 0);
  assert.equal(book.tabs.get('Expired IDs').data[1][0], id);
});

test('failed expiry history write retains source; interrupted deletion retries recorded ID', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const id = jobs.data[1][0]; jobs.data[1][5] = '2020-01-01 00:00:00';
  const history = book.tabs.get('Expired IDs'); const getRange = history.getRange;
  history.getRange = function(row, ...args) {
    const range = getRange.call(this, row, ...args);
    if (row > 1) range.setValues = () => { throw new Error('History write failed'); };
    return range;
  };
  assert.match(runScraper().error, /History write failed/);
  assert.ok(trackedRows(jobs).has(id));
  history.getRange = getRange;
  const remove = jobs.deleteRows;
  jobs.deleteRows = () => { throw new Error('Delete interrupted'); };
  assert.match(runScraper().error, /Delete interrupted/);
  assert.ok(trackedRows(jobs).has(id));
  assert.equal(history.data.length, 2);
  jobs.deleteRows = remove;
  assert.equal(runScraper().removed, 1);
  assert.equal(history.data.length, 2);
  assert.ok(!trackedRows(jobs).has(id));
});

test('Applied edit during expiry journal write retains source and transfers next run', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const id = jobs.data[1][0]; jobs.data[1][5] = '2020-01-01 00:00:00';
  SpreadsheetApp.flush = () => {
    if (book.tabs.get('Expired IDs').getLastRow() > 1) {
      const row = jobs.data.find(row => row[0] === id);
      if (row) row[11] = 'Applied';
    }
  };
  assert.equal(runScraper().removed, 0);
  assert.ok(trackedRows(jobs).has(id));
  assert.equal(runScraper().moved, 1);
  assert.ok(trackedRows(book.tabs.get('Applications')).has(id));
});

test('cleanup rejects shifted physical rows and never deletes another ID', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time');
  const id = jobs.data[1][0]; jobs.data[1][5] = '2020-01-01 00:00:00';
  let inserted = false;
  SpreadsheetApp.flush = () => {
    if (!inserted && book.tabs.get('Expired IDs').getLastRow() > 1) {
      inserted = true; jobs.data.splice(1, 0, blankJobRow());
    }
  };
  assert.match(runScraper().error, /job changed during cleanup/);
  assert.equal(readJobRecords(jobs).length, 2);
  assert.equal(runScraper().removed, 1);
  assert.ok(!trackedRows(jobs).has(id));
});

test('discovery cleanup completes before source failure without touching Applications', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time'); jobs.data[1][5] = '2020-01-01 00:00:00';
  UrlFetchApp.fetch = () => ({ getResponseCode: () => 403, getContentText: () => 'Blocked' });
  const result = runScraper();
  assert.equal(result.outcome, 'Failed'); assert.equal(result.removed, 1);
  assert.equal(readJobRecords(jobs).length, 1);
});

for (const failure of ['missing', 'empty', 'headers', 'formula', 'duplicate']) {
  test(`initialized expiry history fails closed when ${failure}`, t => {
    t.mock.method(console, 'log', () => {});
    configure(); runScraper();
    const history = book.tabs.get('Expired IDs');
    const jobs = book.tabs.get('Part Time'); jobs.data[1][5] = '2020-01-01 00:00:00'; jobs.data[1][11] = 'Applied';
    const before = jobs.data.map(row => row.slice()); const calls = fetches;
    if (failure === 'missing') book.deleteSheet(history);
    if (failure === 'empty') history.data = [];
    if (failure === 'headers') history.data = [['Changed']];
    if (failure === 'formula') history.data.push(['=123']);
    if (failure === 'duplicate') history.data.push(['123'], ['123']);
    assert.equal(runScraper().outcome, 'Failed');
    assert.equal(fetches, calls);
    assert.deepEqual(jobs.data, before);
    assert.equal(book.tabs.get('Applications').getLastRow(), 1);
    if (failure === 'missing') assert.equal(book.tabs.has('Expired IDs'), false);
  });
}

test('sort recovery removes marked helpers before reading sparse job records', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const jobs = book.tabs.get('Part Time'); jobs.data.splice(1, 0, blankJobRow());
  const before = trackedRows(jobs); const properties = PropertiesService.getDocumentProperties();
  const token = 'job-sort:interrupted';
  jobs.insertColumnsAfter(26, 2);
  jobs.getRange(1, 27, 1, 2).setValues([[`${token}:date`, `${token}:id`]]);
  jobs.getRange(2, 27, 3, 2).setValues([[-1,0],[10,1],[9,2]]);
  properties.setProperty(`pendingJobSort:${jobs.getSheetId()}`, JSON.stringify({start:27,token,phase:'marked'}));
  assert.equal(runScraper().outcome, 'Success');
  assert.equal(jobs.getMaxColumns(), 26);
  assert.deepEqual(trackedRows(jobs), before);
  assert.equal(properties.getProperty(`pendingJobSort:${jobs.getSheetId()}`), undefined);
});

for (const phase of ['prepared', 'deleting']) {
  test(`sort journal recovers a lost response in ${phase} phase`, async t => {
    t.mock.method(console, 'log', () => {});
    configure(); const jobs = book.tabs.get('Part Time');
    const key = `pendingJobSort:${jobs.getSheetId()}`;
    PropertiesService.getDocumentProperties().setProperty(key, JSON.stringify({ start:27,token:'job-sort:lost',phase }));
    const { recoverJobSort } = await import('../src/spreadsheet/sort-recovery.js');
    recoverJobSort(jobs);
    assert.equal(jobs.getMaxColumns(), 26);
    assert.equal(PropertiesService.getDocumentProperties().getProperty(key), undefined);
  });
}

test('unknown helper ownership stops refresh without deleting user columns', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper(); const jobs = book.tabs.get('Part Time');
  jobs.insertColumnsAfter(26, 2); jobs.data[0][26] = 'User notes';
  PropertiesService.getDocumentProperties().setProperty(`pendingJobSort:${jobs.getSheetId()}`,
    JSON.stringify({ start:27,token:'job-sort:lost',phase:'prepared' }));
  const calls = fetches;
  assert.match(runScraper().error, /ownership unclear/);
  assert.equal(jobs.getMaxColumns(),28); assert.equal(jobs.data[0][26],'User notes');
  assert.equal(fetches, calls);
});

test('helper deletion failure keeps journal and next refresh recovers it', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper(); const jobs = book.tabs.get('Part Time');
  const remove = jobs.deleteColumns;
  jobs.deleteColumns = () => { throw new Error('Delete helper failed'); };
  assert.equal(runScraper().outcome,'Failed');
  assert.equal(jobs.getMaxColumns(),28);
  jobs.deleteColumns = remove;
  assert.equal(runScraper().outcome,'Success');
  assert.equal(jobs.getMaxColumns(),26);
});

test('application transfer preserves formulas instead of only computed values', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper(); const jobs = book.tabs.get('Part Time');
  jobs.data[0][19] = 'Calculated'; jobs.data[1][11] = 'Applied'; jobs.data[1][19] = '=RC[-3]*2';
  const id=jobs.data[1][0];
  assert.equal(runScraper().moved,1);
  const apps=book.tabs.get('Applications');
  assert.equal(apps.data.find(row=>row[0]===id)[19], '=RC[-3]*2');
  assert.ok(!trackedRows(jobs).has(id));
});

test('changed formula with identical result prevents source deletion', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper(); const jobs = book.tabs.get('Part Time');
  jobs.data[0][19] = 'Calculated'; jobs.data[1][11] = 'Applied'; jobs.data[1][19] = '=1+1';
  const apps = book.tabs.get('Applications');
  SpreadsheetApp.flush = () => { if(apps.getLastRow()>1) jobs.data[1][19] = '=2'; };
  assert.match(runScraper().error,/changed during transfer/);
  assert.equal(jobs.getLastRow(),3); assert.equal(apps.getLastRow(),2);
});

test('formula copy failure retains source and cannot silently accept value-only destination', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper(); const jobs=book.tabs.get('Part Time');
  jobs.data[0][19]='Formula'; jobs.data[1][11]='Applied'; jobs.data[1][19]='=1+1';
  const getRange=jobs.getRange;
  jobs.getRange=function(...args) { const range=getRange.apply(this,args); range.copyTo=()=>{throw new Error('Formula copy failed');}; return range; };
  assert.match(runScraper().error,/Formula copy failed/);
  assert.equal(readJobRecords(jobs).length,2);
  jobs.getRange=getRange;
  assert.match(runScraper().error,/conflict/);
});

test('budget defers transfers without losing progress and resumes next run', async t => {
  t.mock.method(console,'log',()=>{});
  configure(); runScraper(); const tab=book.tabs.get('Part Time');
  tab.data.slice(1).forEach(row=>{row[11]='Applied';});
  const {moveApplications}=await import('../src/spreadsheet/applications.js');
  const {deferredWork}=await import('../src/platform/budget.js');
  let count=0;
  assert.throws(()=>moveApplications([{type:'Part Time',tab}],book.tabs.get('Applications'),()=>{},
    {check(){if(++count===2) throw deferredWork('transfers');}}),error=>error.deferred && error.moved===1);
  assert.equal(runScraper().moved,1);
  assert.equal(readJobRecords(book.tabs.get('Applications')).length,2);
});

test('budget defers cleanup with exact removed count and resumes pending rows', async t => {
  t.mock.method(console,'log',()=>{});
  configure(); runScraper(); const tab=book.tabs.get('Part Time'); tab.data.slice(1).forEach(row=>{row[5]='2020-01-01 00:00:00';});
  const {removeExpiredJobs}=await import('../src/spreadsheet/expiry.js');
  const {deferredWork}=await import('../src/platform/budget.js');
  let count=0;
  assert.throws(()=>removeExpiredJobs([{type:'Part Time',tab}],book.tabs.get('Expired IDs'),Date.now(),()=>{},
    {check(){if(++count===2) throw deferredWork('cleanup');}}),error=>error.deferred && error.removed===1);
  assert.equal(runScraper().removed,1);
  assert.equal(tab.getLastRow(),1);
});

test('shared deadline stops before append and retry keeps all new candidates available', t => {
  t.mock.method(console,'log',()=>{});
  configure(); const now=Date.now(); let time=now;
  t.mock.method(Date,'now',()=>time);
  onFetch=()=>{time=now+170000;};
  const result=runScraper();
  assert.equal(result.outcome,'Limited'); assert.equal(result.added,0);
  assert.match(result.error,/deferred/);
  time=now; onFetch=()=>{};
  assert.equal(runScraper().added,2);
});

test('coverage logs expose deferred candidates per search without claiming full history', t => {
  const logs=[]; t.mock.method(console,'log',line=>logs.push(JSON.parse(line)));
  configure(); mockDiscovery(Array.from({length:60},(_,i)=>String(i+1)));
  assert.equal(runScraper().outcome,'Limited');
  const coverage=logs.find(item=>item.event==='search.coverage').details;
  assert.equal(coverage.eligible,60); assert.equal(coverage.checked,50); assert.equal(coverage.deferred,10);
  const completed=logs.find(item=>item.event==='search.completed').details;
  assert.equal(completed.pages,1); assert.ok(completed.oldestPosted); assert.equal(completed.morePages,false);
});
