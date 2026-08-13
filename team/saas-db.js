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
  `);

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
        db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,NULL)').run(row.id, row.email.toLowerCase(), row.name, row.password_hash, row.salt, row.created_at);
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

  function accountPublic(row) { return row && { id: row.id, email: row.email, name: row.name }; }
  function membership(accountId, workspaceId) {
    return db.prepare('SELECT * FROM memberships WHERE account_id=? AND workspace_id=?').get(accountId, workspaceId);
  }
  function userContext(accountId, workspaceId) {
    const row = db.prepare(`SELECT a.id,a.email,a.name,m.role,m.workspace_id FROM accounts a JOIN memberships m ON m.account_id=a.id
      JOIN workspaces w ON w.id=m.workspace_id WHERE a.id=? AND m.workspace_id=? AND w.deleted_at IS NULL`).get(accountId, workspaceId);
    return row && { id: row.id, accountId: row.id, email: row.email, name: row.name, role: row.role, workspaceId: row.workspace_id };
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
    db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?,NULL)').run(accountId, email.toLowerCase(), name, passwordData.digest, passwordData.salt, now());
    return accountPublic(db.prepare('SELECT * FROM accounts WHERE id=?').get(accountId));
  }
  function createWorkspaceForAccount(accountId, { workspaceName, hourlyRate = 75, timezone = 'UTC', currency = 'USD' }) {
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
    db.prepare('INSERT INTO saas_sessions VALUES (?,?,?,?,?)').run(hash(token), accountId, workspaceId, expires, now());
    return { token, expires };
  }
  function sessionUser(token) {
    if (!token) return null;
    const session = db.prepare('SELECT * FROM saas_sessions WHERE token_hash=? AND expires_at>?').get(hash(token), now());
    return session && userContext(session.account_id, session.active_workspace_id);
  }
  function switchWorkspace(token, accountId, workspaceId) {
    if (!membership(accountId, workspaceId)) throw new Error('You are not a member of this workspace.');
    db.prepare('UPDATE saas_sessions SET active_workspace_id=? WHERE token_hash=? AND account_id=?').run(workspaceId, hash(token), accountId);
    return userContext(accountId, workspaceId);
  }
  function deleteSession(token) { if (token) db.prepare('DELETE FROM saas_sessions WHERE token_hash=?').run(hash(token)); }

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
    const ws = workspace(workspaceId); planAllows(workspaceId, 'series', Math.max(0, items.length - ws.usage.series));
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM series WHERE workspace_id=?').run(workspaceId);
      const insert = db.prepare(`INSERT INTO series (id,workspace_id,source,external_id,title,owner,owner_email,team,duration_minutes,attendee_count,occurrences_per_month,has_agenda,age_months,review_status,decision_json,actual_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) insert.run(makeId('ser'),workspaceId,source,item.id||null,item.title,item.owner,item.ownerEmail||'',item.team,item.durationMinutes,item.attendeeCount,item.occurrencesPerMonth,item.hasAgenda?1:0,item.ageMonths,item.reviewStatus||'backlog',null,null,now(),now());
      audit(workspaceId,userId,'baseline.imported','workspace',workspaceId,{source,count:items.length}); db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error;}
  }
  function saveFollowup(workspaceId,source,result,userId,measuredAt){db.exec('BEGIN');try{const update=db.prepare('UPDATE series SET actual_json=?,updated_at=? WHERE id=? AND workspace_id=?');for(const item of result.workspace.series)update.run(item.actual?JSON.stringify(item.actual):null,now(),item.id,workspaceId);db.prepare('INSERT INTO verification_runs VALUES (?,?,?,?,?,?)').run(makeId('run'),workspaceId,source,measuredAt,JSON.stringify(result.summary),now());audit(workspaceId,userId,'followup.imported','workspace',workspaceId,{source,...result.summary});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  function updateDecision(user,seriesId,decision){const row=db.prepare('SELECT * FROM series WHERE id=? AND workspace_id=?').get(seriesId,user.workspaceId);if(!row)throw new Error('Meeting series not found.');if(user.role==='executive_viewer')throw new Error('This role is read-only.');if(user.role==='meeting_owner'&&row.owner_email.toLowerCase()!==user.email.toLowerCase())throw new Error('You can only decide meetings assigned to you.');db.prepare('UPDATE series SET decision_json=?,review_status=?,updated_at=? WHERE id=?').run(JSON.stringify(decision),'decided',now(),seriesId);audit(user.workspaceId,user.id,'decision.updated','series',seriesId,{action:decision.action,previous:parseJson(row.decision_json)});}
  function createInvite(user,email,role){if(!['admin','delivery_partner'].includes(user.role))throw new Error('Only administrators and delivery partners can invite members.');if(!ROLES.includes(role))throw new Error('Invalid role.');planAllows(user.workspaceId,'members',0);const ws=workspace(user.workspaceId);const pending=db.prepare('SELECT COUNT(*) count FROM saas_invites WHERE workspace_id=? AND used_at IS NULL AND expires_at>?').get(user.workspaceId,now()).count;if(ws.usage.members+pending>=ws.limits.memberLimit)throw new Error(`${ws.limits.name} plan members limit reached.`);const token=crypto.randomBytes(24).toString('base64url');const expires=new Date(Date.now()+72*3600000).toISOString();db.prepare('INSERT INTO saas_invites VALUES (?,?,?,?,?,?,NULL,?)').run(hash(token),user.workspaceId,email.toLowerCase(),role,expires,user.id,now());audit(user.workspaceId,user.id,'member.invited','invite',email.toLowerCase(),{role});return{token,email:email.toLowerCase(),role,expires};}
  function inviteInfo(token){const row=db.prepare(`SELECT i.email,i.role,i.expires_at,w.name workspace_name FROM saas_invites i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND w.deleted_at IS NULL`).get(hash(token),now());return row&&{email:row.email,role:row.role,expires:row.expires_at,workspaceName:row.workspace_name};}
  function acceptInvite(token,name,password){const row=db.prepare('SELECT * FROM saas_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(hash(token),now());if(!row)throw new Error('Invite is invalid or expired.');let account=db.prepare('SELECT * FROM accounts WHERE email=?').get(row.email);if(account){const authenticated=authenticate(row.email,password);if(!authenticated)throw new Error('This email already has an account. Enter its existing password.');account=db.prepare('SELECT * FROM accounts WHERE id=?').get(authenticated.id);if(!membership(account.id,row.workspace_id))planAllows(row.workspace_id,'members');}else{planAllows(row.workspace_id,'members');account=db.prepare('SELECT * FROM accounts WHERE id=?').get(createAccount(name,row.email,password).id);}db.exec('BEGIN');try{db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?,?)').run(row.workspace_id,account.id,row.role,now());db.prepare('UPDATE saas_invites SET used_at=? WHERE token_hash=?').run(now(),hash(token));audit(row.workspace_id,account.id,'member.joined','account',account.id,{role:row.role});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return userContext(account.id,row.workspace_id);}
  function members(workspaceId){return db.prepare(`SELECT a.id,a.email,a.name,m.role,m.created_at FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=? ORDER BY m.created_at`).all(workspaceId).map(row=>({id:row.id,email:row.email,name:row.name,role:row.role,createdAt:row.created_at}));}
  function audit(workspaceId,userId,action,entityType,entityId,details){db.prepare('INSERT INTO audit_logs (workspace_id,user_id,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)').run(workspaceId,userId,action,entityType,entityId,JSON.stringify(details||{}),now());}
  function logs(workspaceId){return db.prepare(`SELECT a.*,ac.name user_name FROM audit_logs a LEFT JOIN accounts ac ON ac.id=a.user_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 200`).all(workspaceId).map(row=>({id:row.id,action:row.action,entityType:row.entity_type,entityId:row.entity_id,details:parseJson(row.details_json,{}),createdAt:row.created_at,userName:row.user_name||'System'}));}
  function exportWorkspace(user){if(user.role!=='admin')throw new Error('Administrator permission is required.');return{exportedAt:now(),workspace:workspace(user.workspaceId),members:members(user.workspaceId),series:listSeries({...user,role:'admin'}),audit:logs(user.workspaceId)};}
  function deleteWorkspace(user,confirmation){if(user.role!=='admin')throw new Error('Administrator permission is required.');const ws=workspace(user.workspaceId);if(confirmation!==ws.name)throw new Error('Enter the workspace name to confirm deletion.');db.prepare('UPDATE workspaces SET deleted_at=? WHERE id=?').run(now(),user.workspaceId);db.prepare('DELETE FROM saas_sessions WHERE active_workspace_id=?').run(user.workspaceId);audit(user.workspaceId,user.id,'workspace.deleted','workspace',user.workspaceId,{});}
  function updateBilling(workspaceId,{plan,status,customerId,subscriptionId}){const ws=workspace(workspaceId);if(!ws)return;db.prepare(`UPDATE workspaces SET plan=?,subscription_status=?,stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=COALESCE(?,stripe_subscription_id) WHERE id=?`).run(plan||ws.plan,status||ws.subscriptionStatus,customerId||null,subscriptionId||null,workspaceId);}
  function webhookProcessed(provider,eventId){return Boolean(db.prepare('SELECT 1 FROM processed_webhooks WHERE provider=? AND event_id=?').get(provider,eventId));}
  function markWebhookProcessed(provider,eventId){db.prepare('INSERT OR IGNORE INTO processed_webhooks VALUES (?,?,?)').run(provider,eventId,now());}

  return {db,ROLES,PLANS,register,authenticate,createSession,sessionUser,switchWorkspace,deleteSession,workspaceList,createWorkspaceForAccount,workspace,updateWorkspace,assertActive,listSeries,replaceBaseline,saveFollowup,updateDecision,createInvite,inviteInfo,acceptInvite,members,logs,exportWorkspace,deleteWorkspace,updateBilling,webhookProcessed,markWebhookProcessed};
}

module.exports={createDb,ROLES,PLANS};
