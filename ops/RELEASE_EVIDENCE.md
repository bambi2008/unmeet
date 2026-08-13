# Release Evidence

Release candidate: `0.4.0`  
Evidence date: 2026-08-13  
Payment state: disabled by default (`UNMEET_ENABLE_BILLING=false`)

## Verified in the repository

- `npm run check`: 34 tests passed, 0 failed.
- Production configuration validation: passed with HTTPS URL, signup policy, and a 32-byte encryption key.
- Backup drill: a database containing sessions, account tokens, OAuth state, and a connector secret was backed up and restored successfully; the published backup retained one workspace and zero rows in all four sensitive tables.
- YAML parsing: deployment and CI configuration are syntactically validated in CI and the container image is built on each pull request.
- Security review `7d528517-0bba-4015-9227-0ba98a55206e`: complete production-surface coverage, zero open findings after remediation and independent re-review.
- Earlier browser acceptance: registration, workspace navigation, source import, settings, and rendering completed without console errors.

## Deliberate boundaries

- Online payment activation is excluded and remains off.
- The deployable architecture is one Node.js process and one SQLite database. Horizontal scaling and managed Postgres are not claimed.
- Google and Microsoft live OAuth acceptance requires the operator's production applications and redirect URIs.
- The local release environment did not contain Docker; the GitHub Actions container job is the authoritative image-build evidence.

## Go-live rule

Repository readiness does not replace the operator gates in `ops/LAUNCH_CHECKLIST.md`. Do not accept customer production data until the deployment-specific items have owners and evidence.
