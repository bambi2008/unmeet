const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let session = null;
let data = null;
let accountWorkspaces = [];
let appStatus = null;

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = `toast${error ? ' error' : ''}`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 3500); }
function formData(form) { return Object.fromEntries(new FormData(form)); }
function roleLabel(role) { return ({ admin: 'Admin', delivery_partner: 'Delivery Partner', meeting_owner: 'Meeting Owner', executive_viewer: 'Executive Viewer' })[role] || role; }
function dateAfter(days) { const d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); }

async function boot() {
  const params=new URLSearchParams(location.search);const verify=params.get('verify');if(verify){await request('/api/account/verify',{method:'POST',body:JSON.stringify({token:verify})});history.replaceState({},'','/');toast('Email verified. You can continue.');}
  const reset=params.get('reset');if(reset){const password=prompt('Choose a new password (at least 12 characters):');if(password){await request('/api/password/reset',{method:'POST',body:JSON.stringify({token:reset,password})});history.replaceState({},'','/');toast('Password reset. Sign in with the new password.');}}
  const token = params.get('invite');
  if (token) return showInvite(token);
  appStatus = await request('/api/status');
  try { const response = await request('/api/session'); session = response.user; accountWorkspaces = response.workspaces; return showProduct(); } catch {}
  $('#auth').hidden = false;
  $('#register-form').hidden = !appStatus.registrationOpen;
  $('#login-form').hidden = appStatus.registrationOpen;
}

async function showInvite(token) {
  $('#auth').hidden = false; $('#invite-form').hidden = false;
  try { const { invite } = await request(`/api/invites/${token}`); $('#invite-title').textContent = `Join ${invite.workspaceName}`; $('#invite-copy').textContent = `${invite.email} · ${roleLabel(invite.role)}`; $('#invite-form').dataset.token = token; }
  catch (error) { $('#invite-title').textContent='Invitation unavailable';$('#invite-copy').textContent=error.message;$('#invite-form').querySelector('button').hidden=true; }
}

async function showProduct() {
  $('#auth').hidden = true; $('#product').hidden = false; $('#product').style.display = 'grid';
  $('#user-name').textContent = session.name; $('#user-role').textContent = roleLabel(session.role);
  const isAdmin = ['admin', 'delivery_partner'].includes(session.role);
  $$('.admin-only').forEach(el => { el.hidden = !isAdmin; });
  $$('.editor-only').forEach(el => { el.hidden = !isAdmin; });
  if(session.role==='delivery_partner')$$('#member-invite option[value="admin"],#member-invite option[value="delivery_partner"]').forEach(el=>el.remove());
  await loadAccountWorkspaces();
  await refresh();
}

async function loadAccountWorkspaces() {
  const response = await request('/api/session'); session = response.user; accountWorkspaces = response.workspaces;
  const select = $('#workspace-switch'); select.innerHTML = accountWorkspaces.map(ws => `<option value="${ws.id}"${ws.id === session.workspaceId ? ' selected' : ''}>${escapeHtml(ws.name)} · ${roleLabel(ws.role)}</option>`).join('');
}

async function refresh() {
  const response = await request('/api/workspace'); data = response;
  $('#workspace-name').textContent = response.workspace.name;
  renderMetrics(response.metrics); renderSeries(response.workspace.series); renderResults(response.metrics);
  renderSaas(response.workspace);
  $('#portfolio-copy').textContent = session.role === 'meeting_owner' ? 'Meetings assigned to your email.' : `${response.workspace.series.length} meeting series across the workspace.`;
}

function renderSaas(workspace) {
  $('#plan-name').textContent = workspace.limits.name;
  const trial = workspace.subscriptionStatus === 'trialing' ? ` · trial ends ${new Date(workspace.trialEndsAt).toLocaleDateString()}` : '';
  $('#plan-status').textContent = `${workspace.subscriptionStatus}${trial}`;
  $('#usage').innerHTML = `<div><b>${workspace.usage.members} / ${workspace.limits.memberLimit}</b><span>members</span></div><div><b>${workspace.usage.series} / ${workspace.limits.seriesLimit}</b><span>meeting series</span></div>`;
  $('#billing-note').textContent = 'Online payment is not enabled. A signed order form and invoice activate the selected plan.';
  const form = $('#settings-form'); form.name.value = workspace.name; form.hourlyRate.value = workspace.hourlyRate; form.timezone.value = workspace.timezone; form.currency.value = workspace.currency;
}

