# Local runtime

Research first, verify identity and mandatory conditions, save evidence and score, then prepare drafts. Unknown mandatory conditions stay under review. Do not use the synthetic fixtures for real outreach.

`npm run runtime:ingest -- --input data/leads/researched.json` is a dry run and rolls back. Input must match the schema in `runtime/pipeline.mjs`. A committed A1 ingestion additionally requires `GROWTH_AUTOMATION_ENABLED=true` and `--commit`. Review all candidates before committing; configuration and environment gates do not establish permission for an external action.

`npm run crm:backup` exports the local database and verifies restoration in memory. The live database is not replaced. Backups and owner records must remain private and outside public release assets.

The daily preflight checks runtime configuration, migrations and workspace access. It does not confirm successful scheduling. Keep external execution disabled; this release contains no production sender, publisher or account-management integration.
