
# 39_ERROR_CATALOG.md

# CommandOS Error Catalog
Version: 1.0

## Purpose

Define standardized application error codes, messages, severity levels, and recovery guidance to ensure consistent user experience, logging, and troubleshooting.

---

## Error Code Format

CMD-<DOMAIN>-<NUMBER>

Examples:

- CMD-AUTH-001
- CMD-AI-014
- CMD-FLIGHT-007

---

## Domains

AUTH
API
AI
FLIGHT
TASK
PROPERTY
CALENDAR
INTEGRATION
SYSTEM
DATABASE

---

## Severity Levels

- Info
- Warning
- Error
- Critical

---

## Standard Error Structure

Each error contains:

- Error Code
- Title
- User Message
- Technical Description
- Suggested Resolution
- Log Level
- Retryable (Yes/No)

---

## Example Errors

### CMD-AUTH-001

Title:
Authentication Failed

User Message:
Unable to sign in. Please verify your credentials and try again.

Retryable:
Yes

---

### CMD-AI-003

Title:
AI Request Timed Out

User Message:
The AI assistant took too long to respond. Please try again.

Retryable:
Yes

---

### CMD-FLIGHT-005

Title:
Weather Unsafe

User Message:
Current weather conditions exceed configured flight safety limits.

Retryable:
No (until conditions change)

---

### CMD-SYSTEM-001

Title:
Unexpected System Error

User Message:
An unexpected error occurred. The issue has been logged.

Retryable:
Depends on context

---

## Logging Requirements

Every error records:

- Timestamp
- User ID
- Organization ID
- Correlation ID
- Service
- Stack Trace (internal only)

---

## Definition of Done

Every recoverable application error is documented, assigned a unique code, and surfaced with user-friendly messaging.
