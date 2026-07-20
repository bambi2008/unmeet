// UnMeet Options Script

document.addEventListener('DOMContentLoaded', loadSettings);

document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('export-btn').addEventListener('click', exportData);
document.getElementById('clear-btn').addEventListener('click', clearData);

async function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
    if (res && res.settings) {
      document.getElementById('hourly-rate').value = res.settings.hourlyRate || 75;
      document.getElementById('currency').value = res.settings.currency || '$';
    }
  });
}

function saveSettings() {
  const hourlyRate = parseInt(document.getElementById('hourly-rate').value) || 75;
  const currency = document.getElementById('currency').value || '$';
  const settings = { hourlyRate, currency };
  chrome.runtime.sendMessage({ action: 'saveSettings', settings }, () => {
    const msg = document.getElementById('saved-msg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2000);
  });
}

function exportData() {
  chrome.runtime.sendMessage({ action: 'getLog' }, (res) => {
    if (!res || !res.log) return;
    const blob = new Blob([JSON.stringify(res.log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unmeet-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function clearData() {
  if (confirm('Delete all meeting data? This cannot be undone.')) {
    chrome.runtime.sendMessage({ action: 'clearData' }, () => {
      alert('All data cleared.');
    });
  }
}
