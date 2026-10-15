import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
export interface DbClient { query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<T[]>; }
interface Database extends DbClient { transaction<T>(fn:(tx:DbClient)=>Promise<T>):Promise<T>; }
const globalDb=globalThis as unknown as {maisonneeDb?:Promise<Database>};
async function connect():Promise<Database> {
  let db:Database;
  if(process.env.DATABASE_URL) {
    const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10});
    db={query:async<T>(sql:string,params:unknown[]=[]) => (await pool.query(sql,params)).rows as T[],transaction:async<T>(fn:(tx:DbClient)=>Promise<T>)=>{
      const client=await pool.connect();
      try { await client.query('BEGIN'); const result=await fn({query:async<R>(sql:string,params:unknown[]=[]) => (await client.query(sql,params)).rows as R[]}); await client.query('COMMIT'); return result; }
      catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
    }};
  } else {
    if(process.env.APP_MODE!=='demo'&&process.env.NODE_ENV!=='test') throw new Error('DATABASE_URL obligatoire hors démonstration explicite APP_MODE=demo.');
    const dataDir=process.env.PGLITE_DATA_DIR||path.join(process.cwd(),'.data','maisonnee');
    if(dataDir!=='memory://') await mkdir(dataDir,{recursive:true});
    const pglite=new PGlite(dataDir);
    await pglite.waitReady;
    db={query:async<T>(sql:string,params:unknown[]=[]) => (await pglite.query<T>(sql,params)).rows,
      transaction:async<T>(fn:(tx:DbClient)=>Promise<T>)=>pglite.transaction(async tx=>fn({query:async<R>(sql:string,params:unknown[]=[]) => (await tx.query<R>(sql,params)).rows}))};
  }
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files=(await readdir(path.join(process.cwd(),'migrations'))).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files) {
    await db.transaction(async tx=>{
      if(process.env.DATABASE_URL) await tx.query('SELECT pg_advisory_xact_lock(71688220)');
      if((await tx.query('SELECT name FROM schema_migrations WHERE name=$1',[file])).length) return;
      const sql=await readFile(path.join(process.cwd(),'migrations',file),'utf8');
      // Migration files are trusted application code; statements contain no user input.
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);
    });
  }
  if(process.env.APP_MODE==='demo') { const {seed}=await import('./seed'); await db.transaction(async tx=>{if(process.env.DATABASE_URL)await tx.query('SELECT pg_advisory_xact_lock(71688220)');await seed(tx);}); }
  else {
    if((await db.query("SELECT id FROM users WHERE id IN ('demo-client','demo-admin','demo-chef','demo-chef-2','demo-chef-3') LIMIT 1")).length)throw new Error('La base contient des comptes de démonstration. Utilisez une base vierge distincte hors APP_MODE=demo.');
    await db.query("INSERT INTO commission_rules(id,basis_points) VALUES('initial-commission',1000) ON CONFLICT(id) DO NOTHING");
  }
  return db;
}
async function database(){if(!globalDb.maisonneeDb) globalDb.maisonneeDb=connect().catch(error=>{delete globalDb.maisonneeDb;throw error;});return globalDb.maisonneeDb;}
export async function query<T=Record<string,unknown>>(sql:string,params:unknown[]=[]):Promise<T[]> {return (await database()).query<T>(sql,params);}
export async function transaction<T>(fn:(tx:DbClient)=>Promise<T>):Promise<T> {return (await database()).transaction(fn);}
