# Production Launch Gate

## Repository-complete controls

- [x] Tenant-scoped roles, member lifecycle, last-admin protection, and audit trail.
- [x] Email verification, password recovery/change, session expiry/revocation, and recent-auth gates.
- [x] Hard deletion, export, documented retention, import complexity limits, and encrypted OAuth secrets.
- [x] CSV/Tencent import plus Google and Microsoft read-only OAuth sync.
- [x] Payment explicitly disabled by default.
- [x] Non-root hardened container, HTTPS proxy sample, health check, CI, backups, and restore validator.
- [x] Privacy, terms, DPA, subprocessors, security, support, incident, and disaster-recovery templates.
- [x] Automated functional/security regression tests and production configuration validation.
- [x] Release evidence record covering tests, security review, backup/restore, and known boundaries.

## Deployment-specific gates (must be evidenced by the operator)

- [ ] Select legal entity, privacy/security/support contacts, governing law, and have counsel approve customer documents.
- [ ] Select hosting/monitoring vendors, region, DPAs, SCCs, subprocessors, encrypted backup target, and alert recipients.
- [ ] Configure DNS, TLS, secret manager, email-domain authentication, log redaction, uptime monitoring, and backup schedule.
- [ ] Register and obtain any required Google/Microsoft OAuth verification; validate each production redirect URI.
- [ ] Perform an independent penetration test and close all high findings.
- [ ] Run and record a restore drill, incident tabletop, accessibility review, and browser/device acceptance test.
- [ ] Load-test expected customer size and document the single-instance capacity limit.
- [ ] Name on-call/support owners and sign the go/no-go record.

No customer production data should be accepted until every deployment-specific gate has an owner, evidence link, and approval date.
