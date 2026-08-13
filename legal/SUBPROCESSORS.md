# Subprocessor Register Template

| Service | Purpose | Data | Region/transfer | Status |
|---|---|---|---|---|
| Selected cloud host | Application and encrypted-volume hosting | Customer workspace data | Set at deployment | Must select |
| Resend | Transactional email | Recipient, subject, delivery metadata | Confirm contract/region | Implemented, optional |
| Google | Customer-authorized Calendar API | Calendar metadata and OAuth exchange | Customer's Google terms | Optional connector |
| Microsoft | Customer-authorized Graph API | Calendar metadata and OAuth exchange | Customer's Microsoft terms | Optional connector |
| Selected monitoring provider | Errors and uptime; redact customer payloads | Operational metadata | Set at deployment | Must select |

The operator must publish legal entity names, locations, transfer mechanisms, links, and a customer change-notice process before production onboarding.
