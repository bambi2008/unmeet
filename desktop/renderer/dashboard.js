// UnMeet Desktop — Dashboard Renderer

let settings = { hourlyRate: 75, currency: '$' };
const PLATFORM_COLORS = {
  'Zoom': '#2D8CFF', 'Google Meet': '#34A853', 'Microsoft Teams': '#6264A7',
  'Tencent Meeting': '#1890FF', 'VooV Meeting': '#1890FF',
  'Feishu': '#3370FF', 'Webex': '#00A652', 'RingCentral': '#FF8800',
  'Whereby': '#6C47FF', 'Slack Call': '#4A154B', 'Discord': '#5865F2',
};

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  settings = await window.unmeet.getSettings();

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Settings page
  document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
  document.getElementById('export-btn')?.addEventListener('click', exportData);
  document.getElementById('clear-btn')?.addEventListener('click', clearData);

  // Listen for navigation from main process
  window.unmeet.onNavigate((section) => navigate(section));

  // Start polling state
  startPolling();
});

// ── Navigation ──
function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  ['dashboard', 'insights', 'team', 'meetings', 'settings'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle('hidden', p !== page);
  });

  if (page === 'meetings') renderAllMeetings();
  if (page === 'insights') renderInsights();
  if (page === 'team') renderTeam();
  if (page === 'analysis') renderAnalysis();
  if (page === 'settings') loadSettingsForm();
}

// ── Polling ──
function startPolling() {
  window.unmeet.onStateUpdate((state) => {
    if (!state) return;
    updateLiveBanner(state);
    updateStats(state);
    renderRecentMeetings();
    updateSidebarStatus(state);
  });
  // Initial load
  window.unmeet.getState().then(state => {
    if (state) {
      updateLiveBanner(state);
      updateStats(state);
    }
  });
  window.unmeet.getLog().then(log => {
    if (log) renderRecentMeetings(log);
  });
}

// ── Live banner ──
function updateLiveBanner(state) {
  const banner = document.getElementById('live-banner');
  const dot = document.getElementById('live-dot');
  const title = document.getElementById('live-title');
  const subtitle = document.getElementById('live-subtitle');
  const cost = document.getElementById('live-cost');

  if (state.inMeeting) {
    banner.className = 'live-banner active';
    dot.className = 'live-dot on';
    title.textContent = `In a meeting — ${state.currentPlatform}`;
    const mins = state.currentDuration;
    subtitle.textContent = `${Math.floor(mins/60)}h ${mins%60}m elapsed`;
    const estCost = ((mins / 60) * settings.hourlyRate).toFixed(2);
    cost.textContent = `${settings.currency}${estCost}`;
  } else {
    banner.className = 'live-banner idle';
    dot.className = 'live-dot off';
    title.textContent = 'No meeting';
    subtitle.textContent = 'Tracking across all apps';
    cost.textContent = '';
  }
}

// ── Stats ──
function updateStats(state) {
  document.getElementById('stat-week').textContent = `${state.thisWeek?.hours || 0}h`;
  document.getElementById('stat-count').textContent = state.thisWeek?.count || 0;
  const estCost = ((state.thisWeek?.minutes || 0) / 60) * settings.hourlyRate;
  document.getElementById('stat-cost').textContent = `${settings.currency}${Math.round(estCost)}`;

  // Today
  const todayStr = new Date().toISOString().split('T')[0];
  window.unmeet.getLog().then(log => {
    const today = (log || []).filter(m => m.date === todayStr);
    const mins = today.reduce((s, m) => s + (m.duration || 0), 0);
    document.getElementById('stat-today').textContent = mins >= 60 ? `${(mins/60).toFixed(1)}h` : `${mins}m`;
  });
}

// ── Recent meetings (dashboard) ──
function renderRecentMeetings(log) {
  if (!log) return;
  const tbody = document.getElementById('recent-meetings');
  if (!tbody) return;
  const recent = log.slice(0, 10);

  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim);text-align:center;padding:32px;">No meetings tracked yet</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map(m => {
    const time = new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dur = m.duration >= 60 ? `${Math.floor(m.duration/60)}h ${m.duration%60}m` : `${m.duration}m`;
    const cost = ((m.duration / 60) * settings.hourlyRate).toFixed(0);
    const color = PLATFORM_COLORS[m.platform] || '#5C5F6B';
    const temp_unused = m.rating != null ? '★'.repeat(m.rating) + '☆'.repeat(5-m.rating) : '—';
    return `<tr>
      <td><span class="platform-badge" style="background:${color}20;color:${color}">${escapeHtml(m.platform)}</span></td>
      <td style="color:var(--text-dim);">${time}</td>
      <td>${dur}</td>
      <td>${stars}</td>
    </tr>`;
  }).join('');
}

