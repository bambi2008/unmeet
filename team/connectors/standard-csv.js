const Core = require('../../app/core');

function normalize(payload) {
  const text = typeof payload === 'string' ? payload : payload?.csv;
  if (!text) throw new Error('CSV content is required.');
  const lines = text.split(/\r?\n/);
  if (lines.length > 5001) throw new Error('CSV may contain at most 5,000 records.');
  const headers = (lines[0] || '').split(',');
  if (headers.length > 50) throw new Error('CSV may contain at most 50 columns.');
  if (lines.some(line => line.length > 20_000)) throw new Error('A CSV row exceeds the 20,000 character limit.');
  return Core.parseCSV(text);
}

module.exports = { normalize };
