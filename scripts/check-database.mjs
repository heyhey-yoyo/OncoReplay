// 在独立内存 SQLite 中验证实际 Worker 路由，不连接线上数据库。需要 Node.js 22.13+。
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { checkRateLimit, resolveRateLimit } from '../src/worker/lib/rate-limit.js';
const root = fileURLToPath(new URL('../', import.meta.url));
function db(beforeUnique=false){
 const sql=new DatabaseSync(':memory:');
 const files=readdirSync(root+'migrations').sort();
 for(const f of beforeUnique?files.slice(0,2):files)sql.exec(readFileSync(root+'migrations/'+f,'utf8'));
 function statement(query,args=[]){return {query,args,bind(...values){return statement(query,values)},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:r.changes}}}};}
 const DB={prepare:query=>statement(query),async batch(stmts){sql.exec('BEGIN');try{const results=stmts.map(s=>{const stmt=sql.prepare(s.query);return stmt.columns().length?{results:stmt.all(...s.args)}:{meta:{changes:stmt.run(...s.args).changes}}});sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {sql,DB};
}
const migration=db(true),now=new Date().toISOString();
for(const [id,status] of [['old','failed'],['good','complete'],['new','complete']]){
 migration.sql.prepare('INSERT INTO replays(id,slug,title,original_query,normalized_query,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,id,id,id,id,status,now,now);
 migration.sql.prepare('INSERT INTO replay_queries(id,replay_id,query_hash,created_at) VALUES (?,?,?,?)').run(id,id,'same',now);
 migration.sql.prepare("INSERT INTO jobs(id,replay_id,job_type,status,created_at,updated_at) VALUES (?,?,'FETCH_WORKS','failed',?,?)").run(id,id,now,now);
}
const migrationText=readFileSync(root+'migrations/0003_query_hash_unique.sql','utf8');migration.sql.exec(migrationText);migration.sql.exec(migrationText);
assert.deepEqual(migration.sql.prepare('SELECT id FROM replays').all().map(x=>x.id),['good']);
assert.equal(migration.sql.prepare('SELECT count(*) n FROM jobs').get().n,1);
assert.throws(()=>migration.sql.prepare('INSERT INTO replay_queries(id,replay_id,query_hash,created_at) VALUES (?,?,?,?)').run('dup','good','same',now),/UNIQUE/);
assert.equal(migration.sql.prepare('PRAGMA foreign_key_check').all().length,0);
console.log('PASS migration: preferred complete replay, cascade, idempotence, unique index, foreign keys');
const {sql,DB}=db();let sends=0,pending=[];
const env={DB,REPLAY_QUEUE:{async send(){sends++}},OPENALEX_API_KEY:'local-test-only',RATE_LIMIT_CREATE_PER_HOUR:5,RATE_LIMIT_RETRY_PER_HOUR:10};
const ctx={waitUntil(p){pending.push(p)}};
function req(path='/api/replays',ip='127.0.0.1'){return new Request('https://local.test'+path,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({topic:'KRAS testing',reuseKey:'a'.repeat(32)})})}
async function call(path,ip){const response=await worker.fetch(req(path,ip),env,ctx);await Promise.all(pending);pending=[];return response}
const concurrent=await Promise.all([call(),call()]);const bodies=await Promise.all(concurrent.map(r=>r.json()));
assert.equal(bodies[0].slug,bodies[1].slug);assert.equal(sends,1);assert.equal(sql.prepare('SELECT count(*) n FROM replays').get().n,1);
console.log('PASS concurrent identical creates: one replay and one queue message');
await call();await call();await call();const limited=await call();assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal(sends,1);
assert.equal((await call(undefined,'127.0.0.2')).status,202);
console.log('PASS create endpoint: sixth request rejected with Retry-After, different IP isolated');
const slug=bodies[0].slug;sql.prepare("UPDATE replays SET status='failed' WHERE slug=?").run(slug);
const failed=await call(undefined,'127.0.0.3');assert.equal(failed.status,200);assert.equal((await failed.json()).status,'failed');
const retries=await Promise.all([call('/api/replays/'+slug+'/retry','127.0.0.4'),call('/api/replays/'+slug+'/retry','127.0.0.4')]);assert.deepEqual(retries.map(r=>r.status).sort(),[202,409]);assert.equal(sends,2);
console.log('PASS failed replay reuse and concurrent retry: one queued job, other request 409');
for(let i=0;i<8;i++)await call('/api/replays/'+slug+'/retry','127.0.0.4');assert.equal((await call('/api/replays/'+slug+'/retry','127.0.0.4')).status,429);
console.log('PASS retry endpoint: eleventh request rejected');
const fresh=db();const t=new Date('2026-09-12T15:59:59Z');assert.equal((await checkRateLimit(fresh,'unused',1,t)).allowed,true);
const quota={DB:fresh.DB};assert.equal((await checkRateLimit(quota,'same',1,t)).allowed,true);assert.equal((await checkRateLimit(quota,'same',1,t)).allowed,false);assert.equal((await checkRateLimit(quota,'same',1,new Date('2026-09-12T16:00:00Z'))).allowed,true);
for(const value of ['1.5','5garbage',0,-1,'Infinity'])assert.equal(resolveRateLimit({RATE_LIMIT_CREATE_PER_HOUR:value},'RATE_LIMIT_CREATE_PER_HOUR'),5);
console.log('PASS real SQL fixed-window rollover and strict positive integer configuration');

const outsiderRequest=new Request('https://local.test/api/replays',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.55'},body:JSON.stringify({topic:'KRAS testing',reuseKey:'b'.repeat(32)})});
const outsider=await worker.fetch(outsiderRequest,env,ctx);const outsiderBody=await outsider.json();
assert.notEqual(outsiderBody.slug,slug);assert.equal(outsider.status,202);
const noCredentialSlugs=[];
for(let i=0;i<2;i++){
 const request=new Request('https://local.test/api/replays',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.56'},body:JSON.stringify({topic:'KRAS testing'})});
 const response=await worker.fetch(request,env,ctx);assert.equal(response.status,202);
 noCredentialSlugs.push((await response.json()).slug);
 await Promise.all(pending);pending=[];
}
assert.equal(new Set([slug,outsiderBody.slug,...noCredentialSlugs]).size,4);
console.log('PASS same query without reuse credentials creates two independent replays');
const {cleanupExpiredReplays}=await import('../src/worker/lib/pipeline.js');
sql.prepare('INSERT INTO rate_limits(key,window_start,count) VALUES (?,?,1)').run('old-raw-ip','2000-01-01T00:00:00.000Z');
await cleanupExpiredReplays(env);
assert.equal(sql.prepare("SELECT count(*) n FROM rate_limits WHERE key='old-raw-ip'").get().n,0);
console.log('PASS unlisted query isolation and old IP deletion on real SQLite');
