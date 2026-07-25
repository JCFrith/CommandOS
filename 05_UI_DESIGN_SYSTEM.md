
# 05_UI_DESIGN_SYSTEM.md

# CommandOS UI Design System
Version: 1.0

## Design Philosophy

- Executive-first
- Information before decoration
- Motion communicates state
- Consistent interaction patterns
- Minimal cognitive load

---

## Design Tokens

### Colors

Primary
- #3B82F6

Success
- #22C55E

Warning
- #F59E0B

Danger
- #EF4444

Background
- #070B12

Surface
- #111827

Glass
- rgba(255,255,255,0.08)

Border
- rgba(255,255,255,0.12)

Text Primary
- #F8FAFC

Text Secondary
- #94A3B8

---

## Typography

Display: 48–64px

H1: 36px

H2: 30px

H3: 24px

Body: 16px

Caption: 13px

Mono: Metrics and telemetry only.

---

## Spacing

4
8
12
16
24
32
48
64

Use an 8-point grid.

---

## Corner Radius

Cards: 20px

Buttons: 12px

Inputs: 12px

Dialogs: 24px

---

## Elevation

Level 0: Flat

Level 1: Glass panel

Level 2: Floating panel

Level 3: Modal

---

## Motion

Default Duration: 200ms

Complex: 350ms

Page Transition: 450ms

Use spring animations for movement.

---

## Layout

Persistent left navigation.

Top command bar.

Responsive content grid.

Widget system supports drag/reorder.

---

## Components

### Button

Variants

- Primary
- Secondary
- Ghost
- Danger
- Icon
- Floating

States

- Default
- Hover
- Pressed
- Focused
- Disabled
- Loading

---

### Card

Standard structure

- Header
- Body
- Footer

Optional

- Actions
- Status badge
- Trend indicator

---

### Metric Card

Contains

- Title
- Current value
- Delta
- Sparkline
- Timestamp

---

### Task Card

Fields

- Checkbox
- Priority
- Due date
- Labels
- Assignee

Completed tasks animate to completed section.

---

### Intelligence Feed

Each article displays

- Source
- Timestamp
- AI summary
- Relevance
- Suggested action

---

### AI Panel

Supports

- Conversation
- Citations
- Suggested actions
- Tool execution status

---

## Tables

Sticky header

Resizable columns

Sortable

Searchable

Keyboard accessible

---

## Maps

Support

- Satellite
- Streets
- Terrain

Overlay

- Flights
- Weather
- Client sites
- Airspace

---

## Charts

Preferred

- Line
- Bar
- Area
- Donut

Avoid unnecessary 3D effects.

---

## Notifications

Levels

- Critical
- Warning
- Success
- Informational

Critical alerts remain until acknowledged.

---

## Empty States

Always explain:

- Why there is no data
- What the user can do next

---

## Loading States

Use skeleton loaders.

Avoid spinners unless progress is unknown.

---

## Accessibility

WCAG AA

Keyboard navigation

Visible focus

Minimum touch target 44x44px

---

## Responsive Breakpoints

Mobile: <768px

Tablet: 768–1279px

Desktop: 1280px+

---

## Visual Rules

Never use decorative animation.

Every animation must communicate:

- State
- Progress
- Focus
- Feedback

---

## Definition of Done

A screen is complete when it:

- Matches design tokens
- Meets accessibility requirements
- Performs at 60 FPS
- Is responsive
- Uses approved components only
