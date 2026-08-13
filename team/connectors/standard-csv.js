const Core = require('../../app/core');

function normalize(payload) {
  const text = typeof payload === 'string' ? payload : payload?.csv;
  if (!text) throw new Error('CSV content is required.');
  return Core.parseCSV(text);
}

module.exports = { normalize };
