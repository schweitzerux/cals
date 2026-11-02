import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

test('parses entries the way they were typed in Discord', () => {
  assert.deepEqual(L.parseEntry('1250 panda plate'), { cal: 1250, label: 'panda plate' });
  assert.deepEqual(L.parseEntry('Chipotle bowl 900'), { cal: 900, label: 'Chipotle bowl' });
  assert.deepEqual(L.parseEntry('1,250'), { cal: 1250, label: '' });
  assert.deepEqual(L.parseEntry('2 eggs 140'), { cal: 140, label: '2 eggs' });
  assert.equal(L.parseEntry('cake'), null);
  assert.equal(L.parseEntry(''), null);
});

test('weeks run Monday to Sunday', () => {
  assert.equal(L.mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(L.mondayOf('2026-11-01'), '2026-10-26');
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
});

test('saved items come from labels, most used first, and can be hidden', () => {
  const s = L.emptyState();
  s.entries = [
    { d: '2026-10-21', cal: 400, label: 'cake' },
    { d: '2026-10-21', cal: 1250, label: 'panda plate' },
    { d: '2026-10-22', cal: 1250, label: 'Panda Plate' },
    { d: '2026-10-22', cal: 80, label: '' },
  ];
  assert.deepEqual(L.savedItems(s).map((i) => i.label), ['Panda Plate', 'cake']);
  assert.deepEqual(L.matchSaved(L.savedItems(s), '125').map((i) => i.cal), [1250]);
  assert.deepEqual(L.matchSaved(L.savedItems(s), 'cak').map((i) => i.cal), [400]);
  assert.deepEqual(L.matchSaved(L.savedItems(s), '1250 pan').map((i) => i.cal), [1250]);
  s.hiddenSaved = ['400|cake'];
  assert.equal(L.savedItems(s).length, 1);
});

// Builds steady eating and a steady weight change, week by week.
function steady(weeks, dailyCal, lbPerWeek) {
  const s = L.emptyState();
  s.weeklyBase = 23000;
  let d = '2027-01-04';
  for (let w = 0; w <= weeks; w += 1) {
    s.weights.push({ d, lb: 340 + lbPerWeek * w });
    if (w < weeks) for (let i = 0; i < 7; i += 1) s.entries.push({ d: L.addDays(d, i), cal: dailyCal, label: '' });
    d = L.addDays(d, 7);
  }
  return s;
}

test('with no weigh-ins the starting number stands', () => {
  const s = L.emptyState(); s.weeklyBase = 23000;
  assert.deepEqual(L.estimate(s), { weekly: 23000, range: 2300, weighIns: 0, usedWeights: false });
});

test('even a 5 lb swing in one week moves the estimate only about 1,000', () => {
  const e = L.estimate(steady(1, 2400, -5));
  assert.ok(Math.abs(e.weekly - 23000) <= 1100, String(e.weekly));
});

test('twelve weeks of data pulls the estimate toward the real number', () => {
  // 2,400 a day is 16,800 a week; losing 2 lb a week adds 7,000, so the true burn is 23,800.
  const s = steady(12, 2400, -2);
  s.weeklyBase = 21000;
  const e = L.estimate(s);
  assert.ok(e.usedWeights);
  assert.ok(e.weekly > 23300 && e.weekly <= 23800, String(e.weekly));
  assert.ok(e.range < 500, String(e.range));
});

test('incomplete weeks are left out of the estimate', () => {
  const s = steady(8, 2400, -2);
  s.entries = s.entries.map((e) => (e.d < '2027-01-11' ? { ...e, cal: 100 } : e));
  const before = L.estimate(s).weekly;
  s.incompleteWeeks = ['2027-01-04'];
  assert.ok(L.estimate(s).weekly > before);
});

test('BMI from height and weight', () => {
  assert.equal(Math.round(L.bmi(70, 180)), 26);
});

test('backup validation rejects other files', () => {
  assert.ok(L.isValidBackup(L.emptyState()));
  assert.ok(!L.isValidBackup({ hello: 1 }));
  assert.ok(!L.isValidBackup({ v: 1, entries: [{ d: 'x', cal: 1 }], weights: [] }));
});
