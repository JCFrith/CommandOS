# 03_DATABASE_SCHEMA.md

# CommandOS Database Schema
Version: 0.1

---

# Purpose

This document defines the foundational relational database design for CommandOS.

The schema is designed for long-term growth, multi-user support, enterprise deployments, and AI-assisted workflows.

---

# Design Principles

- PostgreSQL (Supabase)
- UUID primary keys
- Soft deletes (`deleted_at`)
- Audit timestamps (`created_at`, `updated_at`)
- Row Level Security
- Migration-first development
- No direct production schema edits

---

# Core Conventions

Every table should contain:

- id (UUID)
- created_at
- updated_at
- deleted_at (nullable)

Business tables additionally include:

- organization_id
- created_by
- updated_by

---

# Domain Overview

```text
Organization
 ├── Users
 ├── Clients
 │    └── Properties
 │          ├── Buildings
 │          ├── Inspections
 │          ├── Documents
 │          └── Photos
 ├── Projects
 │    └── Tasks
 ├── Flights
 │    ├── Aircraft
 │    ├── Pilots
 │    └── Flight Logs
 ├── Intelligence
 ├── Weather
 ├── Calendar
 ├── Health
 └── AI
```

---

# Initial Tables

## organizations
Stores each tenant/company.

## users
Authentication profile and preferences.

## roles
Permission groups.

## permissions
Granular authorization.

## user_roles
Many-to-many relationship.

---

# Client Domain

clients

contacts

properties

buildings

sites

documents

photos

inspection_programs

inspection_reports

thermography_reports

cope_reports

risk_events

---

# Operations Domain

projects

tasks

task_comments

task_labels

task_dependencies

attachments

notifications

---

# Flight Operations

aircraft

pilots

missions

flights

flight_logs

maintenance

batteries

weather_snapshots

laanc_requests

notams

tfrs

---

# Intelligence

news_articles

news_sources

intelligence_tags

risk_alerts

industry_events

---

# Health

health_profiles

daily_metrics

sleep_sessions

strain_scores

recovery_scores

wearable_sync_jobs

---

# AI

ai_conversations

ai_messages

ai_memory

ai_embeddings

ai_actions

prompt_templates

---

# Relationships

organizations
    |
    +-- users
    +-- clients
    +-- projects
    +-- flights
    +-- intelligence
    +-- health

clients
    |
    +-- properties
            |
            +-- buildings
            +-- inspections
            +-- documents

projects
    |
    +-- tasks
           |
           +-- comments
           +-- attachments

---

# Indexing Strategy

Create indexes for:

- foreign keys
- created_at
- updated_at
- due_date
- priority
- organization_id
- status
- search fields

Use full-text search where appropriate.

---

# Soft Deletes

Never permanently delete production records.

Use:

deleted_at TIMESTAMP NULL

Application logic excludes deleted records by default.

---

# Audit Logging

Every critical action should create an audit record.

Capture:

- actor
- timestamp
- action
- target entity
- previous value
- new value

---

# Row Level Security

All tables should enforce organization isolation.

Policies should ensure users only access records belonging to their organization unless explicitly authorized.

---

# Future Expansion

Reserved domains include:

- Finance
- CRM
- Inventory
- Procurement
- Fleet Telemetry
- AI Planning
- Voice Commands
- Mobile Sync
- Offline Queue
- External APIs

---

# Migration Rules

- Never edit existing migrations.
- Every schema change requires a new migration.
- Seed data stored separately.
- Schema changes reviewed before merge.

---

# Definition of Done

A schema update is complete when:

- Migration created
- Rollback tested
- Indexes evaluated
- RLS policies added
- Documentation updated
- Tests passing
