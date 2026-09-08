import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, runScraper, enableHourlyRefresh, disableHourlyRefresh } from '../src/app.js';

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const fixture = readFileSync(new URL('./fixtures/search.html', import.meta.url), 'utf8').replaceAll('2026-09-08', today).replaceAll('10:09:25', '00:00:00').replaceAll('09:00:00', '00:00:00').replace('>Assistant <', '>Backend Developer <');
let book, triggers, held, releases, fetches, onFetch;
const fluent = () => new Proxy({}, { get: () => () => fluent() });
class Tab {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.filter = null; this.writes = []; }
  getSheetId() { return this.name.split('').reduce((value, letter) => value * 31 + letter.charCodeAt(0), 0); }
  getLastRow() { let end = this.data.length; while (end && !this.data[end - 1].some(value => value !== '' && value != null)) end--; return end; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return 26; }
  getLastColumn() { return Math.max(0, ...this.data.map(row => row.length)); }
  insertRowsAfter(_row, n) { this.maxRows += n; }
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
      createFilter() { tab.filter = { remove: () => { tab.filter = null; }, getRange: () => ({ getNumColumns: () => width }), setColumnFilterCriteria: () => {} }; return range; },
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
  globalThis.Utilities = { sleep() {} };
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

test('setup and scraping work without a spreadsheet UI context', () => {
  globalThis.SpreadsheetApp.getUi = () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); };
  configure();
  assert.equal(book.tabs.size, 7);
  assert.equal(runScraper().outcome, 'Success');
  assert.doesNotThrow(enableHourlyRefresh);
  assert.doesNotThrow(disableHourlyRefresh);
});

test('setup repeats without overwriting searches or job tracking', () => {
  configure(); runScraper();
  book.getSheetByName('Part Time').data[1][11] = 'Applied';
  setup();
  assert.equal(book.tabs.size, 7);
  assert.deepEqual(book.getSheetByName('Searches').data[1], [true, 'developer', 'Part Time', 1]);
  assert.equal(book.getSheetByName('Part Time').data[1][11], 'Applied');
});

test('manual repeat updates without duplicates and never rewrites existing tracking cells', () => {
  configure();
  assert.equal(runScraper().added, 2);
  const jobs = book.getSheetByName('Part Time');
  jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Call Friday';
  jobs.writes = [];
  onFetch = () => { jobs.data[1][12] = 'Edited while fetching'; };
  const result = runScraper();
  assert.equal(result.added, 0); assert.equal(result.updated, 2);
  assert.equal(jobs.data.length, 3);
  assert.deepEqual([jobs.data[1][11], jobs.data[1][12]], ['Saved', 'Edited while fetching']);
  assert.ok(jobs.writes.every(write => write.column === 14 || write.column === 1 && write.width === 11));
  assert.equal(jobs.data[1][13], 'Open');
  assert.equal(book.getSheetByName('Runs').data.at(-1)[6], 'Success');
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
  assert.equal(book.getSheetByName('Part Time').data[1][13], 'Unknown');
  assert.match(book.getSheetByName('Runs').data.at(-1)[7], /HTTP 403/);
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

test('expired unapplied rows including tracking are deleted even with searches disabled', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time');
  jobs.data[1][5] = '2020-01-01 00:00:00'; jobs.data[1][11] = 'Saved'; jobs.data[1][12] = 'Old note';
  const keptId = jobs.data[2][0];
  book.getSheetByName('Searches').data[1][0] = false;
  const result = runScraper();
  assert.equal(result.removed, 1); assert.equal(jobs.data.length, 2); assert.equal(jobs.data[1][0], keptId);
  assert.equal(book.getSheetByName('Runs').data.at(-1)[8], 1);
});

test('legacy headers migrate without losing notes', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[0] = jobs.data[0].slice(0, 13);
  jobs.data[1][12] = 'Keep this note';
  book.getSheetByName('Runs').data[0] = book.getSheetByName('Runs').data[0].slice(0, 8);
  setup(); assert.equal(jobs.data[0].length, 19); assert.equal(jobs.data[1][12], 'Keep this note');
});

