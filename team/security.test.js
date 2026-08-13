const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('./saas-db');
const Vault = require('./vault');
const Calendar = require('./connectors/calendar-oauth');

test('encrypts OAuth secrets with authenticated encryption', () => {
  const previous=process.env.UNMEET_ENCRYPTION_KEY;process.env.UNMEET_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  const encrypted=Vault.encrypt({access_token:'secret'});assert.equal(encrypted.includes('secret'),false);assert.deepEqual(Vault.decrypt(encrypted),{access_token:'secret'});
  if(previous===undefined)delete process.env.UNMEET_ENCRYPTION_KEY;else process.env.UNMEET_ENCRYPTION_KEY=previous;
});

test('normalizes Google and Microsoft recurring calendar events', () => {
  const items=Calendar.group([{id:'1',recurringEventId:'r1',summary:'Weekly',start:{dateTime:'2026-08-01T10:00:00Z'},end:{dateTime:'2026-08-01T11:00:00Z'},organizer:{email:'owner@example.com'},attendees:[{email:'a@example.com'}]},{id:'2',recurringEventId:'r1',summary:'Weekly',start:{dateTime:'2026-08-08T10:00:00Z'},end:{dateTime:'2026-08-08T10:30:00Z'},organizer:{email:'owner@example.com'},attendees:[]}],'google_workspace');
  assert.equal(items.length,1);assert.equal(items[0].occurrencesPerMonth,2);assert.equal(items[0].durationMinutes,45);
});

test('prevents delivery partners granting privileged roles and protects last admin', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unmeet-security-'));const store=createDb(path.join(dir,'db.sqlite'));
  const admin=store.register({workspaceName:'Secure',name:'Admin',email:'admin@example.com',password:'a-secure-password'});
  const partnerInvite=store.createInvite(admin,'partner@example.com','delivery_partner');const partner=store.acceptInvite(partnerInvite.token,'Partner','partner-password');
  assert.throws(()=>store.createInvite(partner,'attacker@example.com','admin'),/cannot grant/);
  assert.throws(()=>store.updateMemberRole(admin,admin.id,'meeting_owner'),/last administrator/);
  store.saveConnection(admin.workspaceId,partner.id,'google_workspace','encrypted-placeholder');
  store.createOauthState(partner,'google_workspace','pending-removal');
  store.removeMember(admin,partner.id);
  assert.equal(store.consumeOauthState('pending-removal','google_workspace'),null);
  assert.equal(store.connection(admin.workspaceId,'google_workspace'),undefined);
  store.db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('revokes pending OAuth state when connector permission is downgraded', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unmeet-oauth-role-'));const store=createDb(path.join(dir,'db.sqlite'));
  const admin=store.register({workspaceName:'Secure',name:'Admin',email:'admin2@example.com',password:'a-secure-password'});
  const invite=store.createInvite(admin,'partner2@example.com','delivery_partner');const partner=store.acceptInvite(invite.token,'Partner','partner-password');
  store.createOauthState(partner,'microsoft_365','pending-downgrade');store.saveConnection(admin.workspaceId,partner.id,'microsoft_365','encrypted-placeholder');store.updateMemberRole(admin,partner.id,'meeting_owner');
  assert.equal(store.consumeOauthState('pending-downgrade','microsoft_365'),null);
  assert.equal(store.connection(admin.workspaceId,'microsoft_365'),undefined);
  store.db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('enforces account workspace limits and account-token cooldowns', () => {
  const previous=process.env.UNMEET_ACCOUNT_WORKSPACE_LIMIT;process.env.UNMEET_ACCOUNT_WORKSPACE_LIMIT='2';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unmeet-limits-'));const store=createDb(path.join(dir,'db.sqlite'));
  const admin=store.register({workspaceName:'One',name:'Admin',email:'limit@example.com',password:'a-secure-password'});store.createWorkspaceForAccount(admin.id,{workspaceName:'Two'});
  assert.throws(()=>store.createWorkspaceForAccount(admin.id,{workspaceName:'Three'}),/at most 2 workspaces/);
  const first=store.issueAccountTokenAfterCooldown(admin.id,'reset_password',30*60000);const second=store.issueAccountTokenAfterCooldown(admin.id,'reset_password',30*60000);assert.ok(first);assert.equal(second,null);
  store.db.close();fs.rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.UNMEET_ACCOUNT_WORKSPACE_LIMIT;else process.env.UNMEET_ACCOUNT_WORKSPACE_LIMIT=previous;
});

test('rejects OAuth pagination outside the fixed provider host', async () => {
  const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return{ok:true,json:async()=>({value:[], '@odata.nextLink':'https://attacker.example/events'})};};
  await assert.rejects(()=>Calendar.fetchEvents('microsoft_365',{access_token:'secret'},{from:'2026-08-01T00:00:00Z',to:'2026-08-31T00:00:00Z'}),/unexpected destination/);assert.equal(calls,1);global.fetch=original;
});

test('applies one deadline across a paginated calendar synchronization', async () => {
  const original=global.fetch;
  global.fetch=async(_url,{signal})=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve({ok:true,json:async()=>({value:[]})}),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
  await assert.rejects(()=>Calendar.fetchEvents('microsoft_365',{access_token:'secret'},{from:'2026-08-01T00:00:00Z',to:'2026-08-31T00:00:00Z',deadlineAt:Date.now()+5}),/timeout|deadline|aborted/i);
  global.fetch=original;
});
