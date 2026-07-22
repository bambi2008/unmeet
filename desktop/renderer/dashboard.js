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
  ['dashboard', 'meetings', 'settings'].forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle('hidden', p !== page);
  });

  if (page === 'meetings') renderAllMeetings();
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
    const stars = m.rating != null ? '★'.repeat(m.rating) + '☆'.repeat(5-m.rating) : '—';
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
      const stars = m.rating != null ? '★'.repeat(m.rating) + '☆'.repeat(5-m.rating) : '—';
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

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
