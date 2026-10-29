'use strict';
// Presence-only: no network, account creation, provider compute or secret values.
const result={provider:'browserbase',credentialsPresent:Boolean(process.env.BROWSERBASE_API_KEY&&process.env.BROWSERBASE_PROJECT_ID),enabled:process.env.J30_BROWSERBASE_ENABLED==='1',usageApproved:process.env.J30_BROWSERBASE_USAGE_APPROVED==='1',liveDemoVerified:false};
if(require.main===module)process.stdout.write(JSON.stringify(result,null,2)+'\n');
module.exports=result;
