'use strict';
const crypto = require('node:crypto');
const { boundedJson } = require('../attention/storage-response.cjs');
const { createPreviewProof, DEVICE_BRANCH } = require('./preview-proof.cjs');

const PROJECT = 'prj_SeUz2jQJ2KqxZFMALQsKloLicijw';
const WINDOW = 30 * 60 * 1000;
const KEEP = 24 * 60 * 60 * 1000;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function enabled(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_PROJECT_ID === PROJECT &&
    env.VERCEL_GIT_COMMIT_REF === DEVICE_BRANCH &&
    /^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '') &&
    env.JAMES_DEVICE_PROOF_HEAD === env.VERCEL_GIT_COMMIT_SHA;
}

// The pilot accepts one Chrome Android subscription. A caller cannot supply
// a destination host, redirect, message, calendar entry or notification URL.
function chromeEndpoint(value) {
  if (typeof value !== 'string' || !/^https:\/\/fcm\.googleapis\.com\/(?:fcm\/send|wp)\/[A-Za-z0-9_:\-]{16,2048}$/.test(value)) fail('INVALID_SUBSCRIPTION');
  return value;
}

const swap = "local v=redis.call('GET',KEYS[1]); if (v or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'PXAT',ARGV[3]); return 1";
function deviceStore(env, owner, fetchImpl) {
  if (!owner || !env.KV_REST_API_TOKEN || !env.KV_REST_API_URL?.startsWith('https://') || Buffer.byteLength(env.JAMES_SESSION_SECRET || '') < 32) fail('NOT_CONFIGURED');
  const scope = crypto.createHash('sha256').update(JSON.stringify([owner, env.VERCEL_GIT_COMMIT_SHA])).digest('hex');
  const key = 'james:device-proof:v1:' + scope;
  const secret = crypto.hkdfSync('sha256', env.JAMES_SESSION_SECRET, scope, 'james/preview/device-proof/v1', 32);
  function seal(data) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function open(raw) {
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.length > 14000) fail('STORAGE_UNAVAILABLE');
    const bytes = Buffer.from(raw, 'base64url'), decipher = crypto.createDecipheriv('aes-256-gcm', secret, bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
  }
  async function command(args) {
    const response = await fetchImpl(env.KV_REST_API_URL, {method:'POST', redirect:'error', signal:AbortSignal.timeout(3500), headers:{'Content-Type':'application/json', Authorization:'Bearer ' + env.KV_REST_API_TOKEN}, body:JSON.stringify(args)});
    if (!response.ok) fail('STORAGE_UNAVAILABLE');
    const body = await boundedJson(response);
    if (body.error || !Object.hasOwn(body, 'result')) fail('STORAGE_UNAVAILABLE');
    return body.result;
  }
  return {
    read: async () => open(await command(['GET', key])),
    async change(fn) {
      for (let i=0; i<5; i++) {
        const raw = await command(['GET',key]), state = open(raw);
        const before = JSON.stringify(state), next = fn(state);
        if (JSON.stringify(next) === before) return next;
        const result = await command(['EVAL',swap,1,key,raw || '',seal(next),String(next.start + KEEP)]);
        if (result === 1) return next;
        if (result !== 0) fail('STORAGE_UNAVAILABLE');
      }
      fail('STORAGE_UNAVAILABLE');
    }
  };
}

function vapid(publicKey, privateKey, at) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = encode({typ:'JWT',alg:'ES256'}) + '.' + encode({aud:'https://fcm.googleapis.com', exp:Math.floor(at/1000)+300, sub:'https://getjames.ai'});
  const signature = crypto.sign('sha256', Buffer.from(data), {key:crypto.createPrivateKey({key:privateKey,format:'jwk'}),dsaEncoding:'ieee-p1363'}).toString('base64url');
  return 'vapid t=' + data + '.' + signature + ', k=' + publicKey;
}

