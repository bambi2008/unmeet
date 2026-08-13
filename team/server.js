const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../app/core');
const { createDb } = require('./saas-db');
const Connectors = require('./connectors');
const Billing = require('./billing');
const Email = require('./email');

const HOST = process.env.UNMEET_HOST || '127.0.0.1';
const PORT = Number(process.env.UNMEET_PORT || 8787);
const DB_FILE = process.env.UNMEET_DB || path.join(__dirname, 'unmeet.db');
const PUBLIC = path.join(__dirname, 'public');
const store = createDb(DB_FILE);
const attempts = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const publicRoles = { admin: 'Admin', delivery_partner: 'Delivery Partner', meeting_owner: 'Meeting Owner', executive_viewer: 'Executive Viewer' };

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('='); return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
  }));
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Request is larger than 2 MB.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Request body must be valid JSON.'); }
}

async function rawBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new Error('Request is larger than 2 MB.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

function sessionCookie(token, maxAge = 604800) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `unmeet_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function baseUrl(req) {
  if (process.env.UNMEET_PUBLIC_URL) return process.env.UNMEET_PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return `${proto}://${req.headers.host}`;
}

function rateLimit(req, key, limit = 10) {
  const bucket = `${req.socket.remoteAddress || 'unknown'}:${key}`; const current = attempts.get(bucket) || { count: 0, reset: Date.now() + 15 * 60000 };
  if (Date.now() > current.reset) { current.count = 0; current.reset = Date.now() + 15 * 60000; }
  current.count += 1; attempts.set(bucket, current);
  if (current.count > limit) throw new Error('Too many attempts. Try again later.');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function currentUser(req) { return store.sessionUser(cookies(req).unmeet_session); }
function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) send(res, 401, { error: 'Please sign in.' });
  return user;
}
function requireEditor(user) {
  if (!['admin', 'delivery_partner'].includes(user.role)) throw new Error('Administrator or delivery partner permission is required.');
}

function serveFile(req, res, pathname) {
  const target = pathname === '/shared/core.js' ? path.join(__dirname, '..', 'app', 'core.js') : path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!target.startsWith(PUBLIC) && pathname !== '/shared/core.js') return false;
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) return false;
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
    return true;
  } catch { return false; }
}