test('expired search results are not reinserted after cleanup', () => {
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

test('new closed jobs are excluded and existing closed jobs retain notes but lose Open state', () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][12] = 'Keep until expiration';
  globalThis.UrlFetchApp.fetch = url => ({ getResponseCode: () => url.includes('/jobsearch') ? 200 : 410, getContentText: () => fixture });
  const result = runScraper();
  assert.equal(result.added, 0); assert.equal(jobs.data[1][13], 'Closed'); assert.equal(jobs.data[1][12], 'Keep until expiration');
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

test('description-only matches enter Jobs and score sorting keeps notes and custom columns attached', () => {
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
  boosted = true; assert.equal(runScraper().added, 0);
  assert.equal(jobs.data[1][0], '12345');
  assert.ok(jobs.data[1][16] > jobs.data[2][16]);
  assert.match(jobs.data[1][18], /Supabase: Description/);
  assert.equal(jobs.data[1][11], 'Saved'); assert.equal(jobs.data[1][12], 'Keep note'); assert.equal(jobs.data[1][19], 'Custom extra');
});

test('JSON progress records share execution ID and match persisted totals', t => {
  const logs = [];
  t.mock.method(console, 'log', value => logs.push(JSON.parse(value)));
  setup();
  logs.length = 0;
  const result = runScraper();
  assert.equal(new Set(logs.map(record => record.executionId)).size, 1);
  assert.ok(logs.every(record => record.operation === 'runScraper' && Number.isFinite(Date.parse(record.timestamp))));
  for (const event of ['operation.started', 'cleanup.completed', 'searches.selected', 'search.page', 'candidates.prepared', 'verification.batch', 'job.checked', 'jobs.saved', 'cursors.saved', 'scraper.completed', 'operation.completed']) {
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

test('verified employment change moves one job with tracking and custom data', t => {
  t.mock.method(console, 'log', () => {});
  configure(); runScraper();
  const source = book.tabs.get('Part Time');
  source.data[0][19] = 'Custom';
  const tracked = source.data.find(row => row[0] === '12345');
  tracked[11] = 'Saved'; tracked[12] = 'Keep note'; tracked[19] = 'Extra';
  const originalFetch = UrlFetchApp.fetch;
  UrlFetchApp.fetch = (url, options) => {
    const response = originalFetch(url, options);
    return { ...response, getContentText: () => url.endsWith('-12345') ? response.getContentText().replace('<p>Part Time</p>', '<p>Full Time</p>') : response.getContentText() };
  };
  assert.equal(runScraper().outcome, 'Success');
  assert.ok(!source.data.slice(1).some(row => row[0] === '12345'));
  const moved = book.tabs.get('Full Time').data[1];
  assert.equal(moved[0], '12345'); assert.equal(moved[11], 'Saved'); assert.equal(moved[12], 'Keep note'); assert.equal(moved[19], 'Extra');
  assert.equal(runScraper().added, 0);
  assert.equal(book.tabs.get('Full Time').getLastRow(), 2);
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

test('late Applied edits survive expiry scan and transfer next run', async () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][5] = '2020-01-01 00:00:00';
  const snapshot = jobs.data.slice(1).map(row => row.slice());
  jobs.data[1][11] = 'Applied';
  const { removeExpiredJobs } = await import('../src/spreadsheet/sheets.js');
  assert.equal(removeExpiredJobs(jobs, snapshot, Date.now()), 0);
  assert.equal(runScraper().moved, 1);
});

test('unrelated Applications content blocks refresh before cleanup', () => {
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

test('transfer stamps Last Seen as arrival time starting stale-Applied clock', () => {
  configure(); runScraper();
  const before = Date.now();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  assert.equal(runScraper().moved, 1);
  const apps = book.getSheetByName('Applications');
  const stamped = apps.data[1][10];
  assert.ok(stamped instanceof Date);
  assert.ok(stamped.getTime() >= before - 1000 && stamped.getTime() <= Date.now() + 1000);
});

test('stale Applied rows expire after 14 days in Applications; other outcomes stay', async () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  assert.equal(runScraper().moved, 1);
  const apps = book.getSheetByName('Applications');
  const old = new Date(Date.now() - 14 * 24 * 3600000 - 1000);
  apps.data[1][10] = old;
  apps.data[1][11] = 'Applied';
  book.getSheetByName('Searches').data[1][0] = false;
  const result = runScraper();
  assert.equal(result.removed, 1);
  assert.equal(apps.data.length, 1);
  assert.equal(book.getSheetByName('Runs').data.at(-1)[8], 1);
  const { APPLICATION_STATUSES } = await import('../src/config/settings.js');
  const kept = APPLICATION_STATUSES.filter(value => value !== 'Applied');
  kept.forEach((status, index) => {
    const fresh = [String(77101 + index), 'Old job', 'https://example.com', '', 'Part Time', '2020-01-01 00:00:00', '', '', '', new Date(0), old, status, '', 'Open', new Date(0), '', 0, '', ''];
    apps.data.push(fresh);
  });
  assert.equal(runScraper().removed, 0);
  assert.equal(apps.data.length, 5);
});

test('fresh Applied rows survive Applications cleanup; late status change survives scan', async () => {
  configure(); runScraper();
  const jobs = book.getSheetByName('Part Time'); jobs.data[1][11] = 'Applied';
  assert.equal(runScraper().moved, 1);
  const apps = book.getSheetByName('Applications');
  book.getSheetByName('Searches').data[1][0] = false;
  assert.equal(runScraper().removed, 0);
  assert.equal(apps.data.length, 2);
  const { removeExpiredApplications } = await import('../src/spreadsheet/sheets.js');
  const { rows } = await import('../src/spreadsheet/sheets.js');
  apps.data[1][10] = new Date(Date.now() - 14 * 24 * 3600000 - 1000);
  const snapshot = rows(apps, apps.data[0].length).map(row => row.slice());
  apps.data[1][11] = 'Interviewing';
  assert.equal(removeExpiredApplications(apps, snapshot, Date.now()), 0);
  assert.equal(apps.data.length, 2);
});
