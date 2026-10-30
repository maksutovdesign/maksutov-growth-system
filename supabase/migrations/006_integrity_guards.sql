-- Enforce workspace consistency even for server-side writes.
create or replace function public.enforce_workspace_links()
returns trigger language plpgsql security definer set search_path=public as $$
declare entry record; ref_workspace uuid; ref_id uuid;
begin
 if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
  raise exception 'workspace reassignment forbidden' using errcode='23514';
 end if;
 for entry in select key,value from jsonb_each_text(tg_argv[0]::jsonb) loop
  ref_id := (to_jsonb(new)->>entry.key)::uuid;
  if ref_id is not null then
   execute format('select workspace_id from public.%I where id=$1',entry.value) into ref_workspace using ref_id;
   if ref_workspace is null or ref_workspace <> new.workspace_id then
    raise exception 'reference outside workspace: %', entry.key using errcode='23514';
   end if;
  end if;
 end loop;
 return new;
end $$;
do $$
declare item record;
begin
 for item in select * from (values
 ('companies','{}'),
 ('people','{"company_id":"companies"}'),
 ('opportunities','{"company_id":"companies","person_id":"people"}'),
 ('evidence','{"opportunity_id":"opportunities","company_id":"companies","person_id":"people"}'),
 ('drafts','{"opportunity_id":"opportunities","person_id":"people"}'),
 ('approvals','{"opportunity_id":"opportunities","draft_id":"drafts"}'),
 ('touchpoints','{"opportunity_id":"opportunities","person_id":"people","approval_id":"approvals"}'),
 ('tasks','{"opportunity_id":"opportunities"}'),
 ('suppressions','{}'),('agent_runs','{}'),('events','{}')
 ) as mappings(tab,refs) loop
 execute format('create trigger a_workspace_links before insert or update on public.%I for each row execute function public.enforce_workspace_links(%L)',item.tab,item.refs);
 end loop;
end $$;

create or replace function public.normalize_contacts()
returns trigger language plpgsql as $$
begin
 if tg_table_name='companies' then new.domain=nullif(lower(btrim(new.domain)),'');
 else new.email=nullif(lower(btrim(new.email)),''); new.linkedin_url=nullif(lower(btrim(new.linkedin_url)),''); end if;
 return new;
end $$;
create trigger normalize_contacts before insert or update on public.companies for each row execute function public.normalize_contacts();
create trigger normalize_contacts before insert or update on public.people for each row execute function public.normalize_contacts();

-- JSON serialization removes ambiguous delimiter collisions. Always recompute,
-- including writes that attempt to set payload_hash directly.
create or replace function public.compute_draft_payload_hash()
returns trigger language plpgsql as $$
begin
 new.payload_hash=encode(digest(jsonb_build_array(new.type,new.channel,new.subject,new.body)::text,'sha256'),'hex');
 return new;
end $$;
drop trigger compute_draft_hash on public.drafts;
create trigger compute_draft_hash before insert or update on public.drafts for each row execute function public.compute_draft_payload_hash();
-- Rehash existing rows; old pending/approved requests become invalidated.
update public.drafts set body=body;

create or replace function public.guard_draft_state()
returns trigger language plpgsql as $$
begin
 if current_user='authenticated' and new.status in ('approved','sent') then
  if tg_op='INSERT' then raise exception 'draft state requires trusted decision/executor' using errcode='42501'; end if;
  if new.status is distinct from old.status then raise exception 'draft state requires trusted decision/executor' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger z_guard_draft_state before insert or update on public.drafts for each row execute function public.guard_draft_state();

alter table public.approvals add column action_hash text;
create or replace function public.guard_approval_payload()
returns trigger language plpgsql security definer set search_path=public as $$
declare d public.drafts; p public.people; c public.companies;
begin
 if tg_op='UPDATE' then
  if row(new.workspace_id,new.draft_id,new.opportunity_id,new.level,new.action_type,new.target,new.payload_hash,new.payload_snapshot,new.expires_at,new.action_hash)
   is distinct from row(old.workspace_id,old.draft_id,old.opportunity_id,old.level,old.action_type,old.target,old.payload_hash,old.payload_snapshot,old.expires_at,old.action_hash) then
   raise exception 'approval payload is immutable; request a new approval' using errcode='23514';
  end if;
  return new;
 end if;
 if new.level not in ('A2','A3') or new.status <> 'pending' or new.decided_by is not null or new.decided_at is not null then
  raise exception 'only undecided A2/A3 requests allowed' using errcode='23514';
 end if;
 if nullif(btrim(new.target),'') is null then raise exception 'target required'; end if;
 new.expires_at=coalesce(new.expires_at,now()+interval '7 days');
 if new.expires_at <= now() then raise exception 'request already expired'; end if;
 if new.draft_id is not null then
  select * into d from public.drafts where id=new.draft_id;
  if d.workspace_id is distinct from new.workspace_id or d.payload_hash is distinct from new.payload_hash then raise exception 'draft/hash mismatch' using errcode='23514'; end if;
  if new.opportunity_id is distinct from d.opportunity_id then raise exception 'opportunity mismatch' using errcode='23514'; end if;
  select * into p from public.people where id=d.person_id;
  select co.* into c from public.companies co join public.opportunities o on o.company_id=co.id where o.id=d.opportunity_id;
  if public.is_suppressed(new.workspace_id,case when new.action_type='email' then new.target else p.email end,d.person_id,c.id,c.domain) then raise exception 'target suppressed' using errcode='23514'; end if;
  new.payload_snapshot=coalesce(new.payload_snapshot,'{}') || jsonb_build_object('type',d.type,'channel',d.channel,'subject',d.subject,'body',d.body,'target',new.target);
 end if;
 new.action_hash=encode(digest(jsonb_build_object('level',new.level,'action_type',new.action_type,'target',new.target,'payload',new.payload_snapshot)::text,'sha256'),'hex');
 return new;
end $$;
create trigger b_approval_payload before insert or update on public.approvals for each row execute function public.guard_approval_payload();
-- Remove anonymous access to SECURITY DEFINER decision endpoints.
revoke all on function public.approve_action(uuid,text) from public;
revoke all on function public.reject_action(uuid,text) from public;
