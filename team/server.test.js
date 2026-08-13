const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'unmeet-team-test-'));
process.env.UNMEET_DB = path.join(temp, 'test.db');
const { server } = require('./server');

let base;
let adminCookie;
let ownerCookie;

async function call(pathname, options = {}, cookie = adminCookie) {
  const response = await fetch(`${base}${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } });
  const body = await response.json();
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });

test('initializes a team workspace and authenticated session', async () => {
  const result = await call('/api/setup', { method: 'POST', body: JSON.stringify({ workspaceName: 'Acme', name: 'Admin', email: 'admin@acme.test', password: 'very-secure-password', hourlyRate: 80 }) }, null);
  assert.equal(result.response.status, 201);
  adminCookie = result.cookie;
  const workspace = await call('/api/workspace');
  assert.equal(workspace.body.workspace.name, 'Acme');
});

test('imports shared baseline and creates a meeting-owner invitation', async () => {
  const csv = 'title,owner,owner_email,team,duration_minutes,attendee_count,occurrences_per_month\nWeekly Sync,Maya,maya@acme.test,Product,60,10,4\nLeadership Review,Admin,admin@acme.test,Leadership,30,5,4';
  const imported = await call('/api/import', { method: 'POST', body: JSON.stringify({ provider: 'csv', mode: 'baseline', payload: csv }) });
  assert.equal(imported.body.imported, 2);
  const invited = await call('/api/invites', { method: 'POST', body: JSON.stringify({ email: 'maya@acme.test', role: 'meeting_owner' }) });
  assert.ok(invited.body.invite.token);
  const accepted = await call(`/api/invites/${invited.body.invite.token}`, { method: 'POST', body: JSON.stringify({ name: 'Maya', password: 'another-secure-password' }) }, null);
  assert.equal(accepted.response.status, 201);
  ownerCookie = accepted.cookie;
});

test('meeting owner sees and changes only assigned meetings', async () => {
  const workspace = await call('/api/workspace', {}, ownerCookie);
  assert.equal(workspace.body.workspace.series.length, 1);
  assert.equal(workspace.body.workspace.series[0].title, 'Weekly Sync');
  const seriesId = workspace.body.workspace.series[0].id;
  const decision = await call(`/api/series/${seriesId}/decision`, { method: 'PATCH', body: JSON.stringify({ action: 'shorten', owner: 'Maya', targetDuration: 30, effectiveDate: '2026-08-14', reviewDate: '2026-09-13' }) }, ownerCookie);
  assert.equal(decision.response.status, 200);
  const audit = await call('/api/audit');
  assert.ok(audit.body.logs.some(log => log.action === 'decision.updated'));
});
