import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const config=JSON.parse(await readFile('.local/runtime.json','utf8'));
if(config.local_only!==true || !/^[a-zA-Z0-9_-]+$/.test(config.database))throw Error('Local database required');
const tables=['workspaces','workspace_members','companies','people','opportunities','evidence','drafts','approvals','touchpoints','suppressions','tasks','agent_runs','events','local_migrations'];
async function fingerprints(db){
 const result={};
 for(const table of tables){
  const rows=(await db.query(`select to_jsonb(t) row from public.${table} t`)).rows.map(x=>JSON.stringify(x.row)).sort();
  result[table]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
 }
 return result;
}
let db=new PGlite(`.local/${config.database}`,{extensions:{pgcrypto}});
let restored;
try {
 const before=await fingerprints(db);
 const archive=await db.dumpDataDir('gzip');
 const bytes=Buffer.from(await archive.arrayBuffer());
 const stamp=new Date().toISOString().replaceAll(':','-');
 const file=`.local/backups/crm-${stamp}.tgz`;
 await mkdir('.local/backups',{recursive:true});
 await writeFile(file,bytes,{flag:'wx',mode:0o600});
 const runtimeConfigFile=`${file}.runtime.json`;
 await writeFile(runtimeConfigFile,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
 await db.close();
 // Restore to memory only; never replace the live database.
 restored=new PGlite({loadDataDir:new Blob([await readFile(file)]),extensions:{pgcrypto}});
 const after=await fingerprints(restored);
 assert.deepEqual(after,before,'Restored table content differs');
 const report={timestamp:new Date().toISOString(),scope:'local-only',archive:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),runtime_config_backup:runtimeConfigFile,restore_target:'temporary in-memory database',live_database_replaced:false,tables_verified:tables.length,restore_check:'PASS',fingerprints:after};
 await writeFile('reports/daily/local-backup-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({archive:file,tables_verified:tables.length,restore_check:'PASS',live_database_replaced:false},null,2));
}finally{if(restored)await restored.close();if(!db.closed)await db.close();}