// ── All meetings page ──
function renderAllMeetings() {
  window.unmeet.getLog().then(log => {
    const tbody = document.getElementById('all-meetings');
    if (!tbody) return;
    if (!log || log.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-dim);text-align:center;padding:32px;">No meetings tracked yet</td></tr>';
      return;
    }
    tbody.innerHTML = log.map(m => {
      const date = m.date;
      const time = new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dur = m.duration >= 60 ? `${Math.floor(m.duration/60)}h ${m.duration%60}m` : `${m.duration}m`;
      const cost = `${settings.currency}${((m.duration / 60) * settings.hourlyRate).toFixed(2)}`;
      const temp_unused = m.rating != null ? '★'.repeat(m.rating) + '☆'.repeat(5-m.rating) : '—';
      return `<tr>
        <td style="color:var(--text-dim);">${date}</td>
        <td>${escapeHtml(m.platform)}</td>
        <td style="color:var(--text-dim);">${time}</td>
        <td>${dur}</td>
        <td style="color:var(--red);">${cost}</td>
        <td>${stars}</td>
      </tr>`;
    }).join('');
  });
}

// ── Settings ──
function loadSettingsForm() {
  document.getElementById('setting-rate').value = settings.hourlyRate;
  document.getElementById('setting-currency').value = settings.currency;
  loadCalendarStatus();
}

async function saveSettings() {
  settings.hourlyRate = parseInt(document.getElementById('setting-rate').value) || 75;
  settings.currency = document.getElementById('setting-currency').value || '$';
  await window.unmeet.saveSettings(settings);
  const msg = document.getElementById('settings-saved');
  msg.style.opacity = '1';
  setTimeout(() => msg.style.opacity = '0', 2000);
}

