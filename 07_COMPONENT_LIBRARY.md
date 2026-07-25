
# 07_COMPONENT_LIBRARY.md

# CommandOS Component Library
Version: 1.0

## Purpose

This document defines every reusable UI component used throughout CommandOS.

---

## Component Standards

Every component must include:

- Purpose
- Props
- States
- Variants
- Accessibility
- Animations
- Usage Notes

---

# Layout Components

## AppShell

Purpose:
Primary application container.

Contains:
- Sidebar
- Header
- Content
- Notification Layer

---

## Sidebar

Features

- Collapsible
- Icons
- Labels
- Active indicator
- Keyboard navigation

---

## Header

Contains

- Search
- Global actions
- AI access
- User menu
- Notifications

---

# Dashboard Components

## ExecutiveBrief

Displays

- Daily summary
- Risks
- Priorities
- Recommendations

---

## MissionCard

Displays

- Objectives
- Progress
- Completion
- Next actions

---

## MetricCard

Fields

- Title
- Value
- Trend
- Delta
- Timestamp

Variants

- Health
- Revenue
- Weather
- Flights
- Tasks

---

## StatusBadge

States

- Success
- Warning
- Error
- Offline
- Pending
- Active

---

## HealthRing

Displays

- Recovery
- HRV
- Sleep
- Strain

Animated progress ring.

---

## WeatherTile

Displays

- Temperature
- Conditions
- Wind
- Alerts

---

## FlightTile

Displays

- Aircraft
- Pilot
- Mission
- Status
- Weather

---

## IntelligenceCard

Displays

- Source
- Summary
- AI Impact
- Recommended Action

---

## PortfolioCard

Displays

- Client
- Property Count
- Open Risks
- Inspection Status

---

# Task Components

## TaskCard

Contains

- Checkbox
- Priority
- Due Date
- Labels
- Comments
- Attachments

---

## TaskList

Supports

- Drag reorder
- Filtering
- Search
- Grouping

---

# AI Components

## AIConsole

Supports

- Chat
- Citations
- Suggested actions
- Tool execution

---

## AIInsight

Displays

- Recommendation
- Confidence
- Supporting evidence

---

# Data Components

## DataTable

Features

- Sorting
- Filtering
- Search
- Pagination
- Sticky Header

---

## Timeline

Displays

- Meetings
- Flights
- Tasks
- Events

---

## ActivityFeed

Chronological event stream.

---

# Map Components

## OperationsMap

Layers

- Flights
- Client Sites
- Weather
- Airspace

---

# Overlay Components

## CommandPalette

Keyboard

Cmd/Ctrl + K

Supports

- Navigation
- Search
- Commands

---

## NotificationCenter

Groups

- Critical
- Warning
- Info
- Success

---

## Modal

Sizes

- Small
- Medium
- Large
- Fullscreen

---

## Drawer

Placement

- Left
- Right
- Bottom

---

# Feedback Components

## SkeletonLoader

Used for loading states.

---

## EmptyState

Includes

- Illustration
- Explanation
- Call to action

---

## ErrorState

Includes

- Error summary
- Retry
- Details

---

# Accessibility

Every component must support

- Keyboard navigation
- Screen readers
- Focus management
- High contrast compatibility

---

# Definition of Done

A component is complete when:

- Fully documented
- Tested
- Accessible
- Responsive
- Uses design tokens
- Includes loading, empty, and error states
