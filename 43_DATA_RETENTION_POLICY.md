
# 43_DATA_RETENTION_POLICY.md

# CommandOS Data Retention Policy
Version: 1.0

## Purpose

Define how long CommandOS retains operational, user, and system data to balance compliance, performance, privacy, and business value.

---

## Guiding Principles

- Retain only what is necessary.
- Meet legal and contractual obligations.
- Support auditability.
- Allow secure deletion upon expiration.

---

## Data Classification

### Operational Data
Examples:
- Tasks
- Projects
- Flights
- Property records
- Reports

Retention:
- Active while in use
- Archived indefinitely unless organization policy specifies otherwise

---

### AI Data

Examples:
- Executive briefings
- AI recommendations
- Prompt history
- Workflow outputs

Retention:
- Default: 90 days
- Configurable by organization

---

### Authentication

Examples:
- Login history
- MFA events
- Session records

Retention:
- 1 year

---

### Audit Logs

Retention:
- Minimum 7 years

Immutable storage recommended.

---

### Analytics

Aggregated Metrics:
- Indefinite

Raw Events:
- 24 months

---

### Backups

Daily:
- 30 days

Weekly:
- 12 weeks

Monthly:
- 12 months

---

## Secure Deletion

Expired records are:

- Soft deleted
- Scheduled for permanent deletion
- Removed from backups according to backup lifecycle

---

## Legal Holds

Data subject to litigation or contractual preservation requirements is exempt from automatic deletion until the hold is released.

---

## Definition of Done

Every new data type has an assigned retention period, archival strategy, and deletion policy before production release.
