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
  const secondAppliedId = '990000000003', conflictId = '990000000004';
  const fixtureIds = [testAppliedId, testExpiredId, secondAppliedId, conflictId];
  const allBefore = [...types.flatMap(name => values(book.getSheetByName(name))), ...values(apps)];
  assert(!allBefore.some(row => fixtureIds.includes(String(row[0]))), 'Acceptance fixtures already exist; use a fresh copy.');
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
  if (at + 3 > source.getMaxRows()) source.insertRowsAfter(source.getMaxRows(), at + 3 - source.getMaxRows());
  const posted = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');
  const secondApplied = make(secondAppliedId, 'Applied', posted); secondApplied[16] = 11;
  const conflictingSource = make(conflictId, 'Closed', '2020-01-01 00:00:00');
  const conflictingDestination = make(conflictId, 'Applied', '2020-01-01 00:00:00');
  conflictingDestination[12] = 'Keep the distinct application note';
  source.getRange(at, 1, 4, width).setValues([
    make(testAppliedId, 'Applied', posted),
    secondApplied,
    make(testExpiredId, 'Saved', '2020-01-01 00:00:00'),
    conflictingSource,
  ]);
  source.getRange(at, width, 1, 1).setFormula(`=Q${at}*2`);
  source.getRange(at + 1, width, 1, 1).setFormula(`=Q${at + 1}*3`);
  const applicationRow = apps.getLastRow() + 1;
  if (applicationRow > apps.getMaxRows()) apps.insertRowsAfter(apps.getMaxRows(), 1);
  apps.getRange(applicationRow, 1, 1, width).setValues([conflictingDestination]);
  SpreadsheetApp.flush();
  const first = runScraper();
  const check = result => {
    assert(result.outcome === 'Partial' && result.conflicts === 1, 'Expected only the deliberate conflict and an otherwise successful refresh; inspect Runs.');
    const discovery = types.flatMap(name => values(book.getSheetByName(name)));
    const applications = values(apps);
    const ids = [...discovery, ...applications].map(row => String(row[0]));
    const undisputed = ids.filter(id => id !== conflictId);
    assert(new Set(undisputed).size === undisputed.length, 'Unexpected duplicate job IDs after refresh.');
    assert(discovery.filter(row => String(row[0]) === conflictId).length === 1 &&
      applications.filter(row => String(row[0]) === conflictId).length === 1, 'Conflict copies were deleted or duplicated.');
    const retainedSource = discovery.find(row => String(row[0]) === conflictId);
    const retainedDestination = applications.find(row => String(row[0]) === conflictId);
    assert(retainedSource[11] === 'Closed' && retainedSource[12] === conflictingSource[12] &&
      retainedDestination[11] === 'Applied' && retainedDestination[12] === conflictingDestination[12], 'Conflicted tracking data changed.');
    assert(!discovery.some(row => String(row[0]) === testExpiredId), 'Expired fixture retained.');
    const history = book.getSheetByName('Expired IDs');
    assert(history.getRange(2, 1, history.getLastRow() - 1, 1).getValues().some(([id]) => String(id) === testExpiredId), 'Expired ID not recorded.');
    assert(!history.getRange(2, 1, history.getLastRow() - 1, 1).getValues().some(([id]) => String(id) === conflictId), 'Conflicted ID entered expiry history.');
    for (const [id, multiplier, expected] of [[testAppliedId, 2, 14], [secondAppliedId, 3, 33]]) {
      assert(!discovery.some(row => String(row[0]) === id), 'Transferred source was retained.');
      const records = apps.getRange(2, 1, apps.getLastRow() - 1, width).getValues();
      const index = records.findIndex(row => String(row[0]) === id);
      const row = records[index];
      assert(row && row[12] === 'Preserve acceptance note' && row[width - 1] === expected, 'Transferred note/formula result changed.');
      assert(apps.getRange(index + 2, width, 1, 1).getFormulaR1C1() === `=RC[${17 - width}]*${multiplier}`, 'Transfer flattened or mislocated a relative formula.');
    }
    for (const name of types) {
      const tab = book.getSheetByName(name);
      const dates = values(tab).map(row => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row[5])) ? Date.parse(row[5].replace(' ', 'T') + '+08:00') : -Infinity);
      assert(dates.every((date, i) => !i || dates[i - 1] >= date), `${name} is not newest-first.`);
      assert(!PropertiesService.getDocumentProperties().getProperty(`pendingJobSort:${tab.getSheetId()}`), 'Sort recovery journal remains.');
    }
    return { discovery: discovery.length, applications: applications.length };
  };
  const afterFirst = check(first);
  const second = runScraper();
  const afterSecond = check(second);
  assert(second.moved === 0, 'Repeat refresh transferred a duplicate.');
  const result = { first, second, afterFirst, afterSecond, automaticTriggers: 0 };
  console.log(JSON.stringify({ event: 'acceptance.completed', ...result }));
  return result;
}
