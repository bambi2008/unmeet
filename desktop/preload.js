// UnMeet Desktop — Preload Script
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unmeet', {
  getState: () => ipcRenderer.invoke('get-state'),
  getLog: () => ipcRenderer.invoke('get-log'),
  rateMeeting: (id, rating) => ipcRenderer.invoke('rate-meeting', id, rating),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  exportData: () => ipcRenderer.invoke('export-data'),
  clearData: () => ipcRenderer.invoke('clear-data'),
  getInsights: () => ipcRenderer.invoke('get-insights'),
  getWorkspace: () => ipcRenderer.invoke('get-workspace'),
  addMember: (n, r) => ipcRenderer.invoke('add-member', n, r),
  removeMember: (id) => ipcRenderer.invoke('remove-member', id),
  importMemberData: (id, j) => ipcRenderer.invoke('import-member-data', id, j),
  getTeamStats: () => ipcRenderer.invoke('get-team-stats'),
  exportWorkspace: () => ipcRenderer.invoke('export-workspace'),
  connectCalendar: () => ipcRenderer.invoke('connect-calendar'),
  disconnectCalendar: () => ipcRenderer.invoke('disconnect-calendar'),
  getCalendarStatus: () => ipcRenderer.invoke('get-calendar-status'),
  getUpcomingEvents: () => ipcRenderer.invoke('get-upcoming-events'),
  getMeetingAnalysis: (id) => ipcRenderer.invoke('get-meeting-analysis', id),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_, s) => cb(s)),
  onStateUpdate: (cb) => { setInterval(async () => { cb(await ipcRenderer.invoke('get-state')); }, 3000); },
});
