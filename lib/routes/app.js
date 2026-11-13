const fs = require("node:fs");
const path = require("node:path");
const {
  privateNoStore,
  requireAuth
} = require("../auth.js");

module.exports = async function handler(req, res) {
  privateNoStore(res);

  const resource = req.jamesResource || {};
  const asset = String(resource.asset || "");
  const document = String(resource.document || "");
  const session = requireAuth(req, res, { redirectToLogin: !asset && !document });
  if (!session) return;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const allowedDocuments = new Set(["calendar-test.html", "council-test.html"]);
  const allowedAssets = new Map([
    ["customer-activity-ui.js", { filename: "customer-activity-ui.js", type: "text/javascript; charset=utf-8" }],
    ["wall-display.js", { filename: "wall-display.js", type: "text/javascript; charset=utf-8" }],
    ["mobile-wake-recognition.js", { filename: "mobile-wake-recognition.js", type: "text/javascript; charset=utf-8" }],
    ["mobile-wake-worklet.js", { filename: "mobile-wake-worklet.js", type: "text/javascript; charset=utf-8" }],
    ["wake-listener.js", { filename: "wake-listener.js", type: "text/javascript; charset=utf-8" }],
    ["reminders-ui.js", { filename: "reminders-ui.js", type: "text/javascript; charset=utf-8" }],
    ["location-context.js", { filename: "location-context.js", type: "text/javascript; charset=utf-8" }],
    ["appointments-ui.js", { filename: "appointments-ui.js", type: "text/javascript; charset=utf-8" }],
    ["mail-attention.js", { filename: "mail-attention.js", type: "text/javascript; charset=utf-8" }],
    ["realtime-coordinator.mjs", { filename: "realtime-coordinator.mjs", type: "text/javascript; charset=utf-8" }],
    ["turn-timing.mjs", { filename: "turn-timing.mjs", type: "text/javascript; charset=utf-8" }],
    ["voice-session.js", { filename: "voice-session.js", type: "text/javascript; charset=utf-8" }],
    ["conversation-runtime.js", { filename: "conversation-runtime.js", type: "text/javascript; charset=utf-8" }],
    ["conversation-ui.js", { filename: "conversation-ui.js", type: "text/javascript; charset=utf-8" }],
    ["conversation-identity.mjs", { filename: "conversation-identity.mjs", type: "text/javascript; charset=utf-8" }],
    ["conversation-bridge.mjs", { filename: "conversation-bridge.mjs", type: "text/javascript; charset=utf-8" }],
    ["app.js", { filename: "app.js", type: "text/javascript; charset=utf-8" }],
    ["mail-refresh.js", { filename: "mail-refresh.js", type: "text/javascript; charset=utf-8" }],
    ["calendar-sync.js", { filename: "calendar-sync.js", type: "text/javascript; charset=utf-8" }],
    ["welcome.js", { filename: "welcome.js", type: "text/javascript; charset=utf-8" }],
    ["welcome.css", { filename: "welcome.css", type: "text/css; charset=utf-8" }],
    ["assets/welcome-dark.png", { filename: "assets/welcome-dark.png", type: "image/png" }],
    ["assets/welcome-light.png", { filename: "assets/welcome-light.png", type: "image/png" }],
    ["styles.css", { filename: "styles.css", type: "text/css; charset=utf-8" }],
    ["assets/james-signature-v2.png", { filename: "assets/james-signature-v2.png", type: "image/png" }],
    ["assets/orb/90ededa3-bf96-4b39-89c6-29ea5f73338b.png", { filename: "assets/orb/90ededa3-bf96-4b39-89c6-29ea5f73338b.png", type: "image/png" }],
    ["assets/orb/james-orb-v1.png", { filename: "assets/orb/james-orb-v1.png", type: "image/png" }],
    ["assets/orb/james-signature.png.", { filename: "assets/orb/james-signature.png.", type: "image/png" }],
    ["james-orb-v1.png", { filename: "james-orb-v1.png", type: "image/png" }]
  ]);
  allowedAssets.set("assets/orb/james-concierge.svg",{filename:"assets/orb/james-concierge.svg",type:"image/svg+xml"});
  for(const name of ["customer-database.css","customer-database-ui.js"])allowedAssets.set(name,{filename:name,type:name.endsWith(".css")?"text/css; charset=utf-8":"text/javascript; charset=utf-8"});
  const workbenchAssets = new Set(["workbench/host.mjs","workbench/identity-observer.mjs", "workbench/async-services.js", "workbench/core.js", "workbench/workbench.css", "workbench/fixtures.js", "workbench/account-lifecycle.mjs", "workbench/async-app.js", "workbench/async-session.js", "workbench/remote-store.mjs", "workbench/host-door.mjs", "workbench/assets/room-source.svg", "workbench/assets/card-back.svg", "workbench/assets/visual-study.svg", "workbench/assets/room-charcoal.svg", "workbench/assets/resume-paper.svg", "workbench/assets/card-front.svg", "workbench/assets/room-walnut.svg"]);
  if(workbenchAssets.has(asset))allowedAssets.set(asset,{filename:asset,type:asset.endsWith(".css")?"text/css; charset=utf-8":asset.endsWith(".svg")?"image/svg+xml":"text/javascript; charset=utf-8"});
  for(const name of ['oceanfront','forest','penthouse','winter']){
    const filename='assets/scenes/'+name+'.png';
    allowedAssets.set(filename,{filename,type:'image/png'});
  }
  for(const time of ['morning','noon','evening','night','oceanfront','strip-terrace','red-rock-terrace','corner-penthouse','fontainebleau-penthouse','moonlit-forest','winter-lodge','beach','red-rock-snow','winter-storm-penthouse','aurora-from-orbit','wall-oceanfront'])allowedAssets.set('assets/scenes/'+time+'.mp4',{filename:'assets/scenes/'+time+'.mp4',type:'video/mp4'});
  for(const name of ["morning","noon","evening","night","oceanfront","moonlit-forest","aurora-from-orbit","beach","corner-penthouse","fontainebleau-penthouse","red-rock-terrace","red-rock-snow","strip-terrace","winter-lodge","winter-storm-penthouse"])allowedAssets.set("assets/scenes/"+name+".jpg",{filename:"assets/scenes/"+name+".jpg",type:"image/jpeg"});
  const selected = asset
    ? allowedAssets.get(asset)
    : allowedDocuments.has(document)
      ? { filename: document, type: "text/html; charset=utf-8" }
      : { filename: "index.html", type: "text/html; charset=utf-8" };

  if (!selected) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const binary = selected.type === "image/jpeg" || selected.type === "image/png" || selected.type === "video/mp4";
  const body = fs.readFileSync(path.join(process.cwd(), selected.filename), binary ? undefined : "utf8");
  res.setHeader("Content-Type", selected.type);
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

  // Safari probes MP4s with byte ranges. Keep the existing authentication gate
  // ahead of all media metadata and serve only the explicitly allowed assets.
  if (selected.type === "video/mp4") {
    res.setHeader("Accept-Ranges", "bytes");
    const range = req.headers?.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start, end;
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
        end = match[1] ? (match[2] ? Number(match[2]) : body.length - 1) : body.length - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < 0 || start >= body.length || end < start) {
        res.setHeader("Content-Range", `bytes */${body.length}`);
        return res.status(416).end();
      }
      end = Math.min(end, body.length - 1);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${body.length}`);
      res.setHeader("Content-Length", end - start + 1);
      if (req.method === "HEAD") return res.status(206).end();
      return res.status(206).send(body.subarray(start, end + 1));
    }
    res.setHeader("Content-Length", body.length);
  }

  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(body);
};
