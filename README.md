# Maksutov Growth System

A local operating system for researching paid design opportunities and preparing evidence-based content and outreach drafts.

## Scope

Twelve roles cover orchestration, analytics, SEO, content research/writing, case studies, direct leads, studios, jobs, outreach, editorial opportunities and profile distribution. Seven SQL migrations provide workspace isolation, evidence, deduplication, approval guards and audit records.

A0 permits research; A1 permits internal records and drafts. A2 requires exact owner approval for external actions; A3 requires per-action approval for legal, financial or infrastructure changes. This release has no external executor. An approved record does not send or publish anything.

## Local setup

Requires Node.js and npm. Install the pinned dependencies and initialize an empty local database:

```sh
npm ci --ignore-scripts
npm run setup
npm run runtime:init
npm run dry-run
npm run pipeline:demo
npm run test:approval-preflight
npm run crm:backup
```

The tests use synthetic fixtures; `.local/` contains the newly initialized local CRM and is ignored by Git. The repository contains no owner CRM or research inventory. The daily control is disabled by default. Review `config/daily-run-control.json` before enabling local A1 scheduling; keep `external_actions_enabled=false`. Scheduling requires your own host, application and authorized project-folder access. No schedule is created by installation.

## Operations

```sh
npm run crm:report
npm run analytics:daily
npm run approval:maintain
npm run approval:preflight
```

Approval maintenance defaults to rollback; `-- --apply` only saves negative transitions such as expiration, never approval. Inspect `docs/local-runtime.md` before ingesting real research.

Prompts and policies define the evidence and outreach boundaries. Real work must be checked by an operator; tests do not validate prospect freshness, legal eligibility, content quality or production deployment.
