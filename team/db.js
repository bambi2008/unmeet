const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const ROLES = ['admin', 'delivery_partner', 'meeting_owner', 'executive_viewer'];

function json(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function createDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hourly_rate REAL NOT NULL DEFAULT 75,
      period TEXT NOT NULL DEFAULT '30 days', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
      role TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workspace_id, email)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL, role TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id), used_at TEXT
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
  `);

  const now = () => new Date().toISOString();
  const id = prefix => `${prefix}_${crypto.randomUUID()}`;
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
    salt,
    digest: crypto.scryptSync(password, salt, 64).toString('hex'),
  });

  function publicUser(row) {
    return row && { id: row.id, workspaceId: row.workspace_id, email: row.email, name: row.name, role: row.role };
  }

  function createWorkspace({ workspaceName, hourlyRate, name, email, password }) {
    if (db.prepare('SELECT COUNT(*) count FROM workspaces').get().count) throw new Error('A workspace already exists.');
    const workspaceId = id('ws');
    const userId = id('usr');
    const passwordData = hashPassword(password);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run(workspaceId, workspaceName, hourlyRate || 75, '30 days', now());
      db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, workspaceId, email.toLowerCase(), name, passwordData.digest, passwordData.salt, 'admin', now());
      audit(workspaceId, userId, 'workspace.created', 'workspace', workspaceId, { name: workspaceName });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  }

  function authenticate(email, password) {
    const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
    if (!row) return null;
    const candidate = Buffer.from(hashPassword(password, row.salt).digest, 'hex');
    const expected = Buffer.from(row.password_hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected) ? publicUser(row) : null;
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), userId, expires);
    return { token, expires };
  }

  function sessionUser(token) {
    if (!token) return null;
    return publicUser(db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at > ?`).get(hash(token), now()));
  }

  function deleteSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }

  function workspace(workspaceId) {
    const row = db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspaceId);
    return row && { id: row.id, name: row.name, hourlyRate: row.hourly_rate, period: row.period, createdAt: row.created_at };
  }

  function mapSeries(row) {
    return {
      id: row.id, source: row.source, externalId: row.external_id, title: row.title,
      owner: row.owner, ownerEmail: row.owner_email, team: row.team,
      durationMinutes: row.duration_minutes, attendeeCount: row.attendee_count,
      occurrencesPerMonth: row.occurrences_per_month, hasAgenda: Boolean(row.has_agenda),
      ageMonths: row.age_months, reviewStatus: row.review_status,
      decision: json(row.decision_json), actual: json(row.actual_json), updatedAt: row.updated_at,
    };
  }

  function listSeries(user) {
    const ownOnly = user.role === 'meeting_owner';
    const rows = ownOnly
      ? db.prepare('SELECT * FROM series WHERE workspace_id=? AND lower(owner_email)=lower(?) ORDER BY title').all(user.workspaceId, user.email)
      : db.prepare('SELECT * FROM series WHERE workspace_id=? ORDER BY title').all(user.workspaceId);
    return rows.map(mapSeries);
  }

  function replaceBaseline(workspaceId, source, items, userId) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM series WHERE workspace_id=?').run(workspaceId);
      const insert = db.prepare(`INSERT INTO series
        (id,workspace_id,source,external_id,title,owner,owner_email,team,duration_minutes,attendee_count,occurrences_per_month,has_agenda,age_months,review_status,decision_json,actual_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) {
        const seriesId = id('ser');
        insert.run(seriesId, workspaceId, source, item.id || null, item.title, item.owner, item.ownerEmail || '', item.team,
          item.durationMinutes, item.attendeeCount, item.occurrencesPerMonth, item.hasAgenda ? 1 : 0,
          item.ageMonths, item.reviewStatus || 'backlog', null, null, now(), now());
      }
      audit(workspaceId, userId, 'baseline.imported', 'workspace', workspaceId, { source, count: items.length });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function saveFollowup(workspaceId, source, result, userId, measuredAt) {
    db.exec('BEGIN');
    try {
      const update = db.prepare('UPDATE series SET actual_json=?, updated_at=? WHERE id=? AND workspace_id=?');
      for (const item of result.workspace.series) update.run(item.actual ? JSON.stringify(item.actual) : null, now(), item.id, workspaceId);
      db.prepare('INSERT INTO verification_runs VALUES (?,?,?,?,?,?)').run(id('run'), workspaceId, source, measuredAt, JSON.stringify(result.summary), now());
      audit(workspaceId, userId, 'followup.imported', 'workspace', workspaceId, { source, ...result.summary });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function updateDecision(user, seriesId, decision) {
    const row = db.prepare('SELECT * FROM series WHERE id=? AND workspace_id=?').get(seriesId, user.workspaceId);
    if (!row) throw new Error('Meeting series not found.');
    if (user.role === 'executive_viewer') throw new Error('This role is read-only.');
    if (user.role === 'meeting_owner' && row.owner_email.toLowerCase() !== user.email.toLowerCase()) throw new Error('You can only decide meetings assigned to you.');
    db.prepare('UPDATE series SET decision_json=?, review_status=?, updated_at=? WHERE id=?').run(JSON.stringify(decision), 'decided', now(), seriesId);
    audit(user.workspaceId, user.id, 'decision.updated', 'series', seriesId, { action: decision.action, previous: json(row.decision_json) });
  }

  function createInvite(user, email, role) {
    if (!['admin', 'delivery_partner'].includes(user.role)) throw new Error('Only administrators and delivery partners can invite members.');
    if (!ROLES.includes(role)) throw new Error('Invalid role.');
    const token = crypto.randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 72 * 3600000).toISOString();
    db.prepare('INSERT INTO invites VALUES (?,?,?,?,?,?,NULL)').run(hash(token), user.workspaceId, email.toLowerCase(), role, expires, user.id);
    audit(user.workspaceId, user.id, 'member.invited', 'invite', email.toLowerCase(), { role });
    return { token, email: email.toLowerCase(), role, expires };
  }

  function inviteInfo(token) {
    const row = db.prepare(`SELECT i.email,i.role,i.expires_at,w.name workspace_name FROM invites i JOIN workspaces w ON w.id=i.workspace_id
      WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at > ?`).get(hash(token), now());
    return row && { email: row.email, role: row.role, expires: row.expires_at, workspaceName: row.workspace_name };
  }

  function acceptInvite(token, name, password) {
    const row = db.prepare('SELECT * FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at > ?').get(hash(token), now());
    if (!row) throw new Error('Invite is invalid or expired.');
    const passwordData = hashPassword(password);
    const userId = id('usr');
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(userId, row.workspace_id, row.email, name, passwordData.digest, passwordData.salt, row.role, now());
      db.prepare('UPDATE invites SET used_at=? WHERE token_hash=?').run(now(), hash(token));
      audit(row.workspace_id, userId, 'member.joined', 'user', userId, { role: row.role });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  }

  function members(workspaceId) {
    return db.prepare('SELECT id,email,name,role,created_at FROM users WHERE workspace_id=? ORDER BY created_at').all(workspaceId)
      .map(row => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at }));
  }

  function audit(workspaceId, userId, action, entityType, entityId, details) {
    db.prepare('INSERT INTO audit_logs (workspace_id,user_id,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(workspaceId, userId, action, entityType, entityId, JSON.stringify(details || {}), now());
  }

  function logs(workspaceId) {
    return db.prepare(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 200`).all(workspaceId).map(row => ({
        id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        details: json(row.details_json, {}), createdAt: row.created_at, userName: row.user_name || 'System',
      }));
  }

  return { db, ROLES, createWorkspace, authenticate, createSession, sessionUser, deleteSession, workspace, listSeries, replaceBaseline, saveFollowup, updateDecision, createInvite, inviteInfo, acceptInvite, members, logs };
}

module.exports = { createDb, ROLES };
