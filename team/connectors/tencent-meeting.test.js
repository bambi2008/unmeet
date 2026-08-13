const test = require('node:test');
const assert = require('node:assert/strict');
const connector = require('./tencent-meeting');

test('groups Tencent Meeting occurrences into a monthly series', () => {
  const series = connector.normalize({ meeting_info_list: [
    { meeting_id: 'one', recurring_id: 'weekly', subject: '产品周会', owner_email: 'owner@example.com', start_time: 1000, end_time: 4600, participant_count: 10 },
    { meeting_id: 'two', recurring_id: 'weekly', subject: '产品周会', owner_email: 'owner@example.com', start_time: 9000, end_time: 10800, participant_count: 8 },
  ] });
  assert.equal(series.length, 1);
  assert.equal(series[0].occurrencesPerMonth, 2);
  assert.equal(series[0].durationMinutes, 45);
  assert.equal(series[0].attendeeCount, 9);
  assert.equal(series[0].ownerEmail, 'owner@example.com');
});

test('accepts Tencent meeting export arrays', () => {
  const series = connector.normalize([{ meeting_id: 'm1', title: '设计评审', duration_minutes: 30, online_member_num: 6 }]);
  assert.equal(series[0].title, '设计评审');
  assert.equal(series[0].durationMinutes, 30);
});
