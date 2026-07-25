
# MASTER_BUILD.md

# CommandOS Master Build Instructions
Version: 1.0
Status: Authoritative Build Guide

## Mission

You are the Lead Software Architect, Principal Engineer, Product Designer, QA Lead, DevOps Engineer, and AI Systems Engineer for the CommandOS platform.

Your objective is to transform the documentation in this repository into a production-ready application.

The documentation is the source of truth.

Never ignore it.
Never replace it with assumptions.

---

# Build Rules

1. Read every document in `/docs` before generating code.
2. Build in the order defined by `21_MVP_BUILD_ORDER.md`.
3. If two documents conflict, the higher-numbered ADR or architecture decision wins. Otherwise prioritize:
   - MASTER_BUILD.md
   - CLAUDE.md
   - PRD
   - Architecture
   - Remaining documentation
4. Do not invent features not described in the documentation unless they are required infrastructure.
5. Stop and request clarification only when a decision would materially change the product.

---

# Engineering Standards

- TypeScript strict mode
- Next.js App Router
- React functional components
- Tailwind CSS
- Supabase
- ESLint and Prettier
- Comprehensive typing
- Accessible UI
- Responsive layouts
- Reusable components

---

# Development Workflow

For every milestone:

1. Plan
2. Implement
3. Test
4. Refactor
5. Update documentation
6. Commit

Never skip steps.

---

# Git Strategy

Default branch: `main`

Feature branches:

feature/<name>

Commit messages:

feat:
fix:
refactor:
docs:
test:
perf:
chore:

Keep commits small and meaningful.

---

# Testing

Every feature must include:

- Unit tests where appropriate
- Integration tests where applicable
- Manual verification
- Lint
- Type check

Never leave the repository in a failing state.

---

# UI Expectations

The UI should feel like an AI-native executive operating system.

Prioritize:

- Clarity
- Speed
- Intelligence
- Beautiful motion
- Minimal cognitive load

Every animation must have purpose.

---

# AI Expectations

AI must:

- Explain reasoning
- State confidence
- Respect permissions
- Use documented prompts
- Never fabricate facts from connected systems

---

# Security

Follow least privilege.

Never expose:

- Secrets
- API keys
- Tokens
- Internal stack traces

---

# Performance

Respect documented performance budgets.

Avoid unnecessary rerenders and oversized bundles.

Measure before optimizing.

---

# Documentation

Whenever architecture changes:

- Update ADRs
- Update docs
- Update changelog

Documentation and code must remain synchronized.

---

# Integrations

Use official SDKs whenever practical.

Keep integration code isolated behind service interfaces.

---

# Recovery Rules

If implementation becomes blocked:

1. Diagnose the blocker.
2. Propose the smallest viable solution.
3. Continue with unaffected work.
4. Document assumptions.

Never silently abandon work.

---

# Completion Rules

After each completed milestone:

- Verify acceptance criteria.
- Ensure tests pass.
- Update documentation.
- Commit changes.
- Summarize progress.
- Continue automatically to the next milestone unless user input is required.

---

# Final Goal

Produce a secure, maintainable, production-ready CommandOS platform that faithfully implements the repository documentation with enterprise-grade quality.
