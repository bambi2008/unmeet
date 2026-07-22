// UnMeet Desktop — Main Process
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const { Tracker } = require('./tracker');
const { MeetingClassifier } = require('./classifier');
const { Workspace } = require('./workspace');

let tray = null;
let dashboardWindow = null;
let tracker = null;
let classifier = null;
let workspace = null;

// ── App lifecycle ──
app.whenReady().then(() => {
  tracker = new Tracker();
  classifier = new MeetingClassifier();
  workspace = new Workspace();
  createTray();
  tracker.start();

  // Meeting ended → notification with rating
  tracker.on('meetingEnded', (entry) => {
    showRatingNotification(entry);
  });

  // Restore dashboard if it was open
  ipcMain.handle('get-state', () => tracker.getState());
  ipcMain.handle('get-log', () => tracker.getLog());
  ipcMain.handle('get-settings', () => tracker.getSettings());
  ipcMain.handle('save-settings', (_, settings) => tracker.saveSettings(settings));
  ipcMain.handle('export-data', () => tracker.exportData());
  ipcMain.handle('clear-data', () => tracker.clearData());
  ipcMain.handle('get-insights', () => classifier.analyze(tracker.meetingLog));
  ipcMain.handle('get-workspace', () => workspace.data);
  ipcMain.handle('add-member', (_, name, hourlyRate) => workspace.addMember(name, hourlyRate));
  ipcMain.handle('remove-member', (_, memberId) => workspace.removeMember(memberId));
  ipcMain.handle('import-member-data', (_, memberId, jsonStr) => workspace.importMemberExport(jsonStr, memberId));
  ipcMain.handle('get-team-stats', () => workspace.getTeamStats());
  ipcMain.handle('export-workspace', () => workspace.exportWorkspace());
});

app.on('window-all-closed', (e) => {
  // Don't quit — keep running in tray
  e.preventDefault();
});

// ── System Tray ──
function createTray() {
  // Create a simple 16x16 tray icon programmatically
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  updateTrayMenu();
  updateTrayIcon(false);

  tray.setToolTip('UnMeet — No meeting');

  // Click tray to toggle dashboard
  tray.on('click', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.isVisible() ? dashboardWindow.hide() : dashboardWindow.show();
    } else {
      openDashboard();
    }
  });

  // Update tray every 3 seconds
  setInterval(() => {
    const state = tracker.getState();
    updateTrayIcon(state.inMeeting);
    updateTrayMenu();
  }, 3000);
}

function updateTrayIcon(inMeeting) {
  const ctx = nativeImage.createEmpty();
  // We'll use a colored dot approach — generate simple icons
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    const cx = size / 2, cy = size / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const offset = i * 4;
    if (dist < size / 2 - 1) {
      canvas[offset] = inMeeting ? 16 : 92;      // R
      canvas[offset + 1] = inMeeting ? 185 : 95;  // G
      canvas[offset + 2] = inMeeting ? 129 : 107; // B
      canvas[offset + 3] = 255;                    // A
    }
  }
  const img = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  if (tray) tray.setImage(img);
}

function updateTrayMenu() {
  const state = tracker.getState();
  const inMeeting = state.inMeeting;
  const costStr = inMeeting ? ` — $${((state.currentDuration / 60) * (tracker.settings.hourlyRate || 75)).toFixed(2)}` : '';

  const menu = Menu.buildFromTemplate([
    {
      label: inMeeting ? `🔴 In a meeting${costStr}` : '⚪ No meeting',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => openDashboard()
    },
    {
      label: `This week: ${state.weekHours}h`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => openDashboard('settings')
    },
    {
      label: 'Quit UnMeet',
      click: () => {
        tracker.stop();
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

// ── Dashboard window ──
function openDashboard(section) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    if (section) dashboardWindow.webContents.send('navigate', section);
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    title: 'UnMeet',
    icon: path.join(__dirname, 'assets', 'tray-icon.png'),
    backgroundColor: '#090A0E',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  dashboardWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.show();
    if (section) dashboardWindow.webContents.send('navigate', section);
  });

  dashboardWindow.on('close', (e) => {
    // Minimize to tray instead of closing
    if (!app.isQuitting) {
      e.preventDefault();
      dashboardWindow.hide();
    }
  });
}

// Prevent app from quitting when all windows are closed
app.on('before-quit', () => {
  app.isQuitting = true;
});

// ── Rating notification ──
function showRatingNotification(entry) {
  const { Notification } = require('electron');
  if (!Notification.isSupported()) return;

  // Show a notification with the meeting summary
  const cost = ((entry.duration / 60) * (tracker.settings.hourlyRate || 75)).toFixed(2);
  const dur = entry.duration >= 60
    ? `${Math.floor(entry.duration/60)}h ${entry.duration%60}m`
    : `${entry.duration}m`;

  const n = new Notification({
    title: `Meeting ended: ${entry.platform}`,
    body: `${dur} · $${cost} · Tap to rate`,
    silent: false,
    urgency: 'normal',
  });

  n.on('click', () => {
    // Open dashboard to meetings page where user can see the meeting
    openDashboard('meetings');
  });

  n.show();
}
