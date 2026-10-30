import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const mode=process.argv[2];
if (!['setup','migrate','dry-run'].includes(mode)) throw Error('Use setup, migrate or dry-run');
await mkdir('.local',{recursive:true});
await mkdir('reports/daily',{recursive:true});
const dbName=process.env.GROWTH_LOCAL_DB || 'crm';
if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) throw Error('GROWTH_LOCAL_DB must be a local database name');
const db=new PGlite(`.local/${dbName}`,{extensions:{pgcrypto}});
const sql=async(s,p=[]) => (await db.query(s,p)).rows;
try {
 await db.exec(`create schema if not exists auth;
 create table if not exists auth.users(id uuid primary key);
 create or replace function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;
 create table if not exists public.local_migrations(name text primary key, sha256 text not null, applied_at timestamptz default now());`);
 const migrations=[];
 for(const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
  const body=await readFile(`supabase/migrations/${name}`,'utf8');
  const hash=createHash('sha256').update(body).digest('hex');
  const old=await sql('select sha256 from local_migrations where name=$1',[name]);
  if(old.length) assert.equal(old[0].sha256,hash,`Migration changed: ${name}`);
  else {await db.exec('begin'); try {await db.exec(body); await sql('insert into local_migrations(name,sha256) values($1,$2)',[name,hash]); await db.exec('commit');} catch(e){await db.exec('rollback');throw e;}}
  migrations.push({name,status:old.length?'already_applied':'applied',sha256:hash});
 }
 // Local Supabase-compatible grants, never applied to a remote database.
 await db.exec(`grant usage on schema public, auth to authenticated;
 grant select,insert,update,delete on all tables in schema public to authenticated;
 revoke all on local_migrations from authenticated;
 grant usage,select on all sequences in schema public to authenticated;`);
 await writeFile('reports/daily/local-setup.json',JSON.stringify({mode,engine:'PGlite PostgreSQL; local Auth shim',migrations,production_connected:false},null,2));
 if(mode!=='dry-run') {console.log(JSON.stringify({mode,migrations,external_actions:0},null,2));}
 else {
 const checks=[];
 const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});};
 const denied=async(name,query,params=[],expected)=>{
  await db.exec('savepoint denied'); let error;
  try {await sql(query,params);} catch(e){error=e;}
  await db.exec('rollback to savepoint denied');
  check(name,!!error && (!expected || error.code===expected));
 };
 const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002';
 const companiesBaseline=(await sql('select count(*)::int n from companies'))[0].n;
 await db.exec('begin');
 try {
 await sql('insert into auth.users(id) values($1),($2) on conflict do nothing',[A,B]);
 const w=(await sql("insert into workspaces(name,owner_user_id) values('DRY RUN synthetic workspace',$1) returning id",[A]))[0].id;
 const login=async(id)=>{await db.exec('reset role'); await sql("select set_config('request.jwt.claim.sub',$1,true)",[id]); await db.exec('set local role authenticated');};
 const other=(await sql("insert into workspaces(name,owner_user_id) values('Other TEST workspace',$1) returning id",[B]))[0].id;
 const foreign=(await sql("insert into companies(workspace_id,name,domain) values($1,'Foreign TEST','foreign.invalid') returning id",[other]))[0].id;
 await login(A);
 await denied('Cross-workspace company reference denied',"insert into opportunities(workspace_id,company_id,type,title) values($1,$2,'direct_client','Must fail')",[w,foreign],'23514');
 const c=(await sql("insert into companies(workspace_id,name,domain) values($1,'TEST ONLY — Example','example.invalid') returning id",[w]))[0].id;
 const o=(await sql("insert into opportunities(workspace_id,company_id,type,title,score,confidence,stage) values($1,$2,'direct_client','SYNTHETIC opportunity',80,1,'qualified') returning id",[w,c]))[0].id;
 await sql("insert into evidence(workspace_id,opportunity_id,evidence_type,source_ref,fact,confidence) values($1,$2,'synthetic_fixture','local-dry-run','Test fixture; not a real business opportunity',1)",[w,o]);
 check('Owner sees own company',(await sql('select * from companies')).length===1);
 await login(B);
 check('Second user sees zero foreign companies',(await sql('select * from companies where workspace_id=$1',[w])).length===0);
 check('Second user sees zero pipeline rows',(await sql('select * from v_pipeline')).length===0);
 await login(A);
 await db.exec('savepoint duplicate');
 let duplicate=false; try {await sql("insert into companies(workspace_id,name,domain) values($1,'Duplicate','EXAMPLE.INVALID')",[w]);}catch(e){duplicate=e.code==='23505';}
 await db.exec('rollback to savepoint duplicate');check('Case-insensitive domain deduplication',duplicate);
 const person=(await sql("insert into people(workspace_id,company_id,full_name,email) values($1,$2,'TEST person',' TEST@EXAMPLE.INVALID ') returning id,email",[w,c]))[0];
 check('Email trimmed and normalized',person.email==='test@example.invalid');
 await denied('Trimmed email duplicates denied',"insert into people(workspace_id,full_name,email) values($1,'Duplicate',' test@example.invalid ')",[w],'23505');
 await denied('Direct approved draft insert denied',"insert into drafts(workspace_id,type,body,status) values($1,'cold_email','TEST','approved')",[w],'42501');
 const d=(await sql("insert into drafts(workspace_id,opportunity_id,type,channel,subject,body) values($1,$2,'cold_email','email','TEST ONLY','Synthetic draft. DO NOT SEND.') returning id,payload_hash",[w,o]))[0];
 check('Draft SHA-256 computed',d.payload_hash.length===64);
 await denied('Direct approved draft transition denied',"update drafts set status='approved' where id=$1",[d.id],'42501');
 await sql("update drafts set payload_hash='forged' where id=$1",[d.id]);
 check('Forged payload hash recomputed',(await sql('select payload_hash from drafts where id=$1',[d.id]))[0].payload_hash===d.payload_hash);
 await denied('Mismatched approval hash denied',"insert into approvals(workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot) values($1,$2,$3,'A2','email','nobody@example.invalid','forged','{}')",[w,o,d.id],'23514');
 const a=(await sql("insert into approvals(workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot) values($1,$2,$3,'A2','email','nobody@example.invalid',$4,$5::jsonb) returning id",[w,o,d.id,d.payload_hash,JSON.stringify({synthetic:true,body:'Synthetic draft. DO NOT SEND.'})]))[0].id;
 const envelope=(await sql('select action_hash,payload_snapshot from approvals where id=$1',[a]))[0];
 check('Approval hash binds exact target and payload',envelope.action_hash.length===64 && envelope.payload_snapshot.target==='nobody@example.invalid' && envelope.payload_snapshot.body==='Synthetic draft. DO NOT SEND.');
 await db.exec('reset role');
 await denied('Approval target immutable even for server role',"update approvals set target='other@example.invalid' where id=$1",[a],'23514');
 await login(A);
 check('Owner sees pending approval',(await sql('select * from v_approval_queue')).length===1);
 await login(B);
 check('Second user sees zero approvals',(await sql('select * from v_approval_queue')).length===0);
 await denied('Other user cannot approve request','select approve_action($1)',[a]);
 await login(A);
 const direct=await sql("update approvals set status='approved' where id=$1 returning id",[a]);
 check('Direct approval status bypass changes zero rows',direct.length===0);
 await sql("update drafts set body='Changed synthetic draft. DO NOT SEND.' where id=$1",[d.id]);
 check('Changed draft invalidates pending approval',(await sql('select status from approvals where id=$1',[a]))[0].status==='invalidated');
 check('Changed draft increments version',(await sql('select version from drafts where id=$1',[d.id]))[0].version===2);
 const freshMaintenance=(await sql('select payload_hash from drafts where id=$1',[d.id]))[0].payload_hash;
 const expiredTest=(await sql("insert into approvals(workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot,expires_at) values($1,$2,$3,'A2','email','expiry@example.invalid',$4,'{}',now()+interval '1 microsecond') returning id",[w,o,d.id,freshMaintenance]))[0].id;
 const validTest=(await sql("insert into approvals(workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot) values($1,$2,$3,'A2','email','maintenance@example.invalid',$4,'{}') returning id",[w,o,d.id,freshMaintenance]))[0].id;
 await login(B);
 await denied('Other workspace cannot refresh approval states','select * from refresh_approval_states($1)',[w],'42501');
 await login(A);
 const refreshed=await sql('select * from refresh_approval_states($1)',[w]);
 check('Maintenance records expired request without granting approval',refreshed.length===1 && refreshed[0].approval_id===expiredTest && refreshed[0].current_status==='expired');
 check('Maintenance preserves valid pending request',(await sql('select status,decided_by,decided_at from approvals where id=$1',[validTest]))[0].status==='pending');
 check('Repeated maintenance creates no duplicate transition',(await sql('select * from refresh_approval_states($1)',[w])).length===0);
 await sql("insert into suppressions(workspace_id,scope,normalized_value,reason) values($1,'email','maintenance@example.invalid','TEST late suppression')",[w]);
 const suppressedMaintenance=await sql('select * from refresh_approval_states($1)',[w]);
 check('New suppression invalidates pending request',suppressedMaintenance.length===1 && suppressedMaintenance[0].approval_id===validTest && suppressedMaintenance[0].current_status==='invalidated');
 check('Maintenance grants no approval and attributes no owner decision',(await sql("select count(*)::int n from approvals where workspace_id=$1 and (status='approved' or decided_by is not null)",[w]))[0].n===0);
 check('Maintenance transitions each have an audit event',(await sql("select count(*)::int n from events where workspace_id=$1 and event_type='approval_state_refreshed'",[w]))[0].n===2);
 await sql("insert into suppressions(workspace_id,scope,normalized_value,reason) values($1,'email','nobody@example.invalid','Synthetic opt out')",[w]);
 check('Suppression normalizes email',(await sql('select is_suppressed($1,$2) as blocked',[w,' NOBODY@EXAMPLE.INVALID ']))[0].blocked);
 const fresh=(await sql('select payload_hash from drafts where id=$1',[d.id]))[0].payload_hash;
 await denied('Suppression blocks approval request',"insert into approvals(workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot) values($1,$2,$3,'A2','email','nobody@example.invalid',$4,'{}')",[w,o,d.id,fresh],'23514');
 await db.exec('reset role');
 check('All 13 CRM tables have RLS',(await sql("select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity"))[0].n===13);
 await sql("insert into agent_runs(workspace_id,agent_name,task_key,status,finished_at,input_summary,output_summary,external_actions) values($1,'orchestrator','local-dry-run','succeeded',now(),'Synthetic fixtures only','Safety checks passed; no approvals granted; rollback',0)",[w]);
 await db.exec('rollback');
 check('Dry-run fixtures rolled back',(await sql('select count(*)::int n from companies'))[0].n===companiesBaseline);
 const report={timestamp:new Date().toISOString(),mode:'local-dry-run',checks,external_actions_attempted:0,external_actions_executed:0,owner_approvals_granted:0,synthetic_fixtures_rolled_back:true,production_ready:false,limitations:['Local PostgreSQL with Auth shim; not a hosted Supabase Auth test','No live discovery or AI runtime implemented in archive','No outbound executor installed; A2/A3 execution unavailable','Approved-to-send path untested: owner approval required','Production migrations not applied'],findings:['Original migrations lack approvals SELECT policy; fixed in 005','Migration 006 enforces same-workspace references, normalization and immutable approval envelope including target','Direct approved/sent draft transitions and forged hashes blocked; no external executor installed','Migration 007 adds negative-only approval maintenance with audited expiry and suppression transitions; decision RPC unchanged']};
 await writeFile('reports/daily/dry-run.json',JSON.stringify(report,null,2));
 await writeFile('reports/daily/dry-run.md',`# Локальный dry-run\n\n${report.timestamp}\n\n`+checks.map(c=>`- PASS: ${c.name}`).join('\n')+'\n\nВнешних действий: 0. Согласований от имени владельца: 0. Тестовые записи отменены транзакцией.\n\nОграничения:\n'+report.limitations.map(x=>`- ${x}`).join('\n')+'\n\nЗамечания перед production:\n'+report.findings.map(x=>`- ${x}`).join('\n')+'\n');
 console.log(JSON.stringify(report,null,2));
 } catch(e){await db.exec('rollback');throw e;}
 }
} finally {await db.close();}
