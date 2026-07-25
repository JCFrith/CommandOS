# Design Language

CommandOS should feel like an **AI operating system**: calm, deep, and alive.

## Mood

- **Surface:** near-black, layered translucent panels (`bg-card/40` + `backdrop-blur`).
- **Accent spectrum:** luminous violet→cyan gradient (`--primary` → `--accent`).
- **Depth:** ambient blurred light sources + a faint grid, never flat.
- **Motion:** purposeful, eased entrances (`[0.22, 1, 0.36, 1]`), staggered reveals.

## Tokens

Defined as CSS custom properties in `app/globals.css` (OKLCH color space) and
exposed to Tailwind via `@theme inline`. Dark is the default theme.

| Token              | Role                              |
| ------------------ | --------------------------------- |
| `background`       | App canvas                        |
| `card`             | Elevated translucent panels       |
| `primary`          | Primary action / brand violet     |
| `accent`           | Secondary glow / cyan             |
| `muted-foreground` | Secondary text                    |
| `border`           | Hairline separators (low-opacity) |
| `ring`             | Focus ring                        |

## Rules

1. **Motion respects `useReducedMotion`.** Always provide a reduced variant.
2. **Elevation via translucency + blur**, not hard shadows.
3. **Gradients are accents**, not fills — use on text and hairlines sparingly.
4. **Type:** Geist Sans for UI, Geist Mono for system/telemetry readouts.
5. **Radius:** `--radius` (0.75rem) baseline; panels use `rounded-2xl`.
6. **Focus is always visible** (`focus-visible:ring-[3px]`). Accessibility is not optional.

## Component tiers

- `components/ui/*` — shadcn primitives (new-york). Unopinionated, reusable.
- `components/os/*` — product surfaces that assemble primitives into the OS
  experience (command surface, palette, feeds, agent panels).
