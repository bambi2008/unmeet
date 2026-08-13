const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../app/core');
const { createDb } = require('./saas-db');
const Connectors = require('./connectors');
const Billing = require('./billing');
const Email = require('./email');
const Vault = require('./vault');
const CalendarOAuth = require('./connectors/calendar-oauth');

const HOST = process.env.UNMEET_HOST || '127.0.0.1';
const PORT = Number(process.env.UNMEET_PORT || 8787);
const DB_FILE = process.env.UNMEET_DB || path.join(__dirname, 'unmeet.db');
const PUBLIC = path.join(__dirname, 'public');
const store = createDb(DB_FILE);
const attempts = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const publicRoles = { admin: 'Admin', delivery_partner: 'Delivery Partner', meeting_owner: 'Meeting Owner', executive_viewer: 'Executive Viewer' };

const activeSyncs=new Map();
function cancelConnectionSyncs(rows){for(const row of rows)activeSyncs.get(row.id)?.controller.abort(new Error('Connector access was revoked.'));}
async function performSync(row,controller) {
  const runId=store.syncStarted(row.workspace_id,row.provider);
  const deadlineAt=Date.now()+Number(process.env.UNMEET_SYNC_DEADLINE_MS||30000);
  const authorized=()=>store.connectionAuthorized(row.id,row.workspace_id,row.account_id);
  try { if(!authorized())throw new Error('Connector access was revoked.');let token=Vault.decrypt(row.secret_json);if(CalendarOAuth.tokenExpired(token)){token=await CalendarOAuth.refresh(row.provider,token,{deadlineAt,signal:controller.signal});token.obtained_at=Date.now();if(!authorized())throw new Error('Connector access was revoked.');store.updateConnectionSecret(row.id,Vault.encrypt(token));}const to=new Date();const from=new Date(to.getTime()-30*86400000);const items=await CalendarOAuth.fetchEvents(row.provider,token,{from:from.toISOString(),to:to.toISOString(),deadlineAt,signal:controller.signal});if(items.length>5000)throw new Error('Calendar sync exceeds 5,000 recurring series.');if(!authorized())throw new Error('Connector access was revoked.');store.replaceBaseline(row.workspace_id,row.provider,items,row.account_id);store.syncFinished(runId,row.id,items.length,null);return items.length;}catch(error){store.syncFinished(runId,row.id,0,error.message);throw error;}
}
function syncConnection(row){const existing=activeSyncs.get(row.id);if(existing)return existing.promise;const controller=new AbortController();const promise=performSync(row,controller).finally(()=>activeSyncs.delete(row.id));activeSyncs.set(row.id,{controller,promise});return promise;}
async function revokeConnections(rows){const results=[];for(const row of rows){try{results.push({provider:row.provider,...await CalendarOAuth.revoke(row.provider,Vault.decrypt(row.secret_json))});}catch(error){results.push({provider:row.provider,revoked:false,reason:error.message});}}return results;}

let maintenanceRunning=false;
async function runMaintenance(){if(maintenanceRunning)return;maintenanceRunning=true;try{store.cleanupExpired();const rows=store.activeConnections().filter(row=>!row.last_sync_at||Date.now()-Date.parse(row.last_sync_at)>6*3600000);const concurrency=Math.max(1,Math.min(5,Number(process.env.UNMEET_SYNC_CONCURRENCY||3)));for(let index=0;index<rows.length;index+=concurrency)await Promise.all(rows.slice(index,index+concurrency).map(row=>syncConnection(row).catch(error=>console.error(`Scheduled sync failed for ${row.provider}:`,error.message))));}finally{maintenanceRunning=false;}}
const maintenance=setInterval(()=>runMaintenance().catch(error=>console.error('Scheduled maintenance failed:',error.message)),15*60000);maintenance.unref();

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
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
  if (process.env.NODE_ENV === 'production') throw new Error('UNMEET_PUBLIC_URL is required in production.');
  return `http://${req.headers.host}`;
}

