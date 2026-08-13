# UnMeet commercial MVP

This is a browser-based demonstrator for the commercial Meeting Reset workflow.
It is deliberately separate from the earlier personal meeting-tracker prototype.

## Run it

Open `index.html` directly in a browser, or serve the repository root with any
static file server and navigate to `/app/`.

The included sample workspace demonstrates:

- recurring-meeting portfolio ranking;
- owner review decisions;
- planned-savings previews;
- verified-savings reporting;
- local CSV import and report export;
- browser-local persistence.

## CSV schema

Required columns:

```csv
title,owner,team,duration_minutes,attendee_count,occurrences_per_month,has_agenda,age_months
Weekly Product Sync,Maya Chen,Product,60,18,4,true,12
```

## Test the calculation layer

```bash
node --test app/core.test.js
```

## Current boundary

This MVP validates the workflow and commercial demo. It does not yet include
Google Workspace OAuth, multi-tenant authentication, billing, email delivery,
or a server-side audit log. Imported data remains in browser `localStorage`.
