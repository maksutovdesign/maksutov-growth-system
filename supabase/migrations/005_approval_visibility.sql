-- Members must see their approval queue; decisions remain owner/admin RPC only.
create policy approvals_member_select on public.approvals
for select to authenticated using (exists (
 select 1 from public.workspace_members wm
 where wm.workspace_id = approvals.workspace_id and wm.user_id = (select auth.uid())
));
