// UnMeet Desktop — Workspace Engine
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'UnMeet');
const WORKSPACE_FILE = path.join(DATA_DIR, 'workspace.json');

class Workspace {
  constructor() {
    this.data = { id: null, name: '', members: [], createdAt: null };
    this._load();
    // Auto-create personal workspace if none exists
    if (!this.data.id) {
      this.data = {
        id: this._generateId(),
        name: 'My Workspace',
        members: [this._createMember('You', 'owner')],
        createdAt: Date.now(),
      };
      this._save();
    }
  }

  // ── Member management ──
  _createMember(name, role = 'member', hourlyRate = 75) {
    return {
      id: this._generateId(),
      name,
      role,
      hourlyRate,
      joinedAt: Date.now(),
      meetingData: null, // Will be filled via import
    };
  }

  _generateId() {
    return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  addMember(name, hourlyRate = 75) {
    const m = this._createMember(name, 'member', hourlyRate);
    this.data.members.push(m);
    this._save();
    return m;
  }

  removeMember(memberId) {
    this.data.members = this.data.members.filter(m => m.id !== memberId);
    this._save();
  }

  updateMember(memberId, updates) {
    const m = this.data.members.find(m => m.id === memberId);
    if (m) {
      Object.assign(m, updates);
      this._save();
    }
    return m;
  }

  // ── Data import ──
  importMemberData(memberId, meetingLog) {
    const m = this.data.members.find(m => m.id === memberId);
    if (!m) return null;
    m.meetingData = meetingLog;
    this._save();
    return m;
  }

  // ── Team aggregation ──
  getTeamStats() {
    const membersWithData = this.data.members.filter(m => m.meetingData && m.meetingData.length > 0);
    if (membersWithData.length === 0) return null;

    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;

    const team = {
      totalMembers: this.data.members.length,
      membersWithData: membersWithData.length,
      thisWeek: { totalHours: 0, totalMeetings: 0, totalCost: 0 },
      thisMonth: { totalHours: 0, totalMeetings: 0, totalCost: 0 },
      members: [],
    };

    for (const m of membersWithData) {
      if (!m.meetingData) continue;

      const weekMeetings = m.meetingData.filter(e => e.startTime > weekAgo);
      const monthMeetings = m.meetingData.filter(e => e.startTime > monthAgo);
      const weekMin = weekMeetings.reduce((s, e) => s + (e.duration || 0), 0);
      const monthMin = monthMeetings.reduce((s, e) => s + (e.duration || 0), 0);
      const rate = m.hourlyRate || 75;

      const memberStats = {
        id: m.id,
        name: m.name,
        role: m.role,
        hourlyRate: rate,
        thisWeek: {
          hours: Math.round(weekMin / 60 * 10) / 10,
          meetings: weekMeetings.length,
          cost: Math.round(weekMin / 60 * rate),
        },
        thisMonth: {
          hours: Math.round(monthMin / 60 * 10) / 10,
          meetings: monthMeetings.length,
          cost: Math.round(monthMin / 60 * rate),
        },
        avgRating: weekMeetings.filter(e => e.rating).length > 0
          ? (weekMeetings.filter(e => e.rating).reduce((s, e) => s + e.rating, 0) / weekMeetings.filter(e => e.rating).length).toFixed(1)
          : null,
      };

      team.members.push(memberStats);
      team.thisWeek.totalHours += memberStats.thisWeek.hours;
      team.thisWeek.totalMeetings += memberStats.thisWeek.meetings;
      team.thisWeek.totalCost += memberStats.thisWeek.cost;
      team.thisMonth.totalHours += memberStats.thisMonth.hours;
      team.thisMonth.totalMeetings += memberStats.thisMonth.meetings;
      team.thisMonth.totalCost += memberStats.thisMonth.cost;
    }

    // Sort members by meeting hours descending
    team.members.sort((a, b) => b.thisWeek.hours - a.thisWeek.hours);

    // Round team totals
    team.thisWeek.totalHours = Math.round(team.thisWeek.totalHours * 10) / 10;
    team.thisMonth.totalHours = Math.round(team.thisMonth.totalHours * 10) / 10;

    // Per-person averages
    team.avgHoursPerPerson = Math.round(team.thisWeek.totalHours / membersWithData.length * 10) / 10;
    team.avgMeetingsPerPerson = Math.round(team.thisWeek.totalMeetings / membersWithData.length);

    // Team health indicators
    team.insights = this._generateTeamInsights(team);

    return team;
  }

  _generateTeamInsights(team) {
    const insights = [];

    // Heavy meeting load
    if (team.avgHoursPerPerson > 20) {
      insights.push({
        icon: '🚨',
        text: `Team average is ${team.avgHoursPerPerson}h/person this week — that's over half the work week in meetings.`,
        severity: 'critical',
      });
    } else if (team.avgHoursPerPerson > 12) {
      insights.push({
        icon: '⚠️',
        text: `Team average of ${team.avgHoursPerPerson}h/person in meetings. Consider a No Meeting Wednesday.`,
        severity: 'warning',
      });
    }

    // Cost
    if (team.thisWeek.totalCost > 5000) {
      insights.push({
        icon: '💸',
        text: `This week's meetings cost the team $${team.thisWeek.totalCost.toLocaleString()}. That's ~$${Math.round(team.thisWeek.totalCost * 52 / 1000)}k/year.`,
        severity: 'warning',
      });
    }

    // Uneven distribution
    if (team.members.length >= 2) {
      const maxH = team.members[0].thisWeek.hours;
      const minH = team.members[team.members.length - 1].thisWeek.hours;
      if (maxH > minH * 3) {
        insights.push({
          icon: '⚖️',
          text: `Uneven meeting load: ${team.members[0].name} spends ${maxH}h/week, but ${team.members[team.members.length-1].name} only ${minH}h. Check for delegation or bottleneck issues.`,
          severity: 'warning',
        });
      }
    }

    return insights;
  }

  // ── Export / Import workspace ──
  exportWorkspace() {
    return JSON.stringify({
      workspace: {
        id: this.data.id,
        name: this.data.name,
        members: this.data.members.map(m => ({
          id: m.id, name: m.name, role: m.role, hourlyRate: m.hourlyRate,
        })),
        createdAt: this.data.createdAt,
      },
      exportedAt: Date.now(),
      version: '1.0',
    }, null, 2);
  }

  importMemberExport(jsonString, memberId) {
    try {
      const data = JSON.parse(jsonString);
      // Accept either a full workspace export or raw meeting log
      if (Array.isArray(data)) {
        // Raw meeting log
        return this.importMemberData(memberId, data);
      } else if (data.workspace) {
        // Workspace export — find and import this member's data
        return null; // For now, workspace imports are handled separately
      }
    } catch (e) {
      return null;
    }
  }

  // ── Persistence ──
  _load() {
    try {
      if (fs.existsSync(WORKSPACE_FILE)) {
        this.data = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('Workspace load error:', e.message);
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('Workspace save error:', e.message);
    }
  }
}

module.exports = { Workspace };
