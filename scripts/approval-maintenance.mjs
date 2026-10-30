import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'))throw Error('Only --apply allowed');const apply=args.includes('--apply');
const cfg=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(cfg.local_only!==true||!/^[\w-]+$/.test(cfg.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${cfg.database}`,{extensions:{pgcrypto}});
const q=async(s,p=[])=>(await db.query(s,p)).rows;let tx=false;
try{
 await db.exec('begin');tx=true;
 await q("select set_config('request.jwt.claim.sub',$1,true)",[cfg.operator_user_id]);await db.exec('set local role authenticated');
 const envelope=()=>q('select id,target,payload_hash,action_hash,payload_snapshot,decided_by,decided_at from approvals where workspace_id=$1 order by id',[cfg.workspace_id]);
 const before=await envelope();
 const changes=await q('select * from refresh_approval_states($1)',[cfg.workspace_id]);
 assert.ok(changes.every(c=>c.previous_status==='pending'&&['expired','invalidated'].includes(c.current_status)));
 assert.deepEqual(await envelope(),before,'Immutable action and owner decision unchanged');
 const replay=await q('select * from refresh_approval_states($1)',[cfg.workspace_id]);assert.equal(replay.length,0,'Replay creates no transitions');
 if(apply)await q("insert into agent_runs(workspace_id,agent_name,task_key,status,finished_at,input_summary,output_summary,records_updated,external_actions,metadata) values($1,'orchestrator','approval-maintenance','succeeded',now(),'Local pending approvals only','Expiry/suppression refreshed; never approved any action',$2,0,$3)",[cfg.workspace_id,changes.length,{external_actions_attempted:0,external_actions_executed:0,approval_level:'A1',replay_transitions:0}]);
 await db.exec(apply?'commit':'rollback');tx=false;
 const report={timestamp:new Date().toISOString(),mode:apply?'apply':'dry-run',committed:apply,changes,replay_transitions:replay.length,action_envelopes_unchanged:true,owner_decisions_unchanged:true,approvals_granted:0,external_actions:0};
 await writeFile(`reports/daily/approval-maintenance-${apply?'apply':'dry-run'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(tx)await db.exec('rollback');await db.close();}