function renderMetrics(m) {
  const cards = [
    ['Baseline load', `${m.baselineHours}h / mo`, ''], ['Planned recovery', `${m.plannedSavings}h`, 'good'],
    ['Verified net change', `${m.verifiedNetChange}h`, m.verifiedNetChange < 0 ? 'warn' : 'good'], ['Owner decisions', `${m.decided} / ${m.total}`, ''],
  ];
  $('#metrics').innerHTML = cards.map(([label, value, cls]) => `<div class="metric ${cls}"><span>${label}</span><b>${value}</b></div>`).join('');
}
function renderResults(m) {
  const cards = [['Verified recovery', `${m.verifiedSavings}h`], ['Meeting growth', `${m.increasedHours}h`], ['Current load', `${m.currentHours}h`], ['Value recovered', `$${m.verifiedSavingsCost.toLocaleString()}`]];
  $('#results-grid').innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${label}</span><b>${value}</b></div>`).join('');
}
function renderSeries(series) {
  const q = ($('#search').value || '').toLowerCase();
  const visible = series.filter(item => `${item.title} ${item.owner} ${item.team}`.toLowerCase().includes(q));
  $('#series-body').innerHTML = visible.map(item => {
    const status = UnMeetCore.reviewStatus(item); const decision = item.decision ? UnMeetCore.ACTIONS[item.decision.action]?.label : 'Review';
    return `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.team)} · ${item.source}</small></td><td>${escapeHtml(item.owner)}<small>${escapeHtml(item.ownerEmail || 'No owner email')}</small></td><td><strong>${UnMeetCore.monthlyPersonHours(item)}h</strong><small>${item.durationMinutes} min × ${item.attendeeCount} × ${item.occurrencesPerMonth}/mo</small></td><td><span class="pill ${status}">${status}</span></td><td><button class="secondary decision" data-id="${item.id}">${decision}</button></td></tr>`;
  }).join('');
  $('#empty').hidden = series.length > 0; $('.table-wrap').hidden = series.length === 0;
  $$('.decision').forEach(button => button.addEventListener('click', () => openDecision(button.dataset.id)));
}
function escapeHtml(value) { const el = document.createElement('span'); el.textContent = value || ''; return el.innerHTML; }

function openDecision(id) {
  if (session.role === 'executive_viewer') return toast('Executive Viewer is a read-only role.', true);
  const item = data.workspace.series.find(row => row.id === id); if (!item) return;
  const form = $('#decision-form'); form.reset(); form.seriesId.value = id; form.owner.value = item.decision?.owner || item.owner || session.name;
  form.action.value = item.decision?.action || 'keep'; form.effectiveDate.value = item.decision?.effectiveDate || dateAfter(1); form.reviewDate.value = item.decision?.reviewDate || dateAfter(30); form.rationale.value = item.decision?.rationale || '';
  $('#decision-title').textContent = item.title; renderTarget(item); $('#decision-dialog').showModal();
}
function renderTarget(item) {
  const action = $('#decision-form').action.value; let html = '';
  if (action === 'shorten') html = `<label>Target minutes<input name="targetDuration" type="number" min="5" max="${item.durationMinutes - 1}" value="${Math.max(5, Math.round(item.durationMinutes / 2))}" required></label>`;
  if (action === 'reduce_frequency') html = `<label>Target occurrences / month<input name="targetOccurrences" type="number" min="0" max="${item.occurrencesPerMonth - 1}" value="${Math.max(0, Math.floor(item.occurrencesPerMonth / 2))}" required></label>`;
  if (action === 'reduce_attendees') html = `<label>Target attendees<input name="targetAttendees" type="number" min="1" max="${item.attendeeCount - 1}" value="${Math.max(1, Math.floor(item.attendeeCount * .7))}" required></label>`;
  $('#target-wrap').innerHTML = html;
}

async function recentAuth(){const password=prompt('Confirm your password to continue:');if(!password)throw new Error('Password confirmation canceled.');await request('/api/account/reauth',{method:'POST',body:JSON.stringify({password})});}
async function loadMembers() { const { members,invites } = await request('/api/members'); const canManage=session.role==='admin';$('#member-list').innerHTML = members.map(m => `<div class="member"><div><b>${escapeHtml(m.name)}</b><br><span>${escapeHtml(m.email)}</span></div>${canManage?`<div><select class="member-role" data-id="${m.id}">${['admin','delivery_partner','meeting_owner','executive_viewer'].map(role=>`<option value="${role}"${role===m.role?' selected':''}>${roleLabel(role)}</option>`).join('')}</select><button class="link member-remove" data-id="${m.id}">Remove</button></div>`:`<span>${roleLabel(m.role)}</span>`}</div>`).join('')+(invites?.length?`<h3>Pending invitations</h3>${invites.map(i=>`<div class="member"><div><b>${escapeHtml(i.email)}</b><br><span>${roleLabel(i.role)}</span></div><button class="link invite-revoke" data-id="${i.id}">Revoke</button></div>`).join('')}`:'');$$('.member-role').forEach(el=>el.addEventListener('change',async()=>{try{await recentAuth();await request(`/api/members/${el.dataset.id}`,{method:'PATCH',body:JSON.stringify({role:el.value})});toast('Member access updated.');await loadMembers();}catch(e){toast(e.message,true);}}));$$('.member-remove').forEach(el=>el.addEventListener('click',async()=>{try{await recentAuth();await request(`/api/members/${el.dataset.id}`,{method:'DELETE'});toast('Member removed.');await loadMembers();}catch(e){toast(e.message,true);}}));$$('.invite-revoke').forEach(el=>el.addEventListener('click',async()=>{try{await request(`/api/invites/${el.dataset.id}/revoke`,{method:'POST'});await loadMembers();}catch(e){toast(e.message,true);}})); }
async function loadSources() { const { connectors,connections } = await request('/api/connectors'); const live=new Map((connections||[]).map(c=>[c.provider,c]));$('#connector-list').innerHTML = connectors.map(c => {const connected=live.get(c.id);const action=['google_workspace','microsoft_365'].includes(c.id)?`<button class="secondary connector-action" data-provider="${c.id}" data-action="${connected?'sync':'connect'}">${connected?'Sync now':'Connect'}</button>`:`<span class="pill status ${c.ready?'':'backlog'}">${c.ready?'Ready':'Planned'}</span>`;return `<div class="connector"><div><b>${c.name}</b><span>${c.capabilities.join(' · ')}${connected?.lastSyncAt?` · synced ${new Date(connected.lastSyncAt).toLocaleString()}`:''}${connected?.lastError?` · ${escapeHtml(connected.lastError)}`:''}</span></div>${action}</div>`;}).join('');$$('.connector-action').forEach(button=>button.addEventListener('click',async()=>{try{if(button.dataset.action==='connect'){const {url}=await request(`/api/connectors/${button.dataset.provider}/connect`,{method:'POST'});location.href=url;}else{await request(`/api/connectors/${button.dataset.provider}/sync`,{method:'POST'});toast('Calendar sync completed.');await refresh();await loadSources();}}catch(e){toast(e.message,true);}})); }
async function loadAudit() { if (!['admin','delivery_partner'].includes(session.role)) return; const { logs } = await request('/api/audit'); $('#audit-list').innerHTML = logs.map(log => `<div class="audit"><div><b>${log.action}</b><br><span>${escapeHtml(log.userName)} · ${log.entityType}</span></div><span>${new Date(log.createdAt).toLocaleString()}</span></div>`).join('') || '<p class="muted">No activity yet.</p>'; }

$('#register-form').addEventListener('submit', async event => { event.preventDefault(); try { const result=await request('/api/register', { method:'POST', body:JSON.stringify(formData(event.target)) });session=result.user;if(result.verifyUrl)await navigator.clipboard?.writeText(result.verifyUrl);toast(result.delivery?.sent?'Check your email to verify the account.':'Development verification link copied.');await showProduct(); } catch(e){ toast(e.message,true); } });
$$('.auth-toggle').forEach(button => button.addEventListener('click', () => { $('#register-form').hidden = button.dataset.auth !== 'register'; $('#login-form').hidden = button.dataset.auth !== 'login'; }));
$('#login-form').addEventListener('submit', async event => { event.preventDefault(); try { session = (await request('/api/login', { method:'POST', body:JSON.stringify(formData(event.target)) })).user; await showProduct(); } catch(e){ toast(e.message,true); } });
$('#invite-form').addEventListener('submit', async event => { event.preventDefault(); try { session = (await request(`/api/invites/${event.target.dataset.token}`, { method:'POST', body:JSON.stringify(formData(event.target)) })).user; history.replaceState({},'', '/'); await showProduct(); } catch(e){ toast(e.message,true); } });
$('#logout').addEventListener('click', async () => { await request('/api/logout',{method:'POST'}); location.reload(); });
$('#search').addEventListener('input', () => renderSeries(data.workspace.series));
$$('.nav').forEach(button => button.addEventListener('click', async () => { $$('.nav').forEach(b => b.classList.toggle('active', b === button)); $$('.view').forEach(v => { v.hidden = v.id !== `view-${button.dataset.view}`; }); if(button.dataset.view==='team') await loadMembers(); if(button.dataset.view==='sources') await loadSources(); if(button.dataset.view==='audit') await loadAudit();if(button.dataset.view==='settings')await loadSessions(); }));
$('#import-open').addEventListener('click', () => $('#import-dialog').showModal());
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#decision-form').action.addEventListener('change', () => renderTarget(data.workspace.series.find(i => i.id === $('#decision-form').seriesId.value)));
$('#decision-form').addEventListener('submit', async event => { event.preventDefault(); const values=formData(event.target); const id=values.seriesId; delete values.seriesId; ['targetDuration','targetOccurrences','targetAttendees'].forEach(k=>{if(values[k])values[k]=Number(values[k]);}); try{await request(`/api/series/${id}/decision`,{method:'PATCH',body:JSON.stringify(values)}); $('#decision-dialog').close(); toast('Decision saved and logged.'); await refresh();}catch(e){toast(e.message,true);} });
$('#import-form').addEventListener('submit', async event => { event.preventDefault(); const values=formData(event.target); const file=event.target.file.files[0]; try { const text=await file.text(); const payload=values.provider==='csv'?text:JSON.parse(text); const result=await request('/api/import',{method:'POST',body:JSON.stringify({provider:values.provider,mode:values.mode,measuredAt:values.measuredAt,payload})}); $('#import-dialog').close(); toast(result.summary ? `Verification complete: ${result.summary.matched} matched.` : `${result.imported} series imported.`); await refresh(); } catch(e){toast(e.message,true);} });
$('#member-invite').addEventListener('submit', async event => { event.preventDefault(); try { const {inviteUrl,delivery}=await request('/api/invites',{method:'POST',body:JSON.stringify(formData(event.target))}); const result=$('#invite-result'); result.hidden=false; result.textContent=delivery.sent ? `Invitation emailed. Backup link: ${inviteUrl}` : `Copy this invitation link: ${inviteUrl}`; await navigator.clipboard?.writeText(inviteUrl); toast(delivery.sent ? 'Invitation emailed.' : 'Invite link generated.'); }catch(e){toast(e.message,true);} });
$('#workspace-switch').addEventListener('change', async event => { try { session = (await request(`/api/workspaces/${event.target.value}/switch`, {method:'POST'})).user; location.reload(); } catch(e){toast(e.message,true);} });
$('#workspace-add').addEventListener('click', () => $('#workspace-dialog').showModal());
$('#workspace-form').addEventListener('submit', async event => { event.preventDefault(); try { session=(await request('/api/workspaces',{method:'POST',body:JSON.stringify(formData(event.target))})).user; location.reload(); } catch(e){toast(e.message,true);} });
$('#settings-form').addEventListener('submit', async event => { event.preventDefault(); try { await request('/api/workspace/settings',{method:'PATCH',body:JSON.stringify(formData(event.target))}); toast('Workspace settings saved.'); await loadAccountWorkspaces(); await refresh(); } catch(e){toast(e.message,true);} });
$('#forgot-password').addEventListener('click',async()=>{const email=$('#login-form [name="email"]').value;if(!email)return toast('Enter your email first.',true);try{await request('/api/password/forgot',{method:'POST',body:JSON.stringify({email})});toast('If that account exists, a reset email has been sent.');}catch(e){toast(e.message,true);}});
async function loadSessions(){const {sessions}=await request('/api/account/sessions');$('#session-list').innerHTML=sessions.map(s=>`<div class="member"><span>${s.current?'This session':'Other session'}<br><small>${new Date(s.lastSeenAt).toLocaleString()}</small></span>${s.current?'':'<button class="link revoke-session" data-id="'+s.id+'">Sign out</button>'}</div>`).join('');$$('.revoke-session').forEach(button=>button.addEventListener('click',async()=>{try{await recentAuth();await request(`/api/account/sessions/${button.dataset.id}`,{method:'DELETE'});await loadSessions();}catch(e){toast(e.message,true);}}));}
$('#password-form').addEventListener('submit',async event=>{event.preventDefault();try{await request('/api/account/password',{method:'PATCH',body:JSON.stringify(formData(event.target))});toast('Password changed. Sign in again.');setTimeout(()=>location.reload(),800);}catch(e){toast(e.message,true);}});
$('#export-workspace').addEventListener('click', async () => { try { await recentAuth();const exported=await request('/api/workspace/export'); const blob=new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`unmeet-${data.workspace.slug}-export.json`; link.click(); URL.revokeObjectURL(link.href); } catch(e){toast(e.message,true);} });
$('#delete-workspace').addEventListener('click', async () => { try { await recentAuth();await request('/api/workspace',{method:'DELETE',body:JSON.stringify({confirmation:$('#delete-confirmation').value})}); location.reload(); } catch(e){toast(e.message,true);} });
boot().catch(error => toast(error.message, true));
