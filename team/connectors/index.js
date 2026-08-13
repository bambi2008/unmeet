const csv = require('./standard-csv');
const tencent = require('./tencent-meeting');

const connectors = {
  csv,
  tencent_meeting: tencent,
};

const catalog = [
  { id: 'csv', name: 'Standard CSV', mode: 'file', ready: true, capabilities: ['baseline', 'followup'] },
  { id: 'tencent_meeting', name: 'Tencent Meeting', mode: 'json', ready: true, capabilities: ['baseline', 'followup'], note: 'JSON export/API response import; live API credentials are customer-specific.' },
  { id: 'google_workspace', name: 'Google Workspace', mode: 'oauth', ready: true, capabilities: ['calendar baseline', 'manual sync'], note: 'Read-only access to the connected user calendar.' },
  { id: 'microsoft_365', name: 'Microsoft 365 / Teams', mode: 'oauth', ready: true, capabilities: ['calendar baseline', 'manual sync'], note: 'Read-only access to the connected user calendar.' },
  { id: 'feishu', name: 'Feishu Calendar', mode: 'app', ready: false, capabilities: ['baseline', 'followup'] },
  { id: 'zoom', name: 'Zoom', mode: 'oauth', ready: false, capabilities: ['attendance'] },
];

function normalize(provider, payload) {
  const connector = connectors[provider];
  if (!connector) throw new Error(`Unsupported provider: ${provider}`);
  return connector.normalize(payload);
}

module.exports = { catalog, normalize };
