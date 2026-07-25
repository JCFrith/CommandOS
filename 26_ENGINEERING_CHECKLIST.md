
# 26_ENGINEERING_CHECKLIST.md

# CommandOS Engineering Checklist
Version: 1.0

## Purpose

Provide a standardized engineering checklist for every feature, bug fix, and release.

---

## Planning

- Requirements reviewed
- Acceptance criteria defined
- Dependencies identified
- Risks documented

---

## Architecture

- Conforms to system architecture
- Uses approved patterns
- No duplicated business logic
- Service layer updated if required

---

## Development

- TypeScript strict mode passes
- Reusable components preferred
- Design tokens used
- Feature flags applied when needed

---

## Data

- Database migrations created
- Indexes reviewed
- Row Level Security updated
- Seed data updated if required

---

## API

- Request/response models typed
- Error handling implemented
- Retry logic applied where appropriate
- Logging added

---

## User Experience

- Responsive layouts
- Accessible interactions
- Loading states
- Empty states
- Error states

---

## Testing

- Unit tests
- Integration tests
- End-to-end tests
- Manual verification

---

## Performance

- Meets performance budgets
- No unnecessary renders
- Network requests optimized
- Assets optimized

---

## Security

- Authorization verified
- Inputs validated
- Outputs sanitized
- Secrets protected

---

## Documentation

- Technical documentation updated
- Changelog updated
- ADR added if architecture changed

---

## Deployment

- Preview deployment verified
- Monitoring enabled
- Rollback confirmed

---

## Completion

A task is complete only after every applicable checklist item has been reviewed and satisfied.
