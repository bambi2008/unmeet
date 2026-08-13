(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UnMeetCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const ACTIONS = {
    keep: { label: 'Keep as is' },
    shorten: { label: 'Shorten' },
    reduce_frequency: { label: 'Reduce frequency' },
    reduce_attendees: { label: 'Reduce attendees' },
    async: { label: 'Move async' },
    cancel: { label: 'Cancel' },
  };

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round((number(value) + Number.EPSILON) * factor) / factor;
  }

  function monthlyPersonHours(series, scenario = 'baseline') {
    if (scenario === 'actual' && series.actual) {
      return round(
        number(series.actual.durationMinutes) / 60 *
        number(series.actual.attendeeCount) *
        number(series.actual.occurrencesPerMonth),
        1
      );
    }

    const baseline = {
      durationMinutes: number(series.durationMinutes),
      attendeeCount: number(series.attendeeCount),
      occurrencesPerMonth: number(series.occurrencesPerMonth),
    };

    if (scenario === 'planned' && series.decision) {
      const action = series.decision.action;
      if (action === 'cancel' || action === 'async') return 0;
      if (action === 'shorten') baseline.durationMinutes = number(series.decision.targetDuration, baseline.durationMinutes);
      if (action === 'reduce_frequency') baseline.occurrencesPerMonth = number(series.decision.targetOccurrences, baseline.occurrencesPerMonth);
      if (action === 'reduce_attendees') baseline.attendeeCount = number(series.decision.targetAttendees, baseline.attendeeCount);
    }

    return round(
      baseline.durationMinutes / 60 * baseline.attendeeCount * baseline.occurrencesPerMonth,
      1
    );
  }

  function seriesCost(series, hourlyRate, scenario = 'baseline') {
    return Math.round(monthlyPersonHours(series, scenario) * number(hourlyRate, 75));
  }

  function savings(series, scenario = 'planned') {
    return round(Math.max(0, monthlyPersonHours(series, 'baseline') - monthlyPersonHours(series, scenario)), 1);
  }

  function reviewStatus(series) {
    if (series.actual && series.decision) return 'verified';
    if (series.decision) return 'decided';
    if (series.reviewStatus === 'review') return 'review';
    return 'backlog';
  }

  function opportunityScore(series) {
    const hours = monthlyPersonHours(series);
    const recurringWeight = Math.min(number(series.occurrencesPerMonth) / 4, 2);
    const attendeeWeight = Math.min(number(series.attendeeCount) / 8, 2);
    const noAgenda = series.hasAgenda === false ? 8 : 0;
    const ageWeight = Math.min(number(series.ageMonths) / 6, 3);
    return Math.round(hours + recurringWeight * 8 + attendeeWeight * 6 + noAgenda + ageWeight * 4);
  }

  function recommendation(series) {
    if (series.attendeeCount >= 12) return { action: 'reduce_attendees', text: 'Review the attendee list' };
    if (series.durationMinutes >= 60) return { action: 'shorten', text: 'Test a shorter timebox' };
    if (series.occurrencesPerMonth >= 8) return { action: 'reduce_frequency', text: 'Reduce the cadence' };
    if (series.hasAgenda === false) return { action: 'async', text: 'Consider an async update' };
    return { action: 'keep', text: 'Ask the owner to renew it' };
  }

  function workspaceMetrics(workspace) {
    const series = workspace.series || [];
    const baselineHours = round(series.reduce((sum, item) => sum + monthlyPersonHours(item), 0), 1);
    const plannedSavings = round(series.reduce((sum, item) => sum + (item.decision ? savings(item, 'planned') : 0), 0), 1);
    const verifiedSavings = round(series.reduce((sum, item) => sum + (item.actual ? savings(item, 'actual') : 0), 0), 1);
    const reviewed = series.filter(item => reviewStatus(item) !== 'backlog').length;
    const decided = series.filter(item => item.decision).length;
    const verified = series.filter(item => item.actual && item.decision).length;
    return {
      baselineHours,
      baselineCost: Math.round(baselineHours * number(workspace.hourlyRate, 75)),
      plannedSavings,
      plannedSavingsCost: Math.round(plannedSavings * number(workspace.hourlyRate, 75)),
      verifiedSavings,
      verifiedSavingsCost: Math.round(verifiedSavings * number(workspace.hourlyRate, 75)),
      reviewed,
      decided,
      verified,
      total: series.length,
      changeRate: decided ? Math.round(series.filter(item => item.decision && item.decision.action !== 'keep').length / decided * 100) : 0,
    };
  }

  function normalizeSeries(row, index = 0) {
    const title = String(row.title || row.summary || `Meeting ${index + 1}`).trim();
    const frequency = String(row.frequency || '').trim().toLowerCase();
    const occurrences = number(row.occurrencesPerMonth || row.occurrences_per_month || row.monthly_occurrences,
      frequency === 'weekly' ? 4 : frequency === 'biweekly' ? 2 : frequency === 'daily' ? 20 : 4);
    return {
      id: String(row.id || `series_${Date.now()}_${index}`),
      title,
      owner: String(row.owner || row.organizer || 'Unassigned'),
      team: String(row.team || 'Product & Engineering'),
      durationMinutes: Math.max(5, number(row.durationMinutes || row.duration_minutes || row.duration, 30)),
      attendeeCount: Math.max(1, number(row.attendeeCount || row.attendee_count || row.attendees, 1)),
      occurrencesPerMonth: Math.max(0, occurrences),
      hasAgenda: String(row.hasAgenda ?? row.has_agenda ?? 'true').toLowerCase() !== 'false',
      ageMonths: Math.max(0, number(row.ageMonths || row.age_months, 1)),
      reviewStatus: row.reviewStatus || row.review_status || 'backlog',
      decision: row.decision || null,
      actual: row.actual || null,
    };
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      const next = input[i + 1];
      if (char === '"' && quoted && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(field.trim());
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(field.trim());
        field = '';
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
    row.push(field.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map(header => header.trim());
    return rows.slice(1).map((cells, index) => {
      const record = {};
      headers.forEach((header, cellIndex) => { record[header] = cells[cellIndex] || ''; });
      return normalizeSeries(record, index);
    });
  }

  function validateDecision(series, decision) {
    const errors = [];
    if (!decision || !ACTIONS[decision.action]) errors.push('Choose a decision.');
    if (!decision?.owner?.trim()) errors.push('Assign an owner.');
    if (!decision?.effectiveDate) errors.push('Choose an effective date.');
    if (!decision?.reviewDate) errors.push('Choose a review date.');
    if (decision?.action === 'shorten' && number(decision.targetDuration) >= number(series.durationMinutes)) {
      errors.push('The target duration must be shorter than the baseline.');
    }
    if (decision?.action === 'reduce_frequency' && number(decision.targetOccurrences) >= number(series.occurrencesPerMonth)) {
      errors.push('The target cadence must be lower than the baseline.');
    }
    if (decision?.action === 'reduce_attendees' && number(decision.targetAttendees) >= number(series.attendeeCount)) {
      errors.push('The target attendee count must be lower than the baseline.');
    }
    return errors;
  }

  return {
    ACTIONS,
    monthlyPersonHours,
    seriesCost,
    savings,
    reviewStatus,
    opportunityScore,
    recommendation,
    workspaceMetrics,
    normalizeSeries,
    parseCSV,
    validateDecision,
    round,
  };
});
