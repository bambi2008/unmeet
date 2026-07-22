// UnMeet Desktop — Meeting Tracker Engine
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'UnMeet');
const LOG_FILE = path.join(DATA_DIR, 'meetings.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ── Meeting platform patterns (window titles) ──
const MEETING_PATTERNS = [
  { pattern: /zoom meeting/i, platform: 'Zoom' },
  { pattern: /zoom webinar/i, platform: 'Zoom Webinar' },
  { pattern: /microsoft teams/i, platform: 'Microsoft Teams' },
  { pattern: /google meet/i, platform: 'Google Meet' },
  { pattern: /腾讯会议/i, platform: 'Tencent Meeting' },
  { pattern: /voov meeting/i, platform: 'VooV Meeting' },
  { pattern: /飞书视频会议/i, platform: 'Feishu' },
  { pattern: /飞书会议/i, platform: 'Feishu' },
  { pattern: /feishu.*meeting/i, platform: 'Feishu' },
  { pattern: /webex meeting/i, platform: 'Webex' },
  { pattern: /ringcentral.*meeting/i, platform: 'RingCentral' },
  { pattern: /whereby/i, platform: 'Whereby' },
  { pattern: /slack.*call/i, platform: 'Slack Call' },
  { pattern: /discord.*voice/i, platform: 'Discord' },
];

class Tracker {
  constructor() {
    this.meetingLog = [];
    this.currentMeeting = null;
    this.intervalId = null;
    this.settings = { hourlyRate: 75, currency: '$', autoStart: true };

    // Ensure data directory
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Load saved data
    this._load();
  }

  // ── Active window detection ──
  _getPsScriptPath() {
    // Write PowerShell helper script on first call
    const scriptDir = path.join(DATA_DIR, 'scripts');
    if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
    const psPath = path.join(scriptDir, 'get-foreground-window.ps1');
    if (!fs.existsSync(psPath)) {
      const psCode = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinAPI {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
}
'@
$hwnd = [WinAPI]::GetForegroundWindow()
$len = [WinAPI]::GetWindowTextLength($hwnd)
$sb = New-Object System.Text.StringBuilder($len + 1)
[WinAPI]::GetWindowText($hwnd, $sb, $sb.Capacity)
$sb.ToString()
`.trim();
      fs.writeFileSync(psPath, psCode, 'utf8');
    }
    return psPath;
  }

  getActiveWindowTitle() {
    try {
      if (process.platform === 'win32') {
        const psPath = this._getPsScriptPath();
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
          timeout: 3000, encoding: 'utf8', windowsHide: true,
        }).trim();
        return result;
      } else if (process.platform === 'darwin') {
        const result = execSync(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, {
          timeout: 3000,
          encoding: 'utf8',
        }).trim();
        // Also get window title
        const title = execSync(`osascript -e 'tell application "System Events" to get name of front window of (first application process whose frontmost is true)'`, {
          timeout: 3000,
          encoding: 'utf8',
        }).catch(() => '');
        return `${result} — ${title}`.trim();
      }
    } catch (e) {
      return '';
    }
    return '';
  }

  // ── Match window title to meeting platform ──
  detectMeeting(title) {
    if (!title) return null;
    for (const { pattern, platform } of MEETING_PATTERNS) {
      if (pattern.test(title)) return platform;
    }
    return null;
  }

  // ── Main tracking loop ──
  start() {
    this._listeners = {};
    this._tick();
    this.intervalId = setInterval(() => this._tick(), 3000);
    console.log('[UnMeet] Tracker started');
  }

  on(event, callback) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  _emit(event, data) {
    if (this._listeners && this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.currentMeeting) this.endMeeting();
    this._save();
    console.log('[UnMeet] Tracker stopped');
  }

  _tick() {
    const title = this.getActiveWindowTitle();
    const platform = this.detectMeeting(title);

    if (platform && !this.currentMeeting) {
      // Meeting just started
      this.currentMeeting = {
        id: Date.now().toString(),
        platform: platform,
        windowTitle: title,
        startTime: Date.now(),
      };
      console.log(`[UnMeet] Meeting started: ${platform} — "${title}"`);
    } else if (platform && this.currentMeeting) {
      // Meeting still active — update platform if it changed
      if (platform !== this.currentMeeting.platform) {
        this.currentMeeting.platform = platform;
      }
    } else if (!platform && this.currentMeeting) {
      // Meeting just ended
      // Wait a grace period (2 ticks = 6s) in case user switched windows briefly
      if (!this._graceCounter) this._graceCounter = 0;
      this._graceCounter++;
      if (this._graceCounter >= 2) {
        this.endMeeting();
        this._graceCounter = 0;
      }
    } else {
      this._graceCounter = 0;
    }
  }

  endMeeting() {
    if (!this.currentMeeting) return null;
    const endTime = Date.now();
    const duration = Math.round((endTime - this.currentMeeting.startTime) / 60000);

    const entry = {
      id: this.currentMeeting.id,
      platform: this.currentMeeting.platform,
      startTime: this.currentMeeting.startTime,
      endTime: endTime,
      duration: duration,
      rating: null,
      date: new Date(this.currentMeeting.startTime).toISOString().split('T')[0],
    };

    this.meetingLog.unshift(entry);
    if (this.meetingLog.length > 2000) this.meetingLog = this.meetingLog.slice(0, 2000);
    this._save();

    console.log(`[UnMeet] Meeting ended: ${entry.platform}, ${duration}min`);
    this._emit('meetingEnded', entry);
    this.currentMeeting = null;
    return entry;
  }

  // ── IPC handlers ──
  getState() {
    const now = new Date();
    const weekAgo = new Date(now - 7 * 86400000);
    const thisWeek = this.meetingLog.filter(m => m.startTime > weekAgo.getTime());
    const weekMinutes = thisWeek.reduce((s, m) => s + (m.duration || 0), 0);

    return {
      inMeeting: !!this.currentMeeting,
      currentPlatform: this.currentMeeting?.platform || null,
      currentDuration: this.currentMeeting ? Math.round((Date.now() - this.currentMeeting.startTime) / 60000) : 0,
      currentStartTime: this.currentMeeting?.startTime || null,
      thisWeek: {
        count: thisWeek.length,
        minutes: weekMinutes,
        hours: Math.round(weekMinutes / 60 * 10) / 10,
      },
      totalTracked: this.meetingLog.length,
    };
  }

  getLog() {
    return this.meetingLog.slice(0, 100);
  }

  getSettings() {
    return { ...this.settings };
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
  }

  exportData() {
    return JSON.stringify(this.meetingLog, null, 2);
  }

  clearData() {
    this.meetingLog = [];
    this._save();
  }

  // ── Persistence ──
  _load() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        this.meetingLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      }
      if (fs.existsSync(SETTINGS_FILE)) {
        this.settings = { ...this.settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
      }
    } catch (e) {
      console.error('[UnMeet] Failed to load data:', e.message);
    }
  }

  _save() {
    try {
      fs.writeFileSync(LOG_FILE, JSON.stringify(this.meetingLog, null, 2));
    } catch (e) {
      console.error('[UnMeet] Failed to save data:', e.message);
    }
  }
}

module.exports = { Tracker };
