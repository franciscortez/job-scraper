// Native-engine acceptance helper. Upload only to the isolated acceptance project.
// Replace the guard token with the copied workbook ID; never use production's ID.
function runAcceptanceChecks() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== '__ACCEPTANCE_WORKBOOK_ID__') {
    throw new Error('Acceptance tests require the designated workbook copy.');
  }
  if (ScriptApp.getProjectTriggers().length) {
    throw new Error('Remove test-project triggers before running acceptance checks.');
  }
  setup();
  const types = ['Part Time', 'Full Time', 'Gig', 'Any'];
  const values = tab => tab.getLastRow() > 1 ? tab.getRange(2, 1, tab.getLastRow() - 1, 19).getValues().filter(row => row[0] !== '') : [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const source = book.getSheetByName('Part Time');
  const apps = book.getSheetByName('Applications');
  const testAppliedId = '990000000001', testExpiredId = '990000000002';
  const allBefore = [...types.flatMap(name => values(book.getSheetByName(name))), ...values(apps)];
  assert(!allBefore.some(row => [testAppliedId, testExpiredId].includes(String(row[0]))), 'Acceptance fixtures already exist; use a fresh copy.');
  const width = Math.max(20, source.getLastColumn() + 1, apps.getLastColumn() + 1);
  for (const tab of [source, apps]) {
    if (tab.getMaxColumns() < width) tab.insertColumnsAfter(tab.getMaxColumns(), width - tab.getMaxColumns());
    tab.getRange(1, width, 1, 1).setValues([['Acceptance formula']]);
  }
  const make = (id, status, posted) => {
    const row = Array(width).fill('');
    row[0] = id; row[1] = 'Acceptance fixture'; row[4] = 'Part Time'; row[5] = posted;
    row[9] = new Date(); row[10] = new Date(); row[11] = status; row[12] = 'Preserve acceptance note'; row[16] = 7;
    return row;
  };
  const at = source.getLastRow() + 1;
  if (at + 1 > source.getMaxRows()) source.insertRowsAfter(source.getMaxRows(), at + 1 - source.getMaxRows());
  source.getRange(at, 1, 2, width).setValues([
    make(testAppliedId, 'Applied', Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss')),
    make(testExpiredId, 'Saved', '2020-01-01 00:00:00'),
  ]);
  source.getRange(at, width, 1, 1).setFormula(`=Q${at}*2`);
  SpreadsheetApp.flush();
  const first = runScraper();
  const check = () => {
    const discovery = types.flatMap(name => values(book.getSheetByName(name)));
    const applications = values(apps);
    const ids = [...discovery, ...applications].map(row => String(row[0]));
    assert(new Set(ids).size === ids.length, 'Duplicate job IDs after refresh.');
    assert(!discovery.some(row => String(row[0]) === testExpiredId), 'Expired fixture retained.');
    const history = book.getSheetByName('Expired IDs');
    assert(history.getRange(2, 1, history.getLastRow() - 1, 1).getValues().some(([id]) => String(id) === testExpiredId), 'Expired ID not recorded.');
    const row = apps.getRange(2, 1, apps.getLastRow() - 1, width).getValues().find(row => String(row[0]) === testAppliedId);
    assert(row && row[12] === 'Preserve acceptance note' && row[width - 1] === 14, 'Transferred note/formula result changed.');
    const location = apps.getRange(2, 1, apps.getLastRow() - 1, 1).getValues().findIndex(([id]) => String(id) === testAppliedId) + 2;
    assert(Boolean(apps.getRange(location, width, 1, 1).getFormula()), 'Transfer flattened the formula.');
    for (const name of types) {
      const tab = book.getSheetByName(name);
      const dates = values(tab).map(row => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row[5])) ? Date.parse(row[5].replace(' ', 'T') + '+08:00') : -Infinity);
      assert(dates.every((date, i) => !i || dates[i - 1] >= date), `${name} is not newest-first.`);
      assert(!PropertiesService.getDocumentProperties().getProperty(`pendingJobSort:${tab.getSheetId()}`), 'Sort recovery journal remains.');
    }
    return { discovery: discovery.length, applications: applications.length };
  };
  const afterFirst = check();
  const second = runScraper();
  const afterSecond = check();
  const result = { first, second, afterFirst, afterSecond, automaticTriggers: 0 };
  console.log(JSON.stringify({ event: 'acceptance.completed', ...result }));
  return result;
}
