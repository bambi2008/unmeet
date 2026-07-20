// UnMeet Popup Script

let settings = { hourlyRate: 75 };

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refresh();
  // Poll every 5s while popup is open
  setInterval(refresh, 5000);
});

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ── Load settings ──
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
      if (res && res.settings) settings = res.settings;
      resolve();
    });
  });
}

// ── Refresh ──
async function refresh() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    if (!status) return;
    renderLive(status);
    renderStats(status.stats);
    renderMeetings(status.log || []);
  });
}

// ── Live indicator ──
function renderLive(status) {
  const bar = document.getElementById('live-bar');
  const dot = document.getElementById('live-dot');
  const label = document.getElementById('live-label');
  const platform = document.getElementById('live-platform');
  const timer = document.getElementById('live-timer');
  const cost = document.getElementById('live-cost');

  if (status.inMeeting && status.currentMeeting) {
    bar.className = 'live-bar active';
    dot.className = 'live-dot on';
    label.textContent = 'IN MEETING';
    platform.textContent = status.currentMeeting.platform;
    const mins = status.currentMeeting.duration;
    timer.textContent = `${Math.floor(mins/60)}h ${mins%60}m`;
    const estCost = ((mins / 60) * settings.hourlyRate).toFixed(0);
    cost.textContent = `$${estCost}`;
  } else {
    bar.className = 'live-bar idle';
    dot.className = 'live-dot off';
    label.textContent = 'No meeting';
    platform.textContent = '';
    timer.textContent = '';
    cost.textContent = '';
  }
}

// ── Stats ──
function renderStats(stats) {
  document.getElementById('stat-today-hours').textContent =
    formatHours(stats.thisWeek?.hours || (stats.thisWeek?.minutes || 0) / 60);
  document.getElementById('stat-week-hours').textContent =
    formatHours(stats.thisWeek?.hours || (stats.thisWeek?.minutes || 0) / 60);
  document.getElementById('stat-count').textContent = stats.thisWeek?.count || 0;
  document.getElementById('stat-rating').textContent =
    stats.avgRating != null ? `${stats.avgRating}/5` : '—';
}

// ── Meeting list ──
function renderMeetings(log) {
  const list = document.getElementById('meeting-list');
  if (!log || log.length === 0) {
    list.innerHTML = '<div class="empty-state">No meetings tracked yet.<br>Join a call to start.</div>';
    return;
  }
  list.innerHTML = log.slice(0, 8).map(m => {
    const time = new Date(m.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = m.duration >= 60
      ? `${Math.floor(m.duration/60)}h ${m.duration%60}m`
      : `${m.duration}m`;
    const ratingHtml = m.rating != null
      ? `<span class="meeting-rating ${m.rating >= 4 ? 'rating-high' : m.rating <= 2 ? 'rating-low' : ''}">${'★'.repeat(m.rating)}${'☆'.repeat(5-m.rating)}</span>`
      : '';
    return `
      <div class="meeting-item">
        <div>
          <div class="meeting-platform">${escapeHtml(m.platform)}</div>
          <div class="meeting-time">${time}</div>
        </div>
        <div style="text-align:right">
          <div class="meeting-duration">${duration}</div>
          ${ratingHtml}
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}
