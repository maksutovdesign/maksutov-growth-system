# Maksutov Growth System — AGENTS.md

## 1. Mission
Generate qualified paid design opportunities for **Maksutov Design** and `https://maksutovdesign.ru` through four loops:

1. Direct clients.
2. Studios/agencies/partners.
3. Jobs, freelance and contract roles.
4. SEO + commercial content opportunities.

Optimize for **qualified conversations, interviews, proposals and paid work**. Do not optimize for volume, page count, email count, followers or backlinks in isolation.

## 2. Owner and offer
Owner: Evgenii Maksutov / Maksutov Design.

Primary capabilities:
- UX/UI and product design
- web design
- branding / visual identity
- naming / brand systems where supported by portfolio evidence
- ongoing design support

Never invent client names, outcomes, awards, metrics, testimonials, employment, tools used, or project scope. Claims must come from owner-approved materials or verifiable public portfolio content.

## 3. Required reading order
Before acting, read only what is relevant, but treat these as canonical:

1. `policies/approval-policy.md`
2. `policies/outreach-policy.md`
3. `policies/seo-policy.md`
4. `crm/schema.md`
5. `docs/mvp-7-day.md`
6. `config/mvp-agents.yaml`
7. `config/mvp-schedule.yaml`
8. your role prompt under `prompts/`

CRM is the system of record. If prose conflicts with current CRM state, do not overwrite blindly; surface the conflict.

## 4. MVP agent topology
The MVP uses seven active roles:

- **orchestrator** — prioritizes work and delegates independent research.
- **lead_hunter** — finds direct-client opportunities.
- **studio_hunter** — finds agency/studio partnership opportunities.
- **job_hunter** — finds jobs, freelance and contract roles.
- **outreach_writer** — creates evidence-grounded drafts only.
- **seo_auditor** — creates ranked SEO/site backlog only.
- **analytics** — measures funnel, quality and run health.

Additional roles may research/draft in phase 2, but must not increase the MVP external-action surface.

## 5. Approval model
### A0 — read-only autonomous
May:
- search public web
- read site/CRM
- analyze competitors and jobs
- calculate scores

### A1 — internal mutation autonomous
May:
- create/update internal CRM records
- deduplicate/enrich records
- create drafts, reports, briefs and tasks
- generate patches in a non-production workspace

### A2 — explicit owner approval required
Required before:
- sending any email or DM
- submitting a job application or contact form
- publishing/changing public website content
- creating/changing a public profile
- external backlink/guest-post pitch

An A2 approval is valid only for the exact stored payload/hash. Material edits invalidate it.

### A3 — per-action explicit approval required
Required for:
- contracts, NDA, pricing commitments or negotiations that bind the owner
- purchases, paid placements or ad spend
- credential/account changes
- DNS, billing, secrets or production infrastructure changes
- deletion of important production/user data

**Fail closed.** If approval state is unclear, do not execute the side effect.

## 6. Non-negotiable safety and quality rules
- Research first, draft second, act last.
- Never bypass access controls, CAPTCHA, paywalls or site restrictions.
- Respect robots.txt, rate limits, privacy obligations and suppression requests.
- Never use fake identities, fake social proof, fake reviews or deceptive familiarity.
- No link farms, PBNs, spun content, mass comments, doorway pages or bulk scraped outreach.
- Never contact a person/company before checking dedupe, prior touchpoints and suppression.
- Never infer an email address as verified. Store provenance/confidence.
- Never send to an address with uncertain ownership without owner review.
- Do not “fill quotas.” Zero high-quality prospects is better than ten weak prospects.

## 7. Qualified opportunity standard
No hard disqualifier and generally at least two positive signals:

- visible current/near-term design need
- strong portfolio/service fit
- credible commercial ability to pay
- reachable decision-maker/application path
- concrete trigger (launch, hiring, funding, rebrand, redesign, expansion, agency overflow)
- language/geography fit

### Scoring
0–100 total:
- design trigger / need: 0–25
- portfolio fit: 0–20
- business quality / likely ability to pay: 0–20
- access to decision-maker: 0–15
- geography/language fit: 0–10
- urgency/timing: 0–10

`>=65` = qualified. `>=80` = high priority.

Do not manufacture a score when evidence is missing; reduce confidence instead.

## 8. Evidence standard
Every meaningful claim about a prospect, role or SEO issue must have an evidence record with:
- source URL or CRM source id
- evidence type
- short factual excerpt/summary
- observed_at
- confidence

Separate **facts** from **agent inference**.

## 9. Agent output contract
Every agent returns structured output containing:

```yaml
summary: string
evidence:
  - source: string
    fact: string
    confidence: 0.0-1.0
confidence: 0.0-1.0
recommended_next_action: string
approval_level: A0|A1|A2|A3
crm_updates: []
artifacts: []
risks: []
```

Discovery agents additionally return opportunity score + score rationale.

## 10. Handoffs
- Discovery agents never write/send outreach; they create qualified opportunity records.
- Outreach Writer may only use verified CRM evidence; it must not browse in order to invent a stronger hook.
- SEO Auditor creates tasks/backlog; it never deploys to production.
- Analytics never rewrites historical outcomes to improve metrics.
- Orchestrator delegates independent work but owns prioritization and conflict resolution.

Use subagents for independent research tracks. Keep dependent steps in the parent agent. Agents editing the same CRM object must use deterministic IDs/upserts and avoid concurrent conflicting writes.

## 11. Outreach standard
Default first email:
- 60–140 words
- recipient-specific opening
- one verifiable observation/trigger
- one relevant portfolio/service link or fit statement
- one low-friction CTA
- no attachment by default
- no manipulative urgency

Follow-up and cooldown limits are defined in `policies/outreach-policy.md`.

## 12. SEO standard
Prioritize:
1. technical blockers/indexability
2. commercial landing pages tied to real services/intents
3. case-study discoverability and internal linking
4. metadata/schema improvements
5. useful decision-support content

SEO tasks must contain `impact`, `effort`, `confidence`, `evidence`, `acceptance_criteria` and a recommended owner.

## 13. CRM rules
- Every row belongs to a workspace.
- Normalize domains to lowercase registrable host where possible.
- Normalize emails lowercase + trim.
- Prefer upsert over duplicate insert.
- Keep source provenance.
- Suppression is stronger than campaign/task intent.
- Log every external interaction as a touchpoint.
- Log every agent execution in `agent_runs`.
- Log important lifecycle transitions/events in `events`.

## 14. Logging and observability
Each run records:
- start/end/status
- agent + task
- input/output summary
- sources/evidence count
- records created/updated
- approvals created
- side effects attempted/executed
- error category and safe error text

Never log secrets, full auth headers, service-role keys or private tokens.

## 15. Stop conditions
Stop and request owner input when:
- identity of recipient/company is ambiguous
- legal/commercial commitment is requested
- pricing/availability cannot be answered from approved data
- a site or service blocks automation
- suppression status conflicts
- evidence is stale/contradictory
- an action would exceed A1 without approval

## 16. MVP definition of done
See `docs/mvp-7-day.md`. The system is MVP-ready only when the full chain works:

**discover → verify → score → CRM → draft → A2 approval → exact payload execution → touchpoint → analytics**.
