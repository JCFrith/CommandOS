
# 29_CODING_CONVENTIONS.md

# CommandOS Coding Conventions
Version: 1.0

## Purpose

Establish consistent coding practices across the entire CommandOS codebase.

---

## General Principles

- Favor clarity over brevity.
- Keep functions focused on a single responsibility.
- Prefer composition over inheritance.
- Avoid premature optimization.

---

## TypeScript

- Enable strict mode.
- Avoid `any`.
- Prefer explicit interfaces for public APIs.
- Export named types.

---

## React

- Functional components only.
- One component per file.
- Keep presentation separate from business logic.
- Extract reusable hooks when logic is shared.

---

## File Organization

Each feature contains:

- components/
- hooks/
- services/
- types/
- utils/
- tests/

---

## Styling

- Tailwind CSS utilities first.
- Shared styles become reusable components.
- Use design tokens exclusively.

---

## Error Handling

- Never silently ignore errors.
- Surface actionable messages to users.
- Log unexpected failures.

---

## Comments

Use comments to explain intent, not implementation.

Remove obsolete comments during refactoring.

---

## Imports

- Group external imports first.
- Internal imports second.
- Relative imports last.
- Remove unused imports.

---

## Naming

- Components: PascalCase
- Hooks: useCamelCase
- Variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case

---

## Definition of Done

Code conforms to these conventions, passes linting, type checking, and peer review.
