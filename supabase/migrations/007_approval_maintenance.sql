-- A1 negative-only maintenance: never creates or grants an owner approval.
-- Run separately before a decision: exception paths in approve_action roll back
-- their own attempted expiry update. The decision RPC contract is unchanged.
create or replace function public.refresh_approval_states(p_workspace_id uuid)
returns table(approval_id uuid, previous_status public.approval_status, current_status public.approval_status, reason text)
language plpgsql security definer set search_path=public as $$
declare a public.approvals; d public.drafts; c public.companies;
 next_status public.approval_status; why text;
begin
 if not exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','operator')) then
  raise exception 'not authorized for approval maintenance' using errcode='42501';
 end if;
 for a in select * from public.approvals where workspace_id=p_workspace_id and status='pending' for update loop
  next_status:=null;why:=null;
  if a.expires_at is not null and a.expires_at<=clock_timestamp() then
   next_status:='expired';why:='approval_expired_by_clock';
  elsif a.draft_id is not null then
   select * into d from public.drafts where id=a.draft_id and workspace_id=p_workspace_id;
   if not found or d.payload_hash is distinct from a.payload_hash then
    next_status:='invalidated';why:='draft_payload_mismatch';
   else
    select co.* into c from public.companies co join public.opportunities o on o.company_id=co.id where o.id=a.opportunity_id and o.workspace_id=p_workspace_id;
    if public.is_suppressed(p_workspace_id,case when a.action_type='email' then a.target else null end,d.person_id,c.id,c.domain)
    or (a.action_type='email' and public.is_suppressed(p_workspace_id,a.target,d.person_id,c.id,split_part(lower(a.target),'@',2))) then
     next_status:='invalidated';why:='target_suppressed_after_request';
    end if;
   end if;
  end if;
  if next_status is not null then
   update public.approvals set status=next_status where id=a.id;
   insert into public.events(workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload)
   values(p_workspace_id,'approval',a.id,'approval_state_refreshed','agent','approval_maintenance',jsonb_build_object('previous_status',a.status,'current_status',next_status,'reason',why,'owner_decision',false));
   approval_id:=a.id;previous_status:=a.status;current_status:=next_status;reason:=why;return next;
  end if;
 end loop;
end $$;
revoke all on function public.refresh_approval_states(uuid) from public;
grant execute on function public.refresh_approval_states(uuid) to authenticated;
