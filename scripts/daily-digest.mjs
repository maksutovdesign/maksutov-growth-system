import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const cfg=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(cfg.local_only!==true||!/^[\w-]+$/.test(cfg.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${cfg.database}`,{extensions:{pgcrypto}});
const q=async(s,p=[cfg.workspace_id])=>(await db.query(s,p)).rows;
let tx=false;
try{
 await db.exec('begin');tx=true;
 await q("select set_config('request.jwt.claim.sub',$1,true)",[cfg.operator_user_id]);await db.exec('set local role authenticated');
 const [clock]=await q("select now() as generated_at, (date_trunc('day',now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow') as day_start",[]);
 const report={...clock,timezone:'Europe/Moscow',scope:'local CRM; calendar day starts at Moscow midnight',
 inventory:await q('select type,stage,count(*)::int as count from opportunities where workspace_id=$1 group by type,stage order by type,stage'),
 high_priority:await q("select id,title,score,stage from opportunities where workspace_id=$1 and score>=80 and stage not in ('archived','lost','won') order by score desc"),
 pending_approvals:await q("select id,target,level,requested_at,expires_at,expires_at<=now() as expired_by_clock from approvals where workspace_id=$1 and status='pending' order by requested_at"),
 unlogged_draft_creations:await q("select d.id,d.created_at,d.opportunity_id from drafts d where d.workspace_id=$1 and not exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type='draft_created')"),
 reconciled_draft_creations:await q("select d.id,d.created_at,e.created_at as reconciled_at,e.payload from drafts d join events e on e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type='draft_creation_reconciled' where d.workspace_id=$1"),
 unaccounted_draft_creations:await q("select d.id,d.created_at from drafts d where d.workspace_id=$1 and not exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type in ('draft_created','draft_creation_reconciled'))"),
 draft_inventory:await q('select status,count(*)::int as count from drafts where workspace_id=$1 group by status order by status'),
 overdue_tasks:await q("select id,title,status,due_at from tasks where workspace_id=$1 and due_at<now() and status not in ('done','cancelled') order by due_at"),
 tasks_without_due_date:await q("select count(*)::int as count from tasks where workspace_id=$1 and due_at is null and status not in ('done','cancelled')"),
 blocked_tasks:await q("select id,title,description from tasks where workspace_id=$1 and status='blocked' order by priority desc"),
 overdue_opportunity_actions:await q("select id,title,stage,next_action,next_action_at from opportunities where workspace_id=$1 and next_action_at<now() and stage not in ('archived','lost','won') order by next_action_at"),
 stale_evidence:await q("select count(*)::int as count from evidence where workspace_id=$1 and observed_at<now()-interval '30 days'"),
 today_events:await q("select event_type,count(*)::int as count from events where workspace_id=$1 and created_at >= $2 group by event_type order by event_type",[cfg.workspace_id,clock.day_start]),
 today_touchpoints:await q("select direction,touch_type,outcome,count(*)::int as count from touchpoints where workspace_id=$1 and occurred_at >= $2 group by direction,touch_type,outcome",[cfg.workspace_id,clock.day_start]),
 today_suppression_changes:await q("select count(*)::int as count from suppressions where workspace_id=$1 and created_at >= $2",[cfg.workspace_id,clock.day_start]),
 failed_runs:await q("select agent_name,task_key,started_at,error_category,error_safe from agent_runs where workspace_id=$1 and status='failed' and started_at >= now()-interval '7 days' order by started_at desc"),
 weekly_event_counts:await q('select * from v_weekly_funnel where workspace_id=$1 order by week desc'),
 job_inventory:await q("select stage,count(*)::int as count from opportunities where workspace_id=$1 and type='job' group by stage order by stage"),
 outbound_total:await q("select count(*)::int as count from touchpoints where workspace_id=$1 and direction='outbound'"),
 notes:['Weekly numbers count lifecycle events by event week, not a cohort conversion funnel. No conversion rates or channel rankings are inferred.', 'Job stages are current inventory, not historical found/applied/interview/offer counts. Offers have no dedicated event contract yet.', 'Missing due dates are reported separately; absence of overdue tasks does not prove all tasks are on time.', 'Pending requests past expiry are flagged without rewriting approval history.', 'draft_creation_reconciled is an audit correction, not a new creation event; weekly raw event counts remain unchanged.', 'Report is captured before logging its own successful analytics run. No external action is performed.']};
 const cell=x=>String(x??'—').replaceAll('|','\\|').replaceAll('\n',' ');
 await writeFile('reports/daily/daily-digest.json',JSON.stringify(report,null,2));
 const eventCounts=Object.fromEntries(report.today_events.map(e=>[e.event_type,e.count]));
 await writeFile('reports/daily/daily-digest.md',`# Дневная сводка CRM\n\n${report.generated_at}; календарный день Europe/Moscow с ${report.day_start}.\n\n| Тип | Этап | Количество |\n|---|---|---:|\n`+report.inventory.map(r=>`| ${r.type} | ${r.stage} | ${r.count} |`).join('\n')+`\n\nСегодня по событиям: квалифицировано ${eventCounts.opportunity_qualified??0}, создано черновиков ${eventCounts.draft_created??0}, отправлено ${eventCounts.outbound_sent??0}, ответов ${eventCounts.reply_received??0}, встреч ${eventCounts.meeting_booked??0}, побед ${eventCounts.opportunity_won??0}. Это исторические события; архивирование не уменьшает прошлую квалификацию.\n\nОжидающих A2/A3: ${report.pending_approvals.length}, истёкших по времени: ${report.pending_approvals.filter(a=>a.expired_by_clock).length}. Возможностей с score ≥80: ${report.high_priority.length}. Ошибок запуска за 7 дней: ${report.failed_runs.length}. Всего исходящих touchpoints: ${report.outbound_total[0].count}.\n\nПросроченных задач с указанным сроком: ${report.overdue_tasks.length}; незакрытых задач без срока: ${report.tasks_without_due_date[0].count}. Просроченных следующих действий: ${report.overdue_opportunity_actions.length}. Evidence старше 30 дней: ${report.stale_evidence[0].count}. Черновиков без связанного события draft_created: ${report.unlogged_draft_creations.length}; из них покрыто отдельной записью сверки: ${report.reconciled_draft_creations.length}, без объяснения: ${report.unaccounted_draft_creations.length}. Исторические события и текущее количество записей показаны раздельно.\n\n## Заблокированные задачи\n\n`+report.blocked_tasks.map(t=>`- ${cell(t.title)}\n`).join('')+`\n## Ограничения интерпретации\n\nНедельная воронка в JSON считает события по неделям; это не когортная конверсия. При нуле отправок эффективность канала и процент ответов не определены. Job inventory показывает текущие этапы; applied/interview/offer требуют отдельного контракта событий. Этот отчёт не проверяет состояние планировщика; регистрацию и фактические запуски нужно сверять отдельно.\n`);
 await q("insert into agent_runs(workspace_id,agent_name,task_key,status,finished_at,input_summary,output_summary,sources_count,records_created,external_actions,metadata) values($1,'analytics','daily-digest','succeeded',now(),'Local CRM, Moscow calendar day, weekly event counts','Digest saved; no conversion inferred from empty outbound denominator',0,0,0,$2)",[cfg.workspace_id,{artifact:'reports/daily/daily-digest.json',approval_level:'A1',external_actions_attempted:0,external_actions_executed:0}]);
 await db.exec('commit');tx=false;
 console.log(JSON.stringify({report:'reports/daily/daily-digest.md',inventory:report.inventory,pending:report.pending_approvals.length,outbound:report.outbound_total[0].count,external_actions:0},null,2));
}finally{if(tx)await db.exec('rollback');await db.close();}
