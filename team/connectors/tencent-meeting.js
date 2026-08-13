const Core = require('../../app/core');

function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.meeting_info_list || payload?.meetings || payload?.meeting_list || payload?.data?.meeting_info_list || [];
}

function seconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric / 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function durationMinutes(row) {
  if (row.duration_minutes || row.durationMinutes) return Number(row.duration_minutes || row.durationMinutes);
  const start = seconds(row.start_time || row.startTime || row.start);
  const end = seconds(row.end_time || row.endTime || row.end);
  return start && end && end > start ? Math.round((end - start) / 60) : Number(row.duration || 30);
}

function identity(row) {
  return String(row.recurring_id || row.recurring_meeting_id || row.meeting_code || row.meeting_id || `${row.subject || row.title}|${row.owner_email || row.host_user_id || row.creator || ''}`);
}

function normalize(payload) {
  const rows = listFrom(payload);
  if (!rows.length) throw new Error('No Tencent Meeting records were found. Expected meeting_info_list or meetings.');
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = identity(row);
    const ownerObject = row.hosts?.[0] || row.host_info || {};
    const current = groups.get(key) || { key, rows: [], index };
    current.rows.push({
      row,
      title: row.subject || row.title || row.meeting_name || `Tencent Meeting ${index + 1}`,
      owner: row.owner || row.creator_name || ownerObject.nick_name || ownerObject.username || row.host_user_id || 'Unassigned',
      ownerEmail: row.owner_email || row.organizer_email || ownerObject.email || '',
      duration: durationMinutes(row),
      attendees: Number(row.attendee_count || row.participant_count || row.online_member_num || row.participants?.length || 1),
    });
    groups.set(key, current);
  });

  return [...groups.values()].map((group, index) => {
    const first = group.rows[0];
    const avg = field => Math.round(group.rows.reduce((sum, item) => sum + Number(item[field] || 0), 0) / group.rows.length);
    return Core.normalizeSeries({
      id: `tencent_${group.key}`,
      title: first.title,
      owner: first.owner,
      owner_email: first.ownerEmail,
      team: first.row.department || first.row.team || 'Unassigned',
      duration_minutes: avg('duration'),
      attendee_count: Math.max(1, avg('attendees')),
      occurrences_per_month: group.rows.length,
      has_agenda: first.row.has_agenda ?? true,
      age_months: first.row.age_months || 1,
    }, index);
  });
}

module.exports = { normalize };
