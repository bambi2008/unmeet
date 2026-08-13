# Data Retention and Deletion

- Active workspace data: retained for the contract term.
- Expired invitations and account tokens: purge after 30 days.
- Active sessions: seven-day absolute limit and twelve-hour idle limit.
- Audit events: 12 months by default; enterprise contracts may override.
- Failed sync diagnostics: 30 days; never store OAuth tokens in diagnostics.
- Deleted workspaces: live records are transactionally hard-deleted immediately.
- Encrypted backups: daily, retained 30 days, then irreversibly expired.
- Backup copies exclude sessions, account tokens, pending OAuth state, and calendar connector credentials; restored calendar sources require reauthorization.
- Hashed deletion receipts: retained 24 months without direct identifiers.

The operator must schedule token/log cleanup and backup expiry in its hosting platform. Customer export and deletion are available to administrators after recent password confirmation.
