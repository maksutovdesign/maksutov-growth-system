-- Read models for dashboard. security_invoker keeps underlying RLS in force.

create or replace view public.v_pipeline
with (security_invoker = true)
as
select
  o.workspace_id,
  o.id as opportunity_id,
  o.type,
  o.title,
  o.stage,
  o.score,
  o.confidence,
  o.next_action,
  o.next_action_at,
  c.name as company_name,
  c.domain,
  p.full_name as person_name,
  p.title as person_title,
  o.created_at,
  o.updated_at
from public.opportunities o
left join public.companies c on c.id = o.company_id
left join public.people p on p.id = o.person_id;

create or replace view public.v_approval_queue
with (security_invoker = true)
as
select
  a.workspace_id,
  a.id as approval_id,
  a.level,
  a.action_type,
  a.target,
  a.status,
  a.requested_at,
  a.expires_at,
  d.id as draft_id,
  d.type as draft_type,
  d.subject,
  d.body,
  o.id as opportunity_id,
  o.title as opportunity_title,
  c.name as company_name,
  p.full_name as person_name
from public.approvals a
left join public.drafts d on d.id = a.draft_id
left join public.opportunities o on o.id = a.opportunity_id
left join public.companies c on c.id = o.company_id
left join public.people p on p.id = o.person_id
where a.status = 'pending';

create or replace view public.v_weekly_funnel
with (security_invoker = true)
as
select
  workspace_id,
  date_trunc('week', created_at) as week,
  count(*) filter (where event_type = 'opportunity_discovered') as discovered,
  count(*) filter (where event_type = 'opportunity_qualified') as qualified,
  count(*) filter (where event_type = 'draft_created') as drafts,
  count(*) filter (where event_type = 'approval_approved') as approvals,
  count(*) filter (where event_type = 'outbound_sent') as sent,
  count(*) filter (where event_type = 'reply_received') as replies,
  count(*) filter (where event_type = 'positive_reply') as positive_replies,
  count(*) filter (where event_type = 'meeting_booked') as meetings,
  count(*) filter (where event_type = 'proposal_sent') as proposals,
  count(*) filter (where event_type = 'opportunity_won') as wins
from public.events
group by workspace_id, date_trunc('week', created_at);
