import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runPipeline,qualify } from '../runtime/pipeline.mjs';
import { demoCandidates } from '../fixtures/demo.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const [mode,...args]=process.argv.slice(2);
if(!['demo','init-local','ingest'].includes(mode))throw Error('Use demo, init-local or ingest --input FILE [--commit]');
const dbName=process.env.GROWTH_LOCAL_DB || 'crm';
if(!/^[a-zA-Z0-9_-]+$/.test(dbName))throw Error('Invalid local database name');
const commit=args.includes('--commit');
if(commit && mode!=='ingest')throw Error('--commit only supported for ingest');
if(mode==='ingest' && commit && process.env.GROWTH_AUTOMATION_ENABLED!=='true')throw Error('Kill switch: GROWTH_AUTOMATION_ENABLED must be true for A1 commit');
const db=new PGlite(`.local/${dbName}`,{extensions:{pgcrypto}});
const q=async(s,p=[]) => (await db.query(s,p)).rows;
let transaction=false;
try {
 const migrated=await q("select name from local_migrations where name='006_integrity_guards.sql'");
 if(!migrated.length)throw Error('Run npm run setup first');
 await mkdir('reports/daily',{recursive:true});
 if(mode==='init-local'){
  let config;
  try {config=JSON.parse(await readFile('.local/runtime.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(config){if(config.database!==dbName)throw Error('Local runtime config belongs to another database'); console.log(JSON.stringify(config,null,2));}
  else {
   const owner=randomUUID(),operator=randomUUID(),workspace=randomUUID();
   await db.exec('begin');transaction=true;
   await q('insert into auth.users(id) values($1),($2)',[owner,operator]);
   await q("insert into workspaces(id,name,owner_user_id) values($1,'Maksutov Design — local only',$2)",[workspace,owner]);
   await q("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'operator')",[workspace,operator]);
   config={database:dbName,workspace_id:workspace,operator_user_id:operator,owner_user_id:owner,local_only:true};
   await writeFile('.local/runtime.json',JSON.stringify(config,null,2),{flag:'wx'});
   await db.exec('commit');transaction=false; console.log(JSON.stringify(config,null,2));
  }
 } else {
 const demo=mode==='demo',now=new Date();
 let candidates,workspace,actor;
 const baseline=(await q('select count(*)::int n from opportunities'))[0].n;
 await db.exec('begin');transaction=true;
 if(demo){
  candidates=demoCandidates(now);actor=randomUUID();workspace=randomUUID();
  const demoOwner=randomUUID();
  await q('insert into auth.users(id) values($1),($2)',[actor,demoOwner]);
  await q("insert into workspaces(id,name,owner_user_id) values($1,'DEMO TRANSACTION ONLY',$2)",[workspace,demoOwner]);
  await q("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'operator')",[workspace,actor]);
 }else {
  const config=JSON.parse(await readFile('.local/runtime.json','utf8'));
  if(config.database!==dbName || config.local_only!==true)throw Error('Local runtime mismatch');
  workspace=config.workspace_id;actor=config.operator_user_id;
  const input=args.indexOf('--input');if(input<0 || !args[input+1])throw Error('--input FILE required');
  candidates=JSON.parse(await readFile(args[input+1],'utf8'));
 }
 await q("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
 await db.exec('set local role authenticated');
 const run=(await q("insert into agent_runs(workspace_id,agent_name,task_key,input_summary,metadata) values($1,'orchestrator','a1-local-pipeline',$2,$3) returning id",[workspace,`${candidates.length} researcher-supplied candidates`,{demo,dry_run:!commit}]))[0].id;
 await db.exec('savepoint pipeline_work');
 let report;
 try {
 report=await runPipeline(db,workspace,candidates,{demo,now});
 if(demo){
  const checks=[]; const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});};
  check('Ten candidates evaluated',report.crm_updates.candidates===10);
  check('Seven qualified unique opportunities',report.crm_updates.opportunities_created===7);
  check('Low-score and missing-evidence candidates rejected',report.crm_updates.rejected.length===2);
  check('Duplicate candidate skipped',report.crm_updates.duplicates===1);
  check('Fourteen evidence records stored',report.crm_updates.evidence_created===14);
  check('One draft and pending A2 request',report.crm_updates.drafts_created===1 && report.digest.pending_approvals.length===1);
  check('No approval granted',(await q("select count(*)::int n from approvals where workspace_id=$1 and status='approved'",[workspace]))[0].n===0);
  const repeat=await runPipeline(db,workspace,candidates,{demo,now});
  check('Replay creates zero companies, opportunities and drafts',repeat.crm_updates.companies_created===0 && repeat.crm_updates.opportunities_created===0 && repeat.crm_updates.drafts_created===0);
  check('Synthetic fixtures denied outside demo',!qualify(candidates[0],{now,demo:false}).accepted);
  const stale=structuredClone(candidates[0]);stale.evidence[0].observed_at='2020-01-01T00:00:00Z';
  const conflicted=structuredClone(candidates[0]);conflicted.metadata={review_required:true};
  check('Contradictory evidence blocks qualification',!qualify(conflicted,{demo,now}).accepted);
  const office=structuredClone(candidates[5]);office.metadata={work_mode:'office'};
  check('Owner remote-only preference rejects office roles',!qualify(office,{demo,now,preferences:{remote_only:true}}).accepted);
  office.metadata={work_mode:'unknown'};
  check('Unknown remote compatibility requires review',!qualify(office,{demo,now,preferences:{remote_only:true}}).accepted);
  const shopify=structuredClone(candidates[0]);shopify.metadata={required_capabilities:['dtc_shopify_cases']};
  check('Owner-confirmed absent mandatory capability blocks qualification',!qualify(shopify,{demo,now,ownerTerms:{dtc_shopify_cases:false}}).accepted);
  check('Stale evidence rejected',!qualify(stale,{demo,now}).accepted);
  const forged=structuredClone(candidates[0]);forged.scoring.need.evidence_ids=['missing'];
  check('Unsupported score evidence rejected',!qualify(forged,{demo,now}).accepted);
  await db.exec('savepoint extra_checks');
  const suppressed=structuredClone(candidates[1]);suppressed.domain='suppressed.invalid';suppressed.source_url='https://suppressed.invalid/request';
  await q("insert into suppressions(workspace_id,scope,normalized_value,reason) values($1,'domain','suppressed.invalid','Demo opt out')",[workspace]);
  const blocked=await runPipeline(db,workspace,[suppressed],{demo,now});
  check('Suppressed company excluded before CRM ingestion',blocked.crm_updates.opportunities_created===0 && blocked.crm_updates.rejected[0].reasons.includes('suppressed_company_or_domain'));
  const noEmail=structuredClone(candidates[0]);noEmail.source_url='https://demo-0.invalid/second-request';noEmail.draft.email_ownership_verified=false;
  const noDraft=await runPipeline(db,workspace,[noEmail],{demo,now});
  check('Unverified recipient prevents draft creation',noDraft.crm_updates.drafts_created===0 && noDraft.crm_updates.blocked_drafts[0].reason==='email_ownership_not_evidenced');
  const person=(await q('select id from people where workspace_id=$1 and email=$2',[workspace,'owner@demo-0.invalid']))[0];
  await db.exec('savepoint history_checks');
  await q("insert into touchpoints(workspace_id,person_id,channel,direction,occurred_at,metadata) values($1,$2,'email','outbound',$3,'{\"synthetic\":true}')",[workspace,person.id,now.toISOString()]);
  const cooldown=structuredClone(candidates[0]);cooldown.source_url='https://demo-0.invalid/third-request';
  const recent=await runPipeline(db,workspace,[cooldown],{demo,now});
  check('Recent outreach blocks duplicate drafting',recent.crm_updates.drafts_created===0 && recent.crm_updates.blocked_drafts[0].reason==='recent_outreach_requires_owner_review');
  await db.exec('rollback to savepoint history_checks');
  const original=(await q('select id,company_id from opportunities where workspace_id=$1 and person_id=$2',[workspace,person.id]))[0];
  await q("insert into touchpoints(workspace_id,opportunity_id,channel,direction,occurred_at,metadata) values($1,$2,'email','outbound',$3,'{\"synthetic\":true}')",[workspace,original.id,now.toISOString()]);
  cooldown.source_url='https://demo-0.invalid/opportunity-only-request';
  const opportunityOnly=await runPipeline(db,workspace,[cooldown],{demo,now});
  check('Opportunity-only outbound history blocks drafting',opportunityOnly.crm_updates.drafts_created===0 && opportunityOnly.crm_updates.blocked_drafts[0].reason==='recent_outreach_requires_owner_review');
  await db.exec('rollback to savepoint history_checks');
  const approval=(await q('select id from approvals where workspace_id=$1 limit 1',[workspace]))[0];
  await q("insert into touchpoints(workspace_id,approval_id,channel,direction,occurred_at,metadata) values($1,$2,'email','outbound',$3,'{\"synthetic\":true}')",[workspace,approval.id,now.toISOString()]);
  cooldown.source_url='https://demo-0.invalid/approval-only-request';
  const approvalOnly=await runPipeline(db,workspace,[cooldown],{demo,now});
  check('Approval-only outbound history blocks drafting',approvalOnly.crm_updates.drafts_created===0 && approvalOnly.crm_updates.blocked_drafts[0].reason==='recent_outreach_requires_owner_review');
  await db.exec('rollback to savepoint history_checks');
  await q("insert into touchpoints(workspace_id,person_id,channel,direction,occurred_at,metadata) values($1,$2,'email','inbound',$3,'{\"synthetic\":true}')",[workspace,person.id,now.toISOString()]);
  cooldown.source_url='https://demo-0.invalid/inbound-request';
  const inbound=await runPipeline(db,workspace,[cooldown],{demo,now});
  check('Inbound history alone does not trigger outbound cooldown',inbound.crm_updates.drafts_created===1);
  await db.exec('rollback to savepoint extra_checks');
  report.checks=checks;
 }
 await q("update agent_runs set status='succeeded',finished_at=now(),sources_count=$2,records_created=$3,approvals_created=$4,output_summary=$5 where id=$1",[run,report.crm_updates.evidence_created,report.crm_updates.companies_created+report.crm_updates.opportunities_created+report.crm_updates.evidence_created+report.crm_updates.drafts_created,report.crm_updates.approvals_created,JSON.stringify(report.crm_updates)]);
 }catch(e){
  await db.exec('rollback to savepoint pipeline_work');
  await q("update agent_runs set status='failed',finished_at=now(),error_category='pipeline_validation_or_database',error_safe='Pipeline failed; CRM writes rolled back' where id=$1",[run]);
  if(commit){await db.exec('commit');transaction=false;}
  throw e;
 }
 if(commit){await db.exec('commit');transaction=false;}
 else {await db.exec('rollback');transaction=false;}
 await db.exec('reset role');
 report.mode=mode;report.timestamp=now.toISOString();report.committed=commit;report.production_ready=false;
 if(!commit){assert.equal((await q('select count(*)::int n from opportunities'))[0].n,baseline);report.checks?.push({name:'All demo CRM writes rolled back',status:'PASS'});}
 report.artifacts=[`reports/daily/${mode}-pipeline.json`,`reports/daily/${mode}-pipeline.md`];
 await writeFile(report.artifacts[0],JSON.stringify(report,null,2));
 await writeFile(report.artifacts[1],`# ${demo?'Синтетический':'Локальный'} A1 pipeline\n\n${report.timestamp}\n\n`+(report.checks??[]).map(c=>`- ${c.status}: ${c.name}`).join('\n')+`\n\n\`\`\`json\n${JSON.stringify(report.crm_updates,null,2)}\n\`\`\`\n\n`+report.digest.pending_approvals.map(a=>`## Черновик — ${a.target}\n\n${a.subject}\n\n${a.body}\n`).join('\n')+`\nДанные ${commit?'сохранены локально':'отменены транзакцией'}. Внешних действий: 0. Production не подключён.\n`);
 console.log(JSON.stringify(report,null,2));
 }
}catch(e){
 const failure={timestamp:new Date().toISOString(),mode,status:'failed',error_category:'local_runtime',error_safe:'Local run failed; uncommitted CRM work rolled back',database_code:/^[0-9A-Z]{5}$/.test(e.code??'')?e.code:null,external_actions_executed:0};
 await mkdir('reports/daily',{recursive:true});
 await writeFile('reports/daily/runtime-last-failure.json',JSON.stringify(failure,null,2));
 console.error(JSON.stringify(failure));process.exitCode=1;
}finally {if(transaction)await db.exec('rollback');await db.close();}