async function exportData() {
  const data = await window.unmeet.exportData();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unmeet-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearData() {
  if (confirm('Delete all meeting data? This cannot be undone.')) {
    await window.unmeet.clearData();
    location.reload();
  }
}

// ── Sidebar status ──
function updateSidebarStatus(state) {
  const el = document.getElementById('sidebar-status');
  if (state.inMeeting) {
    el.innerHTML = `🟢 In ${state.currentPlatform}`;
  } else {
    el.innerHTML = '⚪ No meeting';
  }
}


async function rateMeetingAction(id, rating) {
  await window.unmeet.rateMeeting(id, rating);
  renderRecentMeetings();
  renderAllMeetings();
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Insights page ──
async function renderInsights() {
  const insights = await window.unmeet.getInsights();
  if (!insights || !insights.fingerprint) {
    document.getElementById('health-score-section').innerHTML =
      '<div style="color:var(--text-dim);text-align:center;padding:48px;">Track at least 5 meetings to unlock insights.</div>';
    return;
  }

  const fp = insights.fingerprint;
  const hs = insights.healthScore;
  const hl = insights.healthLabel;

  // Health badge
  const badge = document.getElementById('health-badge');
  if (badge) {
    badge.textContent = hs != null ? `${hl} · ${hs}/100` : '—';
    badge.style.background = hs >= 70 ? 'rgba(16,185,129,0.1)' : hs >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)';
    badge.style.color = hs >= 70 ? '#10B981' : hs >= 40 ? '#F59E0B' : '#EF4444';
  }

  // Health score bar
  const scoreBar = document.getElementById('health-score-section');
  const scoreColor = hs >= 70 ? '#10B981' : hs >= 40 ? '#F59E0B' : '#EF4444';
  scoreBar.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#fff;font-weight:600;">Meeting Health Score</span>
        <span style="color:${scoreColor};font-weight:700;font-size:24px;">${hs}/100</span>
      </div>
      <div style="background:var(--bg);border-radius:8px;height:12px;overflow:hidden;">
        <div style="width:${hs}%;height:100%;background:${scoreColor};border-radius:8px;transition:width 0.5s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text-dim);">
        <span>🔴 Critical</span><span>🟡 Needs Work</span><span>🟢 Healthy</span>
      </div>
    </div>`;

  // Fingerprint cards
  const cards = document.getElementById('fingerprint-cards');
  cards.innerHTML = `
    <div class="stat-card">
      <div class="icon">📊</div>
      <div class="value">${fp.totalMeetings}</div>
      <div class="label">Total Meetings (30d)</div>
    </div>
    <div class="stat-card">
      <div class="icon">⏱️</div>
      <div class="value">${fp.totalHours}h</div>
      <div class="label">Total Hours</div>
    </div>
    <div class="stat-card">
      <div class="icon">📏</div>
      <div class="value">${fp.avgDuration}m</div>
      <div class="label">Avg Duration</div>
    </div>
    <div class="stat-card">
      <div class="icon">⭐</div>
      <div class="value">${fp.avgRating || '—'}</div>
      <div class="label">Avg Rating</div>
    </div>
    <div class="stat-card">
      <div class="icon">🔝</div>
      <div class="value">${fp.topTypes[0]?.label || '—'}</div>
      <div class="label">Top Meeting Type</div>
    </div>
    <div class="stat-card">
      <div class="icon">📅</div>
      <div class="value">${fp.peakDayName}</div>
      <div class="label">Busiest Day</div>
    </div>
    <div class="stat-card">
      <div class="icon">🕐</div>
      <div class="value">${fp.peakHour}:00</div>
      <div class="label">Peak Hour</div>
    </div>
    <div class="stat-card">
      <div class="icon">🧩</div>
      <div class="value">${fp.fragmentationScore}</div>
      <div class="label">Fragmentation</div>
    </div>`;

  // Personal insights
  const piEl = document.getElementById('personal-insights');
  if (fp.insights && fp.insights.length > 0) {
    piEl.innerHTML = fp.insights.map(i => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;">${i.icon}</span>
        <div>
          <div style="color:#fff;font-weight:600;font-size:12px;text-transform:uppercase;margin-bottom:4px;color:${
            i.severity==='critical'?'#EF4444':i.severity==='warning'?'#F59E0B':'#3B82F6'
          }">${i.severity}</div>
          <div style="color:var(--text);">${i.text}</div>
        </div>
      </div>
    `).join('');
  } else {
    piEl.innerHTML = '<div style="color:var(--text-dim);padding:16px;">Looking good! No major issues detected.</div>';
  }

  // Recurring meetings
  const rt = document.getElementById('recurring-table');
  if (insights.recurring && insights.recurring.length > 0) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    rt.innerHTML = insights.recurring.slice(0, 10).map(r => `
      <tr>
        <td style="color:#fff;">${days[r.day]} ${r.timeBlock}</td>
        <td>${r.count}x</td>
        <td>${r.avgDuration}m</td>
        <td>${r.avgRating ? r.avgRating+'/5' : '—'}</td>
        <td><span style="color:${MEETING_TYPE_COLORS[r.type]||'var(--text-dim)'};">${r.type}</span></td>
        <td style="font-size:11px;color:${r.suggestion?'var(--amber)':'var(--text-dim)'};">${r.suggestion || '—'}</td>
      </tr>
    `).join('');
  }

  // Weekly trend chart
  const wt = document.getElementById('weekly-trend');
  if (insights.trend && insights.trend.length > 0) {
    const maxH = Math.max(...insights.trend.map(t => t.hours), 1);
    wt.innerHTML = insights.trend.map(t => {
      const h = Math.round(t.hours / maxH * 120);
      const color = t.hours > 15 ? '#EF4444' : t.hours > 10 ? '#F59E0B' : '#10B981';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
        <span style="font-size:10px;color:var(--text-dim);">${t.hours}h</span>
        <div style="width:100%;max-width:60px;height:${Math.max(h,4)}px;background:${color};border-radius:6px 6px 0 0;min-height:4px;"></div>
        <span style="font-size:10px;color:var(--text-dim);">${t.week.slice(5)}</span>
      </div>`;
    }).join('');
  }
}

const MEETING_TYPE_COLORS = {
  standup: '#10B981', one_on_one: '#3B82F6', decision: '#F59E0B',
  broadcast: '#8B5CF6', workshop: '#EC4899', social: '#F97316',
  deep_work_block: '#06B6D4', unknown: '#5C5F6B',
};

// ── Team page ──
async function renderTeam() {
  const ws = await window.unmeet.getWorkspace();
  const stats = await window.unmeet.getTeamStats();

  // Setup event listeners
  document.getElementById('add-member-btn').onclick = addMember;
  document.getElementById('export-ws-btn').onclick = exportWorkspace;
  document.getElementById('import-btn').onclick = () => document.getElementById('import-file-input').click();
  document.getElementById('import-file-input').onchange = handleImport;

  // Populate import member select
  const sel = document.getElementById('import-member-select');
  sel.innerHTML = '<option value="">Select member...</option>' +
    ws.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

  // Render members table
  const tbody = document.getElementById('team-members-table');
  if (ws.members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-dim);text-align:center;padding:32px;">No members yet</td></tr>';
  } else {
    tbody.innerHTML = ws.members.map(m => {
      const ms = stats?.members?.find(s => s.id === m.id);
      return `<tr>
        <td style="color:#fff;">${escapeHtml(m.name)}</td>
        <td><span style="color:${m.role==='owner'?'var(--accent)':'var(--text-dim)'};">${m.role}</span></td>
        <td>$${m.hourlyRate}/h</td>
        <td>${ms ? ms.thisWeek.hours+'h' : '—'}</td>
        <td style="color:var(--red);">${ms ? '$'+ms.thisWeek.cost : '—'}</td>
        <td>${ms?.avgRating ? ms.avgRating+'/5' : '—'}</td>
        <td>
          ${m.role !== 'owner' ? `<button class="btn-danger" style="font-size:11px;padding:4px 8px;margin:0;" onclick="removeMember('${m.id}')">Remove</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  // Team stats cards
  const cards = document.getElementById('team-stats-cards');
  if (stats) {
    cards.innerHTML = `
      <div class="stat-card">
        <div class="icon">👥</div>
        <div class="value">${stats.membersWithData}/${stats.totalMembers}</div>
        <div class="label">Active Members</div>
      </div>
      <div class="stat-card">
        <div class="icon">⏱️</div>
        <div class="value">${stats.thisWeek.totalHours}h</div>
        <div class="label">Team Hours (Week)</div>
      </div>
      <div class="stat-card">
        <div class="icon">📊</div>
        <div class="value">${stats.thisWeek.totalMeetings}</div>
        <div class="label">Team Meetings (Week)</div>
      </div>
      <div class="stat-card">
        <div class="icon">💸</div>
        <div class="value">$${stats.thisWeek.totalCost.toLocaleString()}</div>
        <div class="label">Team Cost (Week)</div>
      </div>
      <div class="stat-card">
        <div class="icon">📏</div>
        <div class="value">${stats.avgHoursPerPerson}h</div>
        <div class="label">Avg Per Person</div>
      </div>
      <div class="stat-card">
        <div class="icon">📅</div>
        <div class="value">$${Math.round(stats.thisWeek.totalCost*52/1000)}k</div>
        <div class="label">Est. Annual Cost</div>
      </div>`;
  } else {
    cards.innerHTML = '<div style="grid-column:1/-1;color:var(--text-dim);text-align:center;padding:32px;">Import member data to see team stats.</div>';
  }

  // Team insights
  const ti = document.getElementById('team-insights');
  if (stats?.insights?.length > 0) {
    ti.innerHTML = stats.insights.map(i => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;">
        <span style="font-size:20px;">${i.icon}</span>
        <div>
          <div style="color:#fff;font-weight:600;font-size:12px;text-transform:uppercase;margin-bottom:4px;color:${
            i.severity==='critical'?'#EF4444':i.severity==='warning'?'#F59E0B':'#3B82F6'
          }">${i.severity}</div>
          <div style="color:var(--text);">${i.text}</div>
        </div>
      </div>
    `).join('');
  } else {
    ti.innerHTML = '';
  }

  // Expose removeMember to onclick
  window._removeMember = removeMember;
}

async function addMember() {
  const name = document.getElementById('new-member-name').value.trim();
  const rate = parseInt(document.getElementById('new-member-rate').value) || 75;
  if (!name) return;
  await window.unmeet.addMember(name, rate);
  document.getElementById('new-member-name').value = '';
  renderTeam();
}

async function removeMember(id) {
  if (!confirm('Remove this member?')) return;
  await window.unmeet.removeMember(id);
  renderTeam();
}

async function exportWorkspace() {
  const data = await window.unmeet.exportWorkspace();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unmeet-workspace-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const memberId = document.getElementById('import-member-select').value;
    if (!memberId) { alert('Select a member first'); return; }
    await window.unmeet.importMemberData(memberId, ev.target.result);
    renderTeam();
  };
  reader.readAsText(file);
}

