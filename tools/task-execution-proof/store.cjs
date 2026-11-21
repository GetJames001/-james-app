'use strict';
// Disposable synthetic proof adapter, NOT a production database migration.
// SQLite transactions survive process death and supply real cross-process CAS.
const {DatabaseSync}=require('node:sqlite');
function openStore(filename){
 const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS artifacts (key TEXT PRIMARY KEY, digest TEXT NOT NULL, value TEXT NOT NULL);');
 return {
  read:async key=>db.prepare('SELECT value FROM documents WHERE key=?').get(key)?.value??null,
  compareAndSwap:async(key,old,next)=>{
   db.exec('BEGIN IMMEDIATE');
   try{const actual=db.prepare('SELECT value FROM documents WHERE key=?').get(key)?.value??null;
    if(actual!==old){db.exec('ROLLBACK');return false;}
    db.prepare('INSERT INTO documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,next);db.exec('COMMIT');return true;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  artifact(key,digest,value){
   db.prepare('INSERT OR IGNORE INTO artifacts(key,digest,value) VALUES (?,?,?)').run(key,digest,JSON.stringify(value));
   const row=db.prepare('SELECT digest,value FROM artifacts WHERE key=?').get(key);
   if(row.digest!==digest)throw Error('ARTIFACT_ID_REUSED');return JSON.parse(row.value);
  },
  findArtifact:key=>{const row=db.prepare('SELECT digest,value FROM artifacts WHERE key=?').get(key);return row?{digest:row.digest,value:JSON.parse(row.value)}:null;},
  artifactCount:()=>db.prepare('SELECT COUNT(*) AS count FROM artifacts').get().count,
  close:()=>db.close()
 };
}
module.exports={openStore};
