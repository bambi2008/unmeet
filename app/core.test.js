const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('./core');

const series = { title: 'Weekly Sync', durationMinutes: 60, attendeeCount: 10, occurrencesPerMonth: 4 };

test('calculates baseline monthly person-hours', () => {
  assert.equal(Core.monthlyPersonHours(series), 40);
});

test('calculates planned savings for each material action', () => {
  assert.equal(Core.savings({ ...series, decision: { action: 'shorten', targetDuration: 30 } }), 20);
  assert.equal(Core.savings({ ...series, decision: { action: 'reduce_frequency', targetOccurrences: 2 } }), 20);
  assert.equal(Core.savings({ ...series, decision: { action: 'reduce_attendees', targetAttendees: 6 } }), 16);
  assert.equal(Core.savings({ ...series, decision: { action: 'cancel' } }), 40);
  assert.equal(Core.savings({ ...series, decision: { action: 'keep' } }), 0);
});

test('keeps planned and verified savings separate', () => {
  const item = { ...series, decision: { action: 'shorten', targetDuration: 30 }, actual: { durationMinutes: 45, attendeeCount: 10, occurrencesPerMonth: 4 } };
  assert.equal(Core.savings(item, 'planned'), 20);
  assert.equal(Core.savings(item, 'actual'), 10);
});

test('aggregates workspace metrics without treating plans as verified', () => {
  const metrics = Core.workspaceMetrics({ hourlyRate: 75, series: [
    { ...series, id: 'a', decision: { action: 'cancel' } },
    { ...series, id: 'b', decision: { action: 'shorten', targetDuration: 30 }, actual: { durationMinutes: 45, attendeeCount: 10, occurrencesPerMonth: 4 } },
  ] });
  assert.equal(metrics.baselineHours, 80);
  assert.equal(metrics.plannedSavings, 60);
  assert.equal(metrics.verifiedSavings, 10);
  assert.equal(metrics.verifiedSavingsCost, 750);
});

test('parses quoted CSV and normalizes fields', () => {
  const data = Core.parseCSV('title,owner,duration_minutes,attendee_count,occurrences_per_month\n"Product, Weekly",Maya,45,8,4\n');
  assert.equal(data.length, 1);
  assert.equal(data[0].title, 'Product, Weekly');
  assert.equal(data[0].durationMinutes, 45);
  assert.equal(Core.monthlyPersonHours(data[0]), 24);
});

test('rejects a reduction that does not improve the baseline', () => {
  const errors = Core.validateDecision(series, { action: 'shorten', owner: 'Maya', effectiveDate: '2026-08-01', reviewDate: '2026-09-01', targetDuration: 60 });
  assert.ok(errors.some(error => error.includes('shorter')));
});
