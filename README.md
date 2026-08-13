# UnMeet

> Review expensive recurring meetings. Verify the time you get back.

UnMeet is a meeting-governance product for 50–250 person software companies.
It uses calendar metadata to help teams review recurring meetings, record
decisions to shorten or cancel them, and measure the meeting hours actually
recovered.

The repository now includes a multi-tenant SaaS product and an earlier
single-user browser edition. The team product is the current product surface.

## Run UnMeet Team

Requires Node.js 22.5 or newer.

```bash
npm start
```

Open `http://127.0.0.1:8787`, create the first administrator, import a baseline,
and invite meeting owners. The SaaS edition includes multiple isolated customer
workspaces per account, four roles, subscription plans, invitation email,
owner-scoped access, email/password recovery, session controls, export/hard
deletion, and audit logs. Standard CSV and Tencent Meeting JSON work directly;
Google Workspace and Microsoft 365 provide read-only OAuth calendar sync when
the operator configures the corresponding application credentials.

See [the team deployment and operation guide](./team/README.md).

## Try the commercial MVP

Open [`app/index.html`](./app/index.html) in a browser. The sample workspace
supports portfolio ranking, owner decisions, planned-savings previews,
verified-savings reporting, CSV import, report export, and browser-local
persistence.

```bash
node --test app/core.test.js
```

The app is a working single-user local tool: it accepts baseline and follow-up
periods, automatically matches recurring series, verifies observed changes,
prints management reports, and saves/restores complete project files. For team
use, run the server-backed edition above.

## Prototype capabilities

- Browser-tab meeting detection for several meeting platforms.
- Local duration tracking, hourly-rate estimates, and optional ratings.
- An experimental Electron dashboard and meeting classifier.
- A static landing-page cost calculator.

These capabilities are prototypes. Team analytics, verified savings, recurring
meeting review, production-grade privacy controls, and billing are not complete.

## Current product direction

The commercial product is a channel-assisted 30-day Meeting Reset, followed by
a recurring governance subscription. English-speaking operations consultants
lead customer reviews while UnMeet provides the audit, decision workflow, and
verified results:

1. Import a calendar or meeting-platform data source with minimum permissions.
2. Establish a recurring-meeting baseline.
3. Rank recurring meetings by monthly person-hours invested.
4. Assign each selected series to its owner for an explicit decision.
5. Verify which changes actually took effect after 30 days.
6. Continue with monthly monitoring and quarterly meeting renewal.

UnMeet does not need meeting audio or transcripts for this workflow.

## Project Status

**Deployable single-instance SaaS release.** Multi-tenancy, calendar sync,
account and member lifecycle, transactional email, encrypted connector secrets,
data controls, backups, CI, and operating/legal templates are implemented.
Online payment is intentionally disabled. Enterprise SSO/SCIM, active-active
hosting, and managed Postgres remain explicit enterprise-scale work.

The repository release evidence is recorded in
[`ops/RELEASE_EVIDENCE.md`](./ops/RELEASE_EVIDENCE.md); deployment-specific
operator gates remain in [`ops/LAUNCH_CHECKLIST.md`](./ops/LAUNCH_CHECKLIST.md).

## Product documents

- [Commercial product definition v4](./产品定义-v4-商业版.md)
- [Product definition v3](./产品定义-v3.md)
- [Product assessment and market opportunity](./产品评估与市场机会-2026-07.md)
- [Earlier product definition v2](./产品定义-v2.md)

## Structure

```
unmeet/
├── landing/           # Landing page + waitlist
│   └── index.html
├── app/               # Commercial Meeting Reset MVP
│   ├── index.html
│   ├── app.js
│   ├── core.js
│   ├── core.test.js
│   └── styles.css
├── team/              # Server-backed team edition
│   ├── public/        # Shared team workspace UI
│   ├── connectors/    # CSV and Tencent Meeting adapters
│   ├── saas-db.js     # Accounts, tenants, roles, plans, audit
│   └── server.js      # HTTP API and static server
├── extension/         # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js  # Service worker — time tracking engine
│   ├── content.js     # Meeting page detection + rating UI
│   ├── popup.html     # Popup dashboard
│   ├── popup.js
│   ├── options.html   # Settings page
│   ├── options.js
│   └── icons/
├── desktop/           # Experimental Electron prototype
├── privacy/           # Privacy-policy prototype
├── 产品定义-v4-商业版.md
├── 产品定义-v3.md
├── 产品评估与市场机会-2026-07.md
└── README.md
```

## Development

```bash
# Load unpacked extension in Chrome:
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the `extension/` directory
```

The desktop prototype is not currently recommended for distribution. Its
implementation still contains code from an abandoned recording/AI-analysis
direction and must be aligned with the metadata-only product definition before
testing with users.

## License

MIT
