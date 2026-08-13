const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Billing = require('./billing');

test('verifies an authentic Stripe webhook using the raw body', () => {
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = 'whsec_test';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(Billing.verifyWebhook(raw, `t=${timestamp},v1=${signature}`, secret).id, 'evt_1');
});

test('rejects a tampered Stripe webhook', () => {
  assert.throws(() => Billing.verifyWebhook('{}', `t=${Math.floor(Date.now()/1000)},v1=00`, 'whsec_test'), /verification failed/);
});

test('maps checkout completion to workspace billing state', () => {
  const update = Billing.subscriptionUpdate({ type: 'checkout.session.completed', data: { object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspace_id: 'ws_1', plan: 'team' } } } });
  assert.deepEqual(update, { workspaceId: 'ws_1', plan: 'team', status: 'active', customerId: 'cus_1', subscriptionId: 'sub_1' });
});
