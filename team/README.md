# UnMeet Team

UnMeet Team is the multi-tenant, server-backed SaaS edition of the 30-day Meeting Reset.
It does not require Google Workspace: teams can start with standard CSV files or
Tencent Meeting API/export JSON, while all providers map into one meeting-series model.

## Run locally

Requires Node.js 22.5 or newer.

```bash
npm start
```

Open `http://127.0.0.1:8787`. Each new account starts a 14-day trial and creates
its first workspace. A single account can create or join multiple isolated
customer workspaces. Data is stored in `team/unmeet.db` by default.

For a shared server, set a persistent database path and place the app behind an
HTTPS reverse proxy:

```bash
UNMEET_HOST=0.0.0.0 UNMEET_PORT=8787 UNMEET_DB=/data/unmeet.db npm start
```

Or build the included Dockerfile and mount `/data` as a persistent volume.

Copy `.env.example` into your deployment's secret/environment configuration.
In production, `UNMEET_PUBLIC_URL`, HTTPS, persistent storage, database backups,
and reverse-proxy rate limits are required.

## SaaS capabilities

- Open registration or invite-only mode.
- Global user accounts with multiple workspace memberships.
- Tenant-scoped data, roles, sessions, meeting portfolios, and audit logs.
- Workspace switching for consultants serving multiple clients.
- 14-day trials and enforced member/meeting-series plan limits.
- Online payment is disabled by default for invoice/order-form sales.
- Resend email verification, invitations, and password recovery. Production
  never returns bearer invitation/reset tokens in an API response.
- Workspace usage, settings, recent-authenticated JSON export, and transactional
  hard deletion with a non-identifying receipt.
- Health endpoint at `/api/health`.

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
- **Google Workspace — ready:** read-only OAuth sync of the connected user's
  primary calendar, with encrypted refresh tokens and six-hour scheduled sync.
- **Microsoft 365 / Teams — ready:** read-only OAuth sync of the connected user's
  calendar through Microsoft Graph, with the same encryption and scheduling.
- **Feishu and Zoom — planned:** shown as roadmap connectors, not functioning ones.

Tencent Meeting provides meeting-platform evidence. For a complete view that
also includes in-person meetings or meetings hosted elsewhere, combine it with
the customer's calendar source or a standard calendar export.

The included `sample-baseline.csv`, `sample-followup.csv`, and
`sample-tencent-meeting.json` can be imported directly for a demonstration.

## Security boundary

Passwords use `scrypt` with a unique salt. Session and invitation tokens are
stored as SHA-256 hashes. OAuth tokens use authenticated encryption. Sessions
use HttpOnly, SameSite=Strict, Secure production cookies with idle and absolute expiry;
mutations reject cross-origin browser requests; responses include restrictive
content and framing headers. Every import, invite, join, and decision is written
to the server-side audit log.

Before production use, complete every external gate in
[`ops/LAUNCH_CHECKLIST.md`](../ops/LAUNCH_CHECKLIST.md). The included SQLite deployment is
suitable for a first single-instance SaaS. Move persistence to managed Postgres
before horizontal scaling or enterprise availability commitments.

Backups intentionally omit sessions, reset/verification tokens, pending OAuth
state, and calendar credentials. After a restore, users sign in again and an
administrator reconnects calendar sources. This prevents retained backups from
silently restoring third-party access after deletion or disconnect.

## Billing

Keep `UNMEET_ENABLE_BILLING=false`. The first commercial release is sold by
order form and invoice; live online payment is intentionally outside this scope.

## Email setup

Verify a sending domain with Resend and set `RESEND_API_KEY` and
`UNMEET_FROM_EMAIL`. Production startup rejects open signup without working
email configuration. Local development returns verification/invitation links
for testing; production never exposes those bearer tokens.

## Test

```bash
npm test
```
