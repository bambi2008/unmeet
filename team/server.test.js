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
let primaryWorkspaceId;

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
  const result = await call('/api/register', { method: 'POST', body: JSON.stringify({ workspaceName: 'Acme', name: 'Admin', email: 'admin@acme.test', password: 'very-secure-password', hourlyRate: 80, timezone: 'America/New_York' }) }, null);
  assert.equal(result.response.status, 201);
  adminCookie = result.cookie;
  const workspace = await call('/api/workspace');
  assert.equal(workspace.body.workspace.name, 'Acme');
  assert.equal(workspace.body.workspace.plan, 'trial');
  primaryWorkspaceId = workspace.body.workspace.id;
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

test('one account can create and switch between isolated customer workspaces', async () => {
  const created = await call('/api/workspaces', { method: 'POST', body: JSON.stringify({ workspaceName: 'Beta Client', hourlyRate: 95, timezone: 'Europe/London', currency: 'GBP' }) });
  assert.equal(created.response.status, 201);
  const second = await call('/api/workspace');
  assert.equal(second.body.workspace.name, 'Beta Client');
  assert.equal(second.body.workspace.series.length, 0);
  const session = await call('/api/session');
  assert.equal(session.body.workspaces.length, 2);
  const switched = await call(`/api/workspaces/${primaryWorkspaceId}/switch`, { method: 'POST' });
  assert.equal(switched.body.user.workspaceId, primaryWorkspaceId);
  const primary = await call('/api/workspace');
  assert.equal(primary.body.workspace.series.length, 2);
});

test('administrator can update and export the active workspace', async () => {
  const updated = await call('/api/workspace/settings', { method: 'PATCH', body: JSON.stringify({ name: 'Acme Global', hourlyRate: 88, timezone: 'UTC', currency: 'USD' }) });
  assert.equal(updated.body.workspace.name, 'Acme Global');
  const exported = await call('/api/workspace/export');
  assert.equal(exported.body.workspace.name, 'Acme Global');
  assert.equal(exported.body.series.length, 2);
});

test('supports password recovery without account enumeration', async () => {
  const known=await call('/api/password/forgot',{method:'POST',body:JSON.stringify({email:'admin@acme.test'})},null);
  const unknown=await call('/api/password/forgot',{method:'POST',body:JSON.stringify({email:'nobody@acme.test'})},null);
  assert.equal(known.response.status,202);assert.equal(unknown.response.status,202);assert.deepEqual(known.body,unknown.body);
});

test('lists sessions and requires a valid password for recent authentication', async () => {
  const sessions=await call('/api/account/sessions');assert.ok(sessions.body.sessions.some(item=>item.current));
  const denied=await call('/api/account/reauth',{method:'POST',body:JSON.stringify({password:'wrong-password'})});assert.equal(denied.response.status,401);
  const accepted=await call('/api/account/reauth',{method:'POST',body:JSON.stringify({password:'very-secure-password'})});assert.equal(accepted.response.status,200);
});

test('hard-deletes a workspace and returns a non-identifying receipt', async () => {
  const created=await call('/api/workspaces',{method:'POST',body:JSON.stringify({workspaceName:'Disposable',hourlyRate:75,timezone:'UTC',currency:'USD'})});assert.equal(created.response.status,201);
  await call('/api/account/reauth',{method:'POST',body:JSON.stringify({password:'very-secure-password'})});
  const removed=await call('/api/workspace',{method:'DELETE',body:JSON.stringify({confirmation:'Disposable'})});assert.equal(removed.response.status,200);assert.match(removed.body.receiptId,/^del_/);
});

test('applies an IP-wide authentication ceiling even when emails rotate', async () => {
  process.env.UNMEET_TRUST_PROXY='true';process.env.UNMEET_AUTH_IP_LIMIT='2';
  const headers={'X-Forwarded-For':'203.0.113.77'};
  const first=await call('/api/login',{method:'POST',headers,body:JSON.stringify({email:'rotate-1@example.test',password:'not-the-password'})},null);
  const second=await call('/api/login',{method:'POST',headers,body:JSON.stringify({email:'rotate-2@example.test',password:'not-the-password'})},null);
  const third=await call('/api/login',{method:'POST',headers,body:JSON.stringify({email:'rotate-3@example.test',password:'not-the-password'})},null);
  assert.equal(first.response.status,401);assert.equal(second.response.status,401);assert.equal(third.response.status,429);
  delete process.env.UNMEET_TRUST_PROXY;delete process.env.UNMEET_AUTH_IP_LIMIT;
});
