import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowDifferences } from '../src/spreadsheet/job-tabs.js';

test('migration compares Sheets text IDs, numeric scores and sub-millisecond date roundoff', () => {
  const source = Array(19).fill('');
  source[0] = '12345'; source[9] = new Date('2026-09-08T04:00:00.123Z'); source[16] = 10;
  const copied = source.slice(); copied[0] = 12345; copied[9] = new Date('2026-09-08T04:00:00.122Z'); copied[16] = '10';
  assert.deepEqual(rowDifferences(copied, source), []);
  copied[9] = new Date('2026-09-08T04:00:01.123Z');
  assert.equal(rowDifferences(copied, source)[0].column, 'First Seen');
});

test('migration accepts only equivalent literal escaping and preserves tracking conflicts', () => {
  const source = Array(20).fill(''); source[0] = '123'; source[12] = '- Contact tomorrow'; source[19] = 'Custom';
  const copy = source.slice(); copy[12] = "'- Contact tomorrow";
  assert.deepEqual(rowDifferences(copy, source), []);
  copy[12] = 'Edited'; copy[19] = 'Different';
  assert.deepEqual(rowDifferences(copy, source).map(item => item.column), ['Notes', 'Custom column 20']);
  assert.ok(!JSON.stringify(rowDifferences(copy, source)).includes('Contact tomorrow'));
  assert.ok(rowDifferences(undefined, source).length);
});