function createDeviceProof({env=process.env, owner, fetchImpl=fetch, now=Date.now, store, postPush=fetchImpl}) {
  if (!enabled(env)) fail('NOT_ENABLED');
  store ||= deviceStore(env, owner, fetchImpl);
  const active = state => {
    if (!state || state.stopped || now() < state.start || now() >= state.start + WINDOW) fail('WINDOW_CLOSED');
    return state;
  };
  function proof(state) {
    return createPreviewProof({owner, fetchImpl, now, env:{...env, JAMES_HOSTED_PROOF_ENABLED:'true', JAMES_HOSTED_PROOF_ID:'device-'+state.id, JAMES_HOSTED_PROOF_START_AT:String(state.start), JAMES_HOSTED_PROOF_END_AT:String(state.start+WINDOW)}});
  }
  async function record(state) {
    if (!state) return {};
    const {tasks, notifications} = await proof(state).status();
    const agenda = tasks.find(t=>t.kind==='agenda_fixture' && t.status==='completed' && t.result?.outcome==='prepared');
    const notice = agenda && notifications.find(n=>n.taskId===agenda.id);
    return {agenda,notice};
  }
  async function status() {
    const state = await store.read();
    if (!state) return {state:'new'};
    const {agenda,notice} = await record(state);
    return {state:state.stopped?'stopped':now()>=state.start+WINDOW?'expired':state.endpoint?'registered':'pairing',
      subscriptionKey:!state.stopped && now()<state.start+WINDOW ? state.publicKey : null,
      agenda:agenda?.result.artifact || null, notice:notice?.state || null, transport:state.transport,
      shown:!!state.shown, opened:!!state.opened, id:state.id};
  }
  async function begin() {
    const state = await store.change(prior=>{
      if (prior) return active(prior);
      const {publicKey,privateKey} = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
      const jwk = publicKey.export({format:'jwk'});
      return {id:crypto.randomUUID(),start:now(),stopped:false,publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url'),privateKey:privateKey.export({format:'jwk'}),endpoint:null,transport:'idle',shown:false,opened:false};
    });
    return {subscriptionKey:state.publicKey};
  }
  async function pair(endpoint) {
    chromeEndpoint(endpoint);
    await store.change(state=>{
      active(state);
      if (state.endpoint && state.endpoint!==endpoint) fail('DEVICE_ALREADY_PAIRED');
      state.endpoint=endpoint;
      return state;
    });
    return {state:'registered'};
  }
  const receipt = state => state?.shown ? {status:'delivered',receiptId:'shown-'+state.id} : {status:'unknown'};
  async function run() {
    let state = active(await store.read());
    if (!state.endpoint) fail('DEVICE_REQUIRED');
    const engine = proof(state);
    await engine.tick();
    const {notice} = await record(state);
    if (!notice) fail('AGENDA_UNAVAILABLE');
    async function send(message,{signal}) {
      if (message.id !== notice.id) return {status:'unknown'};
      const token = crypto.randomUUID();
      state = await store.change(s=>{
        active(s);
        if (s.transport==='idle') {s.transport='attempting'; s.attempt=token;}
        return s;
      });
      if (state.attempt!==token || state.transport!=='attempting') return receipt(state);
      const current = active(await store.read());
      if (!current.endpoint || current.attempt!==token || signal.aborted) return {status:'unknown'};
      // Empty push contains no personal data. The device checks James for the
      // saved fictional result. A provider acceptance is never a device receipt.
      const response = await postPush(chromeEndpoint(current.endpoint),{method:'POST',redirect:'error',signal,headers:{Authorization:vapid(current.publicKey,current.privateKey,now()),TTL:'60',Urgency:'normal','Content-Length':'0'}});
      await response.body?.cancel();
      state = await store.change(s=>{
        if (s && s.attempt===token && !s.stopped) s.transport=response.status===201?'accepted':'unconfirmed';
        return s;
      });
      return receipt(state);
    }
    await engine.deliver({send,reconcile:async()=>receipt(await store.read())});
    return status();
  }
  async function pending() {
    const state = active(await store.read());
    if (state.shown || !state.endpoint || !['attempting','accepted','unconfirmed'].includes(state.transport)) return {};
    const {notice} = await record(state);
    return notice && ['sending','unknown','delivered'].includes(notice.state) ? {id:state.id} : {};
  }
  async function acknowledge(id, opened=false) {
    const current = await store.read();
    if (!current || id!==current.id || !['attempting','accepted','unconfirmed'].includes(current.transport)) fail('NOTICE_UNAVAILABLE');
    if (!opened) {
      const {notice} = await record(current);
      if (!notice) fail('NOTICE_UNAVAILABLE');
      const result = await proof(current).confirmReceipt(notice.id,'shown-'+id);
      if (result.status!=='delivered') fail('NOTICE_UNAVAILABLE');
    }
    await store.change(s=>{
      if (!s || s.id!==id || s.stopped && !s.shown) fail('NOTICE_UNAVAILABLE');
      if (opened && !s.shown) fail('NOTICE_UNAVAILABLE');
      if (opened) s.opened=true; else s.shown=true;
      return s;
    });
    return {recorded:true};
  }
  async function stop() {
    const state = await store.change(s=>{
      if (!s) fail('NOTICE_UNAVAILABLE');
      s.stopped=true; s.endpoint=null; s.privateKey=null;
      return s;
    });
    await proof(state).stop();
    return {state:'stopped'};
  }
  return {begin,pair,run,pending,acknowledge,stop,status};
}
module.exports={createDeviceProof,chromeEndpoint,enabled,vapid};