function clientIp(req) {
  if (process.env.UNMEET_TRUST_PROXY === 'true') return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  return req.socket.remoteAddress || 'unknown';
}
function rateLimit(req, key, limit = 10) {
  if (attempts.size >= 10000) {for (const [name, value] of attempts) if (Date.now() > value.reset) attempts.delete(name);while(attempts.size>9000)attempts.delete(attempts.keys().next().value);}
  const bucket = `${clientIp(req)}:${String(key).toLowerCase().slice(0,160)}`; const current = attempts.get(bucket) || { count: 0, reset: Date.now() + 15 * 60000 };
  if (Date.now() > current.reset) { current.count = 0; current.reset = Date.now() + 15 * 60000; }
  current.count += 1; attempts.set(bucket, current);
  if (current.count > limit) throw new Error('Too many attempts. Try again later.');
}
function authRateLimit(req, key, limit = 10) {
  rateLimit(req, 'authentication-total', Number(process.env.UNMEET_AUTH_IP_LIMIT || 50));
  rateLimit(req, key, limit);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return process.env.UNMEET_PUBLIC_URL ? new URL(origin).origin === new URL(process.env.UNMEET_PUBLIC_URL).origin : new URL(origin).host === req.headers.host; } catch { return false; }
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
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = pathname === '/shared/core.js' ? path.join(__dirname, '..', 'app', 'core.js') : path.resolve(PUBLIC, relative);
  if (pathname !== '/shared/core.js' && target !== PUBLIC && !target.startsWith(`${PUBLIC}${path.sep}`)) return false;
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
    if (process.env.UNMEET_ENABLE_BILLING !== 'true') return send(res, 404, { error: 'Not found.' });
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
    return send(res, 200, { registrationOpen: process.env.UNMEET_DISABLE_SIGNUP !== 'true', version: '0.4.0', billingConfigured: false, emailConfigured: Email.configured() });
  }
  if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true, version: '0.4.0', time: new Date().toISOString() });
  if (pathname === '/api/register' && method === 'POST') {
    if (process.env.UNMEET_DISABLE_SIGNUP === 'true') return send(res, 403, { error: 'New account registration is disabled.' });
    const data = await body(req);
    authRateLimit(req, `register:${data.email || ''}`, 5);
    if (!data.workspaceName?.trim() || !data.name?.trim() || !/^\S+@\S+\.\S+$/.test(data.email || '') || String(data.password || '').length < 12) throw new Error('Workspace, name, valid email, and a password of at least 12 characters are required.');
    const existing=store.accountByEmail(data.email);
    if(existing&&process.env.NODE_ENV==='production'){const reset=store.issueAccountTokenAfterCooldown(existing.id,'reset_password',30*60000);if(reset){const resetUrl=`${baseUrl(req)}/?reset=${reset.token}`;await Email.sendPasswordReset({to:existing.email,resetUrl,idempotencyKey:`registration-existing-${existing.id}-${reset.expiresAt}`});}return send(res,202,{ok:true,message:'Check your email to continue.'});}
    const user = store.register({ ...data, workspaceName: data.workspaceName.trim(), name: data.name.trim(), email: data.email.trim() });
    const verification = store.issueAccountToken(user.accountId, 'verify_email');
    const verifyUrl = `${baseUrl(req)}/?verify=${verification.token}`;
    const delivery = await Email.sendVerification({ to: user.email, verifyUrl, idempotencyKey: `verify-${user.accountId}-${verification.expiresAt}` });
    if(process.env.NODE_ENV==='production')return send(res,202,{ok:true,message:'Check your email to continue.'});
    const session = store.createSession(user.accountId, user.workspaceId);
    return send(res, 201, { user, verificationRequired: true, delivery, verifyUrl }, { 'Set-Cookie': sessionCookie(session.token) });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const data = await body(req);
    authRateLimit(req, `login:${data.email || ''}`);
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
  if (pathname === '/api/account/verify' && method === 'POST') {
    const data = await body(req); const account = store.verifyEmail(data.token);
    return account ? send(res, 200, { verified: true }) : send(res, 400, { error: 'Verification link is invalid or expired.' });
  }
  if (pathname === '/api/password/forgot' && method === 'POST') {
    const data = await body(req); authRateLimit(req, `forgot:${data.email || ''}`, 5); const account = store.accountByEmail(data.email);
    if (account) { const reset = store.issueAccountTokenAfterCooldown(account.id, 'reset_password', 30 * 60000); if(reset){const resetUrl = `${baseUrl(req)}/?reset=${reset.token}`; await Email.sendPasswordReset({ to: account.email, resetUrl, idempotencyKey: `reset-${account.id}-${reset.expiresAt}` });} }
    return send(res, 202, { ok: true, message: 'If the account exists, a reset link has been sent.' });
  }
  if (pathname === '/api/password/reset' && method === 'POST') {
    const data = await body(req); if (String(data.password || '').length < 12) throw new Error('Password must be at least 12 characters.');
    return store.resetPassword(data.token, data.password) ? send(res, 200, { reset: true }) : send(res, 400, { error: 'Reset link is invalid or expired.' });
  }
  const inviteMatch = pathname.match(/^\/api\/invites\/([^/]+)$/);
  if (inviteMatch && method === 'GET') {
    const invite = store.inviteInfo(inviteMatch[1]);
    return invite ? send(res, 200, { invite }) : send(res, 404, { error: 'Invite is invalid or expired.' });
  }
  if (inviteMatch && method === 'POST') {
    const data = await body(req);
    if (!data.name?.trim() || String(data.password || '').length < 12) throw new Error('Name and a password of at least 12 characters are required.');
    const user = store.acceptInvite(inviteMatch[1], data.name.trim(), data.password);
    let verification = null;
    if (!user.emailVerified) { const token=store.issueAccountToken(user.accountId,'verify_email');const verifyUrl=`${baseUrl(req)}/?verify=${token.token}`;const delivery=await Email.sendVerification({to:user.email,verifyUrl,idempotencyKey:`verify-${user.accountId}-${token.expiresAt}`});verification={required:true,delivery,...(process.env.NODE_ENV!=='production'?{verifyUrl}:{})}; }
    const session = store.createSession(user.accountId, user.workspaceId);
    return send(res, 201, { user, verification }, { 'Set-Cookie': sessionCookie(session.token) });
  }
  const oauthCallback=pathname.match(/^\/api\/oauth\/(google_workspace|microsoft_365)\/callback$/);
  if(oauthCallback&&method==='GET'){
    const params=new URL(req.url,baseUrl(req)).searchParams;const state=store.consumeOauthState(params.get('state'),oauthCallback[1]);if(!state)return send(res,400,{error:'OAuth state is invalid or expired.'});if(params.get('error'))return send(res,400,{error:'Calendar authorization was declined.'});
    const redirectUri=`${baseUrl(req)}/api/oauth/${oauthCallback[1]}/callback`;const token=await CalendarOAuth.exchange(oauthCallback[1],{code:params.get('code'),redirectUri});token.obtained_at=Date.now();store.saveConnection(state.workspaceId,state.accountId,oauthCallback[1],Vault.encrypt(token));res.writeHead(302,{Location:'/?connected='+oauthCallback[1]});return res.end();
  }

  const user = requireUser(req, res);
  if (!user) return;
  if (process.env.NODE_ENV === 'production' && !user.emailVerified && !['/api/session','/api/account/resend-verification'].includes(pathname)) return send(res, 403, { error: 'Verify your email before continuing.' });
  if (pathname === '/api/session' && method === 'GET') return send(res, 200, { user, roles: publicRoles, workspaces: store.workspaceList(user.accountId) });
  if (pathname === '/api/account/resend-verification' && method === 'POST') { authRateLimit(req,`verify:${user.accountId}`,5);const verification=store.issueAccountTokenAfterCooldown(user.accountId,'verify_email',24*3600000);if(!verification)return send(res,202,{delivery:{sent:false,reason:'cooldown'}});const verifyUrl=`${baseUrl(req)}/?verify=${verification.token}`;const delivery=await Email.sendVerification({to:user.email,verifyUrl,idempotencyKey:`verify-${user.accountId}-${verification.expiresAt}`});return send(res,202,{delivery,...(process.env.NODE_ENV!=='production'?{verifyUrl}:{})}); }
  if (pathname === '/api/account/reauth' && method === 'POST') { const data=await body(req);rateLimit(req,`reauth:${user.email}`,5);return store.reauthenticate(cookies(req).unmeet_session,data.password)?send(res,200,{ok:true}):send(res,401,{error:'Password is incorrect.'}); }
  if (pathname === '/api/account/sessions' && method === 'GET') return send(res,200,{sessions:store.listSessions(user.accountId,cookies(req).unmeet_session)});
  const sessionMatch=pathname.match(/^\/api\/account\/sessions\/([a-f0-9]{64})$/);if(sessionMatch&&method==='DELETE'){if(!store.recentlyAuthenticated(cookies(req).unmeet_session))return send(res,403,{error:'Confirm your password before changing sessions.'});return send(res,200,{revoked:store.revokeSession(user.accountId,sessionMatch[1])});}
  if(pathname==='/api/account/password'&&method==='PATCH'){const data=await body(req);if(String(data.password||'').length<12)throw new Error('Password must be at least 12 characters.');if(!store.changePassword(user.accountId,data.currentPassword,data.password))return send(res,401,{error:'Current password is incorrect.'});return send(res,200,{changed:true},{'Set-Cookie':sessionCookie('',0)});}
  if (pathname === '/api/workspaces' && method === 'POST') {
    rateLimit(req,`workspace-create:${user.accountId}`,5);
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
  if (pathname === '/api/members' && method === 'GET') return send(res, 200, { members: store.members(user.workspaceId), invites: store.invites(user.workspaceId) });
  const memberMatch=pathname.match(/^\/api\/members\/([^/]+)$/);if(memberMatch&&method==='PATCH'){if(!store.recentlyAuthenticated(cookies(req).unmeet_session))return send(res,403,{error:'Confirm your password before changing access.'});const data=await body(req);const connections=!['admin','delivery_partner'].includes(data.role)?store.connectionsOwnedBy(user.workspaceId,memberMatch[1]):[];cancelConnectionSyncs(connections);store.updateMemberRole(user,memberMatch[1],data.role);return send(res,200,{ok:true,revocations:await revokeConnections(connections)});}if(memberMatch&&method==='DELETE'){if(!store.recentlyAuthenticated(cookies(req).unmeet_session))return send(res,403,{error:'Confirm your password before removing members.'});const connections=store.connectionsOwnedBy(user.workspaceId,memberMatch[1]);cancelConnectionSyncs(connections);store.removeMember(user,memberMatch[1]);return send(res,200,{removed:true,revocations:await revokeConnections(connections)});}
  const revokeInviteMatch=pathname.match(/^\/api\/invites\/([^/]+)\/revoke$/);if(revokeInviteMatch&&method==='POST'){return send(res,200,{revoked:store.revokeInvite(user,revokeInviteMatch[1])});}
  if (pathname === '/api/workspace/settings' && method === 'PATCH') {
    const data = await body(req); if (!data.name?.trim()) throw new Error('Workspace name is required.');
    store.updateWorkspace(user, data); return send(res, 200, { workspace: store.workspace(user.workspaceId) });
  }
  if (pathname === '/api/workspace/export' && method === 'GET') { if(!store.recentlyAuthenticated(cookies(req).unmeet_session))return send(res,403,{error:'Confirm your password before exporting data.'});return send(res, 200, store.exportWorkspace(user)); }
  if (pathname === '/api/workspace' && method === 'DELETE') {
    if(!store.recentlyAuthenticated(cookies(req).unmeet_session))return send(res,403,{error:'Confirm your password before deleting data.'});const data = await body(req);const connections=store.workspaceConnections(user.workspaceId);cancelConnectionSyncs(connections); const receipt=store.deleteWorkspace(user, data.confirmation);const revocations=await revokeConnections(connections); return send(res, 200, { deleted: true, receiptId: receipt.id,revocations }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (pathname === '/api/audit' && method === 'GET') {
    if (!['admin', 'delivery_partner'].includes(user.role)) return send(res, 403, { error: 'Audit log permission is required.' });
    return send(res, 200, { logs: store.logs(user.workspaceId) });
  }
  if (pathname === '/api/connectors' && method === 'GET') return send(res, 200, { connectors: Connectors.catalog, connections: store.connections(user.workspaceId) });
  const connectorConnect=pathname.match(/^\/api\/connectors\/(google_workspace|microsoft_365)\/connect$/);if(connectorConnect&&method==='POST'){requireEditor(user);const state=CalendarOAuth.stateToken();store.createOauthState(user,connectorConnect[1],state);const redirectUri=`${baseUrl(req)}/api/oauth/${connectorConnect[1]}/callback`;return send(res,200,{url:CalendarOAuth.authorizationUrl(connectorConnect[1],{redirectUri,state})});}
  const connectorSync=pathname.match(/^\/api\/connectors\/(google_workspace|microsoft_365)\/sync$/);if(connectorSync&&method==='POST'){requireEditor(user);const row=store.connection(user.workspaceId,connectorSync[1]);if(!row)throw new Error('Connect this calendar first.');return send(res,200,{imported:await syncConnection(row)});}
  const connectorDisconnect=pathname.match(/^\/api\/connectors\/(google_workspace|microsoft_365)$/);if(connectorDisconnect&&method==='DELETE'){const row=store.connection(user.workspaceId,connectorDisconnect[1]);if(row)cancelConnectionSyncs([row]);const disconnected=store.disconnect(user,connectorDisconnect[1]);return send(res,200,{disconnected,revocation:row?(await revokeConnections([row]))[0]:null});}
  if (pathname === '/api/invites' && method === 'POST') {
    const data = await body(req);
    if (!/^\S+@\S+\.\S+$/.test(data.email || '')) throw new Error('A valid email is required.');
    const invite = store.createInvite(user, data.email.trim(), data.role);
    const inviteUrl = `${baseUrl(req)}/?invite=${invite.token}`;
    let delivery = { sent: false, reason: 'not_configured' };
    try { delivery = await Email.sendInvite({ to: invite.email, workspaceName: store.workspace(user.workspaceId).name, inviterName: user.name, role: publicRoles[invite.role], inviteUrl, idempotencyKey: `invite-${invite.token.slice(0,24)}` }); }
    catch (error) { delivery = { sent: false, reason: error.message }; }
    const publicInvite = { id: invite.id, email: invite.email, role: invite.role, expires: invite.expires };
    return send(res, 201, { invite: process.env.NODE_ENV === 'production' ? publicInvite : invite, ...(process.env.NODE_ENV !== 'production' ? { inviteUrl } : {}), delivery });
  }
  if (pathname === '/api/billing/checkout' && method === 'POST') {
    if (process.env.UNMEET_ENABLE_BILLING !== 'true') return send(res, 503, { error: 'Online billing is not enabled.' });
    if (user.role !== 'admin') throw new Error('Administrator permission is required.');
    const data = await body(req); if (!['starter','team'].includes(data.plan)) throw new Error('Choose Starter or Team.');
    const checkout = await Billing.createCheckout({ workspace: store.workspace(user.workspaceId), user, plan: data.plan, baseUrl: baseUrl(req) });
    return send(res, 200, { url: checkout.url });
  }
  if (pathname === '/api/billing/portal' && method === 'POST') {
    if (process.env.UNMEET_ENABLE_BILLING !== 'true') return send(res, 503, { error: 'Online billing is not enabled.' });
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

function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.UNMEET_PUBLIC_URL || !process.env.UNMEET_PUBLIC_URL.startsWith('https://')) throw new Error('Production requires an HTTPS UNMEET_PUBLIC_URL.');
  if (process.env.UNMEET_DISABLE_SIGNUP !== 'true' && !Email.configured()) throw new Error('Public signup requires RESEND_API_KEY and UNMEET_FROM_EMAIL.');
  if (Buffer.from(process.env.UNMEET_ENCRYPTION_KEY || '', 'base64').length !== 32) throw new Error('Production requires a base64-encoded 32-byte UNMEET_ENCRYPTION_KEY.');
}

if (require.main === module) { validateProductionConfig(); server.listen(PORT, HOST, () => console.log(`UnMeet Team is running at ${baseUrl({ headers: { host: `${HOST}:${PORT}` } })}`)); }

module.exports = { server, store, validateProductionConfig, runMaintenance, syncConnection, cancelConnectionSyncs };
