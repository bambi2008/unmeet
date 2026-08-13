const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const file = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(file)) throw new Error('Pass a backup database file to verify.');
const db = new DatabaseSync(file, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get();
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
for (const required of ['workspaces','accounts','memberships','series','audit_logs']) if (!tables.has(required)) throw new Error(`Backup is missing ${required}.`);
if (integrity.integrity_check !== 'ok') throw new Error(`Integrity check failed: ${integrity.integrity_check}`);
const sensitiveRows={};for(const table of ['saas_sessions','account_tokens','oauth_states','connector_connections']){sensitiveRows[table]=tables.has(table)?db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count:0;if(sensitiveRows[table])throw new Error(`Backup contains ${sensitiveRows[table]} sensitive rows in ${table}.`);}
console.log(JSON.stringify({ ok: true, file, workspaces: db.prepare('SELECT COUNT(*) count FROM workspaces').get().count,sensitiveRows })); db.close();
