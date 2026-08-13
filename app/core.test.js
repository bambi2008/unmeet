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

test('matches follow-up rows by normalized title and owner', () => {
  const baseline = { ...series, id: 'base', owner: 'Maya Chen' };
  const followup = [{ ...series, id: 'follow', title: ' weekly-sync ', owner: 'MAYA CHEN' }];
  const match = Core.matchFollowupSeries(baseline, followup);
  assert.equal(match.confidence, 'high');
  assert.equal(match.row.id, 'follow');
});

test('applies follow-up values and reports verified savings', () => {
  const workspace = { hourlyRate: 75, series: [{ ...series, id: 'base', owner: 'Maya', decision: { action: 'shorten', targetDuration: 30 } }] };
  const result = Core.applyFollowup(workspace, [{ ...series, id: 'follow', owner: 'Maya', durationMinutes: 45 }], '2026-09-01');
  assert.equal(result.summary.matched, 1);
  assert.equal(result.workspace.series[0].actual.durationMinutes, 45);
  assert.equal(Core.savings(result.workspace.series[0], 'actual'), 10);
});

test('verifies an expected absence for canceled meetings', () => {
  const workspace = { series: [{ ...series, id: 'base', owner: 'Maya', decision: { action: 'cancel' } }] };
  const result = Core.applyFollowup(workspace, [], '2026-09-01');
  assert.equal(result.summary.verifiedAbsent, 1);
  assert.equal(Core.monthlyPersonHours(result.workspace.series[0], 'actual'), 0);
});

test('does not guess when multiple follow-up titles match', () => {
  const baseline = { ...series, id: 'base', owner: 'Unknown' };
  const rows = [{ ...series, id: 'a', owner: 'A' }, { ...series, id: 'b', owner: 'B' }];
  const match = Core.matchFollowupSeries(baseline, rows);
  assert.equal(match.confidence, 'ambiguous');
  assert.equal(match.row, null);
});

test('validates restorable project files', () => {
  assert.deepEqual(Core.validateProject({ name: 'Acme', series: [series] }), []);
  assert.ok(Core.validateProject({ name: '', series: [] }).length > 0);
});

test('reports meeting growth and net current load', () => {
  const workspace = { hourlyRate: 75, series: [{ ...series, actual: { durationMinutes: 90, attendeeCount: 10, occurrencesPerMonth: 4 }, decision: { action: 'keep' } }] };
  const metrics = Core.workspaceMetrics(workspace);
  assert.equal(metrics.baselineHours, 40);
  assert.equal(metrics.currentHours, 60);
  assert.equal(metrics.increasedHours, 20);
  assert.equal(metrics.verifiedNetChange, -20);
  assert.equal(metrics.verifiedSavings, 0);
});
