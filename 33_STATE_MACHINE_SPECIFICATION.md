
# 33_STATE_MACHINE_SPECIFICATION.md

# CommandOS State Machine Specification
Version: 1.0

## Purpose

Define lifecycle states and valid transitions for core platform entities.

---

## Task

States:
- Draft
- Planned
- In Progress
- Blocked
- Completed
- Archived

Valid Transitions:
- Draft -> Planned
- Planned -> In Progress
- In Progress -> Blocked
- Blocked -> In Progress
- In Progress -> Completed
- Completed -> Archived

---

## Flight

States:
- Planned
- Preflight
- Active
- Paused
- Completed
- Aborted

---

## Inspection

States:
- Scheduled
- Active
- Awaiting Review
- Approved
- Published

---

## AI Workflow

States:
- Requested
- Processing
- Awaiting Confirmation
- Executing
- Completed
- Failed

---

## Rules

- Invalid transitions are rejected.
- Every transition is timestamped.
- Every transition generates an audit event.
- State changes may publish domain events.

---

## Definition of Done

Each new domain entity includes documented states, transitions, and validation rules.
