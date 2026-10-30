import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {hasRecentOutbound} from '../runtime/contact-history.mjs';
import {inspectApproval} from '../runtime/approval-preflight.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const config=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(config.local_only!==true || !/^[a-zA-Z0-9_-]+$/.test(config.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${config.database}`,{extensions:{pgcrypto}});
try {
 await db.exec('begin read only');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[config.operator_user_id]);
 await db.exec('set local role authenticated');
 const {rows}=await db.query(`select a.id,a.level,a.action_type,a.target,a.status,a.expires_at,a.payload_hash,a.action_hash,a.payload_snapshot,
 c.id as company_id,d.status as draft_status, a.expires_at > now() as not_expired,
 exists(select 1 from workspace_members m where m.workspace_id=a.workspace_id and m.user_id=a.decided_by and m.role='owner') and a.decided_at is not null as owner_decision,
 a.payload_hash=d.payload_hash and a.payload_hash=encode(digest(jsonb_build_array(d.type,d.channel,d.subject,d.body)::text,'sha256'),'hex')
 and a.payload_snapshot @> jsonb_build_object('type',d.type,'channel',d.channel,'subject',d.subject,'body',d.body,'target',a.target) as payload_matches,
 a.action_hash=encode(digest(jsonb_build_object('level',a.level,'action_type',a.action_type,'target',a.target,'payload',a.payload_snapshot)::text,'sha256'),'hex') as action_matches,
 public.is_suppressed(a.workspace_id,a.target,d.person_id,c.id,c.domain) or public.is_suppressed(a.workspace_id,a.target,d.person_id,c.id,split_part(lower(a.target),'@',2)) as suppressed,
 exists(select 1 from touchpoints t where t.workspace_id=a.workspace_id and t.approval_id=a.id and t.direction='outbound') as already_executed,
 o.stage not in ('archived','lost','won') as active_opportunity
 from approvals a left join drafts d on d.id=a.draft_id left join opportunities o on o.id=a.opportunity_id left join companies c on c.id=o.company_id
 where a.workspace_id=$1 order by a.created_at`,[config.workspace_id]);
 for(const row of rows)row.recent_outbound=await hasRecentOutbound(db,{workspace:config.workspace_id,email:row.target,companyId:row.company_id});
 await db.exec('rollback');
 const report={timestamp:new Date().toISOString(),scope:'local read-only; no decision or external execution',approvals:rows.map(r=>({...r,...inspectApproval(r)})),external_actions:0};
 await writeFile('reports/daily/approval-preflight.json',JSON.stringify(report,null,2));
 await writeFile('reports/daily/approval-preflight.md',`# Проверка согласований\n\n${report.timestamp}\n\n`+report.approvals.map(r=>`## ${r.target}\n\nСтатус: **${r.status}**. Исполнение отключено.\n\n- Approval: ${r.id}\n- Action hash: ${r.action_hash}\n- Срок: ${r.expires_at}\n- Блокировки: ${r.blocked_by.join(', ')}\n\nТочный текст хранится в owner-confirmed-drafts-2026-10-12.md. Эта проверка не выдаёт согласование и не отправляет сообщение.\n`).join('\n'));
 console.log(JSON.stringify(report.approvals.map(({id,status,blocked_by,checks})=>({id,status,blocked_by,checks})),null,2));
}finally {await db.close();}
