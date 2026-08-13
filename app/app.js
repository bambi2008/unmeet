const Core = window.UnMeetCore;
const STORAGE_KEY = 'unmeet-local-tool-v2';
const LEGACY_STORAGE_KEY = 'unmeet-commercial-mvp-v1';
let workspace = loadWorkspace();
let currentView = 'portfolio';
let activeSeriesId = null;
let importMode = 'baseline';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadWorkspace() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return clone(window.UNMEET_SAMPLE);
}
function saveWorkspace() { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
function emptyWorkspace() { return { name: 'New Meeting Reset', coverage: 0, people: 0, hourlyRate: 75, period: 'No baseline imported', createdAt: new Date().toISOString(), series: [] }; }
function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value); }
function hours(value) { return `${Core.round(value, 1).toLocaleString()}h`; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
function statusLabel(status) { return ({ review: 'Needs review', decided: 'Decided', verified: 'Verified', backlog: 'Backlog' })[status] || status; }
function formatDate(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'; }

function render() {
  renderHeader();
  renderPortfolio();
  renderReviews();
  renderResults();
  renderSetup();
}

function renderHeader() {
  const titles = { portfolio: 'Meeting portfolio', reviews: 'Owner reviews', results: 'Verified results', setup: 'Data & privacy' };
  document.getElementById('page-title').textContent = titles[currentView];
  document.getElementById('period-label').textContent = workspace.period || 'Current 30-day baseline';
  document.querySelector('.workspace-chip strong').textContent = workspace.name.split(' ')[0];
}

function summaryCard(label, value, note, featured = false) {
  return `<article class="summary-card${featured ? ' featured' : ''}"><span class="summary-label">${escapeHtml(label)}</span><strong class="summary-value">${escapeHtml(value)}</strong><span class="summary-note">${escapeHtml(note)}</span></article>`;
}

function renderPortfolio() {
  const metrics = Core.workspaceMetrics(workspace);
  document.getElementById('summary-grid').innerHTML = [
    summaryCard('Monthly meeting load', hours(metrics.baselineHours), `${money(metrics.baselineCost)} blended cost`),
    summaryCard('Series reviewed', `${metrics.reviewed}/${metrics.total}`, `${Math.round(metrics.reviewed / Math.max(metrics.total, 1) * 100)}% of portfolio`),
    summaryCard('Planned recovery', hours(metrics.plannedSavings), `${money(metrics.plannedSavingsCost)} per month`),
    summaryCard('Verified recovery', hours(metrics.verifiedSavings), `${money(metrics.verifiedSavingsCost)} observed in calendar`, true),
  ].join('');

  document.getElementById('progress-panel').innerHTML = `<div class="progress-copy"><strong>Reset progress</strong><span>${metrics.verified} changes verified</span></div><div class="steps"><div class="step done">Baseline</div><span class="step-line"></span><div class="step ${metrics.reviewed ? 'done' : ''}">Select</div><span class="step-line"></span><div class="step ${metrics.decided ? 'done' : ''}">Decide</div><span class="step-line"></span><div class="step ${metrics.verified ? 'done' : ''}">Verify</div></div>`;
  renderPortfolioRows();
}

function renderPortfolioRows() {
  const search = document.getElementById('search-input')?.value?.trim().toLowerCase() || '';
  const filter = document.getElementById('status-filter')?.value || 'all';
  const rows = workspace.series
    .filter(item => !search || `${item.title} ${item.owner} ${item.team}`.toLowerCase().includes(search))
    .filter(item => filter === 'all' || Core.reviewStatus(item) === filter)
    .sort((a, b) => Core.monthlyPersonHours(b) - Core.monthlyPersonHours(a));
  const body = document.getElementById('portfolio-body');
  if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="empty-state">No meeting series match this filter.</td></tr>'; return; }
  body.innerHTML = rows.map(item => {
    const status = Core.reviewStatus(item);
    const rec = Core.recommendation(item);
    const decided = item.decision ? Core.ACTIONS[item.decision.action].label : rec.text;
    const reasons = Core.opportunityReasons(item).slice(0, 3).join(' · ');
    return `<tr><td class="meeting-cell"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.team)} · ${item.durationMinutes} min × ${item.attendeeCount} people × ${item.occurrencesPerMonth}/mo</small></td><td><span class="load-value">${hours(Core.monthlyPersonHours(item))}<small>${money(Core.seriesCost(item, workspace.hourlyRate))}/mo</small></span></td><td>${escapeHtml(item.owner)}</td><td><span class="status ${status}">${statusLabel(status)}</span></td><td class="opportunity"><strong>${escapeHtml(decided)}</strong><small>${escapeHtml(reasons)}</small></td><td><button class="row-button" data-review-id="${escapeHtml(item.id)}">${item.decision ? 'Edit' : 'Review'}</button></td></tr>`;
  }).join('');
}

function renderReviews() {
  const metrics = Core.workspaceMetrics(workspace);
  document.getElementById('decision-rate').innerHTML = `<strong>${metrics.changeRate}%</strong><span>of decisions change a meeting</span>`;
  const groups = [
    { key: 'review', title: 'Needs decision', items: workspace.series.filter(i => Core.reviewStatus(i) === 'review') },
    { key: 'decided', title: 'Waiting to verify', items: workspace.series.filter(i => Core.reviewStatus(i) === 'decided') },
    { key: 'verified', title: 'Verified', items: workspace.series.filter(i => Core.reviewStatus(i) === 'verified') },
  ];
  document.getElementById('review-board').innerHTML = groups.map(group => `<section class="review-column"><div class="review-column-head"><strong>${group.title}</strong><span>${group.items.length}</span></div>${group.items.length ? group.items.map(reviewCard).join('') : '<div class="empty-state">Nothing here yet.</div>'}</section>`).join('');
}

function reviewCard(item) {
  const action = item.decision ? Core.ACTIONS[item.decision.action].label : Core.recommendation(item).text;
  const note = item.decision ? `Review ${formatDate(item.decision.reviewDate)}` : `${hours(Core.monthlyPersonHours(item))} per month`;
  const saved = item.actual ? Core.savings(item, 'actual') : item.decision ? Core.savings(item, 'planned') : 0;
  return `<article class="review-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.owner)} · ${escapeHtml(action)} · ${escapeHtml(note)}</p><div class="review-card-foot"><strong>${saved ? `${hours(saved)} ${item.actual ? 'verified' : 'planned'}` : 'Owner decision needed'}</strong><button class="row-button" data-review-id="${escapeHtml(item.id)}">Open</button></div></article>`;
}

function renderResults() {
  const metrics = Core.workspaceMetrics(workspace);
  const actualHours = metrics.currentHours;
  document.getElementById('results-summary').innerHTML = [
    summaryCard('Verified recovery', hours(metrics.verifiedSavings), metrics.increasedHours ? `${hours(metrics.increasedHours)} of growth reported separately` : `${money(metrics.verifiedSavingsCost)} per month`, true),
    summaryCard('Net annualized change', hours(metrics.verifiedNetChange * 12), `${money(metrics.verifiedNetChangeCost * 12)} net annualized`),
    summaryCard('Verified changes', `${metrics.verified}`, `${metrics.decided - metrics.verified} waiting for evidence`),
    summaryCard('Portfolio change rate', `${metrics.changeRate}%`, 'of owner decisions changed a meeting'),
  ].join('');
  const max = Math.max(metrics.baselineHours, actualHours, 1);
  document.getElementById('comparison-chart').innerHTML = `<div class="bar-row"><label>Baseline</label><div class="bar-track"><span class="bar-fill" style="width:${metrics.baselineHours / max * 100}%"></span></div><strong>${hours(metrics.baselineHours)}</strong></div><div class="bar-row"><label>Current</label><div class="bar-track"><span class="bar-fill current" style="width:${actualHours / max * 100}%"></span></div><strong>${hours(actualHours)}</strong></div><p class="muted">Current reflects all matched follow-up values. ${metrics.increasedHours ? `${hours(metrics.increasedHours)} of increased meeting load is included.` : 'No increased meeting load was observed.'} Planned changes are excluded.</p>`;
  const verified = workspace.series.filter(item => item.actual && item.decision);
  document.getElementById('verified-body').innerHTML = verified.length ? verified.map(item => {
    const delta = Core.round(Core.monthlyPersonHours(item) - Core.monthlyPersonHours(item, 'actual'), 1);
    const result = delta >= 0 ? `${hours(delta)} · ${money(delta * workspace.hourlyRate)}` : `+${hours(Math.abs(delta))} · +${money(Math.abs(delta) * workspace.hourlyRate)}`;
    return `<tr><td class="meeting-cell"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.owner)} · ${escapeHtml(item.actual.confidence || 'existing')} confidence</small></td><td>${escapeHtml(Core.ACTIONS[item.decision.action].label)}</td><td>${hours(Core.monthlyPersonHours(item))}</td><td>${hours(Core.monthlyPersonHours(item, 'actual'))}</td><td class="${delta >= 0 ? 'positive' : 'negative'}">${result}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-state">No changes have been verified yet. Import a follow-up period after decisions take effect.</td></tr>';
  const verification = workspace.lastVerification;
  document.getElementById('verification-summary').innerHTML = verification ? `<div class="verification-banner"><strong>Follow-up imported ${escapeHtml(formatDate(verification.measuredAt))}</strong><span>${verification.matched} matched · ${verification.verifiedAbsent} expected absences · ${verification.missing} missing · ${verification.ambiguous} ambiguous · ${verification.unmatchedFollowup} new/unmatched</span></div>` : '';
}

function renderSetup() {
  document.getElementById('coverage-value').textContent = `${workspace.coverage || 0}%`;
  document.getElementById('coverage-meter').style.width = `${Math.min(workspace.coverage || 0, 100)}%`;
  document.getElementById('hourly-rate').value = workspace.hourlyRate;
  document.getElementById('workspace-name').value = workspace.name;
  document.getElementById('followup-status').textContent = workspace.followup ? `Last follow-up: ${formatDate(workspace.followup.measuredAt)} · ${workspace.followup.rowCount} rows` : 'No follow-up period imported.';
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
  renderHeader();
}

function openDecision(id) {
  const item = workspace.series.find(series => series.id === id);
  if (!item) return;
  activeSeriesId = id;
  document.getElementById('decision-series-id').value = id;
  document.getElementById('decision-title').textContent = item.title;
  document.getElementById('decision-baseline').innerHTML = `<div><span>Duration</span><strong>${item.durationMinutes} min</strong></div><div><span>Attendees</span><strong>${item.attendeeCount}</strong></div><div><span>Cadence</span><strong>${item.occurrencesPerMonth}/month</strong></div><div><span>Monthly load</span><strong>${hours(Core.monthlyPersonHours(item))}</strong></div>`;
  document.getElementById('action-grid').innerHTML = Object.entries(Core.ACTIONS).map(([key, value]) => `<label class="action-option"><input type="radio" name="decision-action" value="${key}" ${item.decision?.action === key ? 'checked' : ''}><span>${value.label}</span></label>`).join('');
  document.getElementById('decision-owner').value = item.decision?.owner || item.owner;
  document.getElementById('effective-date').value = item.decision?.effectiveDate || dateOffset(7);
  document.getElementById('review-date').value = item.decision?.reviewDate || dateOffset(37);
  document.getElementById('decision-note').value = item.decision?.note || '';
  document.getElementById('decision-error').textContent = '';
  const chosen = item.decision?.action || Core.recommendation(item).action;
  const radio = document.querySelector(`input[name="decision-action"][value="${chosen}"]`);
  if (radio) radio.checked = true;
  renderTargetField(item, chosen);
  document.getElementById('decision-modal').classList.remove('hidden');
}

function dateOffset(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }

function renderTargetField(item, action) {
  const target = document.getElementById('target-fields');
  if (action === 'shorten') target.innerHTML = `<label>Target duration (minutes)<input id="target-value" type="number" min="5" max="${Math.max(5, item.durationMinutes - 5)}" value="${item.decision?.targetDuration || Math.max(15, Math.round(item.durationMinutes / 2))}"></label>`;
  else if (action === 'reduce_frequency') target.innerHTML = `<label>Target occurrences per month<input id="target-value" type="number" min="1" max="${Math.max(1, item.occurrencesPerMonth - 1)}" value="${item.decision?.targetOccurrences || Math.max(1, Math.round(item.occurrencesPerMonth / 2))}"></label>`;
  else if (action === 'reduce_attendees') target.innerHTML = `<label>Target attendee count<input id="target-value" type="number" min="1" max="${Math.max(1, item.attendeeCount - 1)}" value="${item.decision?.targetAttendees || Math.max(2, Math.round(item.attendeeCount * .65))}"></label>`;
  else target.innerHTML = '';
  updateImpactPreview();
}

function decisionFromForm() {
  const action = document.querySelector('input[name="decision-action"]:checked')?.value;
  const target = Number(document.getElementById('target-value')?.value);
  const decision = { action, owner: document.getElementById('decision-owner').value.trim(), effectiveDate: document.getElementById('effective-date').value, reviewDate: document.getElementById('review-date').value, note: document.getElementById('decision-note').value.trim() };
  if (action === 'shorten') decision.targetDuration = target;
  if (action === 'reduce_frequency') decision.targetOccurrences = target;
  if (action === 'reduce_attendees') decision.targetAttendees = target;
  return decision;
}

function updateImpactPreview() {
  const item = workspace.series.find(series => series.id === activeSeriesId);
  if (!item) return;
  const original = item.decision;
  item.decision = decisionFromForm();
  const saved = Core.savings(item, 'planned');
  item.decision = original;
  document.getElementById('impact-preview').innerHTML = `<span>Planned monthly recovery</span><strong>${hours(saved)} · ${money(saved * workspace.hourlyRate)}</strong>`;
}

function closeDecision() { document.getElementById('decision-modal').classList.add('hidden'); activeSeriesId = null; }
function openImport(mode = 'baseline') {
  importMode = mode;
  document.getElementById('import-error').textContent = '';
  document.getElementById('csv-file').value = '';
  document.getElementById('import-title').textContent = mode === 'followup' ? 'Import follow-up CSV' : 'Import baseline CSV';
  document.getElementById('import-eyebrow').textContent = mode === 'followup' ? 'Verification period' : 'Starting portfolio';
  document.getElementById('import-help').innerHTML = mode === 'followup'
    ? 'Use the same columns as the baseline. Series are matched by normalized <code>title</code> and <code>owner</code>; ambiguous matches are never guessed.'
    : 'Required columns: <code>title</code>, <code>owner</code>, <code>duration_minutes</code>, <code>attendee_count</code>, and <code>occurrences_per_month</code>.';
  document.getElementById('import-period-label').childNodes[0].textContent = mode === 'followup' ? 'Follow-up period end date' : 'Baseline period label';
  const periodInput = document.getElementById('import-period');
  periodInput.type = mode === 'followup' ? 'date' : 'text';
  periodInput.value = mode === 'followup' ? new Date().toISOString().slice(0, 10) : '';
  periodInput.placeholder = mode === 'followup' ? '' : 'Jul 1 – Jul 31, 2026';
  document.getElementById('import-modal').classList.remove('hidden');
}
function closeImport() { document.getElementById('import-modal').classList.add('hidden'); }

function submitDecision(event) {
  event.preventDefault();
  const item = workspace.series.find(series => series.id === activeSeriesId);
  const decision = decisionFromForm();
  const errors = Core.validateDecision(item, decision);
  if (errors.length) { document.getElementById('decision-error').textContent = errors.join(' '); return; }
  item.decision = decision;
  item.reviewStatus = 'review';
  if (item.actual) delete item.actual;
  saveWorkspace();
  closeDecision();
  render();
  toast('Decision saved. It will count as planned until calendar data verifies the change.');
}

function importCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const rows = Core.parseCSV(reader.result);
    if (!rows.length) { document.getElementById('import-error').textContent = 'No valid meeting rows found. Check the template and try again.'; return; }
    if (importMode === 'followup') {
      if (!workspace.series.length) { document.getElementById('import-error').textContent = 'Import a baseline before importing a follow-up period.'; return; }
      const measuredAt = document.getElementById('import-period').value || new Date().toISOString().slice(0, 10);
      const result = Core.applyFollowup(workspace, rows, measuredAt);
      workspace = result.workspace;
      workspace.lastVerification = result.summary;
      workspace.lastVerification.measuredAt = workspace.followup.measuredAt;
      saveWorkspace(); closeImport(); render(); navigate('results');
      toast(`Follow-up complete: ${result.summary.matched + result.summary.verifiedAbsent} series verified; ${result.summary.missing + result.summary.ambiguous} need review.`);
    } else {
      if (workspace.series.length && !confirm('Replace the current baseline and all of its decisions? Export the project first if you need a backup.')) return;
      const existingName = workspace.name;
      const period = document.getElementById('import-period').value.trim() || `Baseline imported ${new Date().toLocaleDateString()}`;
      workspace = { ...emptyWorkspace(), name: existingName || 'New Meeting Reset', coverage: workspace.coverage || 0, hourlyRate: workspace.hourlyRate || 75, period, series: rows, baselineImportedAt: new Date().toISOString() };
      saveWorkspace(); closeImport(); render(); navigate('portfolio');
      toast(`${rows.length} recurring meeting series imported as the baseline.`);
    }
  };
  reader.onerror = () => { document.getElementById('import-error').textContent = 'The file could not be read.'; };
  reader.readAsText(file);
}

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function exportReport() {
  const metrics = Core.workspaceMetrics(workspace);
  const report = { generatedAt: new Date().toISOString(), workspace: { name: workspace.name, period: workspace.period, coverage: workspace.coverage, hourlyRate: workspace.hourlyRate }, metrics, series: workspace.series.map(item => ({ ...item, baselinePersonHours: Core.monthlyPersonHours(item), plannedPersonHours: item.decision ? Core.monthlyPersonHours(item, 'planned') : null, actualPersonHours: item.actual ? Core.monthlyPersonHours(item, 'actual') : null })) };
  download(`unmeet-reset-report-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(report, null, 2), 'application/json');
  toast('Audit report exported.');
}

function exportProject() {
  const project = { ...workspace, format: 'unmeet-project', version: 2, exportedAt: new Date().toISOString() };
  download(`unmeet-project-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(project, null, 2), 'application/json');
  toast('Complete project file saved.');
}

function importProject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = JSON.parse(reader.result);
      const errors = Core.validateProject(project);
      if (errors.length) throw new Error(errors.join(' '));
      workspace = project;
      saveWorkspace(); render(); navigate('portfolio');
      toast(`Project “${workspace.name}” opened.`);
    } catch (error) { toast(`Project could not be opened: ${error.message}`); }
  };
  reader.readAsText(file);
}

function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 3200); }

document.addEventListener('DOMContentLoaded', () => {
  render();
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-open-import]').forEach(button => button.addEventListener('click', () => openImport(button.dataset.openImport || 'baseline')));
  document.querySelectorAll('[data-close-import]').forEach(button => button.addEventListener('click', closeImport));
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeDecision));
  document.getElementById('search-input').addEventListener('input', renderPortfolioRows);
  document.getElementById('status-filter').addEventListener('change', renderPortfolioRows);
  document.getElementById('decision-form').addEventListener('submit', submitDecision);
  document.getElementById('action-grid').addEventListener('change', event => { if (event.target.name === 'decision-action') renderTargetField(workspace.series.find(item => item.id === activeSeriesId), event.target.value); });
  document.getElementById('decision-form').addEventListener('input', updateImpactPreview);
  document.getElementById('csv-file').addEventListener('change', event => importCSV(event.target.files[0]));
  document.getElementById('export-report').addEventListener('click', exportReport);
  document.getElementById('print-report').addEventListener('click', () => { navigate('results'); setTimeout(() => window.print(), 50); });
  document.getElementById('export-project').addEventListener('click', exportProject);
  document.getElementById('export-project-setup').addEventListener('click', exportProject);
  document.getElementById('import-project').addEventListener('click', () => document.getElementById('project-file').click());
  document.getElementById('project-file').addEventListener('change', event => importProject(event.target.files[0]));
  document.getElementById('download-template').addEventListener('click', () => download('unmeet-calendar-template.csv', 'title,owner,team,duration_minutes,attendee_count,occurrences_per_month,has_agenda,age_months\nWeekly Product Sync,Maya Chen,Product,60,18,4,true,12\n'));
  document.getElementById('save-workspace').addEventListener('click', () => { workspace.hourlyRate = Number(document.getElementById('hourly-rate').value) || 75; workspace.name = document.getElementById('workspace-name').value.trim() || 'My Workspace'; saveWorkspace(); render(); toast('Workspace assumptions saved.'); });
  document.getElementById('load-sample').addEventListener('click', () => { if (confirm('Replace the current local workspace with the sample project? Export your project first if needed.')) { workspace = clone(window.UNMEET_SAMPLE); saveWorkspace(); render(); navigate('portfolio'); toast('Sample project loaded.'); } });
  document.getElementById('delete-workspace').addEventListener('click', () => { if (confirm('Permanently delete this workspace from this browser? Export it first if you need a backup.')) { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); workspace = emptyWorkspace(); saveWorkspace(); render(); navigate('setup'); toast('Local workspace deleted.'); } });
  document.addEventListener('click', event => { const button = event.target.closest('[data-review-id]'); if (button) openDecision(button.dataset.reviewId); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeDecision(); closeImport(); } });
});