async function api(req, res, pathname) {
  const method = req.method;
  if (pathname === '/api/webhooks/stripe' && method === 'POST') {
    const raw = await rawBody(req);
    const event = Billing.verifyWebhook(raw, req.headers['stripe-signature']);
    if (!store.webhookProcessed('stripe', event.id)) {
      const update = Billing.subscriptionUpdate(event);
      if (update?.workspaceId) store.updateBilling(update.workspaceId, update);
      store.markWebhookProcessed('stripe', event.id);
    }
    return send(res, 200, { received: true });
  }
  if (method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-origin request rejected.' });

  if (pathname === '/api/status' && method === 'GET') {
    return send(res, 200, { registrationOpen: process.env.UNMEET_DISABLE_SIGNUP !== 'true', version: '0.3.0', billingConfigured: Billing.configured(), emailConfigured: Email.configured() });
  }
  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true, version: '0.3.0', time: new Date().toISOString() });
  if (pathname === '/api/register' && method === 'POST') {
    if (process.env.UNMEET_DISABLE_SIGNUP === 'true') return send(res, 403, { error: 'New account registration is disabled.' });
    rateLimit(req, 'register', 5);
    const data = await body(req);
    if (!data.workspaceName?.trim() || !data.name?.trim() || !/^\S+@\S+\.\S+$/.test(data.email || '') || String(data.password || '').length < 10) throw new Error('Workspace, name, valid email, and a password of at least 10 characters are required.');
    const user = store.register({ ...data, workspaceName: data.workspaceName.trim(), name: data.name.trim(), email: data.email.trim() });
    const session = store.createSession(user.accountId, user.workspaceId);
    return send(res, 201, { user }, { 'Set-Cookie': sessionCookie(session.token) });
  }
  if (pathname === '/api/login' && method === 'POST') {
    rateLimit(req, 'login');
    const data = await body(req);
    const user = store.authenticate(data.email || '', data.password || '');
    if (!user) return send(res, 401, { error: 'Email or password is incorrect.' });
    if (!user.workspaceId) return send(res, 403, { error: 'This account has no active workspace.' });
    const session = store.createSession(user.accountId, user.workspaceId);
    return send(res, 200, { user }, { 'Set-Cookie': sessionCookie(session.token) });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    store.deleteSession(cookies(req).unmeet_session);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  const inviteMatch = pathname.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteMatch && method === 'GET') {
    const invite = store.inviteInfo(inviteMatch[1]);
    return invite ? send(res, 200, { invite }) : send(res, 404, { error: 'Invite is invalid or expired.' });
  }
  if (inviteMatch && method === 'POST') {
    const data = await body(req);
    if (!data.name?.trim() || String(data.password || '').length < 10) throw new Error('Name and a password of at least 10 characters are required.');
    const user = store.acceptInvite(inviteMatch[1], data.name.trim(), data.password);
    const session = store.createSession(user.accountId, user.workspaceId);
    return send(res, 201, { user }, { 'Set-Cookie': sessionCookie(session.token) });
  }

  const user = requireUser(req, res);
  if (!user) return;
  if (pathname === '/api/session' && method === 'GET') return send(res, 200, { user, roles: publicRoles, workspaces: store.workspaceList(user.accountId) });
  if (pathname === '/api/workspaces' && method === 'POST') {
    const data = await body(req);
    if (!data.workspaceName?.trim()) throw new Error('Workspace name is required.');
    const created = store.createWorkspaceForAccount(user.accountId, data);
    store.switchWorkspace(cookies(req).unmeet_session, user.accountId, created.workspaceId);
    return send(res, 201, { user: created });
  }
  const switchMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/switch$/);
  if (switchMatch && method === 'POST') return send(res, 200, { user: store.switchWorkspace(cookies(req).unmeet_session, user.accountId, switchMatch[1]) });
  if (pathname === '/api/workspace' && method === 'GET') {
    const workspace = store.workspace(user.workspaceId);
    const series = store.listSeries(user);
    return send(res, 200, { workspace: { ...workspace, series }, metrics: Core.workspaceMetrics({ ...workspace, series }) });
  }
  if (pathname === '/api/members' && method === 'GET') return send(res, 200, { members: store.members(user.workspaceId) });
  if (pathname === '/api/workspace/settings' && method === 'PATCH') {
    const data = await body(req); if (!data.name?.trim()) throw new Error('Workspace name is required.');
    store.updateWorkspace(user, data); return send(res, 200, { workspace: store.workspace(user.workspaceId) });
  }
  if (pathname === '/api/workspace/export' && method === 'GET') return send(res, 200, store.exportWorkspace(user));
  if (pathname === '/api/workspace' && method === 'DELETE') {
    const data = await body(req); store.deleteWorkspace(user, data.confirmation); return send(res, 200, { deleted: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (pathname === '/api/audit' && method === 'GET') {
    if (!['admin', 'delivery_partner'].includes(user.role)) return send(res, 403, { error: 'Audit log permission is required.' });
    return send(res, 200, { logs: store.logs(user.workspaceId) });
  }
  if (pathname === '/api/connectors' && method === 'GET') return send(res, 200, { connectors: Connectors.catalog });
  if (pathname === '/api/invites' && method === 'POST') {
    const data = await body(req);
    if (!/^\S+@\S+\.\S+$/.test(data.email || '')) throw new Error('A valid email is required.');
    const invite = store.createInvite(user, data.email.trim(), data.role);
    const inviteUrl = `${baseUrl(req)}/?invite=${invite.token}`;
    let delivery = { sent: false, reason: 'not_configured' };
    try { delivery = await Email.sendInvite({ to: invite.email, workspaceName: store.workspace(user.workspaceId).name, inviterName: user.name, role: publicRoles[invite.role], inviteUrl, idempotencyKey: `invite-${invite.token.slice(0,24)}` }); }
    catch (error) { delivery = { sent: false, reason: error.message }; }
    return send(res, 201, { invite, inviteUrl, delivery });
  }
  if (pathname === '/api/billing/checkout' && method === 'POST') {
    if (user.role !== 'admin') throw new Error('Administrator permission is required.');
    const data = await body(req); if (!['starter','team'].includes(data.plan)) throw new Error('Choose Starter or Team.');
    const checkout = await Billing.createCheckout({ workspace: store.workspace(user.workspaceId), user, plan: data.plan, baseUrl: baseUrl(req) });
    return send(res, 200, { url: checkout.url });
  }
  if (pathname === '/api/billing/portal' && method === 'POST') {
    if (user.role !== 'admin') throw new Error('Administrator permission is required.');
    const portal = await Billing.createPortal({ workspace: store.workspace(user.workspaceId), baseUrl: baseUrl(req) });
    return send(res, 200, { url: portal.url });
  }
  if (pathname === '/api/import' && method === 'POST') {
    requireEditor(user);
    store.assertActive(user.workspaceId);
    const data = await body(req);
    const items = Connectors.normalize(data.provider, data.payload);
    if (!items.length) throw new Error('No meeting series were found.');
    if (data.mode === 'baseline') {
      store.replaceBaseline(user.workspaceId, data.provider, items, user.id);
      return send(res, 200, { imported: items.length });
    }
    if (data.mode === 'followup') {
      const workspace = store.workspace(user.workspaceId);
      const baseline = store.listSeries({ ...user, role: 'admin' });
      const measuredAt = data.measuredAt || new Date().toISOString().slice(0, 10);
      const result = Core.applyFollowup({ ...workspace, series: baseline }, items, measuredAt);
      store.saveFollowup(user.workspaceId, data.provider, result, user.id, measuredAt);
      return send(res, 200, { summary: result.summary, matches: result.matches });
    }
    throw new Error('Import mode must be baseline or followup.');
  }
  const decisionMatch = pathname.match(/^\/api\/series\/([^/]+)\/decision$/);
  if (decisionMatch && method === 'PATCH') {
    store.assertActive(user.workspaceId);
    const data = await body(req);
    const series = store.listSeries({ ...user, role: user.role === 'meeting_owner' ? 'meeting_owner' : 'admin' }).find(item => item.id === decisionMatch[1]);
    if (!series) throw new Error('Meeting series not found or not assigned to you.');
    const decision = { ...data, owner: data.owner || user.name };
    const errors = Core.validateDecision(series, decision);
    if (errors.length) return send(res, 400, { error: errors.join(' ') });
    store.updateDecision(user, series.id, decision);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found.' });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    if (!serveFile(req, res, pathname)) send(res, 404, { error: 'Not found.' });
  } catch (error) {
    const status = /permission|only|read-only|not a member|registration is disabled/i.test(error.message) ? 403 : /already exists|UNIQUE/.test(error.message) ? 409 : /Too many attempts/.test(error.message) ? 429 : 400;
    send(res, status, { error: error.message || 'Request failed.' });
  }
});

if (require.main === module) server.listen(PORT, HOST, () => console.log(`UnMeet Team is running at http://${HOST}:${PORT}`));

module.exports = { server, store };
