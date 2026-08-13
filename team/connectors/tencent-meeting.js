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
  if (rows.length > 5000) throw new Error('Tencent Meeting import may contain at most 5,000 records.');
  const groups = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Tencent Meeting record ${index + 1} is invalid.`);
    const key = identity(row);
    const ownerObject = row.hosts?.[0] || row.host_info || {};
    const title = String(row.subject || row.title || row.meeting_name || `Tencent Meeting ${index + 1}`).slice(0, 500);
    const owner = String(row.owner || row.creator_name || ownerObject.nick_name || ownerObject.username || row.host_user_id || 'Unassigned').slice(0, 200);
    const ownerEmail = String(row.owner_email || row.organizer_email || ownerObject.email || '').slice(0, 320);
    const current = groups.get(key) || { key, first: row, title, owner, ownerEmail, durationTotal: 0, attendeeTotal: 0, count: 0, index };
    current.durationTotal += Math.max(0, durationMinutes(row));
    current.attendeeTotal += Math.max(1, Number(row.attendee_count || row.participant_count || row.online_member_num || row.participants?.length || 1));
    current.count += 1;
    groups.set(key, current);
  });

  return [...groups.values()].map((group, index) => {
    return Core.normalizeSeries({
      id: `tencent_${group.key}`,
      title: group.title,
      owner: group.owner,
      owner_email: group.ownerEmail,
      team: group.first.department || group.first.team || 'Unassigned',
      duration_minutes: Math.round(group.durationTotal / group.count),
      attendee_count: Math.round(group.attendeeTotal / group.count),
      occurrences_per_month: group.count,
      has_agenda: group.first.has_agenda ?? true,
      age_months: group.first.age_months || 1,
    }, index);
  });
}

module.exports = { normalize };
