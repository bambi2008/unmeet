const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const source = path.resolve(process.env.UNMEET_DB || path.join(__dirname, '..', 'team', 'unmeet.db'));
const directory = path.resolve(process.env.UNMEET_BACKUP_DIR || path.join(__dirname, '..', 'backups'));
if (!fs.existsSync(source)) throw new Error(`Database does not exist: ${source}`);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = path.join(directory, `unmeet-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const temporary = path.join(directory, `.unmeet-${process.pid}-${crypto.randomUUID()}.tmp`);
const previousUmask=process.umask(0o077);let db;let backup;
try {
  db = new DatabaseSync(source, { readOnly: true });db.exec(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`);db.close();db=null;fs.chmodSync(temporary,0o600);
  backup = new DatabaseSync(temporary);backup.exec('PRAGMA foreign_keys=ON; BEGIN; DELETE FROM saas_sessions; DELETE FROM account_tokens; DELETE FROM oauth_states; DELETE FROM connector_connections; COMMIT; VACUUM;');
  for(const table of ['saas_sessions','account_tokens','oauth_states','connector_connections'])if(backup.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)throw new Error(`Backup sanitization failed for ${table}.`);
  backup.close();backup=null;fs.renameSync(temporary,target);console.log(target);
} catch(error) { try{backup?.close();}catch{}try{db?.close();}catch{}try{fs.unlinkSync(temporary);}catch{}throw error; }
finally { process.umask(previousUmask); }
