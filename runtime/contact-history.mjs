// Conservatively block outbound history linked by person, opportunity or approval.
// Shared by drafting and preflight so optional foreign keys cannot hide contact.
export async function hasRecentOutbound(db,{workspace,email=null,companyId=null,now=new Date()}) {
 const {rows}=await db.query(`select exists(
 select 1 from touchpoints t
 left join people p on p.id=t.person_id and p.workspace_id=t.workspace_id
 left join opportunities o on o.id=t.opportunity_id and o.workspace_id=t.workspace_id
 left join approvals a on a.id=t.approval_id and a.workspace_id=t.workspace_id
 where t.workspace_id=$1 and t.direction='outbound'
 and t.occurred_at > $4::timestamptz-interval '90 days'
 and (p.email=lower(btrim($2)) or p.company_id=$3 or o.company_id=$3
 or (a.action_type='email' and lower(btrim(a.target))=lower(btrim($2))))
 ) as blocked`,[workspace,email,companyId,new Date(now).toISOString()]);
 return rows[0].blocked;
}
