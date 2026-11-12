/**
 * GET /api/health
 * Does not expose secret values.
 */
const { requireAuth } = require("../auth.js");

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });
  }

  if(req.query?.probe==='microsoft'){
    // Fixed public target, no Authorization header, no mailbox or token reads.
    const started=Date.now();
    try{
      const response=await fetch('https://graph.microsoft.com/v1.0/me?$select=id',{
        method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)
      });
      try{await response.body?.cancel();}catch{}
      return res.status(200).json({ok:true,probeOnly:true,target:'microsoft_graph',reachable:true,httpStatus:response.status,elapsedMs:Date.now()-started});
    }catch(error){
      const allowed=['ENOTFOUND','EAI_AGAIN','ENETUNREACH','ETIMEDOUT','ECONNRESET','UND_ERR_CONNECT_TIMEOUT'];
      const reason=error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':allowed.includes(error?.cause?.code)?error.cause.code:'request_failed';
      return res.status(200).json({ok:true,probeOnly:true,target:'microsoft_graph',reachable:false,reason,elapsedMs:Date.now()-started});
    }
  }

  return res.status(200).json({
    ok: true,
    service: "james-live-council",
    version: "0.4.0",
    openai_configured: Boolean(process.env.OPENAI_API_KEY)
  });
};
