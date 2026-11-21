'use strict';
// Second process reading a persisted synthetic account. This is not a deployed
// James login or proof of actual iPad/Android authentication.
const {createLedger}=require('../../lib/task-execution/ledger.cjs');
const {openStore}=require('./store.cjs');
const store=openStore(process.argv[2]);
createLedger(store).snapshot(process.argv[3]).then(document=>{
 process.stdout.write(JSON.stringify({tasks:document.tasks.map(t=>({id:t.id,status:t.status,revision:t.revision,checkpoint:t.checkpoint?.step||null,result:t.result?.outcome||null}))}));
}).catch(()=>{process.exitCode=1;}).finally(()=>store.close());
