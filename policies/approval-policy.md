# Approval Policy

## Levels

### A0 — autonomous, read-only
No approval needed:
- web research
- competitor research
- keyword research
- public job discovery
- public company/studio discovery
- reading site analytics when access is already authorized
- lead scoring from public information
- drafting internal reports

### A1 — autonomous internal write
No external side effect; no approval needed:
- create/edit local drafts
- create CRM records from public data
- deduplicate/enrich CRM
- produce article drafts
- produce email drafts
- propose site patches in a branch/draft
- generate issue/task lists
- generate backlink opportunity lists

### A2 — batch approval
Owner must approve the batch before execution:
- send cold email or follow-up
- send LinkedIn/other social message
- submit a normal job application
- publish an article/page to production
- create/update a public directory/profile
- submit a guest-post pitch
- submit a contact form
- publish a social post
- merge normal SEO/content changes to production

A2 approval packet must show recipient/URL, exact content, reason, source, and intended side effect.

### A3 — explicit per-action approval
Never batch silently:
- purchase or paid subscription
- sign terms, NDA, contract, DPA, license, or legal attestation
- quote a binding price or commercial commitment not pre-approved
- change domain/DNS, billing, analytics ownership, authentication, secrets, or production infrastructure
- delete production data
- create account requiring identity verification
- upload identity documents
- accept a job offer / client agreement
- send files containing confidential/client data
- mass actions above configured daily limits

## Always prohibited without a new owner instruction
- fake reviews/testimonials
- pretending to be another person
- buying spam links
- automated comment spam
- CAPTCHA bypass
- scraping private/authenticated data without authorization
- evading platform anti-spam limits
- harvesting or selling personal data
- deceptive opt-in or unsubscribe behavior

## Approval object
Each approval request must include:
```yaml
approval_id: string
level: A2|A3
action_type: email|message|publish|application|profile|merge|purchase|legal|other
target: string
reason: string
exact_payload: string_or_file
source_evidence: []
risk_notes: []
expires_at: timestamp
```

Approval is valid only for the exact payload and target shown. Material changes require re-approval.
