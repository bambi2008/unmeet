// UnMeet Desktop — Meeting Classifier & Insights Engine
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'UnMeet');

// ── Meeting type definitions ──
const MEETING_TYPES = {
  standup: {
    name: 'Daily Standup',
    icon: '🔄',
    color: '#10B981',
    description: 'Short daily sync — typically 15min, same time every day',
    suggestion: 'Consider async if everyone just reads status updates.',
  },
  one_on_one: {
    name: '1:1 Meeting',
    icon: '🤝',
    color: '#3B82F6',
    description: 'Two-person check-in — high value if structured',
    suggestion: 'Keep it weekly. Have a shared agenda doc.',
  },
  decision: {
    name: 'Decision Meeting',
    icon: '📋',
    color: '#F59E0B',
    description: 'Mid-length meeting to make a specific decision',
    suggestion: 'Send materials 24h in advance. Hard stop at 45min.',
  },
  broadcast: {
    name: 'All Hands / Broadcast',
    icon: '📢',
    color: '#8B5CF6',
    description: 'Large group, one-to-many communication',
    suggestion: 'Replace with async video update + Q&A Slack channel.',
  },
  workshop: {
    name: 'Workshop / Brainstorm',
    icon: '🧠',
    color: '#EC4899',
    description: 'Long, collaborative, creative session',
    suggestion: 'Timebox each section. Assign a facilitator.',
  },
  social: {
    name: 'Social / Team Building',
    icon: '🎉',
    color: '#F97316',
    description: 'Non-work gathering — important for culture',
    suggestion: 'Keep it opt-in, not mandatory.',
  },
  deep_work_block: {
    name: 'Deep Work Session',
    icon: '🔬',
    color: '#06B6D4',
    description: 'Long focused block — likely heads-down work',
    suggestion: 'Protect this time. No interruptions.',
  },
  unknown: {
    name: 'Unclassified',
    icon: '❓',
    color: '#5C5F6B',
    description: 'Doesn\'t fit clear patterns — needs manual tagging',
    suggestion: null,
  },
};

// ── Meeting classifier ──
class MeetingClassifier {
  constructor() {
    this.meetings = [];
    this.insights = null;
    this._load();
  }

  _load() {
    try {
      const f = path.join(DATA_DIR, 'meetings.json');
      if (fs.existsSync(f)) this.meetings = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {}
  }

  // ── Classify a single meeting ──
  classify(meeting) {
    const dur = meeting.duration || 0;
    const hour = new Date(meeting.startTime).getHours();

    // Duration-based
    if (dur <= 20 && hour >= 8 && hour <= 11) return 'standup';
    if (dur <= 30) return 'one_on_one';
    if (dur <= 60) return 'decision';
    if (dur <= 120) return 'workshop';
    if (dur > 120) return 'deep_work_block';

    // Time-based
    if (hour >= 17 || hour < 8) return 'social';

    return 'unknown';
  }

  // ── Detect recurring meetings ──
  detectRecurring(meetings) {
    const byTimeSlot = {};
    for (const m of meetings) {
      const date = new Date(m.startTime);
      const key = `${date.getDay()}-${Math.floor(date.getHours()/2)}`; // day-half-hour slot
      if (!byTimeSlot[key]) byTimeSlot[key] = [];
      byTimeSlot[key].push(m);
    }

    const recurring = [];
    for (const [slot, ms] of Object.entries(byTimeSlot)) {
      if (ms.length >= 3) { // At least 3 occurrences in same slot = recurring
        const [day, halfHour] = slot.split('-');
        const avgDur = Math.round(ms.reduce((s, m) => s + (m.duration||0), 0) / ms.length);
        const platforms = [...new Set(ms.map(m => m.platform))];
        const avgRating = ms.filter(m => m.rating).length > 0
          ? (ms.filter(m => m.rating).reduce((s, m) => s + m.rating, 0) / ms.filter(m => m.rating).length).toFixed(1)
          : null;

        recurring.push({
          slot,
          day: parseInt(day),
          timeBlock: `${parseInt(halfHour)*2}:00-${parseInt(halfHour)*2+2}:00`,
          count: ms.length,
          avgDuration: avgDur,
          avgRating: avgRating ? parseFloat(avgRating) : null,
          platforms,
          type: this.classify({ duration: avgDur, startTime: ms[0].startTime }),
          suggestion: avgRating && avgRating < 3
            ? 'This recurring meeting has low ratings. Consider restructuring or canceling.'
            : null,
        });
      }
    }
    return recurring.sort((a, b) => b.count - a.count);
  }

  // ── Personal meeting fingerprint ──
  getFingerprint(meetings) {
    if (meetings.length < 5) return null;

    const totalMeetings = meetings.length;
    const typeCount = {};
    const hourCount = new Array(24).fill(0);
    const dayCount = new Array(7).fill(0);
    let totalDuration = 0;
    let ratedCount = 0;
    let totalRating = 0;

    for (const m of meetings) {
      const type = this.classify(m);
      typeCount[type] = (typeCount[type] || 0) + 1;
      totalDuration += (m.duration || 0);

      const date = new Date(m.startTime);
      hourCount[date.getHours()]++;
      dayCount[date.getDay()]++;

      if (m.rating != null) {
        ratedCount++;
        totalRating += m.rating;
      }
    }

    // Top types
    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    // Peak meeting hour
    const peakHour = hourCount.indexOf(Math.max(...hourCount));
    const peakDay = dayCount.indexOf(Math.max(...dayCount));

    // Average rating
    const avgRating = ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : null;

    // Meeting fragmentation score (lower = more fragmented)
    const avgDuration = totalDuration / totalMeetings;
    const fragmentationScore = avgDuration < 30 ? 'High' : avgDuration < 60 ? 'Medium' : 'Low';

    // Weekday bias
    const weekdayMeetings = meetings.filter(m => {
      const d = new Date(m.startTime).getDay();
      return d >= 1 && d <= 5;
    }).length;
    const weekdayRatio = Math.round(weekdayMeetings / totalMeetings * 100);

    return {
      totalMeetings,
      totalHours: Math.round(totalDuration / 60 * 10) / 10,
      avgDuration: Math.round(avgDuration),
      avgRating: avgRating ? parseFloat(avgRating) : null,
      topTypes: topTypes.map(([t, c]) => ({
        type: t,
        label: MEETING_TYPES[t]?.name || t,
        count: c,
        pct: Math.round(c / totalMeetings * 100),
      })),
      peakHour,
      peakDay,
      peakDayName: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][peakDay],
      fragmentationScore,
      weekdayRatio,
      // Personal insights
      insights: this._generateFingerprintInsights({
        topTypes, peakHour, avgDuration, fragmentationScore, weekdayRatio, avgRating,
      }),
    };
  }

