-- RLS: users can only access workspaces where they are members.

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.companies enable row level security;
alter table public.people enable row level security;
alter table public.opportunities enable row level security;
alter table public.evidence enable row level security;
alter table public.drafts enable row level security;
alter table public.approvals enable row level security;
alter table public.touchpoints enable row level security;
alter table public.suppressions enable row level security;
alter table public.tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.events enable row level security;

create policy "workspace owner can read workspace"
on public.workspaces for select to authenticated
using (owner_user_id = (select auth.uid()) or exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = id and wm.user_id = (select auth.uid())
));

create policy "user can create own workspace"
on public.workspaces for insert to authenticated
with check (owner_user_id = (select auth.uid()));

create policy "owner can update workspace"
on public.workspaces for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

create policy "members read own membership"
on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()));

-- Generic member policies for CRM tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','people','opportunities','evidence','drafts',
    'touchpoints','suppressions','tasks','agent_runs','events'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid())))',
      t || '_member_select', t, t
    );
  end loop;
end $$;

-- Owner/admin/operator may mutate operational CRM data.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','people','opportunities','evidence','drafts',
    'touchpoints','suppressions','tasks'
  ] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid()) and wm.role in (''owner'',''admin'',''operator'')))',
      t || '_operator_insert', t, t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid()) and wm.role in (''owner'',''admin'',''operator''))) with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid()) and wm.role in (''owner'',''admin'',''operator'')))',
      t || '_operator_update', t, t, t
    );
  end loop;
end $$;

-- Approvals: operators may request only pending approvals. Decisions go through approve_action().
create policy "approvals operator insert pending" on public.approvals for insert to authenticated
with check (
  status = 'pending' and
  exists (select 1 from public.workspace_members wm where wm.workspace_id = approvals.workspace_id and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','operator'))
);

-- No direct authenticated UPDATE policy is granted for approvals.
-- approve_action() is SECURITY DEFINER and performs owner/admin authorization + hash validation.

-- Agent runs/events are append-oriented for authenticated operators.
create policy "agent_runs operator insert" on public.agent_runs for insert to authenticated
with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = agent_runs.workspace_id and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','operator')));
create policy "agent_runs operator update" on public.agent_runs for update to authenticated
using (exists (select 1 from public.workspace_members wm where wm.workspace_id = agent_runs.workspace_id and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','operator')))
with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = agent_runs.workspace_id and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','operator')));

create policy "events operator insert" on public.events for insert to authenticated
with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = events.workspace_id and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin','operator')));

-- Destructive deletes only for owner/admin, and not for immutable event log.
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','people','opportunities','evidence','drafts',
    'touchpoints','suppressions','tasks','agent_runs'
  ] loop
    execute format(
      'create policy %I on public.%I for delete to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = (select auth.uid()) and wm.role in (''owner'',''admin'')))',
      t || '_admin_delete', t, t
    );
  end loop;
end $$;
