# styles/

CommandOS uses Tailwind CSS v4. The single source of truth for design tokens
(colors, radii, fonts, dark theme) is [`app/globals.css`](../app/globals.css),
declared with CSS custom properties and exposed to Tailwind via `@theme inline`.

Add global, non-token stylesheets here (e.g. print styles, third-party
overrides) and import them from `app/layout.tsx`. Component styling stays
co-located as Tailwind utility classes.
