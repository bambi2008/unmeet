# UnMeet Team

UnMeet Team is the shared, server-backed edition of the 30-day Meeting Reset.
It does not require Google Workspace: teams can start with standard CSV files or
Tencent Meeting API/export JSON, while all providers map into one meeting-series model.

## Run locally

Requires Node.js 22.5 or newer.

```bash
npm start
```

Open `http://127.0.0.1:8787`. The first user creates the workspace and becomes
its administrator. Data is stored in `team/unmeet.db` by default.

For a shared server, set a persistent database path and place the app behind an
HTTPS reverse proxy:

```bash
UNMEET_HOST=0.0.0.0 UNMEET_PORT=8787 UNMEET_DB=/data/unmeet.db npm start
```

Or build the included Dockerfile and mount `/data` as a persistent volume.

## Roles

- **Admin**: workspace setup, imports, invitations, all meetings, audit log.
- **Delivery Partner**: runs the review, imports data, invites users, views audit.
- **Meeting Owner**: sees and decides only meetings assigned to their email.
- **Executive Viewer**: read-only portfolio and verified results.

## Data sources

- **Standard CSV — ready:** baseline and follow-up files.
- **Tencent Meeting — ready for JSON:** accepts an API response with
  `meeting_info_list`, `meetings`, `meeting_list`, or a raw meeting array. The
  adapter groups occurrences by recurring ID or meeting identity. See
  `sample-tencent-meeting.json`.
- **Google Workspace, Microsoft 365 / Teams, Feishu, Zoom — connector contracts
  registered:** live authorization still requires customer-specific credentials.

Tencent Meeting provides meeting-platform evidence. For a complete view that
also includes in-person meetings or meetings hosted elsewhere, combine it with
the customer's calendar source or a standard calendar export.

The included `sample-baseline.csv`, `sample-followup.csv`, and
`sample-tencent-meeting.json` can be imported directly for a demonstration.

## Security boundary

Passwords use `scrypt` with a unique salt. Session and invitation tokens are
stored as SHA-256 hashes. Sessions use HttpOnly, SameSite=Strict cookies;
mutations reject cross-origin browser requests; responses include restrictive
content and framing headers. Every import, invite, join, and decision is written
to the server-side audit log.

Before production use, deploy behind HTTPS, back up the database, set access
logs and rate limits at the reverse proxy, and use a managed database when
running more than one application instance.

## Test

```bash
npm test
```
