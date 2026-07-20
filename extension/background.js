// UnMeet Background Service Worker
// Tracks meeting time and manages storage

const MEETING_URL_PATTERNS = [
  /meet\.google\.com\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}/,
  /zoom\.us\/[jwm]\//,
  /teams\.microsoft\.com\/.*meeting/,
  /teams\.live\.com\/meet/,
  /feishu\.cn\/vc\//,
  /meeting\.tencent\.com/,
  /ringcentral\.com\/.*meeting/,
  /whereby\.com\//,
];

const STORAGE_KEY = 'unmeet_data';
const ALARM_NAME = 'meeting-check';
const HEARTBEAT_INTERVAL = 15; // seconds

let activeMeeting = null; // { id, url, startTime, platform }
let meetingLog = [];      // [{ id, url, platform, startTime, endTime, duration, rating }]

// ── Initialize ──
async function init() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, 'settings']);
  if (stored[STORAGE_KEY]) {
    meetingLog = stored[STORAGE_KEY];
  }
  if (stored.settings?.hourlyRate === undefined) {
    await chrome.storage.local.set({ settings: { hourlyRate: 75 } });
  }
  // Start heartbeat
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_INTERVAL / 60 });
}

// ── Meeting detection ──
function isMeetingUrl(url) {
  if (!url) return false;
  return MEETING_URL_PATTERNS.some(p => p.test(url));
}

function detectPlatform(url) {
  if (url.includes('meet.google.com')) return 'Google Meet';
  if (url.includes('zoom.us')) return 'Zoom';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'Microsoft Teams';
  if (url.includes('feishu.cn')) return 'Feishu';
  if (url.includes('meeting.tencent.com')) return 'Tencent Meeting';
  if (url.includes('ringcentral.com')) return 'RingCentral';
  if (url.includes('whereby.com')) return 'Whereby';
  return 'Unknown';
}

// ── Meeting lifecycle ──
function startMeeting(tabId, url) {
  if (activeMeeting) {
    // Already in a meeting — don't start a new one
    updateMeetingEndTime();
  }
  activeMeeting = {
    id: `${Date.now()}-${tabId}`,
    url: url,
    startTime: Date.now(),
    platform: detectPlatform(url),
    tabId: tabId,
  };
  console.log('[UnMeet] Meeting started:', activeMeeting.platform);
}

function endMeeting(rating = null) {
  if (!activeMeeting) return null;
  const endTime = Date.now();
  const duration = Math.round((endTime - activeMeeting.startTime) / 60000); // minutes
  const entry = {
    id: activeMeeting.id,
    url: activeMeeting.url,
    platform: activeMeeting.platform,
    startTime: activeMeeting.startTime,
    endTime: endTime,
    duration: duration,
    rating: rating,
    date: new Date(activeMeeting.startTime).toISOString().split('T')[0],
  };
  meetingLog.unshift(entry);
  // Keep last 500 entries
  if (meetingLog.length > 500) meetingLog = meetingLog.slice(0, 500);
  // Persist
  chrome.storage.local.set({ [STORAGE_KEY]: meetingLog });
  console.log(`[UnMeet] Meeting ended: ${duration}min`, rating ? `rated ${rating}/5` : 'unrated');
  activeMeeting = null;
  return entry;
}

function updateMeetingEndTime() {
  if (!activeMeeting) return;
  // Just update the active meeting's end time silently
  // Used when a new meeting starts while one is already active
}

// ── Tab listeners ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    checkTab(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeMeeting && activeMeeting.tabId === tabId) {
    endMeeting();
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Check if the newly activated tab is a meeting
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    checkTab(tab.id, tab.url);
  } catch(e) { /* tab may not exist */ }
});

function checkTab(tabId, url) {
  if (isMeetingUrl(url)) {
    if (!activeMeeting || activeMeeting.tabId !== tabId) {
      startMeeting(tabId, url);
    }
  } else if (activeMeeting && activeMeeting.tabId === tabId) {
    // The meeting tab changed to a non-meeting URL — meeting ended
    endMeeting();
  }
}

// ── Alarm heartbeat ──
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    // Verify active meeting is still valid
    if (activeMeeting) {
      chrome.tabs.get(activeMeeting.tabId).catch(() => {
        // Tab no longer exists
        endMeeting();
      });
    }
  }
});

// ── Message handlers ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getStatus':
      sendResponse({
        inMeeting: !!activeMeeting,
        currentMeeting: activeMeeting ? {
          platform: activeMeeting.platform,
          duration: Math.round((Date.now() - activeMeeting.startTime) / 60000),
          startTime: activeMeeting.startTime,
        } : null,
        todayMeetings: getTodayMeetings(),
        log: meetingLog.slice(0, 50),
        stats: getStats(),
      });
      break;

    case 'rateMeeting':
      const entry = endMeeting(message.rating);
      sendResponse({ ok: true, entry });
      break;

    case 'endMeeting':
      const ended = endMeeting();
      sendResponse({ ok: true, entry: ended });
      break;

    case 'getLog':
      sendResponse({ log: meetingLog });
      break;

    case 'getSettings':
      chrome.storage.local.get('settings', (data) => {
        sendResponse({ settings: data.settings || { hourlyRate: 75 } });
      });
      return true; // async

    case 'saveSettings':
      chrome.storage.local.set({ settings: message.settings }, () => {
        sendResponse({ ok: true });
      });
      return true; // async

    case 'clearData':
      meetingLog = [];
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
      sendResponse({ ok: true });
      break;
  }
});

// ── Stats helpers ──
function getTodayMeetings() {
  const today = new Date().toISOString().split('T')[0];
  return meetingLog.filter(m => m.date === today);
}

function getStats() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000);
  const monthAgo = new Date(now - 30 * 86400000);

  const thisWeek = meetingLog.filter(m => m.startTime > weekAgo.getTime());
  const thisMonth = meetingLog.filter(m => m.startTime > monthAgo.getTime());
  const rated = meetingLog.filter(m => m.rating !== null && m.rating !== undefined);

  const weekMinutes = thisWeek.reduce((s, m) => s + (m.duration || 0), 0);
  const weekHours = Math.round(weekMinutes / 60 * 10) / 10;
  const monthMinutes = thisMonth.reduce((s, m) => s + (m.duration || 0), 0);
  const avgRating = rated.length > 0
    ? Math.round(rated.reduce((s, m) => s + m.rating, 0) / rated.length * 10) / 10
    : null;

  return {
    thisWeek: { count: thisWeek.length, minutes: weekMinutes, hours: weekHours },
    thisMonth: { count: thisMonth.length, minutes: monthMinutes },
    totalTracked: meetingLog.length,
    avgRating: avgRating,
    highValue: rated.filter(m => m.rating >= 4).length,
    lowValue: rated.filter(m => m.rating <= 2).length,
  };
}

// ── Start ──
init();
console.log('[UnMeet] Background service worker initialized');
