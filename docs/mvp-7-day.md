# Maksutov Growth System — MVP in 7 Days

## MVP goal
At the end of day 7 the system must reliably do four things:

1. Discover and score relevant companies, studios and jobs.
2. Store every opportunity, person, source and touchpoint in Supabase CRM.
3. Generate personalized outreach/application drafts from verified evidence.
4. Put every external action behind an explicit approval queue and produce a daily/weekly report.

The MVP is not a mass outreach bot. It is a research + qualification + drafting + approval system.

## Success criteria by end of day 7
- Supabase project can run all migrations without manual edits.
- One owner can sign in and see only their workspace data.
- Orchestrator can create/read/update CRM records through a restricted service surface.
- Lead, studio and job agents produce structured records with evidence and confidence.
- Outreach agent produces drafts but cannot send without A2 approval.
- Approval queue records immutable payload hashes and decision history.
- Daily digest shows new qualified opportunities, drafts waiting for approval, replies/outcomes and stale follow-ups.
- No duplicate contacts are created for normalized email/domain/profile URL.
- Suppression / do-not-contact is enforced before any outbound action.

---

## Day 1 — Foundation and scope

### Deliverables
- Repository conventions finalized.
- `AGENTS.md` becomes the system constitution.
- Agent registry reduced to MVP roles.
- Approval policy enforced in code/config, not only prose.
- Environment variable contract documented.

### MVP agents enabled
1. `orchestrator`
2. `lead_hunter`
3. `studio_hunter`
4. `job_hunter`
5. `outreach_writer`
6. `seo_auditor`
7. `analytics`

Content publishing, backlink outreach and public profile mutation remain phase 2. They may research/draft, but are not required to pass MVP acceptance.

### Done when
- Every agent has one clear responsibility, structured output and allowed tools.
- Every tool is mapped to A0/A1/A2/A3.

---

## Day 2 — Supabase CRM

### Deliverables
- Apply migrations in `supabase/migrations/`.
- Create owner workspace.
- RLS enabled for all user-facing CRM tables.
- Create enums, constraints, timestamps, indexes, dedupe keys and audit trail.
- Create read models / dashboard views.

### Core entities
- workspaces
- workspace_members
- companies
- people
- opportunities
- evidence
- drafts
- touchpoints
- approvals
- suppressions
- tasks
- agent_runs
- events

### Done when
- A test user can create a company and opportunity inside their workspace.
- A second user cannot read it.
- `service_role` is never exposed to browser/agent sandbox.

---

## Day 3 — Discovery pipeline

### Deliverables
- Lead Hunter: qualified direct clients.
- Studio Hunter: agencies/studios with overflow or freelance fit.
- Job Hunter: current contract/freelance/full-time roles.
- Normalization and deduplication before insert.
- Evidence objects stored separately from agent prose.

### Minimum structured output
```json
{
  "company": {},
  "person": {},
  "opportunity": {},
  "evidence": [],
  "score": 0,
  "confidence": 0,
  "recommended_next_action": "",
  "approval_level": "A1"
}
```

### Scoring MVP
Score 0–100:
- 0–25: current design need / trigger
- 0–20: portfolio fit
- 0–20: ability to pay / business quality
- 0–15: access to decision-maker
- 0–10: geography/language fit
- 0–10: urgency / timing

Qualified threshold: `>= 65`.
High priority: `>= 80`.

### Done when
- One run can ingest at least 10 candidates and retain only qualified, deduplicated opportunities.

---

## Day 4 — Outreach drafting and approvals

### Deliverables
- Outreach Writer reads CRM evidence only.
- Drafts are linked to exact opportunity/person.
- Approval request is created for every proposed external send.
- Approval stores payload hash so approved text cannot be silently changed.
- Suppression checks run before approval and again before execution.

### Draft quality rules
- 60–140 words for first cold email by default.
- One real observation.
- One relevant service/case connection.
- One low-friction CTA.
- No fake familiarity, fake audit or invented metrics.
- Language matches recipient.

### Done when
- Draft can be approved/rejected.
- Editing an approved draft invalidates approval and requires a new approval.

---

## Day 5 — SEO weekly loop

### Deliverables
- SEO Auditor writes findings into `tasks` instead of editing production directly.
- Track technical issues, commercial landing-page opportunities, internal linking, metadata/schema and content gaps.
- Each recommendation has impact, effort, evidence URL and acceptance criteria.

### Priority formula
`priority = impact (1–5) × confidence (0–1) × 10 / effort (1–5)`

### Done when
- Audit creates a ranked backlog without publishing anything.

---

## Day 6 — Orchestration, schedules and analytics

### Deliverables
- Orchestrator reads overdue tasks, new opportunities, approvals and recent run health.
- Daily run plan stored in CRM.
- Scheduled execution defined in `config/mvp-schedule.yaml`.
- Analytics produces daily digest and weekly funnel.

### MVP metrics
- discovered opportunities
- qualified opportunities
- drafts created
- approval rate
- messages sent (manual/external executor later)
- reply rate
- positive reply rate
- meetings
- proposals
- wins
- applications
- interviews
- SEO tasks opened/closed

### Done when
- A failed agent run does not corrupt CRM and appears in the digest.

---

## Day 7 — End-to-end acceptance

### Test scenario
1. Orchestrator starts a daily run.
2. Lead Hunter discovers a company and stores evidence.
3. Opportunity is scored >= 65.
4. Outreach Writer creates a personalized draft.
5. System creates A2 approval.
6. Owner approves.
7. External executor may send only the exact approved payload.
8. Touchpoint is logged.
9. Reply/outcome can be recorded.
10. Analytics reflects the funnel.

### Go-live checklist
- RLS verified with two users.
- Secrets only in server/Vault environment.
- No public mutation tool bypasses approvals.
- Duplicate/suppression checks pass.
- All agent outputs validate against schema.
- Schedules can be disabled globally with a kill switch.
- Error logs contain no secrets or full auth tokens.

---

## What is deliberately NOT in the 7-day MVP
- automatic mass email sending
- automatic LinkedIn messaging
- buying links
- automated account creation
- production website deployment without approval
- autonomous negotiation, contracts or pricing commitments
- scraping that violates site terms or bypasses access controls
- large content farm / programmatic SEO

These can be added only after the qualification and approval loops prove useful.
