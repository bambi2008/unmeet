# Production Runbook

## Deploy

1. Provision one encrypted persistent volume and a production secrets store.
2. Set the variables in `.env.example`; keep billing disabled. Require HTTPS, a 32-byte encryption key, and transactional email if signup is open.
3. Point DNS at the host, run `docker compose up -d`, and verify `/api/health` through the public hostname.
4. Complete Google/Microsoft redirect URI registration only for connectors being offered.
5. Run `npm run check`, create a backup, and verify it with `npm run restore:check -- <file>` before each release.

## Operate

Back up daily, retain encrypted backups for 30 days, monitor health every minute, alert on five-minute outage or repeated 5xx responses, and review failed syncs/security events daily. Do not log request bodies, cookies, passwords, reset/invite tokens, or OAuth credentials. Roll back by redeploying the prior immutable image; restore the database only after preserving the failed volume for investigation.

## Scale boundary

This release is a single-instance SQLite service. It is appropriate for early paid teams with scheduled backups, but not active-active deployment or enterprise availability commitments. Move to managed Postgres before horizontal scaling.
