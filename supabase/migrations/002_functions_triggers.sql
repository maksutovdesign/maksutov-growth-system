-- Helper functions and integrity triggers.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_workspaces_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger set_companies_updated_at before update on public.companies
for each row execute function public.set_updated_at();
create trigger set_people_updated_at before update on public.people
for each row execute function public.set_updated_at();
create trigger set_opportunities_updated_at before update on public.opportunities
for each row execute function public.set_updated_at();
create trigger set_drafts_updated_at before update on public.drafts
for each row execute function public.set_updated_at();
create trigger set_tasks_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.add_workspace_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

create trigger add_workspace_owner_member
after insert on public.workspaces
for each row execute function public.add_workspace_owner_member();

create or replace function public.compute_draft_payload_hash()
returns trigger
language plpgsql
as $$
begin
  new.payload_hash = encode(
    digest(
      coalesce(new.type::text,'') || '|' ||
      coalesce(new.channel::text,'') || '|' ||
      coalesce(new.subject,'') || '|' ||
      coalesce(new.body,''),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create trigger compute_draft_hash
before insert or update of type, channel, subject, body on public.drafts
for each row execute function public.compute_draft_payload_hash();

create or replace function public.invalidate_approval_on_draft_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.payload_hash is distinct from new.payload_hash then
    update public.approvals
      set status = 'invalidated', decided_at = now(), notes = coalesce(notes || E'\n','') || 'Draft payload changed after approval request.'
    where draft_id = new.id and status in ('pending','approved');
    if new.status = 'approved' then
      new.status = 'draft';
    end if;
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

create trigger invalidate_approval_on_draft_change
before update on public.drafts
for each row execute function public.invalidate_approval_on_draft_change();

create or replace function public.is_suppressed(
  p_workspace_id uuid,
  p_email text default null,
  p_person_id uuid default null,
  p_company_id uuid default null,
  p_domain text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.suppressions s
    where s.workspace_id = p_workspace_id
      and (s.expires_at is null or s.expires_at > now())
      and (
        (s.scope = 'email' and p_email is not null and s.normalized_value = lower(btrim(p_email))) or
        (s.scope = 'person' and p_person_id is not null and s.normalized_value = p_person_id::text) or
        (s.scope = 'company' and p_company_id is not null and s.normalized_value = p_company_id::text) or
        (s.scope = 'domain' and p_domain is not null and s.normalized_value = lower(btrim(p_domain)))
      )
  );
$$;

revoke all on function public.is_suppressed(uuid,text,uuid,uuid,text) from public;
grant execute on function public.is_suppressed(uuid,text,uuid,uuid,text) to authenticated, service_role;

create or replace function public.approve_action(p_approval_id uuid, p_notes text default null)
returns public.approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.approvals;
  d public.drafts;
begin
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then raise exception 'approval not found'; end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = a.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  ) then
    raise exception 'not authorized to decide approval';
  end if;
  if a.status <> 'pending' then raise exception 'approval is not pending'; end if;
  if a.expires_at is not null and a.expires_at <= now() then
    update public.approvals set status='expired', decided_at=now() where id=a.id;
    raise exception 'approval expired';
  end if;

  if a.draft_id is not null then
    select * into d from public.drafts where id = a.draft_id;
    if not found or d.payload_hash is distinct from a.payload_hash then
      update public.approvals set status='invalidated', decided_at=now() where id=a.id;
      raise exception 'approval payload no longer matches draft';
    end if;
  end if;

  update public.approvals
    set status='approved', decided_by=(select auth.uid()), decided_at=now(), notes=p_notes
    where id=a.id
    returning * into a;

  if a.draft_id is not null then
    update public.drafts set status='approved' where id=a.draft_id;
  end if;

  return a;
end;
$$;

grant execute on function public.approve_action(uuid,text) to authenticated;

create or replace function public.reject_action(p_approval_id uuid, p_notes text default null)
returns public.approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.approvals;
begin
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then raise exception 'approval not found'; end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = a.workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role in ('owner','admin')
  ) then
    raise exception 'not authorized to decide approval';
  end if;

  if a.status <> 'pending' then raise exception 'approval is not pending'; end if;

  update public.approvals
    set status='rejected', decided_by=(select auth.uid()), decided_at=now(), notes=p_notes
    where id=a.id
    returning * into a;

  if a.draft_id is not null then
    update public.drafts set status='rejected' where id=a.draft_id;
  end if;

  return a;
end;
$$;

grant execute on function public.reject_action(uuid,text) to authenticated;
