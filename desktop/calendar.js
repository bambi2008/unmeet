// UnMeet Desktop — Google Calendar Integration
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'UnMeet');
const TOKEN_PATH = path.join(DATA_DIR, 'calendar-token.json');

// Google OAuth client — replace with your own in production
const CLIENT_ID = '458391479461-abcdefg.apps.googleusercontent.com'; // Placeholder
const CLIENT_SECRET = 'GOCSPX-abcdefg'; // Placeholder
const REDIRECT_PORT = 51337;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

class CalendarService {
  constructor() {
    this.auth = null;
    this.connected = false;
    this.cachedEvents = [];
    this._loadToken();
  }

  _loadToken() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        this.auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        this.auth.setCredentials(token);
        this.connected = true;
      }
    } catch (e) {
      this.connected = false;
    }
  }

  // ── OAuth flow ──
  async startAuth() {
    this.auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const authUrl = this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url, true);
        if (parsed.pathname === '/oauth2callback') {
          const code = parsed.query.code;
          if (code) {
            try {
              const { tokens } = await this.auth.getToken(code);
              this.auth.setCredentials(tokens);
              if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
              fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
              this.connected = true;

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end('<h2>UnMeet — Calendar connected!</h2><p>You can close this window.</p><script>setTimeout(()=>window.close(),2000)</script>');
              server.close();
              resolve(true);
            } catch (e) {
              res.end('Auth failed: ' + e.message);
              server.close();
              reject(e);
            }
          } else {
            res.end('No auth code received.');
            server.close();
            reject(new Error('No code'));
          }
        } else {
          res.end('OK');
        }
      });

      server.listen(REDIRECT_PORT, () => {
        // Open browser for user to authorize
        const { shell } = require('electron');
        shell.openExternal(authUrl);
      });

      server.on('error', reject);
    });
  }

  disconnect() {
    try {
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    } catch (e) {}
    this.auth = null;
    this.connected = false;
    this.cachedEvents = [];
  }

  // ── Fetch calendar events ──
  async fetchEvents(timeMin, timeMax) {
    if (!this.connected || !this.auth) return [];

    try {
      const calendar = google.calendar({ version: 'v3', auth: this.auth });
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax || new Date(Date.now() + 7 * 86400000).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100,
      });

      this.cachedEvents = (res.data.items || []).map(evt => ({
        id: evt.id,
        title: evt.summary || '(No title)',
        description: evt.description || '',
        startTime: evt.start?.dateTime || evt.start?.date,
        endTime: evt.end?.dateTime || evt.end?.date,
        attendees: (evt.attendees || []).map(a => ({
          email: a.email,
          name: a.displayName || a.email,
          organizer: a.organizer || false,
          responseStatus: a.responseStatus || 'needsAction',
        })),
        organizer: evt.organizer?.email || '',
        hangoutLink: evt.hangoutLink || '',
        conferenceLink: evt.conferenceData?.entryPoints?.[0]?.uri || '',
        recurringEventId: evt.recurringEventId || null,
        hasAgenda: !!(evt.description && evt.description.length > 20),
      }));

      return this.cachedEvents;
    } catch (e) {
      console.error('[Calendar] Fetch error:', e.message);
      return [];
    }
  }

  // ── Match a meeting to a calendar event ──
  matchMeeting(meeting) {
    if (!meeting || !this.cachedEvents.length) return null;

    const meetingStart = meeting.startTime;
    const meetingEnd = meeting.endTime || Date.now();

    // Find calendar event that overlaps with this meeting
    for (const evt of this.cachedEvents) {
      const evtStart = new Date(evt.startTime).getTime();
      const evtEnd = new Date(evt.endTime).getTime();

      // Overlap check: meeting starts during event, or event starts during meeting
      if ((meetingStart >= evtStart && meetingStart <= evtEnd) ||
          (evtStart >= meetingStart && evtStart <= meetingEnd)) {
        return evt;
      }
    }

    return null;
  }

  // ── Get today's upcoming meetings from calendar ──
  getUpcomingEvents() {
    const now = Date.now();
    return this.cachedEvents
      .filter(e => {
        const start = new Date(e.startTime).getTime();
        return start > now - 3600000 && start < now + 86400000;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }
}

module.exports = { CalendarService };
