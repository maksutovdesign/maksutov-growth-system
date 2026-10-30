// Save manual-review tasks only. Does not create opportunities, drafts or approvals.
import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {idFor} from '../runtime/pipeline.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const file=process.argv[2];if(!/^data\/(jobs|studios|leads)\/[\w.-]+\.json$/.test(file??''))throw Error('Local candidate JSON path required');
const raw=await readFile(file,'utf8');const candidates=JSON.parse(raw);assert.ok(Array.isArray(candidates)&&candidates.length<=100);
const cfg=JSON.parse(await readFile('.local/runtime.json','utf8'));if(cfg.local_only!==true||!/^[\w-]+$/.test(cfg.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${cfg.database}`,{extensions:{pgcrypto}});const q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
 await db.exec('begin');await q("select set_config('request.jwt.claim.sub',$1,true)",[cfg.operator_user_id]);await db.exec('set local role authenticated');
 const before=await q('select id,status,payload_hash,action_hash,target from approvals where workspace_id=$1 order by id',[cfg.workspace_id]);
 const drafts=await q('select * from drafts where workspace_id=$1 order by id',[cfg.workspace_id]);
 let created=0;const tasks=[];
 for(const c of candidates){
  assert.equal(c.metadata?.review_required,true,'Only explicitly flagged manual-review candidates');
  assert.ok(c.domain&&c.name&&c.source_url?.startsWith('https://')&&Array.isArray(c.evidence)&&c.evidence.length>=2);
  const score=Object.values(c.scoring).reduce((n,v)=>n+v.points,0);assert.ok(Number.isFinite(score)&&score>=0&&score<=100);
  const id=idFor(cfg.workspace_id,'candidate-review',c.domain,c.source_url);
  const rows=await q("insert into tasks(id,workspace_id,task_type,title,description,status,priority,impact,effort,confidence,acceptance_criteria,assigned_agent) values($1,$2,'research_review',$3,$4,'blocked',15,3,2,1,$5,'orchestrator') on conflict do nothing returning id",[id,cfg.workspace_id,`${c.name}: проверить условия сотрудничества`,JSON.stringify({candidate:c,score,source_artifact:file,qualified:false},null,2),['Подтвердить обязательные навыки, язык и допустимость remote','Разделить evergreen roster и конкретный оплачиваемый проект','Сохранить прежние evidence; новый score только после явного review','Черновик и точный A2 только после квалификации; ничего не отправлять автоматически']]);created+=rows.length;
  if(rows.length)await q("insert into events(workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload) values($1,'task',$2,'candidate_manual_review_created','agent','orchestrator',$3)",[cfg.workspace_id,id,{domain:c.domain,score,artifact:file,qualified:false}]);
  tasks.push({id,name:c.name,score,new_record:rows.length===1});
 }
 assert.deepEqual(await q('select id,status,payload_hash,action_hash,target from approvals where workspace_id=$1 order by id',[cfg.workspace_id]),before);
 assert.deepEqual(await q('select * from drafts where workspace_id=$1 order by id',[cfg.workspace_id]),drafts);
 const agent=file.includes('/studios/')?'studio_hunter':file.includes('/jobs/')?'job_hunter':'lead_hunter';
 const runId=idFor(cfg.workspace_id,'manual-review-ingest',file,createHash('sha256').update(raw).digest('hex'));
 await q("insert into agent_runs(id,workspace_id,agent_name,task_key,status,finished_at,input_summary,output_summary,sources_count,records_created,external_actions,metadata) values($1,$2,$3,'manual-review-ingest','succeeded',now(),$4,'Manual review only; no qualification, drafts or approvals',$5,$6,0,$7) on conflict do nothing",[runId,cfg.workspace_id,agent,file,new Set(candidates.flatMap(c=>c.evidence.map(e=>e.source_url))).size,created,{artifact:file,approval_level:'A1',external_actions_attempted:0,external_actions_executed:0}]);
 await db.exec('commit');const report={input:file,tasks_created:created,tasks,approvals_unchanged:true,drafts_unchanged:true,external_actions:0};
 await writeFile('reports/daily/candidate-review-last.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await db.exec('rollback');throw e;}finally{await db.close();}
