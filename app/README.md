# UnMeet commercial MVP

This is a local-first tool for running a complete recurring-meeting reset with
real CSV data. It is deliberately separate from the earlier personal
meeting-tracker prototype.

## Run it

Open `index.html` directly in a browser, or serve the repository root with any
static file server and navigate to `/app/`.

The tool supports:

- recurring-meeting portfolio ranking;
- owner review decisions;
- planned-savings previews;
- verified-savings reporting;
- baseline and follow-up CSV imports;
- automatic high/medium-confidence series matching;
- expected-absence verification for canceled or async meetings;
- reporting of both recovered and increased meeting load;
- printable management reports and JSON audit exports;
- portable project save/restore files;
- browser-local persistence.

## Real workflow

1. Open **Data & privacy** and import a baseline CSV.
2. Review selected meeting series and save owner decisions.
3. After the decisions take effect, import the follow-up period CSV.
4. Inspect matching confidence, missing series, increased load, and verified
   changes on **Results**.
5. Print the management report and save the portable project file.

Use `sample-baseline.csv` and `sample-followup.csv` to exercise this workflow.

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

This release is a functional single-user local tool. It does not include Google
Workspace OAuth, multi-tenant collaboration, billing, email delivery, or a
server-side audit log. Imported data remains in browser `localStorage`; use
**Save project** to create backups or move a project to another browser.
