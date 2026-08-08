const handler = require("../api/council.js");

function mockRes(){
  return {
    statusCode:200,
    headers:{},
    body:null,
    setHeader(k,v){this.headers[k]=v;},
    status(n){this.statusCode=n; return this;},
    json(v){this.body=v; return this;},
    end(){return this;}
  };
}

(async()=>{
  let res=mockRes();
  await handler({method:"GET",body:{}},res);
  console.log("GET:",res.statusCode,res.body?.error);
  if(res.statusCode!==405) process.exit(1);

  const old=process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  res=mockRes();
  await handler({method:"POST",body:{question:"Test"}},res);
  console.log("NO KEY:",res.statusCode,res.body?.error);
  if(res.statusCode!==500 || res.body?.error!=="OPENAI_API_KEY_NOT_CONFIGURED") process.exit(2);

  res=mockRes();
  await handler({method:"POST",body:{}},res);
  // Key check comes before question validation in this version; still must not leak anything.
  console.log("EMPTY BODY WITHOUT KEY:",res.statusCode,res.body?.error);

  if(old) process.env.OPENAI_API_KEY=old;
})();
