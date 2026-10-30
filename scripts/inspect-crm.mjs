import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const config=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(!/^[a-zA-Z0-9_-]+$/.test(config.database))throw Error('Local DB required');
const db=new PGlite(`.local/${config.database}`,{extensions:{pgcrypto}});
const q=async(s,p=[]) => (await db.query(s,p)).rows;
try {
 await db.exec('begin');
 await q("select set_config('request.jwt.claim.sub',$1,true)",[config.operator_user_id]);
 await db.exec('set local role authenticated');
 const report={timestamp:new Date().toISOString(),workspace_id:config.workspace_id,scope:'local-only',
 opportunities:await q('select p.*,o.score_breakdown,o.metadata,o.source_url from v_pipeline p join opportunities o on o.id=p.opportunity_id where p.workspace_id=$1 order by p.score desc,p.title',[config.workspace_id]),
 evidence:await q('select opportunity_id,evidence_type,source_url,fact,inference,observed_at,confidence from evidence where workspace_id=$1 order by opportunity_id,created_at',[config.workspace_id]),
 approvals:await q('select * from v_approval_queue where workspace_id=$1',[config.workspace_id]),
 runs:await q('select agent_name,status,task_key,started_at,finished_at,sources_count,records_created,records_updated,approvals_created,external_actions,error_category,error_safe from agent_runs where workspace_id=$1 order by started_at desc limit 30',[config.workspace_id]),
 tasks:await q('select title,description,status,priority,acceptance_criteria from tasks where workspace_id=$1 order by priority desc',[config.workspace_id]),
 funnel:await q('select * from v_weekly_funnel where workspace_id=$1',[config.workspace_id])};
 await db.exec('rollback');
 await writeFile('reports/daily/crm-snapshot.json',JSON.stringify(report,null,2));
 const escape=x=>String(x??'unknown').replaceAll('|','\\|').replaceAll('\n',' ');
 await writeFile('reports/daily/crm-snapshot.md',`# Локальная CRM\n\n${report.timestamp}\n\n| Opportunity | Score | Type | Stage | Next action |\n|---|---:|---|---|---|\n`+report.opportunities.map(o=>`| [${escape(o.title)}](${o.source_url}) | ${o.score} | ${o.type} | ${escape(o.stage)} | ${escape(o.next_action)} |`).join('\n')+`\n\nОжидающих согласований: ${report.approvals.length}. Задач проверки: ${report.tasks.length}. Это локальная CRM. Score — оценка исследователя, актуальность и ограничения указаны в metadata и evidence.\n\n## Задачи проверки\n\n`+report.tasks.map(t=>`- **${t.title}** (${t.status}, priority ${t.priority}): ${t.description}\n`).join('\n'));
 console.log(JSON.stringify({opportunities:report.opportunities.length,evidence:report.evidence.length,pending_approvals:report.approvals.length,failed_runs:report.runs.filter(r=>r.status==='failed').length,external_actions:report.runs.reduce((n,r)=>n+r.external_actions,0),report:'reports/daily/crm-snapshot.md'},null,2));
}finally {await db.close();}
