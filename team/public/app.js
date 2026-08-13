const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let session = null;
let data = null;

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
  const token = new URLSearchParams(location.search).get('invite');
  if (token) return showInvite(token);
  const status = await request('/api/status');
  try { session = (await request('/api/session')).user; return showProduct(); } catch {}
  $('#auth').hidden = false;
  $(status.setupRequired ? '#setup-form' : '#login-form').hidden = false;
}

async function showInvite(token) {
  $('#auth').hidden = false; $('#invite-form').hidden = false;
  try { const { invite } = await request(`/api/invites/${token}`); $('#invite-title').textContent = `Join ${invite.workspaceName}`; $('#invite-copy').textContent = `${invite.email} · ${roleLabel(invite.role)}`; $('#invite-form').dataset.token = token; }
  catch (error) { $('#invite-form').innerHTML = `<h2>Invitation unavailable</h2><p class="muted">${error.message}</p>`; }
}

async function showProduct() {
  $('#auth').hidden = true; $('#product').hidden = false; $('#product').style.display = 'grid';
  $('#user-name').textContent = session.name; $('#user-role').textContent = roleLabel(session.role);
  const isAdmin = ['admin', 'delivery_partner'].includes(session.role);
  $$('.admin-only').forEach(el => { el.hidden = !isAdmin; });
  $$('.editor-only').forEach(el => { el.hidden = !isAdmin; });
  await refresh();
}

async function refresh() {
  const response = await request('/api/workspace'); data = response;
  $('#workspace-name').textContent = response.workspace.name;
  renderMetrics(response.metrics); renderSeries(response.workspace.series); renderResults(response.metrics);
  $('#portfolio-copy').textContent = session.role === 'meeting_owner' ? 'Meetings assigned to your email.' : `${response.workspace.series.length} meeting series across the workspace.`;
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

async function loadMembers() { const { members } = await request('/api/members'); $('#member-list').innerHTML = members.map(m => `<div class="member"><div><b>${escapeHtml(m.name)}</b><br><span>${escapeHtml(m.email)}</span></div><span>${roleLabel(m.role)}</span></div>`).join(''); }
async function loadSources() { const { connectors } = await request('/api/connectors'); $('#connector-list').innerHTML = connectors.map(c => `<div class="connector"><div><b>${c.name}</b><span>${c.capabilities.join(' · ')}${c.note ? ` — ${c.note}` : ''}</span></div><span class="pill status ${c.ready ? '' : 'backlog'}">${c.ready ? 'Ready' : 'Adapter ready'}</span></div>`).join(''); }
async function loadAudit() { if (!['admin','delivery_partner'].includes(session.role)) return; const { logs } = await request('/api/audit'); $('#audit-list').innerHTML = logs.map(log => `<div class="audit"><div><b>${log.action}</b><br><span>${escapeHtml(log.userName)} · ${log.entityType}</span></div><span>${new Date(log.createdAt).toLocaleString()}</span></div>`).join('') || '<p class="muted">No activity yet.</p>'; }

$('#setup-form').addEventListener('submit', async event => { event.preventDefault(); try { session = (await request('/api/setup', { method:'POST', body:JSON.stringify(formData(event.target)) })).user; await showProduct(); } catch(e){ toast(e.message,true); } });
$('#login-form').addEventListener('submit', async event => { event.preventDefault(); try { session = (await request('/api/login', { method:'POST', body:JSON.stringify(formData(event.target)) })).user; await showProduct(); } catch(e){ toast(e.message,true); } });
$('#invite-form').addEventListener('submit', async event => { event.preventDefault(); try { session = (await request(`/api/invites/${event.target.dataset.token}`, { method:'POST', body:JSON.stringify(formData(event.target)) })).user; history.replaceState({},'', '/'); await showProduct(); } catch(e){ toast(e.message,true); } });
$('#logout').addEventListener('click', async () => { await request('/api/logout',{method:'POST'}); location.reload(); });
$('#search').addEventListener('input', () => renderSeries(data.workspace.series));
$$('.nav').forEach(button => button.addEventListener('click', async () => { $$('.nav').forEach(b => b.classList.toggle('active', b === button)); $$('.view').forEach(v => { v.hidden = v.id !== `view-${button.dataset.view}`; }); if(button.dataset.view==='team') await loadMembers(); if(button.dataset.view==='sources') await loadSources(); if(button.dataset.view==='audit') await loadAudit(); }));
$('#import-open').addEventListener('click', () => $('#import-dialog').showModal());
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#decision-form').action.addEventListener('change', () => renderTarget(data.workspace.series.find(i => i.id === $('#decision-form').seriesId.value)));
$('#decision-form').addEventListener('submit', async event => { event.preventDefault(); const values=formData(event.target); const id=values.seriesId; delete values.seriesId; ['targetDuration','targetOccurrences','targetAttendees'].forEach(k=>{if(values[k])values[k]=Number(values[k]);}); try{await request(`/api/series/${id}/decision`,{method:'PATCH',body:JSON.stringify(values)}); $('#decision-dialog').close(); toast('Decision saved and logged.'); await refresh();}catch(e){toast(e.message,true);} });
$('#import-form').addEventListener('submit', async event => { event.preventDefault(); const values=formData(event.target); const file=event.target.file.files[0]; try { const text=await file.text(); const payload=values.provider==='csv'?text:JSON.parse(text); const result=await request('/api/import',{method:'POST',body:JSON.stringify({provider:values.provider,mode:values.mode,measuredAt:values.measuredAt,payload})}); $('#import-dialog').close(); toast(result.summary ? `Verification complete: ${result.summary.matched} matched.` : `${result.imported} series imported.`); await refresh(); } catch(e){toast(e.message,true);} });
$('#member-invite').addEventListener('submit', async event => { event.preventDefault(); try { const {inviteUrl}=await request('/api/invites',{method:'POST',body:JSON.stringify(formData(event.target))}); const result=$('#invite-result'); result.hidden=false; result.textContent=inviteUrl; await navigator.clipboard?.writeText(inviteUrl); toast('Invite link generated.'); }catch(e){toast(e.message,true);} });
boot().catch(error => toast(error.message, true));
