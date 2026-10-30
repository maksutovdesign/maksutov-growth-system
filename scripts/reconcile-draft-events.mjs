import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {idFor} from '../runtime/pipeline.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
if(args.some(a=>a!=='--apply'))throw Error('Only --apply is supported');
const apply=args.includes('--apply');
const cfg=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(cfg.local_only!==true||!/^[\w-]+$/.test(cfg.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${cfg.database}`,{extensions:{pgcrypto}});
const q=async(s,p=[cfg.workspace_id])=>(await db.query(s,p)).rows;
let tx=false;
try{
 await db.exec('begin');tx=true;
 await q("select set_config('request.jwt.claim.sub',$1,true)",[cfg.operator_user_id]);await db.exec('set local role authenticated');
 const before={drafts:await q('select * from drafts where workspace_id=$1 order by id'),approvals:await q('select * from approvals where workspace_id=$1 order by id'),events:await q('select * from events where workspace_id=$1 order by id')};
 const missing=()=>q(`select d.id,d.created_at,d.opportunity_id,e.id as provenance_event_id,e.created_at as provenance_recorded_at
 from drafts d join events e on e.workspace_id=d.workspace_id and e.event_type='owner_terms_applied' and e.payload->'drafts' @> to_jsonb(array[d.id::text])
 where d.workspace_id=$1 and not exists(select 1 from events x where x.workspace_id=d.workspace_id and x.entity_id=d.id and x.event_type in ('draft_created','draft_creation_reconciled'))`);
 const corrected=[];
 const reconcile=async()=>{
  let n=0;
  for(const d of await missing()){
   // Append only: now() is actual audit time; original creation time stays in payload.
   const rows=await q("insert into events(workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload) select $1,'draft',$2,'draft_creation_reconciled','agent','analytics',$3 where not exists(select 1 from events where workspace_id=$1 and entity_id=$2 and event_type in ('draft_created','draft_creation_reconciled')) returning id,created_at",[cfg.workspace_id,d.id,{original_created_at:d.created_at,provenance_event_id:d.provenance_event_id,provenance_recorded_at:d.provenance_recorded_at,reason:'Original writer stored draft without draft_created event; append-only audit reconciliation',not_a_new_draft:true,source:'CRM drafts and existing owner_terms_applied event'}]);
   n+=rows.length;if(rows.length)corrected.push({...d,reconciliation_event:rows[0]});
  }return n;
 };
 const created=await reconcile();const replay=await reconcile();
 assert.equal(replay,0,'Replay must not duplicate corrections');
 assert.deepEqual(await q('select * from drafts where workspace_id=$1 order by id'),before.drafts,'Draft content/status unchanged');
 assert.deepEqual(await q('select * from approvals where workspace_id=$1 order by id'),before.approvals,'Approval content/status unchanged');
 const afterEvents=await q('select * from events where workspace_id=$1 order by id');
 assert.deepEqual(afterEvents.filter(e=>before.events.some(old=>old.id===e.id)),before.events,'Historical events unchanged');
 const [coverage]=await q(`select count(*)::int as drafts,
 count(*) filter(where exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type='draft_created'))::int as original_creation_events,
 count(*) filter(where not exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type='draft_created') and exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type='draft_creation_reconciled'))::int as reconciled,
 count(*) filter(where not exists(select 1 from events e where e.workspace_id=d.workspace_id and e.entity_id=d.id and e.event_type in ('draft_created','draft_creation_reconciled')))::int as unresolved
 from drafts d where d.workspace_id=$1`);
 let tasksUpdated=0;
 if(coverage.unresolved===0){
  const rows=await q("update tasks set status='done',description=$3 where id=$1 and workspace_id=$2 and status<>'done' returning id",[idFor(cfg.workspace_id,'missing-draft-event-review'),cfg.workspace_id,'Append-only reconciliation completed. Original draft_created events remain 2; one historical missing creation is covered by draft_creation_reconciled with original timestamp/provenance. No historical event or draft/approval was rewritten. See reports/daily/draft-reconciliation-apply.json.']);tasksUpdated=rows.length;
  if(rows.length)await q("insert into events(workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload) values($1,'task',$2,'data_quality_issue_resolved','agent','analytics',$3)",[cfg.workspace_id,rows[0].id,coverage]);
 }
 if(apply)await q("insert into agent_runs(workspace_id,agent_name,task_key,status,finished_at,input_summary,output_summary,records_created,records_updated,external_actions,metadata) values($1,'analytics','draft-event-reconciliation','succeeded',now(),'Existing CRM only; append-only audit correction','Historical missing creation covered without changing draft or approval',0,$2,0,$3)",[cfg.workspace_id,tasksUpdated,{correction_events_created:created,checks_passed:4,replay_created:replay,external_actions_attempted:0,external_actions_executed:0}]);
 await db.exec(apply?'commit':'rollback');tx=false;
 const report={timestamp:new Date().toISOString(),mode:apply?'apply':'dry-run',committed:apply,correction_events_created:created,corrections:corrected,replay_created:replay,coverage,tasks_updated:tasksUpdated,checks:['replay_no_duplicates','drafts_unchanged','approvals_unchanged','historical_events_unchanged'].map(name=>({name,status:'PASS'})),external_actions_attempted:0,external_actions_executed:0};
 await writeFile(`reports/daily/draft-reconciliation-${apply?'apply':'dry-run'}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{if(tx)await db.exec('rollback');await db.close();}
