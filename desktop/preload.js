// UnMeet Desktop — Preload Script
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unmeet', {
  // State
  getState: () => ipcRenderer.invoke('get-state'),
  getLog: () => ipcRenderer.invoke('get-log'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Data management
  exportData: () => ipcRenderer.invoke('export-data'),
  clearData: () => ipcRenderer.invoke('clear-data'),

  // Insights
  getInsights: () => ipcRenderer.invoke('get-insights'),

  // Navigation events from main process
  onNavigate: (callback) => ipcRenderer.on('navigate', (_, section) => callback(section)),

  // Listen for state updates
  onStateUpdate: (callback) => {
    // Poll state via IPC — lightweight
    setInterval(async () => {
      const state = await ipcRenderer.invoke('get-state');
      callback(state);
    }, 3000);
  },
});
