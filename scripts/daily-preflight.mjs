import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {PGlite} from '@electric-sql/pglite';import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const control=JSON.parse(await readFile('config/daily-run-control.json','utf8'));
if(control.enabled!==true||process.env.GROWTH_AUTOMATION_ENABLED==='false')throw Error('Daily run disabled by kill switch');
if(control.external_actions_enabled!==false||process.env.GROWTH_EXTERNAL_ACTIONS_ENABLED==='true')throw Error('A0/A1 scope required: external actions must remain disabled');
if(control.timezone!=='Europe/Moscow'||!Number.isInteger(control.max_new_candidates_per_track)||control.max_new_candidates_per_track<1||control.max_new_candidates_per_track>5||!Number.isInteger(control.max_new_drafts_per_run)||control.max_new_drafts_per_run<0||control.max_new_drafts_per_run>3)throw Error('Invalid daily control limits');
const cfg=JSON.parse(await readFile('.local/runtime.json','utf8'));if(cfg.local_only!==true||!/^[\w-]+$/.test(cfg.database))throw Error('Local runtime required');
const db=new PGlite(`.local/${cfg.database}`,{extensions:{pgcrypto}});
try{
 const {rows:migrations}=await db.query('select name from local_migrations order by name');
 for(const name of ['001_core.sql','002_functions_triggers.sql','003_rls.sql','004_views.sql','005_approval_visibility.sql','006_integrity_guards.sql','007_approval_maintenance.sql'])if(!migrations.some(r=>r.name===name))throw Error('Missing migration: '+name);
 await db.exec('begin read only');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[cfg.operator_user_id]);await db.exec('set local role authenticated');
 const {rows:workspace}=await db.query('select id,settings from workspaces where id=$1',[cfg.workspace_id]);if(workspace.length!==1)throw Error('Operator cannot access workspace');
 const {rows:membership}=await db.query('select role from workspace_members where workspace_id=$1 and user_id=$2',[cfg.workspace_id,cfg.operator_user_id]);if(!['operator','owner','admin'].includes(membership[0]?.role))throw Error('Operator membership required');
 await db.exec('rollback');
 console.log(JSON.stringify({status:'PASS',scope:'local A0/A1 only',control_file:'config/daily-run-control.json',timezone:control.timezone,max_candidates_per_track:control.max_new_candidates_per_track,max_new_drafts:control.max_new_drafts_per_run,migrations_verified:7,workspace_access:'PASS',external_actions_enabled:false,scheduled_execution_check:'not_part_of_runtime_preflight'},null,2));
}finally{await db.close();}
