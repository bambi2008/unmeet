# Disaster Recovery

Initial service objectives: RPO 24 hours and RTO 8 hours. Daily encrypted database backups are stored outside the application volume and retained for 30 days. A monthly restore drill must restore the newest backup into an isolated environment, run `npm run restore:check`, start the service, verify tenant counts and a read-only user journey, then record duration and evidence.

The backup command removes live sessions, account/reset tokens, pending OAuth states, and calendar connector credentials from every backup copy. Restored users must sign in again and administrators must reconnect calendar sources. This deliberately prevents a retained backup from silently resuming third-party calendar access.

Recovery order: isolate the failed deployment; provision clean infrastructure; restore secrets from the secret manager; restore the latest verified database; deploy the pinned image; validate health, authentication, tenant isolation, imports, and export; switch traffic; monitor; document actual data-loss window. Never overwrite the only backup or the failed source volume.
