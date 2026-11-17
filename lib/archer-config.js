'use strict';
// Michael confirmed the subscription purchase on 2026-11-17. Activation is
// limited to his combined Preview. An explicit false remains a kill switch.
function archerEnabled(env){
 if(env.JAMES_ARCHER_ENABLED!==undefined)return env.JAMES_ARCHER_ENABLED==='true';
 return env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='fix/calendar-refresh-diagnosis-20261031';
}
module.exports={archerEnabled};