// ── Analysis page ──
async function renderAnalysis() {
  const log = await window.unmeet.getLog();
  const sel = document.getElementById('analysis-meeting-select');
  sel.innerHTML = '<option value="">Select a meeting to analyze...</option>' +
    (log || []).map(m => {
      const d = new Date(m.startTime);
      const t = d.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<option value="${m.id}">${t} — ${m.platform} (${m.duration}m)</option>`;
    }).join('');

  document.getElementById('load-analysis-btn').onclick = async () => {
    const id = sel.value;
    if (!id) return;
    const analysis = await window.unmeet.getMeetingAnalysis(id);
    const content = document.getElementById('analysis-content');
    if (!analysis || analysis.error) {
      content.innerHTML = '<div style="color:var(--text-dim);padding:32px;text-align:center;">No analysis available for this meeting. Analysis is generated when audio recording is enabled.</div>';
      return;
    }
    content.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="color:#fff;font-weight:600;font-size:16px;margin-bottom:12px;">Summary</div>
        <div style="color:var(--text);line-height:1.6;">${escapeHtml(analysis.summary || 'No summary generated.')}</div>
        ${analysis.effectivenessScore ? `<div style="margin-top:12px;display:flex;gap:16px;">
          <span style="color:${analysis.effectivenessScore>=7?'var(--green)':analysis.effectivenessScore>=4?'var(--amber)':'var(--red)'};font-weight:600;">Effectiveness: ${analysis.effectivenessScore}/10</span>
          ${analysis.wastedTimePct ? `<span style="color:var(--red);">Wasted: ${analysis.wastedTimePct}% of time</span>` : ''}
          ${analysis.shouldHaveBeenEmail ? '<span style="color:var(--amber);">⚠ Should have been an email</span>' : ''}
        </div>` : ''}
      </div>
      ${analysis.decisions?.length ? `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="color:#fff;font-weight:600;font-size:14px;margin-bottom:8px;">Decisions</div>
        ${analysis.decisions.map(d => `<div style="color:var(--text);padding:4px 0;">• ${escapeHtml(d)}</div>`).join('')}
      </div>` : ''}
      ${analysis.actionItems?.length ? `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="color:#fff;font-weight:600;font-size:14px;margin-bottom:8px;">Action Items</div>
        ${analysis.actionItems.map(a => `<div style="color:var(--text);padding:4px 0;">• ${escapeHtml(a.task || a)} ${a.assignee ? '@'+escapeHtml(a.assignee) : ''} ${a.deadline ? 'by '+a.deadline : ''}</div>`).join('')}
      </div>` : ''}
      ${analysis.participation ? `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="color:#fff;font-weight:600;font-size:14px;margin-bottom:12px;">Participation</div>
        <div style="color:var(--text-dim);margin-bottom:8px;">${analysis.participation.totalSpeakers} speakers · ${analysis.participation.meetingFlow || 'N/A'} flow</div>
        ${analysis.participation.dominatedByFew ? '<div style="color:var(--amber);margin-bottom:8px;">⚠ Dominated by a few speakers</div>' : ''}
        ${(analysis.participation.speakers||[]).map(s => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="color:#fff;width:80px;">${escapeHtml(s.label)}</span>
            <div style="flex:1;background:var(--bg);border-radius:4px;height:20px;">
              <div style="width:${s.talkTimePct}%;height:100%;background:var(--accent);border-radius:4px;min-width:2px;"></div>
            </div>
            <span style="color:var(--text-dim);width:40px;text-align:right;font-size:11px;">${s.talkTimePct}%</span>
          </div>
        `).join('')}
        ${analysis.participation.silentParticipants?.length ? `<div style="color:var(--red);margin-top:8px;font-size:12px;">Silent: ${analysis.participation.silentParticipants.join(', ')}</div>` : ''}
      </div>` : ''}
    `;
  };
}

// ── Calendar (in Settings) ──
async function loadCalendarStatus() {
  const status = await window.unmeet.getCalendarStatus();
  const btn = document.getElementById('connect-calendar-btn');
  const st = document.getElementById('calendar-status');
  if (status.connected) {
    btn.textContent = 'Disconnect Calendar';
    btn.onclick = async () => { await window.unmeet.disconnectCalendar(); loadCalendarStatus(); };
    st.textContent = '✓ Connected';
    st.style.color = 'var(--green)';
  } else {
    btn.textContent = 'Connect Google Calendar';
    btn.onclick = async () => { await window.unmeet.connectCalendar(); loadCalendarStatus(); };
    st.textContent = 'Not connected';
    st.style.color = 'var(--text-dim)';
  }
}
