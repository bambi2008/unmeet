const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const ROLES = ['admin', 'delivery_partner', 'meeting_owner', 'executive_viewer'];
const PLANS = {
  trial: { name: 'Trial', memberLimit: 10, seriesLimit: 100 },
  starter: { name: 'Starter', memberLimit: 25, seriesLimit: 250 },
  team: { name: 'Team', memberLimit: 250, seriesLimit: 2000 },
  enterprise: { name: 'Enterprise', memberLimit: 100000, seriesLimit: 100000 },
};

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function createDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hourly_rate REAL NOT NULL DEFAULT 75,
      period TEXT NOT NULL DEFAULT '30 days', created_at TEXT NOT NULL
    );
  `);
  const workspaceColumns = new Set(db.prepare('PRAGMA table_info(workspaces)').all().map(row => row.name));
  const addWorkspaceColumn = (name, sql) => { if (!workspaceColumns.has(name)) db.exec(`ALTER TABLE workspaces ADD COLUMN ${name} ${sql}`); };
  addWorkspaceColumn('slug', "TEXT");
  addWorkspaceColumn('timezone', "TEXT NOT NULL DEFAULT 'UTC'");
  addWorkspaceColumn('currency', "TEXT NOT NULL DEFAULT 'USD'");
  addWorkspaceColumn('plan', "TEXT NOT NULL DEFAULT 'trial'");
  addWorkspaceColumn('subscription_status', "TEXT NOT NULL DEFAULT 'trialing'");
  addWorkspaceColumn('trial_ends_at', 'TEXT');
  addWorkspaceColumn('stripe_customer_id', 'TEXT');
  addWorkspaceColumn('stripe_subscription_id', 'TEXT');
  addWorkspaceColumn('deleted_at', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug ON workspaces(slug) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS saas_sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      active_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saas_invites (
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES accounts(id), used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'csv', external_id TEXT, title TEXT NOT NULL, owner TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT '', team TEXT NOT NULL, duration_minutes REAL NOT NULL,
      attendee_count REAL NOT NULL, occurrences_per_month REAL NOT NULL, has_agenda INTEGER NOT NULL,
      age_months REAL NOT NULL, review_status TEXT NOT NULL, decision_json TEXT, actual_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS series_workspace ON series(workspace_id);
    CREATE INDEX IF NOT EXISTS series_owner ON series(workspace_id, owner_email);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, user_id TEXT,
      action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, details_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source TEXT NOT NULL, measured_at TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_webhooks (
      provider TEXT NOT NULL, event_id TEXT NOT NULL, processed_at TEXT NOT NULL,
      PRIMARY KEY(provider,event_id)
    );
    CREATE TABLE IF NOT EXISTS account_tokens (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deletion_receipts (
      id TEXT PRIMARY KEY, workspace_hash TEXT NOT NULL, requested_by_hash TEXT NOT NULL,
      policy_version TEXT NOT NULL, deleted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connector_connections (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
      secret_json TEXT NOT NULL, status TEXT NOT NULL, last_sync_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, provider)
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, status TEXT NOT NULL, imported_count INTEGER NOT NULL DEFAULT 0,
      error TEXT, started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS oauth_states (
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);

  function addColumn(table, name, sql) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
  }
  addColumn('accounts', 'email_verified_at', 'TEXT');
  addColumn('saas_sessions', 'last_seen_at', 'TEXT');
  addColumn('saas_sessions', 'recent_auth_at', 'TEXT');
  addColumn('saas_invites', 'id', 'TEXT');
  db.prepare('UPDATE saas_sessions SET last_seen_at=COALESCE(last_seen_at,created_at),recent_auth_at=COALESCE(recent_auth_at,created_at)').run();
  db.prepare("UPDATE saas_invites SET id='inv_' || hex(randomblob(16)) WHERE id IS NULL").run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS saas_invites_id ON saas_invites(id); CREATE INDEX IF NOT EXISTS account_tokens_lookup ON account_tokens(account_id,purpose,expires_at);');
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT OR IGNORE INTO schema_migrations VALUES (4,datetime('now')); PRAGMA user_version=4;");

  const now = () => new Date().toISOString();
  const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, digest: crypto.scryptSync(password, salt, 64).toString('hex') });
  const slugify = value => String(value || 'workspace').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
  const uniqueSlug = name => {
    const base = slugify(name); let candidate = base; let index = 2;
    while (db.prepare('SELECT 1 FROM workspaces WHERE slug=? AND deleted_at IS NULL').get(candidate)) candidate = `${base}-${index++}`;
    return candidate;
  };

  function migrateLegacy() {
    const hasLegacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!hasLegacy || db.prepare('SELECT COUNT(*) count FROM accounts').get().count) return;
    const rows = db.prepare('SELECT * FROM users').all();
    for (const row of rows) {
      let account = db.prepare('SELECT * FROM accounts WHERE email=?').get(row.email);
      if (!account) {
        db.prepare('INSERT INTO accounts (id,email,name,password_hash,salt,created_at,last_login_at,email_verified_at) VALUES (?,?,?,?,?,?,NULL,?)').run(row.id, row.email.toLowerCase(), row.name, row.password_hash, row.salt, row.created_at, row.created_at);
        account = { id: row.id };
      }
      db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)').run(row.workspace_id, account.id, row.role, row.created_at);
    }
  }
  migrateLegacy();

  for (const row of db.prepare('SELECT id,name,slug,trial_ends_at FROM workspaces').all()) {
    if (!row.slug) db.prepare('UPDATE workspaces SET slug=? WHERE id=?').run(uniqueSlug(row.name), row.id);
    if (!row.trial_ends_at) db.prepare('UPDATE workspaces SET trial_ends_at=? WHERE id=?').run(new Date(Date.now() + 14 * 86400000).toISOString(), row.id);
  }

  function accountPublic(row) { return row && { id: row.id, email: row.email, name: row.name, emailVerified: Boolean(row.email_verified_at) }; }
  function membership(accountId, workspaceId) {
    return db.prepare('SELECT * FROM memberships WHERE account_id=? AND workspace_id=?').get(accountId, workspaceId);
  }
  function userContext(accountId, workspaceId) {
    const row = db.prepare(`SELECT a.id,a.email,a.name,m.role,m.workspace_id FROM accounts a JOIN memberships m ON m.account_id=a.id
      JOIN workspaces w ON w.id=m.workspace_id WHERE a.id=? AND m.workspace_id=? AND w.deleted_at IS NULL`).get(accountId, workspaceId);
    return row && { id: row.id, accountId: row.id, email: row.email, name: row.name, role: row.role, workspaceId: row.workspace_id,
      emailVerified: Boolean(db.prepare('SELECT email_verified_at FROM accounts WHERE id=?').get(row.id)?.email_verified_at) };
  }
  function workspaceList(accountId) {
    return db.prepare(`SELECT w.id,w.name,w.slug,w.plan,w.subscription_status,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
      WHERE m.account_id=? AND w.deleted_at IS NULL ORDER BY w.created_at`).all(accountId).map(row => ({
        id: row.id, name: row.name, slug: row.slug, plan: row.plan, subscriptionStatus: row.subscription_status, role: row.role,
      }));
  }
  function createAccount(name, email, password) {
    const existing = db.prepare('SELECT 1 FROM accounts WHERE email=?').get(email.toLowerCase());
    if (existing) throw new Error('An account with this email already exists.');
    const passwordData = passwordHash(password); const accountId = makeId('acct');
    db.prepare('INSERT INTO accounts (id,email,name,password_hash,salt,created_at,last_login_at,email_verified_at) VALUES (?,?,?,?,?,?,NULL,NULL)').run(accountId, email.toLowerCase(), name, passwordData.digest, passwordData.salt, now());
    return accountPublic(db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId));
  }
  function createWorkspaceForAccount(accountId, { workspaceName, hourlyRate = 75, timezone = 'UTC', currency = 'USD' }) {
    const workspaceLimit=Number(process.env.UNMEET_ACCOUNT_WORKSPACE_LIMIT||5);const workspaceCount=db.prepare('SELECT COUNT(*) count FROM memberships WHERE account_id=?').get(accountId).count;
    if(workspaceCount>=workspaceLimit)throw new Error(`An account can belong to at most ${workspaceLimit} workspaces. Contact support for an exception.`);
    const workspaceId = makeId('ws'); const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString();
    db.exec('BEGIN');
    try {
      db.prepare(`INSERT INTO workspaces (id,name,hourly_rate,period,created_at,slug,timezone,currency,plan,subscription_status,trial_ends_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(workspaceId, workspaceName, hourlyRate, '30 days', now(), uniqueSlug(workspaceName), timezone, currency, 'trial', 'trialing', trialEnds);
      db.prepare('INSERT INTO memberships VALUES (?,?,?,?)').run(workspaceId, accountId, 'admin', now());
      audit(workspaceId, accountId, 'workspace.created', 'workspace', workspaceId, { name: workspaceName });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return userContext(accountId, workspaceId);
  }
  function register(data) {
    const account = createAccount(data.name, data.email, data.password);
    try { return createWorkspaceForAccount(account.id, data); }
    catch (error) { db.prepare('DELETE FROM accounts WHERE id=?').run(account.id); throw error; }
  }
  function authenticate(email, password) {
    const row = db.prepare('SELECT * FROM accounts WHERE email=?').get(email.toLowerCase());
    if (!row) return null;
    const candidate = Buffer.from(passwordHash(password, row.salt).digest, 'hex'); const expected = Buffer.from(row.password_hash, 'hex');
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return null;
    db.prepare('UPDATE accounts SET last_login_at=? WHERE id=?').run(now(), row.id);
    const first = workspaceList(row.id)[0];
    return first ? userContext(row.id, first.id) : { ...accountPublic(row), workspaceId: null, role: null };
  }
  function createSession(accountId, workspaceId) {
    const token = crypto.randomBytes(32).toString('base64url'); const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const created = now();
    db.prepare('INSERT INTO saas_sessions (token_hash,account_id,active_workspace_id,expires_at,created_at,last_seen_at,recent_auth_at) VALUES (?,?,?,?,?,?,?)').run(hash(token), accountId, workspaceId, expires, created, created, created);
    return { token, expires };
  }
  function sessionUser(token) {
    if (!token) return null;
    const tokenHash = hash(token); const session = db.prepare('SELECT * FROM saas_sessions WHERE token_hash=? AND expires_at>?').get(tokenHash, now());
    if (!session) return null;
    if (Date.now() - new Date(session.last_seen_at || session.created_at).getTime() > 12 * 3600000) { db.prepare('DELETE FROM saas_sessions WHERE token_hash=?').run(tokenHash); return null; }
    db.prepare('UPDATE saas_sessions SET last_seen_at=? WHERE token_hash=?').run(now(), tokenHash);
    return userContext(session.account_id, session.active_workspace_id);
  }
  function recentlyAuthenticated(token, minutes = 10) { const row = token && db.prepare('SELECT recent_auth_at FROM saas_sessions WHERE token_hash=?').get(hash(token)); return Boolean(row && Date.now() - new Date(row.recent_auth_at).getTime() <= minutes * 60000); }
  function reauthenticate(token, password) { const user = sessionUser(token); if (!user || !authenticate(user.email, password)) return false; db.prepare('UPDATE saas_sessions SET recent_auth_at=? WHERE token_hash=?').run(now(), hash(token)); return true; }
  function listSessions(accountId, currentToken) { const currentHash = hash(currentToken); return db.prepare('SELECT token_hash,created_at,last_seen_at,expires_at FROM saas_sessions WHERE account_id=? ORDER BY created_at DESC').all(accountId).map(row => ({ id: row.token_hash, createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, current: row.token_hash === currentHash })); }
  function revokeSession(accountId, sessionId) { return db.prepare('DELETE FROM saas_sessions WHERE account_id=? AND token_hash=?').run(accountId, sessionId).changes > 0; }
  function switchWorkspace(token, accountId, workspaceId) {
    if (!membership(accountId, workspaceId)) throw new Error('You are not a member of this workspace.');
    db.prepare('UPDATE saas_sessions SET active_workspace_id=? WHERE token_hash=? AND account_id=?').run(workspaceId, hash(token), accountId);
    return userContext(accountId, workspaceId);
  }
  function deleteSession(token) { if (token) db.prepare('DELETE FROM saas_sessions WHERE token_hash=?').run(hash(token)); }
  function issueAccountToken(accountId, purpose, ttlMs = 24 * 3600000) {
    db.prepare('UPDATE account_tokens SET used_at=? WHERE account_id=? AND purpose=? AND used_at IS NULL').run(now(), accountId, purpose);
    const token = crypto.randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,NULL,?)').run(hash(token), accountId, purpose, expiresAt, now());
    return { token, expiresAt };
  }
  function issueAccountTokenAfterCooldown(accountId,purpose,ttlMs,cooldownMs=5*60000){const latest=db.prepare('SELECT created_at FROM account_tokens WHERE account_id=? AND purpose=? ORDER BY created_at DESC LIMIT 1').get(accountId,purpose);if(latest&&Date.now()-Date.parse(latest.created_at)<cooldownMs)return null;return issueAccountToken(accountId,purpose,ttlMs);}
  function accountByEmail(email) { const row = db.prepare('SELECT * FROM accounts WHERE email=?').get(String(email || '').toLowerCase()); return accountPublic(row); }
  function consumeAccountToken(token, purpose) {
    const row = db.prepare('SELECT * FROM account_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?').get(hash(token || ''), purpose, now());
    if (!row) return null;
    db.prepare('UPDATE account_tokens SET used_at=? WHERE token_hash=?').run(now(), row.token_hash);
    return accountPublic(db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account_id));
  }
  function verifyEmail(token) { const account = consumeAccountToken(token, 'verify_email'); if (!account) return null; db.prepare('UPDATE accounts SET email_verified_at=? WHERE id=?').run(now(), account.id); return accountPublic(db.prepare('SELECT * FROM accounts WHERE id=?').get(account.id)); }
  function resetPassword(token, password) { const account = consumeAccountToken(token, 'reset_password'); if (!account) return false; const next = passwordHash(password); db.exec('BEGIN'); try { db.prepare('UPDATE accounts SET password_hash=?,salt=? WHERE id=?').run(next.digest,next.salt,account.id); db.prepare('DELETE FROM saas_sessions WHERE account_id=?').run(account.id); db.exec('COMMIT'); return true; } catch(error){ db.exec('ROLLBACK'); throw error; } }
  function changePassword(accountId, currentPassword, password) { const row=db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId); if(!row)return false; const candidate=Buffer.from(passwordHash(currentPassword,row.salt).digest,'hex'); const expected=Buffer.from(row.password_hash,'hex'); if(candidate.length!==expected.length||!crypto.timingSafeEqual(candidate,expected))return false; const next=passwordHash(password); db.exec('BEGIN');try{db.prepare('UPDATE accounts SET password_hash=?,salt=? WHERE id=?').run(next.digest,next.salt,accountId);db.prepare('DELETE FROM saas_sessions WHERE account_id=?').run(accountId);db.exec('COMMIT');return true;}catch(error){db.exec('ROLLBACK');throw error;} }

  function workspace(workspaceId) {
    const row = db.prepare('SELECT * FROM workspaces WHERE id=? AND deleted_at IS NULL').get(workspaceId);
    if (!row) return null;
    const members = db.prepare('SELECT COUNT(*) count FROM memberships WHERE workspace_id=?').get(workspaceId).count;
    const series = db.prepare('SELECT COUNT(*) count FROM series WHERE workspace_id=?').get(workspaceId).count;
    return { id: row.id, name: row.name, slug: row.slug, hourlyRate: row.hourly_rate, period: row.period, timezone: row.timezone,
      currency: row.currency, plan: row.plan, subscriptionStatus: row.subscription_status, trialEndsAt: row.trial_ends_at,
      stripeCustomerId: row.stripe_customer_id, createdAt: row.created_at, usage: { members, series }, limits: PLANS[row.plan] || PLANS.trial };
  }
  function updateWorkspace(user, changes) {
    if (user.role !== 'admin') throw new Error('Administrator permission is required.');
    const allowedTimezone = String(changes.timezone || 'UTC').slice(0, 64); const currency = String(changes.currency || 'USD').toUpperCase();
    db.prepare('UPDATE workspaces SET name=?,hourly_rate=?,timezone=?,currency=? WHERE id=?').run(changes.name.trim(), Number(changes.hourlyRate || 75), allowedTimezone, currency, user.workspaceId);
    audit(user.workspaceId, user.id, 'workspace.updated', 'workspace', user.workspaceId, { name: changes.name, timezone: allowedTimezone, currency });
  }
  function planAllows(workspaceId, resource, added = 1) {
    const ws = workspace(workspaceId); const plan = PLANS[ws.plan] || PLANS.trial;
    const expired = ws.subscriptionStatus === 'trialing' && new Date(ws.trialEndsAt) < new Date();
    if (expired || ['canceled', 'unpaid', 'past_due'].includes(ws.subscriptionStatus)) throw new Error('Your subscription is inactive. Update billing to continue.');
    if (ws.usage[resource] + added > plan[`${resource === 'series' ? 'series' : 'member'}Limit`]) throw new Error(`${plan.name} plan ${resource} limit reached.`);
  }
  function assertActive(workspaceId) { planAllows(workspaceId, 'series', 0); }
  function mapSeries(row) { return { id: row.id, source: row.source, externalId: row.external_id, title: row.title, owner: row.owner, ownerEmail: row.owner_email,
    team: row.team, durationMinutes: row.duration_minutes, attendeeCount: row.attendee_count, occurrencesPerMonth: row.occurrences_per_month,
    hasAgenda: Boolean(row.has_agenda), ageMonths: row.age_months, reviewStatus: row.review_status, decision: parseJson(row.decision_json), actual: parseJson(row.actual_json), updatedAt: row.updated_at }; }
  function listSeries(user) {
    const rows = user.role === 'meeting_owner'
      ? db.prepare('SELECT * FROM series WHERE workspace_id=? AND owner_email=? ORDER BY title').all(user.workspaceId, user.email)
      : db.prepare('SELECT * FROM series WHERE workspace_id=? ORDER BY title').all(user.workspaceId);
    return rows.map(mapSeries);
  }
  function replaceBaseline(workspaceId, source, items, userId) {
    const existingSource=db.prepare('SELECT COUNT(*) count FROM series WHERE workspace_id=? AND source=?').get(workspaceId,source).count; planAllows(workspaceId, 'series', Math.max(0, items.length-existingSource));
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM series WHERE workspace_id=? AND source=?').run(workspaceId,source);
      const insert = db.prepare(`INSERT INTO series (id,workspace_id,source,external_id,title,owner,owner_email,team,duration_minutes,attendee_count,occurrences_per_month,has_agenda,age_months,review_status,decision_json,actual_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) insert.run(makeId('ser'),workspaceId,source,item.id||null,item.title,item.owner,item.ownerEmail||'',item.team,item.durationMinutes,item.attendeeCount,item.occurrencesPerMonth,item.hasAgenda?1:0,item.ageMonths,item.reviewStatus||'backlog',null,null,now(),now());
      audit(workspaceId,userId,'baseline.imported','workspace',workspaceId,{source,count:items.length}); db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
  }
  function saveFollowup(workspaceId,source,result,userId,measuredAt){db.exec('BEGIN');try{const update=db.prepare('UPDATE series SET actual_json=?,updated_at=? WHERE id=? AND workspace_id=?');for(const item of result.workspace.series)update.run(item.actual?JSON.stringify(item.actual):null,now(),item.id,workspaceId);db.prepare('INSERT INTO verification_runs VALUES (?,?,?,?,?,?)').run(makeId('run'),workspaceId,source,measuredAt,JSON.stringify(result.summary),now());audit(workspaceId,userId,'followup.imported','workspace',workspaceId,{source,...result.summary});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function updateDecision(user,seriesId,decision){const row=db.prepare('SELECT * FROM series WHERE id=? AND workspace_id=?').get(seriesId,user.workspaceId);if(!row)throw new Error('Meeting series not found.');if(user.role==='executive_viewer')throw new Error('This role is read-only.');if(user.role==='meeting_owner'&&row.owner_email.toLowerCase()!==user.email.toLowerCase())throw new Error('You can only decide meetings assigned to you.');db.prepare('UPDATE series SET decision_json=?,review_status=?,updated_at=? WHERE id=?').run(JSON.stringify(decision),'decided',now(),seriesId);audit(user.workspaceId,user.id,'decision.updated','series',seriesId,{action:decision.action,previous:parseJson(row.decision_json)});}
  function createInvite(user,email,role){if(!['admin','delivery_partner'].includes(user.role))throw new Error('Only administrators and delivery partners can invite members.');if(!ROLES.includes(role))throw new Error('Invalid role.');if(user.role==='delivery_partner'&&!['meeting_owner','executive_viewer'].includes(role))throw new Error('Delivery partners cannot grant administrator or delivery-partner access.');planAllows(user.workspaceId,'members',0);const ws=workspace(user.workspaceId);const pending=db.prepare('SELECT COUNT(*) count FROM saas_invites WHERE workspace_id=? AND used_at IS NULL AND expires_at>?').get(user.workspaceId,now()).count;if(ws.usage.members+pending>=ws.limits.memberLimit)throw new Error(`${ws.limits.name} plan members limit reached.`);const token=crypto.randomBytes(24).toString('base64url');const expires=new Date(Date.now()+72*3600000).toISOString();const id=makeId('inv');db.prepare('INSERT INTO saas_invites (token_hash,workspace_id,email,role,expires_at,created_by,used_at,created_at,id) VALUES (?,?,?,?,?,?,NULL,?,?)').run(hash(token),user.workspaceId,email.toLowerCase(),role,expires,user.id,now(),id);audit(user.workspaceId,user.id,'member.invited','invite',id,{email:email.toLowerCase(),role});return{id,token,email:email.toLowerCase(),role,expires};}
  function inviteInfo(token){const row=db.prepare(`SELECT i.email,i.role,i.expires_at,w.name workspace_name FROM saas_invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND w.deleted_at IS NULL`).get(hash(token),now());return row&&{email:row.email,role:row.role,expires:row.expires_at,workspaceName:row.workspace_name};}
  function acceptInvite(token,name,password){const row=db.prepare('SELECT * FROM saas_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash(token),now());if(!row)throw new Error('Invite is invalid or expired.');let account=db.prepare('SELECT * FROM accounts WHERE email=?').get(row.email);if(account){const authenticated=authenticate(row.email,password);if(!authenticated)throw new Error('This email already has an account. Enter its existing password.');account=db.prepare('SELECT * FROM accounts WHERE id=?').get(authenticated.id);if(!membership(account.id,row.workspace_id))planAllows(row.workspace_id,'members');}else{planAllows(row.workspace_id,'members');account=db.prepare('SELECT * FROM accounts WHERE id=?').get(createAccount(name,row.email,password).id);}db.exec('BEGIN');try{db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)').run(row.workspace_id,account.id,row.role,now());db.prepare('UPDATE saas_invites SET used_at=? WHERE token_hash=?').run(now(),hash(token));audit(row.workspace_id,account.id,'member.joined','account',account.id,{role:row.role});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return userContext(account.id,row.workspace_id);}
  function members(workspaceId){return db.prepare(`SELECT a.id,a.email,a.name,m.role,m.created_at FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=? ORDER BY m.created_at`).all(workspaceId).map(row=>({id:row.id,email:row.email,name:row.name,role:row.role,createdAt:row.created_at}));}
  function invites(workspaceId){return db.prepare('SELECT id,email,role,expires_at,created_at FROM saas_invites WHERE workspace_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC').all(workspaceId,now()).map(row=>({id:row.id,email:row.email,role:row.role,expiresAt:row.expires_at,createdAt:row.created_at}));}
  function revokeInvite(user,id){if(user.role!=='admin')throw new Error('Administrator permission is required.');const result=db.prepare('DELETE FROM saas_invites WHERE workspace_id=? AND id=? AND used_at IS NULL').run(user.workspaceId,id);if(result.changes)audit(user.workspaceId,user.id,'invite.revoked','invite',id,{});return Boolean(result.changes);}
  function updateMemberRole(user,accountId,role){if(user.role!=='admin')throw new Error('Administrator permission is required.');if(!ROLES.includes(role))throw new Error('Invalid role.');const target=membership(accountId,user.workspaceId);if(!target)throw new Error('Member not found.');if(target.role==='admin'&&role!=='admin'&&db.prepare("SELECT COUNT(*) count FROM memberships WHERE workspace_id=? AND role='admin'").get(user.workspaceId).count<=1)throw new Error('Promote another administrator before changing the last administrator.');db.exec('BEGIN');try{db.prepare('UPDATE memberships SET role=? WHERE workspace_id=? AND account_id=?').run(role,user.workspaceId,accountId);if(!['admin','delivery_partner'].includes(role)){db.prepare('DELETE FROM oauth_states WHERE workspace_id=? AND account_id=?').run(user.workspaceId,accountId);db.prepare('DELETE FROM connector_connections WHERE workspace_id=? AND account_id=?').run(user.workspaceId,accountId);}audit(user.workspaceId,user.id,'member.role_changed','account',accountId,{from:target.role,to:role});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function removeMember(user,accountId){if(user.role!=='admin')throw new Error('Administrator permission is required.');const target=membership(accountId,user.workspaceId);if(!target)throw new Error('Member not found.');if(target.role==='admin'&&db.prepare("SELECT COUNT(*) count FROM memberships WHERE workspace_id=? AND role='admin'").get(user.workspaceId).count<=1)throw new Error('The last administrator cannot be removed.');db.exec('BEGIN');try{db.prepare('DELETE FROM connector_connections WHERE workspace_id=? AND account_id=?').run(user.workspaceId,accountId);db.prepare('DELETE FROM oauth_states WHERE workspace_id=? AND account_id=?').run(user.workspaceId,accountId);db.prepare('DELETE FROM memberships WHERE workspace_id=? AND account_id=?').run(user.workspaceId,accountId);db.prepare('DELETE FROM saas_sessions WHERE account_id=? AND active_workspace_id=?').run(accountId,user.workspaceId);audit(user.workspaceId,user.id,'member.removed','account',accountId,{});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function audit(workspaceId,userId,action,entityType,entityId,details){db.prepare('INSERT INTO audit_logs (workspace_id,user_id,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)').run(workspaceId,userId,action,entityType,entityId,JSON.stringify(details||{}),now());}
  function logs(workspaceId){return db.prepare(`SELECT a.*,ac.name user_name FROM audit_logs a LEFT JOIN accounts ac ON ac.id=a.user_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 200`).all(workspaceId).map(row=>({id:row.id,action:row.action,entityType:row.entity_type,entityId:row.entity_id,details:parseJson(row.details_json,{}),createdAt:row.created_at,userName:row.user_name||'System'}));}
  function exportWorkspace(user){if(user.role!=='admin')throw new Error('Administrator permission is required.');return{exportedAt:now(),workspace:workspace(user.workspaceId),members:members(user.workspaceId),series:listSeries({...user,role:'admin'}),audit:logs(user.workspaceId)};}
  function deleteWorkspace(user,confirmation){if(user.role!=='admin')throw new Error('Administrator permission is required.');const ws=workspace(user.workspaceId);if(confirmation!==ws.name)throw new Error('Enter the workspace name to confirm deletion.');const deletedAt=now();const receipt={id:makeId('del'),workspaceHash:hash(user.workspaceId),requestedByHash:hash(user.id),deletedAt};const accountIds=db.prepare('SELECT account_id FROM memberships WHERE workspace_id=?').all(user.workspaceId).map(row=>row.account_id);db.exec('BEGIN');try{db.prepare('DELETE FROM saas_sessions WHERE active_workspace_id=?').run(user.workspaceId);db.prepare('DELETE FROM audit_logs WHERE workspace_id=?').run(user.workspaceId);db.prepare('DELETE FROM workspaces WHERE id=?').run(user.workspaceId);db.prepare('INSERT INTO deletion_receipts VALUES (?,?,?,?,?)').run(receipt.id,receipt.workspaceHash,receipt.requestedByHash,'2026-08-13',deletedAt);const removeOrphan=db.prepare('DELETE FROM accounts WHERE id=? AND NOT EXISTS (SELECT 1 FROM memberships WHERE account_id=?)');for(const accountId of accountIds)removeOrphan.run(accountId,accountId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return receipt;}
  function updateBilling(workspaceId,{plan,status,customerId,subscriptionId}){const ws=workspace(workspaceId);if(!ws)return;db.prepare(`UPDATE workspaces SET plan=?,subscription_status=?,stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=COALESCE(?,stripe_subscription_id) WHERE id=?`).run(plan||ws.plan,status||ws.subscriptionStatus,customerId||null,subscriptionId||null,workspaceId);}
  function webhookProcessed(provider,eventId){return Boolean(db.prepare('SELECT 1 FROM processed_webhooks WHERE provider=? AND event_id=?').get(provider,eventId));}
  function markWebhookProcessed(provider,eventId){db.prepare('INSERT OR IGNORE INTO processed_webhooks VALUES (?,?,?)').run(provider,eventId,now());}
  function createOauthState(user,provider,token){db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now());db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?,?,?)').run(hash(token),user.workspaceId,user.id,provider,new Date(Date.now()+10*60000).toISOString(),now());}
  function consumeOauthState(token,provider){const row=db.prepare(`SELECT s.* FROM oauth_states s JOIN memberships m ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id WHERE s.token_hash=? AND s.provider=? AND s.expires_at>? AND m.role IN ('admin','delivery_partner')`).get(hash(token||''),provider,now());if(!row)return null;db.prepare('DELETE FROM oauth_states WHERE token_hash=?').run(row.token_hash);return{workspaceId:row.workspace_id,accountId:row.account_id,provider:row.provider};}
  function saveConnection(workspaceId,accountId,provider,secretJson){const existing=db.prepare('SELECT id FROM connector_connections WHERE workspace_id=? AND provider=?').get(workspaceId,provider);const id=existing?.id||makeId('con');db.prepare(`INSERT INTO connector_connections (id,workspace_id,provider,account_id,secret_json,status,last_sync_at,last_error,created_at,updated_at) VALUES (?,?,?,?,?,'connected',NULL,NULL,?,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET account_id=excluded.account_id,secret_json=excluded.secret_json,status='connected',last_error=NULL,updated_at=excluded.updated_at`).run(id,workspaceId,provider,accountId,secretJson,now(),now());audit(workspaceId,accountId,'connector.connected','connector',id,{provider});return id;}
  function connection(workspaceId,provider){return db.prepare('SELECT * FROM connector_connections WHERE workspace_id=? AND provider=?').get(workspaceId,provider);}
  function connectionAuthorized(id,workspaceId,accountId){return Boolean(db.prepare("SELECT 1 FROM connector_connections c JOIN memberships m ON m.workspace_id=c.workspace_id AND m.account_id=c.account_id WHERE c.id=? AND c.workspace_id=? AND c.account_id=? AND m.role IN ('admin','delivery_partner')").get(id,workspaceId,accountId));}
  function connections(workspaceId){return db.prepare('SELECT id,provider,status,last_sync_at,last_error,created_at,updated_at FROM connector_connections WHERE workspace_id=? ORDER BY provider').all(workspaceId).map(row=>({id:row.id,provider:row.provider,status:row.status,lastSyncAt:row.last_sync_at,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at}));}
  function connectionsOwnedBy(workspaceId,accountId){return db.prepare('SELECT * FROM connector_connections WHERE workspace_id=? AND account_id=?').all(workspaceId,accountId);}
  function workspaceConnections(workspaceId){return db.prepare('SELECT * FROM connector_connections WHERE workspace_id=?').all(workspaceId);}
  function updateConnectionSecret(id,secretJson){db.prepare('UPDATE connector_connections SET secret_json=?,updated_at=? WHERE id=?').run(secretJson,now(),id);}
  function syncStarted(workspaceId,provider){const id=makeId('sync');db.prepare("INSERT INTO sync_runs (id,workspace_id,provider,status,started_at) VALUES (?,?,?,'running',?)").run(id,workspaceId,provider,now());return id;}
  function syncFinished(id,connectionId,count,error){db.exec('BEGIN');try{db.prepare('UPDATE sync_runs SET status=?,imported_count=?,error=?,finished_at=? WHERE id=?').run(error?'failed':'completed',count||0,error||null,now(),id);db.prepare('UPDATE connector_connections SET status=?,last_sync_at=?,last_error=?,updated_at=? WHERE id=?').run(error?'error':'connected',error?null:now(),error||null,now(),connectionId);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  function disconnect(user,provider){if(!['admin','delivery_partner'].includes(user.role))throw new Error('Administrator or delivery partner permission is required.');const row=connection(user.workspaceId,provider);if(!row)return false;db.prepare('DELETE FROM connector_connections WHERE id=?').run(row.id);audit(user.workspaceId,user.id,'connector.disconnected','connector',row.id,{provider});return true;}
  function activeConnections(){return db.prepare("SELECT c.* FROM connector_connections c JOIN memberships m ON m.workspace_id=c.workspace_id AND m.account_id=c.account_id WHERE c.status IN ('connected','error') AND m.role IN ('admin','delivery_partner') ORDER BY COALESCE(c.last_sync_at,c.created_at)").all();}
  function cleanupExpired(){const cutoff=new Date(Date.now()-30*86400000).toISOString();const auditCutoff=new Date(Date.now()-365*86400000).toISOString();db.exec('BEGIN');try{const counts={sessions:db.prepare('DELETE FROM saas_sessions WHERE expires_at<=?').run(now()).changes,tokens:db.prepare('DELETE FROM account_tokens WHERE expires_at<=? OR (used_at IS NOT NULL AND used_at<=?)').run(now(),cutoff).changes,invites:db.prepare('DELETE FROM saas_invites WHERE expires_at<=? OR (used_at IS NOT NULL AND used_at<=?)').run(now(),cutoff).changes,audit:db.prepare('DELETE FROM audit_logs WHERE created_at<=?').run(auditCutoff).changes};db.exec('COMMIT');return counts;}catch(error){db.exec('ROLLBACK');throw error;}}

  return {db,ROLES,PLANS,register,authenticate,createSession,sessionUser,recentlyAuthenticated,reauthenticate,listSessions,revokeSession,switchWorkspace,deleteSession,
    issueAccountToken,issueAccountTokenAfterCooldown,accountByEmail,verifyEmail,resetPassword,changePassword,workspaceList,createWorkspaceForAccount,workspace,updateWorkspace,assertActive,listSeries,replaceBaseline,saveFollowup,updateDecision,
    createInvite,inviteInfo,acceptInvite,members,invites,revokeInvite,updateMemberRole,removeMember,logs,exportWorkspace,deleteWorkspace,updateBilling,webhookProcessed,markWebhookProcessed,
    createOauthState,consumeOauthState,saveConnection,connection,connectionAuthorized,connections,connectionsOwnedBy,workspaceConnections,updateConnectionSecret,syncStarted,syncFinished,disconnect,activeConnections,cleanupExpired};
}

module.exports={createDb,ROLES,PLANS};
