# CRM Schema

The canonical CRM implementation is the Supabase/Postgres migration set:

- `supabase/migrations/001_core.sql`
- `supabase/migrations/002_functions_triggers.sql`
- `supabase/migrations/003_rls.sql`
- `supabase/migrations/004_views.sql`

Design rationale and acceptance tests: `docs/supabase-crm.md`.

## System-of-record rules
- `workspace_id` scopes all operational data.
- Companies and people are deduplicated before new opportunity creation.
- Evidence is first-class and separate from agent inference.
- Drafts are versioned and hashed.
- External actions require an approval whose hash matches the current payload.
- Suppression overrides tasks, campaigns and agent recommendations.
- Touchpoints capture external interaction history.
- Events are append-only lifecycle analytics/audit records.
- Agent runs capture execution health and observability.