  _generateFingerprintInsights(fp) {
    const insights = [];

    const standupType = fp.topTypes.find(t => t[0] === 'standup');
    if (standupType && standupType[1] / (fp.totalMeetings || 1) > 0.3) {
      insights.push({
        icon: '🔄',
        text: `${standupType[1]} standup meetings detected — that's ${Math.round(standupType[1]/fp.totalMeetings*100)}% of all your meetings. Consider consolidating to 3x/week.`,
        severity: 'warning',
      });
    }

    if (fp.avgDuration < 25) {
      insights.push({
        icon: '⚡',
        text: `Your average meeting is only ${fp.avgDuration}min — highly fragmented schedule. Try batching meetings into blocks.`,
        severity: 'warning',
      });
    }

    if (fp.weekdayRatio < 85) {
      insights.push({
        icon: '📅',
        text: `${100-fp.weekdayRatio}% of your meetings happen on weekends. Consider protecting your personal time.`,
        severity: 'critical',
      });
    }

    if (fp.peakHour >= 17) {
      insights.push({
        icon: '😰',
        text: `Your peak meeting time is ${fp.peakHour}:00 — late in the day. Morning deep work hours are being protected. Good.`,
        severity: 'info',
      });
    } else if (fp.peakHour >= 9 && fp.peakHour <= 11) {
      insights.push({
        icon: '🧠',
        text: `Your peak meeting time is ${fp.peakHour}:00 AM — prime deep work hours. Consider shifting meetings to afternoon.`,
        severity: 'warning',
      });
    }

    if (fp.avgRating != null && fp.avgRating < 3) {
      insights.push({
        icon: '📉',
        text: `Your average meeting rating is ${fp.avgRating}/5. Consider declining meetings without clear agendas.`,
        severity: 'critical',
      });
    }

    return insights;
  }

  // ── Health score (0-100) ──
  getHealthScore(meetings) {
    if (meetings.length < 5) return null;

    const fp = this.getFingerprint(meetings);
    if (!fp) return null;

    let score = 70; // Start neutral

    // Duration: target <20h/week for full-time
    const weeklyHours = fp.totalHours / (meetings.length > 10 ? 4 : 1); // Rough weekly estimate
    if (weeklyHours > 25) score -= 20;
    else if (weeklyHours > 15) score -= 10;
    else if (weeklyHours < 5) score += 5;

    // Rating
    if (fp.avgRating != null) {
      if (fp.avgRating >= 4) score += 15;
      else if (fp.avgRating >= 3.5) score += 5;
      else if (fp.avgRating < 3) score -= 20;
    }

    // Fragmentation
    if (fp.avgDuration > 45) score += 10;
    else if (fp.avgDuration < 25) score -= 15;

    // Weekend
    if (fp.weekdayRatio < 70) score -= 15;
    else if (fp.weekdayRatio > 95) score += 5;

    // Standup ratio
    const standupPct = (fp.topTypes.find(t => t[0] === 'standup')?.[1] || 0) / fp.totalMeetings;
    if (standupPct > 0.3) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  // ── Full analysis ──
  analyze(meetings) {
    const recent = meetings || this.meetings;
    const last30d = recent.filter(m => Date.now() - m.startTime < 30 * 86400000);

    const fingerprint = this.getFingerprint(last30d);
    const recurring = this.detectRecurring(last30d);
    const healthScore = this.getHealthScore(last30d);

    // Weekly trend
    const weeks = {};
    for (const m of last30d) {
      const d = new Date(m.startTime);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const wk = weekStart.toISOString().split('T')[0];
      if (!weeks[wk]) weeks[wk] = { totalMin: 0, count: 0, ratings: [] };
      weeks[wk].totalMin += (m.duration || 0);
      weeks[wk].count++;
      if (m.rating != null) weeks[wk].ratings.push(m.rating);
    }
    const trend = Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0])).map(([wk, d]) => ({
      week: wk,
      hours: Math.round(d.totalMin / 60 * 10) / 10,
      count: d.count,
      avgRating: d.ratings.length > 0 ? (d.ratings.reduce((s, r) => s + r, 0) / d.ratings.length).toFixed(1) : null,
    }));

    return {
      fingerprint,
      recurring,
      healthScore,
      healthLabel: healthScore ? (healthScore >= 70 ? '🟢 Healthy' : healthScore >= 40 ? '🟡 Needs Attention' : '🔴 Critical') : null,
      trend,
      allClassified: last30d.map(m => ({
        ...m,
        classifiedType: this.classify(m),
        typeLabel: MEETING_TYPES[this.classify(m)]?.name || 'Unknown',
      })),
    };
  }
}

module.exports = { MeetingClassifier, MEETING_TYPES };
