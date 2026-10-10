// Space Party server: an allowlist of public files, the live event stream to every screen, phone input, generation
// through Astra (within each player's drawing budget), Sol's controller HTML (v1.2), and perf samples. The game itself
// runs in world.js. HTTPS (https.js, self-signed for the LAN) runs next to HTTP with the same handler so phones get
// tilt and camera.
// Usage: PORT=8000 HTTPS_PORT=8443 node server.js [--bots N] [--autostart S] [--endless]      (HTTPS_PORT=0 turns HTTPS off)
//   The lobby lasts until the big screen's START (POST /start); --autostart S starts every lobby after S seconds.
//   --endless (or ENDLESS=1), v1.6: the ENDLESS free-for-all (endless.js; off by default, the demo round flow is
//   unchanged): no clock, join any time, the boss and chests come back, drawings recharge, the host ends it (POST /end).
//   The big screen's lobby switches it on and off too (POST /mode).
// v1.6.1 RESTART (owner, 10 Oct 12:31; on the main line since v1.8): the big screen's RESTART (POST /restart { confirm:
//   true }) is a server restart: every screen hears {type:"restart"}, every stream closes, and a fresh server (new
//   SESSION_ID, empty world, empty hall of fame) takes the ports. Under a supervisor that restarts `node server.js` when it
//   exits (KEEPALIVE=1, or a parent process named like keepalive / pm2 / nodemon / forever / supervisor) the process just
//   exits 0; otherwise (the default) it first spawns a detached copy of itself with the same argv and env (one that cannot
//   start is a 500 and nothing happens), then releases the ports and exits; the copy waits for this process to be gone and
//   retries listen until the ports are free. KEEPALIVE=0 forces the self-respawn.
// Robustness (v1.0 review): no request can throw out of the handler (a malformed target like `GET //` is a 400 or a
// 404), a world step or tick that throws is logged and skipped, static files stream with pipeline (an aborted download
// frees its file), a screen that stops reading is dropped, bodies are capped per endpoint, drawings must be real PNGs
// of at most 1024 px, and clients never see internal error text.
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream");
const Contract = require("./contract");
const Verbs = require("./verbs");
const { createWorld, mergeLayout, withSteer } = require("./world");

const PORT = Number(process.env.PORT) || 8000;
const HTTPS_PORT = process.env.HTTPS_PORT === undefined ? 8443 : Number(process.env.HTTPS_PORT);
const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");
const PERF_LOG = process.env.PERF_LOG || path.join(ROOT, "perf.log");
const PERF_LOG_MAX_BYTES = 50 * 1024 * 1024;   // perf.log stops growing past this
const BODY_LIMIT = 2 * 1024 * 1024;            // POST /generate (a 512 px drawing); the other endpoints are far smaller
const SMALL_BODY = { "/input": 64 * 1024, "/perf": 16 * 1024, "/join": 4096, "/start": 4096, "/controller-html": 4096, "/mode": 4096, "/end": 4096 };
Object.assign(SMALL_BODY, { "/hall/judge": 4096, "/hall/reset": 4096 }); // v1.6 hall of fame
SMALL_BODY["/restart"] = 4096; // v1.6.1 RESTART
SMALL_BODY["/default"] = 4096; // v1.8 skipready: SKIP on a drawing step
SMALL_BODY["/practice"] = 4096; // v1.9 PRACTICE: play while you wait
// v1.6.1: this server process's id, in every world message and in GET /info. A screen that sees it change knows the server
// restarted (a phone then forgets its player and joins again, the TV reloads).
const SESSION_ID = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
const KEEPALIVE_MS = 15000;
const MAX_STREAMS = 150;                       // screens connected to /events at once
const MAX_BUFFERED = 1024 * 1024;              // a screen this far behind (about 150 ticks) has stopped reading: dropped
const MAX_DRAWING_PX = 1024;                   // the phone sends at most 512 px
const MAX_DRAWING_BYTES = 1536 * 1024;
const SPECULATIVE_WINDOW_MS = 10000, SPECULATIVE_MAX = 8; // speculative /generate calls per player (the phone: one per 1.2 s)
// rules.js, astra.js, astra-html.js, world.js and the server stay private. inflate.js (a drawing becomes a 3D body on
// the device) is loaded by render.js on demand when a drawn ship or explorer arrives.
// v1.4: controller.webmanifest and icons/<name>.png make the phone page a home-screen web app (full screen on iPhone).
const PUBLIC_FILES = new Set([
  "space.html", "controller.html", "render.js", "contract.js", "verbs.js", "terrain.js", "rigs.js",
  "transition.js", "anim.js", "anims.js", "phone-extras.js", "bigscreen-extras.js", "inflate.js", "ship3d.js",
  "ctrl-sandbox.js", "mischief-fx.js", "sfx.js", "controller.webmanifest",
  "entity3d.js", // v1.4: drawn explorers built rigged from their body spec (render.js loads it on demand)
  "hall-of-fame.html", // v1.6: the hall of fame (hall.js: GET /hall, POST /hall/judge)
]);
const ICONS = path.join(ROOT, "icons");
const ICON_PATH = /^icons\/[a-z0-9][a-z0-9_.-]{0,63}\.png$/i;   // one level, no dot files, PNG only
// v1.9 demo (owner 13:41): hall-of-fame.html?mock=1 reads hall-mock/<name>.png|json (one level, no dot files)
const HALL_MOCK_PATH = /^hall-mock\/[a-z0-9][a-z0-9_-]{0,63}\.(png|json)$/i;
const TOUCH_ICON = /^apple-touch-icon(-\d{2,3}x\d{2,3})?(-precomposed)?\.png$/; // iOS asks the root for these
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};
const ASSET_EXTS = new Set([".png", ".jpg", ".webp", ".glb", ".gltf", ".bin", ".mp3", ".ogg", ".wav", ".js", ".json"]);

const botsArg = process.argv.indexOf("--bots");
const BOTS = botsArg > 0 ? Math.max(0, Math.min(25, Number(process.argv[botsArg + 1]) || 0)) : 0; // 25 players at most (humans take bots' seats)
const autoArg = process.argv.indexOf("--autostart");
const AUTOSTART = autoArg > 0 && Number.isFinite(Number(process.argv[autoArg + 1])) ? Math.max(0, Number(process.argv[autoArg + 1])) : null;
const argNum = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 && Number.isFinite(Number(process.argv[i + 1])) ? Number(process.argv[i + 1]) : fallback; };
const MINUTES_AT_START = Contract.ROUND_MINUTES.includes(argNum("--minutes", 2)) ? argNum("--minutes", 2) : 2; // demo default: 2 minutes (owner 14:37; v1.9 had 1)
const START_AFTER_AT_START = Contract.LOBBY_WAITS.includes(argNum("--start-after", 30)) ? argNum("--start-after", 30) : 30; // 0 = off
// v1.6 ENDLESS (owner, 10 Oct 11:53): --endless or ENDLESS=1 starts the server in the endless free-for-all (endless.js).
const ENDLESS_AT_START = (() => { try { return require("./endless").fromEnv(); } catch { return false; } })();

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
// One log line per distinct problem per 10 s (a broken client must not flood the console).
const loggedAt = new Map();
function logOnce(what, err) {
  const key = `${what}:${(err && err.message) || err}`;
  if (Date.now() - (loggedAt.get(key) || 0) < 10000) return;
  loggedAt.set(key, Date.now());
  if (loggedAt.size > 500) loggedAt.delete(loggedAt.keys().next().value);
  console.log(`${what}: ${(err && err.stack) || err}`);
}

// ---- Event stream ------------------------------------------------------------------------------------------------
// GET /events?player=<name> (a phone) or ?screen=big (the TV). Messages for one player (toast, mischief, cooldown) go only to
// that player's streams; a `generated` carrying controller HTML goes in full only to its player (other screens get it
// without the HTML, and never the HTML-only upgrade). A stream that names nobody gets everything, as before.

const streams = new Map(); // res → { player, big, practice } (v1.9: practice = this phone's stream carries the practice world)
// v1.9 PRACTICE (section below): declared here, before the world exists (its first messages read them)
let practice = null;                        // the practice world, made at the first POST /practice (again for a new length)
const practicing = new Map();               // name → { since }
const practiceImages = Object.create(null); // name → the URL of the explorer they drew while practicing
const practiceFiles = new Map();            // name → that drawing's PNG
const hasStream = (player) => { for (const who of streams.values()) if (who.player === player) return true; return false; };
const PERSONAL = new Set(["toast", "mischief", "cooldown", "hit"]); // v1.3: hit = the victim's hit marker
const sse = (m) => `data: ${JSON.stringify(m)}\n\n`;
function write(res, line) {
  if (res.writableLength > MAX_BUFFERED) { streams.delete(res); res.destroy(); return; }
  res.write(line);
}
function writeAll(line) {
  for (const res of streams.keys()) write(res, line);
}
const withoutHtml = ({ html, controls, padLayout, ...rest }) => rest;
function broadcast(m) {
  m = withDrawings(m);
  const personal = PERSONAL.has(m.type) ? m.player : null;
  const heavy = m.type === "generated" && typeof m.html === "string";
  let full = null, lite = null;
  for (const [res, who] of streams) {
    // v1.9 PRACTICE: a practicing phone hears the practice world (practiceBroadcast); of the real one only its own pad
    if (who.practice && !(m.type === "generated" && who.player === m.player)) continue;
    const other = who.big || (who.player && who.player !== m.player);
    if (personal && other) continue;
    if (heavy && other) {
      if (m.kind === "html") continue; // only the owner's phone swaps its controller
      write(res, lite || (lite = sse(withoutHtml(m))));
    } else write(res, full || (full = sse(m)));
  }
}

// Astra is loaded lazily and guarded: another lane may be mid-edit, and wireAnimations may not exist yet.
let astra = null;
function loadAstra() {
  try {
    astra = astra || require("./astra");
    if (astra && !lateSpecHooked && typeof astra.onShipSpec === "function") { lateSpecHooked = true; astra.onShipSpec(onLateShipSpec); }
    return astra;
  } catch (err) { console.log(`astra unavailable: ${err.message}`); return null; }
}
// v1.4: the model's ship spec arrived after the /generate answer (that answer carried a spec made from the entity's
// parts): keep it and send the player's ship again, so every screen rebuilds it from the model's parts.
let lateSpecHooked = false;
function onLateShipSpec({ player, kind, image, spec }) {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(image || ""));
  if (!m || !spec) return;
  const v = sha1(Buffer.from(m[1], "base64")).slice(0, 10);
  noteShipSpec(v, spec);
  const family = kind === "explorer" ? "explorer" : "ship"; // v1.4: an explorer's body spec comes the same way
  if (family === "explorer") onLatePracticeSpec(player, v);
  const url = drawnImages[player] && drawnImages[player][family];
  if (!url || specKey(vOfUrl(url)) !== v) return; // an older drawing of theirs: kept by its hash, nothing to send
  const p = world.players[player];
  if (p && p.entity && kindOfEntity(p.entity) === family) broadcast({ type: "entity", player, entity: p.entity });
  if (p && p.mode === "planet") broadcast(world.worldMessage({ entities: false }));
}
function onLatePracticeSpec(player, v) { // v1.9 PRACTICE: an explorer drawn while practicing
  const q = practice && practicing.has(player) && practice.players[player];
  if (q && q.entity && kindOfEntity(q.entity) === "explorer" && specKey(vOfUrl(practiceImages[player])) === v) practiceBroadcast({ type: "entity", player, entity: q.entity });
}
function wireAnimations(type, verbs) {
  const a = loadAstra();
  try { return a && typeof a.wireAnimations === "function" ? a.wireAnimations(type, verbs) : undefined; } catch { return undefined; }
}

// v1.3 (owner: "make sure the entity creation works"): a finished ship / explorer drawing never fails silently. When
// Astra cannot answer at all (not loaded, threw, a timeout or an error it did not turn into an entity itself) the
// player still gets a usable entity, wearing their drawing. v1.5 (QA M1): nothing was read, so nothing is unlocked:
// the plain entity (only its type's innate skills, source "fallback"), and it is free (fallback: true, free: true: no
// drawing spent, the phone says so and offers TRY AGAIN). Astra answers its own timeouts / failures the same way.
// Refusals (a controller drawn in the ship step, a blank page) and bad requests keep their plain message.
const ENTITY_NO_FALLBACK = /^(looks like|nothing to read|no drawings left|new round|slow down|superseded|kind is|player required|image must|image too large|region too small|join first|name taken)/;
function fallbackEntity(kind) {
  const type = kind === "ship" ? "ship" : "person";
  const unlocked = [];
  const verbs = Verbs.entityVerbs(type, []);
  const entity = { type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked, parts: [], source: "fallback" };
  if (typeof Verbs.cardOf === "function") entity.card = Verbs.cardOf(type, unlocked);
  const anims = wireAnimations(entity.rig, verbs);
  if (anims) entity.anims = anims;
  return entity;
}

// ---- Drawn ships and explorers -----------------------------------------------------------------------------------
// A finished ship / explorer drawing is kept (in memory, and by Astra at controllers/<player>-<kind>.png) and served
// read-only at /drawings/<player>-<kind>.png; every entity message for that player and type carries its URL as
// `image` (with ?v=<hash>), so every screen, late joiners included, inflates the same drawing (inflate.js).
// v1.5 (owner, 10 Oct 11:31: every round starts from scratch): only from memory, and only this round's. The ?v= is the
// drawing's hash (10 hex) in round 1 and the hash plus the round in hex from round 2 on (drawingV), so a drawing never has
// the same URL in two rounds and no screen's cache (render.js DrawnCache, the TV hangar) can show a previous round's
// model; freshRound clears everything at each new lobby.
const DRAWING_KINDS = Object.assign(Object.create(null), { ship: "ship", explorer: "explorer" }); // drawing kind → drawnImages key
const kindOfEntity = (entity) => (entity && entity.type === "ship" ? "ship" : "explorer"); // any planet type is the explorer
const DRAWING_PATH = /^\/drawings\/([a-z0-9]{1,20})-(ship|explorer)\.png$/;
const drawingFiles = new Map();          // "<player>-<kind>" → PNG buffer
const drawnImages = Object.create(null); // player → { [entity type]: "/drawings/<player>-<kind>.png?v=<hash>" }
// v1.4 (ship3d.js): the ship spec Astra read from each ship drawing (astra-ship.js: hull, wings, engines... as parts), by
// the drawing's hash (the ?v= of its URL). Every ship entity message and parked ship carries it as `spec`, next to `image`.
const shipSpecs = new Map(); // drawing hash (10 hex) → spec (newest 200), this round's only (freshRound clears it)
const vOfUrl = (url) => { const m = /[?&]v=([0-9a-f]{6,40})/.exec(String(url || "")); return m ? m[1] : ""; };
// The drawing's own hash in a ?v= (its first 10 hex): what the phone's result card computes from its PNG (render.js
// entImageV) and asks GET /ship-spec for.
const specKey = (v) => String(v || "").slice(0, 10);
// The ?v= of a drawing this round: its hash, plus the round in hex from round 2 on (round 1 keeps the plain 10 hex).
const drawingV = (buf) => sha1(buf).slice(0, 10) + (world.round > 1 ? world.round.toString(16).padStart(2, "0") : "");
// The round a ?v= belongs to (10 hex: round 1).
const roundOfV = (v) => (String(v).length <= 10 ? 1 : parseInt(String(v).slice(10), 16) || 0);
function noteShipSpec(v, spec) {
  v = specKey(v);
  if (!v || !spec || typeof spec !== "object") return;
  shipSpecs.delete(v);
  shipSpecs.set(v, spec);
  if (shipSpecs.size > 200) shipSpecs.delete(shipSpecs.keys().next().value);
  if (hall) { try { hall.noteSpec(v, spec); } catch (err) { logOnce("hall spec failed", err); } } // v1.6: the archived drawing gets it too
}
const shipSpecOf = (url) => shipSpecs.get(specKey(vOfUrl(url))) || null;

// A real PNG of a sane size: the signature, an IHDR chunk first, 1..MAX_DRAWING_PX on each side.
function validPng(buf) {
  if (!buf || buf.length < 24 || buf.length > MAX_DRAWING_BYTES || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return false;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return w >= 1 && h >= 1 && w <= MAX_DRAWING_PX && h <= MAX_DRAWING_PX;
}

function keepDrawing(player, kind, dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m || !DRAWING_KINDS[kind]) return null;
  const buf = Buffer.from(m[1], "base64");
  if (!validPng(buf)) return null;
  drawingFiles.set(`${player}-${kind}`, buf);
  const url = `/drawings/${player}-${kind}.png?v=${drawingV(buf)}`;
  (drawnImages[player] || (drawnImages[player] = {}))[DRAWING_KINDS[kind]] = url;
  return url;
}

// Adds the drawing URL to an entity (mutating the world's own entity, so the next connect's world message has it).
function drawnEntity(player, entity) {
  const url = entity && drawnImages[player] && drawnImages[player][kindOfEntity(entity)];
  const spec = url ? shipSpecOf(url) : null; // v1.4: the parts ship3d.js (ships) or entity3d.js (explorers) builds
  if (!url || (entity.image === url && (!spec || entity.spec === spec))) return entity;
  const p = world.players[player];
  if (p && p.entity === entity) { entity.image = url; if (spec) entity.spec = spec; return entity; }
  return spec ? { ...entity, image: url, spec } : { ...entity, image: url };
}
// v1.3: every parked ship on the landing pad carries its owner's ship drawing (island.parked[].image), so a screen
// that connects after they landed (their current entity is the explorer) still shows the drawn ship. The world's own
// parked entries are never mutated: the message gets copies.
function withParkedImages(island) {
  if (!island || !Array.isArray(island.parked) || !island.parked.length) return island;
  let changed = false;
  const parked = island.parked.map((c) => {
    const url = c && drawnImages[c.player] && drawnImages[c.player].ship;
    const spec = url ? shipSpecOf(url) : null;
    if (!url || (c.image === url && (!spec || c.spec === spec))) return c;
    changed = true;
    return spec ? { ...c, image: url, spec } : { ...c, image: url };
  });
  return changed ? { ...island, parked } : island;
}
function withDrawings(m) {
  if (m && m.type === "entity") {
    const entity = drawnEntity(m.player, m.entity);
    return entity === m.entity ? m : { ...m, entity };
  }
  if (m && m.type === "world") {
    m = { ...m, session: SESSION_ID }; // v1.6.1 RESTART: screens notice a new server by this id
    if (practicing.size && m.phase === "lobby") m.practicing = [...practicing.keys()]; // v1.9 PRACTICE: the TV's "n PRACTICING"
    if (m.entities) for (const name of Object.keys(m.entities)) m.entities[name] = drawnEntity(name, m.entities[name]);
    const island = withParkedImages(m.island);
    if (island !== m.island) m = { ...m, island };
  }
  return m;
}

// v1.5 (every round from scratch): only this round's drawings, from memory. No copy on disk is ever served (Astra's
// controllers/ copies are a record, not a source), and a URL of another round (its ?v=) is 404.
function serveDrawing(req, res, url) {
  const m = DRAWING_PATH.exec(url.pathname);
  const name = m && `${m[1]}-${m[2]}`;
  const v = url.searchParams.get("v");
  // v1.9 PRACTICE: an explorer drawn while practicing (&practice=1) lives in its own store, never in the round's drawings
  const buf = name && url.searchParams.get("practice") === "1" ? (m[2] === "explorer" ? practiceFiles.get(m[1]) : null)
    : name && (v == null || roundOfV(v) === world.round) ? drawingFiles.get(name) : null;
  if (!validPng(buf)) return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length, "Cache-Control": url.searchParams.has("v") ? "public, max-age=86400" : "no-cache" });
  res.end(req.method === "HEAD" ? undefined : buf);
}

// ---- Sol writes the controller (v1.2, PLAN.md section 0) ---------------------------------------------------------
// Every controller or button answer comes back at once with the whole pad as HTML: the deterministic template
// (astra-html.templateHtml, under 1 ms, the same Fortnite-like look), or Sol's own HTML when it is already cached for
// that drawing and pad. In the background one Sol call (astra-html.generateControllerHtml) writes the player's
// controller; when it is valid and the pad is still the player's, it is kept and sent to that phone as
// `generated` { kind: "html", htmlSource: "model" }. Play never waits for Sol. A newer pad aborts the older call.
let astraHtml = null;
function loadAstraHtml() {
  try { return (astraHtml = astraHtml || require("./astra-html")); } catch (err) { console.log(`astra-html unavailable: ${err.message}`); return null; }
}
const CTRL_HTML_TIMEOUT_MS = 20000;
const ctrl = Object.create(null); // player → { sig, padLayout, html, controls, source, image, job }

const padSig = (layout) => sha1(JSON.stringify((layout.buttons || []).map((b) => [b.type || "button", Contract.normaliseAction(b.action), b.label || "", b.x, b.y, b.w, b.h]))).slice(0, 16);
const allowedOf = (layout) => [...new Set((layout.buttons || []).map((b) => Contract.normaliseAction(b.action)))];
function templateFor(A, padLayout) {
  const allowedActions = allowedOf(padLayout);
  const html = A.templateHtml(padLayout, { allowedActions });
  return { html, controls: A.validateHtml(html, { allowedActions }).controls, source: "template" };
}

function startHtmlJob(A, player, padLayout, sig, image) {
  const entry = ctrl[player];
  const key = `${sig}:${image ? sha1(image).slice(0, 16) : "-"}`;
  if (entry.job && entry.job.key === key) return entry.job; // the same pad and drawing: running, or done (cached)
  if (entry.job && !entry.job.done) entry.job.controller.abort();
  const controller = new AbortController();
  const job = { key, sig, controller, done: false };
  job.promise = Promise.resolve()
    .then(() => A.generateControllerHtml({ image, layout: padLayout, allowedActions: allowedOf(padLayout), player, signal: controller.signal, timeoutMs: CTRL_HTML_TIMEOUT_MS }))
    .catch((err) => ({ ok: false, error: String((err && err.message) || err) }))
    .then((r) => {
      job.done = true;
      if (r && r.ok && r.source === "model" && ctrl[player] === entry && entry.sig === sig && entry.source !== "model") { // v1.5: not after a new round
        Object.assign(entry, { html: r.html, controls: r.controls, source: "model" });
        broadcast({ type: "generated", player, kind: "html", html: r.html, controls: r.controls, htmlSource: "model", padLayout: entry.padLayout });
        if (hall && image) { try { hall.noteControllerHtml(image, r.html, "model"); } catch (err) { logOnce("hall html failed", err); } } // v1.6
      }
      return r;
    });
  entry.job = job;
  return job;
}

// The pad's HTML now. commit: a finished drawing (the pad is the player's from now on); a speculative one only starts
// (or joins) Sol's call so the answer is often ready by the time the player taps Done.
async function controllerHtml(player, padLayout, image, commit) {
  const A = loadAstraHtml();
  if (!A) return null;
  const entry = ctrl[player] || (ctrl[player] = { sig: null, job: null, image: null });
  const sig = padSig(padLayout);
  let now = templateFor(A, padLayout);
  const job = startHtmlJob(A, player, padLayout, sig, image);
  // A cached Sol answer resolves within a turn of the event loop; anything slower arrives later as kind "html".
  const quick = await Promise.race([job.promise, new Promise((resolve) => setImmediate(() => resolve(null)))]);
  if (quick && quick.ok && quick.source === "model") now = { html: quick.html, controls: quick.controls, source: "model" };
  if (commit) Object.assign(entry, { sig, padLayout, ...now, image: image || entry.image });
  return now;
}

// The player's controller as it is now (a phone that reloads, or one that missed the broadcast).
async function currentHtml(player, wait) {
  const A = loadAstraHtml();
  if (!A) return null;
  let entry = ctrl[player];
  const padLayout = world.layoutOf(player);
  if (!entry || entry.sig !== padSig(padLayout)) return { ...templateFor(A, padLayout), padLayout, pending: false };
  if (wait && entry.job && !entry.job.done && entry.job.sig === entry.sig) await entry.job.promise;
  entry = ctrl[player];
  return { html: entry.html, controls: entry.controls, source: entry.source, padLayout: entry.padLayout, pending: !!(entry.job && !entry.job.done && entry.job.sig === entry.sig) };
}

// ---- Hall of fame (v1.6, owner 10 Oct 11:57) ----------------------------------------------------------------------
// hall.js archives every finished drawing of the session (ship, explorer, controller) the moment it is accepted, so the
// archive has it before freshRound wipes the round; gameplay still starts from scratch every round. POST /hall/judge
// ranks them (OpenAI Decisions API), GET /hall lists them, /hall-of-fame.html shows them. Guarded like Astra: a hall.js
// that fails to load never touches the game. Loaded at start: a restart is a new session (hall.init clears hall/).
let hall = null, hallTried = false;
function loadHall() {
  if (!hallTried) {
    hallTried = true;
    try { hall = require("./hall"); hall.init(); } catch (err) { hall = null; console.log(`hall unavailable: ${err.message}`); }
  }
  return hall;
}
function hallArchive(item) {
  const H = loadHall();
  if (H) { try { H.archive(item); } catch (err) { logOnce("hall archive failed", err); } }
}
loadHall();
// GET /hall (the ranked list), /hall/img/<id>.png (an archived drawing), /hall/ctrl/<id>.html (an archived controller's
// HTML: no script runs, CSP sandbox; the hall shows it in a sandboxed frame).
function serveHall(req, res, url) {
  const H = loadHall();
  if (!H) return json(res, 503, { ok: false, error: "hall unavailable" });
  if (url.pathname === "/hall") return json(res, 200, H.list());
  let m = /^\/hall\/img\/([a-z0-9]{1,40})\.png$/.exec(url.pathname);
  const buf = m && H.image(m[1]);
  if (buf) {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length, "Cache-Control": "public, max-age=86400" });
    return res.end(req.method === "HEAD" ? undefined : buf);
  }
  m = /^\/hall\/ctrl\/([a-z0-9]{1,40})\.html$/.exec(url.pathname);
  const html = m && H.html(m[1]);
  if (html) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" });
    return res.end(req.method === "HEAD" ? undefined : html);
  }
  return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}

// ---- The world ---------------------------------------------------------------------------------------------------

// v1.5 (owner, 10 Oct 11:31: "Make sure things restart from scratch each round. not possible to reuse drawings etc."):
// at every new lobby after the first, world.js clears each player's drawings, skills, controller and budget, and calls
// this first. Everything generated from a drawing goes too: the drawings and their URLs, the ship / body specs, Sol's
// controller HTML (its running calls aborted), the speculative counters, Astra's and astra-html's caches (so a drawing
// sent again is read afresh and costs a drawing) and Astra's saved copies of those players' drawings. Kept: the players
// (name, colour, device token) and the session stars (world.js).
function freshRound(round, names) {
  // v1.7 (owner 12:26, world readyGate): names = only the players who PLAYED the round that ended. A player who waited
  // keeps their drawings (re-keyed to this round's ?v=, so serveDrawing still serves them), their ship spec and Sol's
  // controller; everything of the others is cleared as before.
  const wiped = new Set(names);
  const keptHashes = new Set();
  for (const k of Object.keys(drawnImages)) {
    if (wiped.has(k)) { delete drawnImages[k]; continue; }
    for (const family of Object.keys(drawnImages[k])) {
      const buf = drawingFiles.get(`${k}-${family}`);
      if (!buf) { delete drawnImages[k][family]; continue; }
      keptHashes.add(specKey(vOfUrl(drawnImages[k][family])));
      drawnImages[k][family] = `/drawings/${k}-${family}.png?v=${drawingV(buf)}`;
    }
  }
  for (const key of [...drawingFiles.keys()]) { const who = key.replace(/-(ship|explorer)$/, ""); if (wiped.has(who) || !drawnImages[who]) drawingFiles.delete(key); }
  for (const v of [...shipSpecs.keys()]) if (!keptHashes.has(v)) shipSpecs.delete(v);
  for (const k of Object.keys(ctrl)) {
    if (!wiped.has(k)) continue;
    const job = ctrl[k] && ctrl[k].job;
    if (job && !job.done) { try { job.controller.abort(); } catch {} }
    delete ctrl[k];
  }
  for (const k of Object.keys(speculativeAt)) if (wiped.has(k)) delete speculativeAt[k];
  try { if (astra && typeof astra.newRound === "function") astra.newRound({ players: names }); } catch (err) { logOnce("astra round reset failed", err); }
  try { if (astraHtml && typeof astraHtml.newRound === "function") astraHtml.newRound(); } catch (err) { logOnce("astra-html round reset failed", err); }
  // the kept ships' new URLs reach every screen once the new lobby is out (the world sends the round's messages first)
  const kept = Object.keys(drawnImages);
  if (kept.length) setImmediate(() => { for (const k of kept) { const p = world.players[k]; if (p && p.entity) broadcast({ type: "entity", player: k, entity: p.entity }); } });
  console.log(`round ${round}: a fresh start (drawings, controllers and their caches cleared for ${names.length} player(s)${kept.length ? `, kept for ${kept.length} who waited` : ""})`);
}

// v1.7 readyGate (owner 12:26): only the ready players (ship + controller) enter a round; START needs one of them.
// v1.9 (owner 13:41): selectable round length (2 minutes by default since owner 14:37, 1 in v1.9) and the lobby auto-start 30 s after the first READY player; the TV lobby
// changes both (POST /mode { minutes, startAfter }), remembered for the session. --minutes N / --start-after S at launch.
const world = createWorld({ broadcast, autoStart: true, wireAnimations, autostartSeconds: AUTOSTART, onRoundReset: freshRound, readyGate: true, minutes: MINUTES_AT_START, startAfter: START_AFTER_AT_START,
  onStart: () => endAllPractice("start") }); // v1.9 PRACTICE: everybody back in the lobby before the 3-2-1
for (let i = 1; i <= BOTS; i++) world.addBot(`bot${i}`);
// v1.6 ENDLESS: guarded, so a world.js without the endless hooks still runs (the demo).
const canEndless = () => typeof world.setEndless === "function" && typeof world.endSession === "function";
if (ENDLESS_AT_START && canEndless()) world.setEndless(true);
// v1.9.1 (owner, 10 Oct 14:25: "make sure 1.9.1 shows hall of fame after finishing the seconds"): a round's end (time up,
// every chest open, or the host's END) starts judging the session's drawings by itself, exactly as POST /hall/judge does
// (idempotent: a running judge goes on; cached by the PNG's hash; the 60-call cap stays). The TV shows the hall full screen
// after the podium (space.html hallAuto) and its scores fill in while this runs. Watches world.phase: world.js is untouched.
let hallPhase = world.phase;
const hallWatch = setInterval(() => {
  const now = world.phase, was = hallPhase;
  if (now === was) return;
  hallPhase = now;
  if (now !== "scoreboard") return;
  const H = loadHall();
  if (!H) return;
  try {
    const j = H.judge();
    console.log(`hall: round ${world.round} over (${was} → results): judging ${j.pending} of ${j.total} drawing(s)${j.mock ? " (mock scores)" : ""}, ${j.calls}/${j.maxCalls} calls used`);
  } catch (err) { logOnce("hall auto-judge failed", err); }
}, 250);
if (hallWatch.unref) hallWatch.unref();

setInterval(() => {
  if (!streams.size) return;
  if (practicing.size && world.phase !== "lobby") endAllPractice("start"); // a safety net: start() already did it
  let main = null, prac = null;
  for (const [res, who] of streams) {
    try {
      if (who.practice) write(res, prac || (prac = sse(practiceOut(practice.tickMessage()))));
      else write(res, main || (main = sse(mainTick())));
    } catch (err) { logOnce("tick failed", err); }
  }
}, 1000 / Contract.TICK_HZ);
// v1.9 PRACTICE: the real world's tick names who practices (lobby only; absent when nobody does: the demo's ticks unchanged)
function mainTick() {
  const m = world.tickMessage();
  if (practicing.size && m.phase === "lobby") m.practicing = [...practicing.keys()];
  return m;
}
setInterval(() => writeAll(": keepalive\n\n"), KEEPALIVE_MS);

function openStream(req, res, url) {
  if (streams.size >= MAX_STREAMS) return res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "5" }).end("too many screens");
  const player = Contract.cleanName(url.searchParams.get("player")) || null;
  const big = url.searchParams.get("screen") === "big";
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 1000\n\n");
  const inPractice = !!(player && !big && practicing.has(player) && practice); // v1.9 PRACTICE: a phone that reconnects while practicing
  res.write(sse(inPractice ? practiceOut(practice.worldMessage()) : withDrawings(world.worldMessage())));
  res.write(sse(inPractice ? practiceOut(practice.tickMessage()) : mainTick()));
  streams.set(res, { player, big, practice: inPractice });
  req.on("close", () => streams.delete(res));
  res.on("error", () => streams.delete(res));
}

// ---- v1.9 PRACTICE: play while you wait (owner, 10 Oct 14:08) ------------------------------------------------------
// "a lobby for people waiting which is essentially the same but without time ... they can go to planet and generate etc.
// everything like the regular game but while waiting only". A second world (world.js practice: true): ENDLESS rules with the
// picked round length's pacing, no clock, its own ticks, never a result or a session star. A READY player of the lobby opts
// in (POST /practice): their ship entity and controller are copied in; the switch is by name, so the phone changes nothing:
// its own stream (/events?player=<name>, render.js's and the JOIN one) gets the practice world's world message and ticks,
// its /input, its explorer drawings (/generate kind explorer, real generation, the practice world's drawing budget) and its
// quick explorer (/default) go there. The practice world's messages carry the real round's number (the phone keeps its
// drawings), practice: true, and practiceStartIn (the lobby auto-start's seconds left). The real world never changes: its
// lobby keeps the player READY with their ship (the TV hears practicing: [names]). The round's START (the host's or the
// auto-start: world.js onStart) brings everybody back first: their streams get the lobby's world message, then the 3-2-1.
// Explorer drawings made while practicing are kept apart (practiceImages / practiceFiles, served with &practice=1) and
// forgotten on the way out, so no practice drawing ever shows in the round; they still go to the hall of fame's archive.
// (practice, practicing, practiceImages and practiceFiles are declared with the event streams, above)
function practiceWorld() {
  if (practice && (practicing.size || practice.minutes === world.minutes)) return practice;
  practice = createWorld({ broadcast: practiceBroadcast, autoStart: false, wireAnimations, autostartSeconds: null, readyGate: false, minutes: world.minutes, startAfter: 0, practice: true });
  practice.setEndless(true);
  practice.start({ countdown: false });
  return practice;
}
// The practice world runs only while somebody practices (no work otherwise).
setInterval(() => { if (practice && practicing.size) practice.safeStep(1 / Contract.SIM_HZ); }, 1000 / Contract.SIM_HZ);
// A practice entity with its look: the ship drawing of the lobby, the explorer drawn while practicing.
function practiceEntity(name, entity) {
  if (!entity) return entity;
  const url = entity.type === "ship" ? drawnImages[name] && drawnImages[name].ship : practiceImages[name];
  if (!url) return entity;
  const spec = shipSpecOf(url);
  return spec ? { ...entity, image: url, spec } : { ...entity, image: url };
}
// What a practicing phone receives: the real round's number (so the phone never takes it for a new round), practice: true.
function practiceOut(m) {
  if (!m || typeof m !== "object") return m;
  if (m.type === "entity") return { ...m, entity: practiceEntity(m.player, m.entity) };
  if (m.type === "world") {
    m = { ...m, round: world.round, practice: true, session: SESSION_ID, island: withParkedImages(m.island) };
    if (m.entities) m.entities = Object.fromEntries(Object.entries(m.entities).map(([k, e]) => [k, practiceEntity(k, e)]));
    return m;
  }
  if (m.type === "tick") {
    const startIn = world.phase === "lobby" ? world.startIn : undefined;
    return { ...m, round: world.round, practice: true, ...(startIn != null ? { practiceStartIn: startIn } : {}) };
  }
  return m;
}
function practiceBroadcast(m) {
  if (!practicing.size) return;
  m = practiceOut(m);
  const personal = PERSONAL.has(m.type) ? m.player : null;
  let line = null;
  for (const [res, who] of streams) {
    if (!who.practice || (personal && who.player !== personal)) continue;
    write(res, line || (line = sse(m)));
  }
}
// The player's streams change world: the new world's world message (with every entity) and a tick, at once.
function switchStreams(name, on) {
  for (const [res, who] of streams) {
    if (who.big || who.player !== name || !!who.practice === on) continue;
    who.practice = on;
    try {
      write(res, sse(on ? practiceOut(practice.worldMessage()) : withDrawings(world.worldMessage())));
      write(res, sse(on ? practiceOut(practice.tickMessage()) : mainTick()));
    } catch (err) { logOnce("practice switch failed", err); }
  }
}
function startPractice(name) {
  const p = world.players[name];
  if (!p || p.bot) return false;
  const P = practiceWorld();
  if (!P.importPlayer(name, { color: p.color, device: p.device, space: p.drawn.space, layout: p.layout })) return false;
  practicing.set(name, { since: Date.now() });
  switchStreams(name, true);
  console.log(`practice: ${name} plays while they wait (${practicing.size} practicing)`);
  return true;
}
function endPractice(name, why = "back") {
  if (!practicing.has(name)) return false;
  practicing.delete(name);
  try { if (practice) practice.removePlayer(name); } catch (err) { logOnce("practice remove failed", err); }
  delete practiceImages[name];
  practiceFiles.delete(name);
  switchStreams(name, false);
  console.log(`practice: ${name} back in the lobby (${why})`);
  return true;
}
function endAllPractice(why) { for (const name of [...practicing.keys()]) endPractice(name, why); }
// POST /generate from a practicing phone: the explorer only (real generation, the practice world's budget); the ship and the
// controller stay the lobby's (a redraw waits for the lobby: nothing here may change the real round).
async function practiceGenerate(req, res, body, player) {
  const P = practice;
  const left = () => P.drawingsLeft(player);
  if (body.kind !== "explorer") return json(res, 200, { ok: false, error: "practice", message: "Practice keeps your ship and buttons. Redraw them in the lobby.", drawingsLeft: left() });
  const finished = !body.speculative;
  if (!finished && !speculativeOk(player)) return json(res, 200, { ok: false, error: "slow down", message: "", drawingsLeft: left() });
  const where = P.drawingWorld(player);
  if (finished && left()[where] <= 0) return json(res, 200, { ok: false, error: "no drawings left", message: plainMessage("explorer", "no drawings left"), drawingsLeft: left() });
  const gone = new AbortController();
  res.on("close", () => { if (!res.writableEnded) gone.abort(); });
  if (res.destroyed || (req.socket && req.socket.destroyed)) gone.abort();
  let { status, result } = await generate({ ...body, where }, gone.signal);
  if (gone.signal.aborted) return;
  // the round started meanwhile: the drawing belongs to no world (nothing spent or kept)
  if (practice !== P || !practicing.has(player)) return json(res, 200, { ok: false, error: "practice over", message: "The round is starting!", drawingsLeft: world.drawingsLeft(player) });
  if (finished && !(result && result.ok) && !ENTITY_NO_FALLBACK.test(String((result && result.error) || ""))) {
    status = 200;
    result = { ok: true, entity: fallbackEntity("explorer"), fallback: true, free: true, failed: result && result.error === "timeout" ? "timeout" : "error" };
  }
  const free = !!(result && result.ok && result.fallback && result.free);
  if (result && result.ok && finished && !free && !P.spendDrawing(player, where)) result = { ok: false, error: "no drawings left" };
  const q = P.players[player];
  if (result && result.ok && finished && result.entity && !(free && q && q.drawn.planet)) {
    const m = /^data:image\/png;base64,(.+)$/.exec(String(body.image || ""));
    const buf = m ? Buffer.from(m[1], "base64") : null;
    let image = null;
    if (buf && validPng(buf)) {
      practiceFiles.set(player, buf);
      image = practiceImages[player] = `/drawings/${player}-explorer.png?v=${drawingV(buf)}&practice=1`;
      if (result.entity.spec) noteShipSpec(vOfUrl(image), result.entity.spec);
      hallArchive({ player, color: q && q.color, round: world.round, kind: "explorer", image: body.image, spec: result.entity.spec || shipSpecOf(image), unlocked: result.entity.unlocked, card: result.entity.card, type: result.entity.type, source: result.entity.source, practice: true });
    }
    if (typeof result.entity.card !== "string" && typeof Verbs.cardOf === "function") result = { ...result, entity: { ...result.entity, card: Verbs.cardOf(result.entity.type, result.entity.unlocked) } };
    P.setEntity(player, "explorer", result.entity); // the new entity reaches the practicing screens with its look (practiceOut)
    result = { ...result, entity: image ? { ...result.entity, image } : result.entity };
  }
  if (result && !result.ok) result = { ...result, message: plainMessage("explorer", result.error) };
  else if (free) result = { ...result, message: plainMessage("explorer", result.failed === "timeout" ? "fallback timeout" : "fallback error") };
  return json(res, status, result ? { ...result, drawingsLeft: left() } : result);
}

// ---- Static files: an allowlist only -------------------------------------------------------------------------------

// iOS asks for /apple-touch-icon.png when a page names none (or before reading it): the 180 px icon from icons/.
function touchIcon() {
  try {
    const names = fs.readdirSync(ICONS).filter((n) => ICON_PATH.test(`icons/${n}`)).sort();
    const name = names.find((n) => /apple/i.test(n)) || names.find((n) => /180/.test(n));
    return name ? path.join(ICONS, name) : null;
  } catch { return null; }
}

function staticFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ""); } catch { return null; }
  if (PUBLIC_FILES.has(rel)) return path.join(ROOT, rel);
  if (ICON_PATH.test(rel)) return path.join(ROOT, rel);
  if (TOUCH_ICON.test(rel)) return touchIcon();
  if (HALL_MOCK_PATH.test(rel)) return path.join(ROOT, rel); // v1.9 demo: the mock hall of fame's bundled data
  if (!rel.startsWith("assets/") || rel.split("/").some((part) => !part || part.startsWith("."))) return null;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ASSETS + path.sep) || !ASSET_EXTS.has(path.extname(file).toLowerCase())) return null;
  return file;
}

function serveStatic(req, res, url) {
  if (url.pathname === "/") return res.writeHead(302, { Location: "/space.html" }).end();
  const file = staticFile(url.pathname);
  let stat = null;
  try { stat = file && fs.statSync(file); } catch {}
  if (!stat || !stat.isFile()) return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  const ext = path.extname(file).toLowerCase();
  const cache = ext === ".html" || ext === ".js" ? "no-store" : ext === ".webmanifest" ? "no-cache" : "public, max-age=300";
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": stat.size, "Cache-Control": cache });
  if (req.method === "HEAD") return res.end();
  // pipeline closes the file when the download is aborted (pipe() leaked a descriptor per aborted big file).
  pipeline(fs.createReadStream(file), res, () => {});
}

// ---- GET /info: where phones join (the big screen's QR) -----------------------------------------------------------

let httpsUp = false;
function lanIp() {
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) return a.address;
  return "localhost";
}
const lanAddress = () => (httpsLib && httpsLib.lanIps && httpsLib.lanIps()[0]) || lanIp();
// lanUrl: this server over HTTP on the LAN; httpsUrl: the same over HTTPS (null when it is off or failed);
// controllerUrl: what the QR should open (HTTPS when up: tilt and camera need it); bigScreenUrl: the TV page.
function info() {
  const ip = lanAddress();
  const lanUrl = `http://${ip}:${PORT}`;
  const httpsUrl = httpsUp ? `https://${ip}:${HTTPS_PORT}` : null;
  return { lanUrl, httpsUrl, controllerUrl: `${httpsUrl || lanUrl}/controller.html`, bigScreenUrl: `${lanUrl}/space.html`, session: SESSION_ID };
}

// ---- POST handlers -------------------------------------------------------------------------------------------------

function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (!tooBig) { tooBig = true; chunks.length = 0; reject(Object.assign(new Error("body too large"), { status: 413 })); } // the rest drains unread
    });
    req.on("end", () => {
      if (tooBig) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("bad json"), { status: 400 })); }
    });
    req.on("error", reject);
    // v1.4: a phone that gives up mid-upload (an aborted fetch) closes the request before its end: no promise left
    // waiting for ever.
    req.on("close", () => { if (!req.complete) reject(Object.assign(new Error("request aborted"), { status: 400 })); });
  });
}

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));

// Name-to-device binding (v1.0 review #19, additive): /join binds a name to the phone's random device token; a
// /input or /generate that carries a token (`device`, or `token`) for a name bound to ANOTHER device is refused.
// Requests without a token are accepted as before (older phones), and bots' names are never usable by a phone.
const tokenOf = (body) => {
  const t = body && (typeof body.device === "string" ? body.device : typeof body.token === "string" ? body.token : null);
  return t && /^[\w-]{8,64}$/.test(t) ? t : null;
};
function boundElsewhere(player, body) {
  const p = player && world.players[player];
  if (!p) return false;
  if (p.bot) return true;
  const token = tokenOf(body);
  return !!(token && p.device && p.device !== token);
}

// → "ok" | "unknown" (never joined: no ghost players, v1.0 review #18) | "taken" | "bad"
function input(msg) {
  if (!msg || typeof msg !== "object") return "bad";
  msg = { ...msg, player: Contract.cleanName(msg.player) };
  if (msg.type === "input") msg.action = Contract.normaliseAction(msg.action);
  if (Contract.CHECKS.input(msg).length) return "bad";
  // A phone whose own event stream is open (render.js names it: /events?player=<name>) is re-adopted after a server
  // restart; a name nobody's screen is watching is dropped.
  if (!world.players[msg.player] && !(hasStream(msg.player) && world.join(msg.player, tokenOf(msg)))) return "unknown";
  if (boundElsewhere(msg.player, msg)) return "taken";
  // v1.9 PRACTICE: a practicing phone's input drives its practice ship; its lobby seat stays warm (seat: lastSeen)
  if (practice && practicing.has(msg.player)) { world.seat(msg.player); return practice.handleInput(msg) === false ? "unknown" : "ok"; }
  return world.handleInput(msg) === false ? "unknown" : "ok";
}

// signal (v1.4): aborts when the phone gives up on the request. Waiting stops at once (result null; the caller spends
// and changes nothing). astra.js gets it as generate(body, { signal }) (its opts.signal): that request lets go of the
// model call, which astra.js aborts when nobody else waits for that drawing, so tapping Done again reads it afresh.
async function generate(body, signal = null) {
  try {
    const a = loadAstra();
    if (!a) throw new Error("astra.js did not load");
    const call = a.generate(body, { signal });
    if (!signal) return { status: 200, result: await call };
    const gaveUp = new Promise((resolve) => {
      if (signal.aborted) resolve(null);
      else signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    return { status: 200, result: await Promise.race([call, gaveUp]) };
  } catch (err) {
    logOnce("generate failed", err);
    return { status: 503, result: { ok: false, error: "generation unavailable" } };
  }
}

// Every /generate refusal or error also carries `message`: plain words the phone can show as they are (PLAN.md
// section 0, "SUPER CLEAR"; v1.0 review: raw strings like "unreadable button" reached players). "" = show nothing.
function plainMessage(kind, error) {
  const e = String(error || "");
  const what = kind === "button" ? "button" : kind === "ship" ? "ship" : kind === "explorer" ? "explorer" : "controller";
  if (e === "slow down" || e === "superseded") return "";
  if (e === "no drawings left") return "No drawings left for this world.";
  if (e === "new round") return "A new round started: draw your ship again.";
  if (e === "timeout") return "That took too long. Tap Done to try again.";
  // v1.5 (QA M1): the entity could not be read, the plain one stands in, nothing spent
  if (e === "fallback timeout") return "That took too long. Try again: this did not use a drawing.";
  if (e === "fallback error") return "We could not read it. Try again: this did not use a drawing.";
  if (e === "generation unavailable") return "The drawing reader is offline. Try again in a moment.";
  if (e === "looks like a controller") return what === "ship" ? "This looks like a controller. Did you mean to draw your ship?" : "This looks like a controller. Draw what explores the planet here.";
  if (e === "looks like a ship") return kind === "button" ? "That looks like a ship. Draw one button here." : "That looks like your ship. Draw your buttons here.";
  let m = /^looks like an? (person|car|bike|animal|creature)$/.exec(e);
  if (m) return `That looks like ${m[1] === "animal" ? "an" : "a"} ${m[1]}. Draw your ${kind === "button" ? "button" : "buttons"} here.`;
  if (/^looks like a drawing/.test(e)) return kind === "button" ? "That looks like a picture. Draw a box with a word like LAND." : "That looks like a picture. Draw boxes with words like FIRE.";
  if (e === "nothing to read") return `We couldn't see a drawing. Draw your ${what} bigger and darker.`;
  if (e === "no controls found") return "We couldn't find any buttons. Draw them bigger and try again.";
  if (e === "unreadable button") return "We couldn't read that. Write the word bigger and try again.";
  if (e === "region too small") return "Draw the button bigger.";
  m = /^no skill called "(.{1,16})"$/.exec(e);
  if (m) return `We don't know "${m[1]}". Try a word like FIRE, BOOST or LAND.`;
  return "We couldn't read that. Try again.";
}

// v1.5 (QA N1): the drawn steering circle. A controller the reader gave no way to turn (no steer stick, no LEFT / RIGHT)
// used to get world.js's steer stick in the roomiest empty spot, away from the circle the player drew. Before that, look
// at the drawing's own ink blobs (inkRegions from the phone, fractions of the same image as the layout): an unused round
// blob (the phone found a closed ring), else an unused about-square blob on the left half, becomes the steer stick right
// there (auto: true, ink: true; at least a thumb's size around its middle when that overlaps nothing). Unused = not
// covered by a control the reader found. Nothing usable: the layout as it was (withSteer then adds one, auto: true).
const TURN_ACTIONS = new Set(["steer", "left", "right"]);
function steerFromInk(layout, inkRegions) {
  if (!layout || !Array.isArray(layout.buttons) || !Array.isArray(inkRegions) || layout.buttons.length >= 16) return layout;
  if (layout.buttons.some((b) => TURN_ACTIONS.has(Contract.normaliseAction(b.action)))) return layout;
  const num = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const area = (a) => a.w * a.h;
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const used = (r) => layout.buttons.some((b) => overlap(r, b) > 0.3 * Math.min(area(r), area(b)));
  const blobs = inkRegions.slice(0, 40).filter((r) => r && typeof r === "object").map((r) => {
    const x = num(r.x), y = num(r.y);
    return { x, y, w: Math.min(num(r.w), 1 - x), h: Math.min(num(r.h), 1 - y), round: r.round === true };
  }).filter((r) => r.w >= 0.04 && r.h >= 0.06 && !used(r));
  const mid = (r) => r.x + r.w / 2;
  const round = blobs.filter((r) => r.round).sort((a, b) => (mid(a) < 0.5) - (mid(b) < 0.5) || area(a) - area(b)).pop();
  const square = blobs.filter((r) => mid(r) < 0.5 && r.h >= 0.15 && r.w / r.h >= 0.25 && r.w / r.h <= 1 && area(r) >= 0.012).sort((a, b) => area(a) - area(b)).pop();
  const pick = round || square;
  if (!pick) return layout;
  // a small circle still gets a stick a thumb can use (centred on the circle), unless the bigger box would cover a button
  const cx = pick.x + pick.w / 2, cy = pick.y + pick.h / 2, w = Math.max(pick.w, 0.16), h = Math.max(pick.h, 0.28);
  const big = { x: Math.min(Math.max(0, cx - w / 2), 1 - w), y: Math.min(Math.max(0, cy - h / 2), 1 - h), w, h };
  const box = layout.buttons.some((b) => overlap(big, b) > 0) ? pick : big;
  const stick = { type: "stick", action: "steer", label: "", x: r3(box.x), y: r3(box.y), w: r3(Math.min(box.w, 1 - box.x)), h: r3(Math.min(box.h, 1 - box.y)), auto: true, ink: true };
  return { ...layout, buttons: [...layout.buttons, stick] };
}

const speculativeAt = Object.create(null); // player → recent speculative call times
function speculativeOk(player) {
  const now = Date.now();
  const recent = (speculativeAt[player] || []).filter((t) => now - t < SPECULATIVE_WINDOW_MS);
  speculativeAt[player] = recent;
  if (recent.length >= SPECULATIVE_MAX) return false;
  recent.push(now);
  return true;
}

function device(ua) {
  ua = String(ua || "");
  for (const [re, name] of [[/iPhone/, "iPhone"], [/iPad/, "iPad"], [/Android/, "Android"], [/Macintosh/, "Mac"], [/Windows/, "Windows"], [/Linux/, "Linux"]]) if (re.test(ua)) return name;
  return "unknown";
}

// Only the known fields go to perf.log, numbers as numbers, the user agent cut to 300 characters.
const PERF_NUMBERS = ["fps", "low1", "p90ms", "calls", "tris", "textures", "tier", "w", "h", "dpr"];
let perfBytes = (() => { try { return fs.statSync(PERF_LOG).size; } catch { return 0; } })();
function perf(sample) {
  const line = { t: Date.now(), player: Contract.cleanName(sample.player) || null, screen: sample.screen, ua: String(sample.ua || "").slice(0, 300) };
  for (const k of PERF_NUMBERS) if (Number.isFinite(Number(sample[k]))) line[k] = Number(sample[k]);
  line.at = new Date().toISOString();
  const text = JSON.stringify(line) + "\n";
  if (perfBytes < PERF_LOG_MAX_BYTES) { perfBytes += text.length; fs.appendFile(PERF_LOG, text, () => {}); }
  const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "?");
  console.log(`perf ${line.screen} ${line.player || "-"} ${device(line.ua)}: ${n(line.fps, 1)} fps, 1% low ${n(line.low1)}, p90 ${n(line.p90ms, 1)} ms, ${n(line.calls)} calls, ${Math.round(Number(line.tris) / 1000)}k tris, tier ${n(line.tier)}`);
}

async function handlePost(req, res, url) {
  const body = await readJson(req, SMALL_BODY[url.pathname] || BODY_LIMIT);
  if (url.pathname === "/input") {
    // 204 as before; v1.3 (additive): 409 "join first" when a message named a player who never joined (the phone
    // should POST /join again), 403 "name taken" when its device token belongs to another phone.
    const outcomes = new Set((Array.isArray(body) ? body.slice(0, 64) : [body]).map(input));
    if (outcomes.has("taken")) return json(res, 403, { ok: false, error: "name taken" });
    if (outcomes.has("unknown")) return json(res, 409, { ok: false, error: "join first" });
    return res.writeHead(204).end();
  }
  if (url.pathname === "/start") {
    // The big screen's START button: lobby → the 3-2-1 (phase "countdown", v1.4: always, so every phone counts down
    // with the TV from the tick) → playing. { countdown: false } (or 0, or ?countdown=0) starts at once: tests and
    // tools that need play now. Anything but the lobby is a no-op (409).
    const off = (v) => v === false || v === 0 || v === "0" || v === "false";
    const countdown = !(off(body.countdown) || off(url.searchParams.get("countdown")));
    // v1.7 (owner 12:26): the host can start whenever at least one player is ready (ship + controller); only they get in
    const ready = typeof world.readyCount === "function" ? world.readyCount() : null;
    if (world.phase === "lobby" && world.readyGate && ready === 0) return json(res, 409, { ok: false, error: "nobody is ready", phase: world.phase, ready: 0 });
    if (!world.start({ countdown })) return json(res, 409, { ok: false, error: "not in the lobby", phase: world.phase });
    return json(res, 200, { ok: true, round: world.round, phase: world.phase, ...(ready != null ? { ready } : {}), ...(world.countdown ? { countdown: world.countdown } : {}) });
  }
  if (url.pathname === "/mode") {
    // v1.6 ENDLESS (endless.js): the big screen's ENDLESS switch, { endless: true | false }. Only in the lobby (it holds for
    // the session START begins and every one after, until switched off); every screen hears it from the world message
    // (`mode: "endless"`, absent in the demo). 409 outside the lobby, 501 with a world.js that has no endless mode.
    // v1.9 (owner 13:41, additive): { minutes: 1-4 } the round length (lobby only, 409 outside it; 400 for another value),
    // { startAfter: 0 | 15 | 30 | 60 } the lobby auto-start (any time). A body with neither `endless` nor `mode` leaves
    // ENDLESS as it is (before v1.9 every POST /mode set it). Picking a length also switches ENDLESS off unless the same
    // body asks for it. The reply carries minutes and startAfter.
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const state = () => ({ mode: world.endless ? "endless" : "demo", phase: world.phase, minutes: world.minutes, startAfter: world.startAfter });
    if (has("startAfter") && !world.setStartAfter(Number(body.startAfter))) return json(res, 400, { ok: false, error: "startAfter must be 0, 15, 30 or 60", ...state() });
    if (has("minutes")) {
      if (!Contract.ROUND_MINUTES.includes(Number(body.minutes))) return json(res, 400, { ok: false, error: "minutes must be 1, 2, 3 or 4", ...state() });
      if (world.phase !== "lobby") return json(res, 409, { ok: false, error: "not in the lobby", ...state() });
      if (!has("endless") && !has("mode") && world.endless && canEndless()) world.setEndless(false);
      world.setRoundLength(Number(body.minutes));
    }
    if (!has("endless") && !has("mode")) return json(res, 200, { ok: true, ...state() });
    if (!canEndless()) return json(res, 501, { ok: false, error: "no endless mode" });
    const on = body.endless === true || body.endless === 1 || body.endless === "1" || body.endless === "true" || body.mode === "endless";
    if (!world.setEndless(on)) return json(res, 409, { ok: false, error: "not in the lobby", ...state() });
    return json(res, 200, { ok: true, ...state() });
  }
  if (url.pathname === "/end") {
    // v1.6 ENDLESS: the big screen's END button: the endless session ends now (the normal results, then the lobby). 409
    // when no endless session is being played (the demo ends by itself: 4:00 or every chest open).
    if (!canEndless()) return json(res, 501, { ok: false, error: "no endless mode" });
    if (!world.endSession()) return json(res, 409, { ok: false, error: "no endless session to end", phase: world.phase, mode: world.endless ? "endless" : "demo" });
    return json(res, 200, { ok: true, round: world.round, phase: world.phase });
  }
  if (url.pathname === "/join") {
    // device (optional): a token the phone keeps; a name in use by another phone becomes "name2" (renamed: true).
    const joined = world.join(body.player, body.device);
    if (joined) return json(res, 200, joined);
    return json(res, 400, { error: Contract.cleanName(body.player) ? "the game is full" : "player name required" });
  }
  if (url.pathname === "/default") {
    // v1.8 (skipready): SKIP on the phone's drawing steps, { player, device, kinds: ["ship", "controller"] } ("plain ship +
    // default buttons") or { kinds: ["controller"] } ("use the default buttons"; `kind` alone works too). The readyGate counts
    // the plain ship / the default buttons like a drawing (world.useDefault), so a skipping player is READY on the TV and
    // enters the round at START. Free (no drawing spent, no Astra call). A name that has not joined (a phone that outlived a
    // server restart) joins first, as for /generate; a name bound to another phone, or a bot's, is refused.
    const player = Contract.cleanName(body.player);
    if (!player) return json(res, 400, { ok: false, error: "player name required" });
    // v1.9: kind "explorer" = USE A QUICK EXPLORER (1-2 minute rounds): a plain person with a shovel and a drill, counted as
    // the round's explorer drawing (world.useDefault); the entity message reaches every screen as for a drawn one.
    const kinds = [...new Set((Array.isArray(body.kinds) ? body.kinds : [body.kind]).filter((k) => k === "ship" || k === "controller" || k === "explorer"))];
    if (!kinds.length) return json(res, 400, { ok: false, error: "kind must be ship, controller or explorer" });
    if (!world.players[player] && !world.join(player, tokenOf(body))) return json(res, 400, { ok: false, error: "the game is full" });
    if (boundElsewhere(player, body)) return json(res, 403, { ok: false, error: "name taken" });
    if (typeof world.seat === "function" && !world.seat(player)) return json(res, 400, { ok: false, error: "the game is full" });
    // v1.9 PRACTICE: the quick explorer of a practicing player is the practice world's
    if (kinds.includes("explorer") && practice && practicing.has(player)) {
      if (!practice.quickExplorer(player)) return json(res, 400, { ok: false, error: "the quick explorer is for a player in a round", phase: world.phase });
      for (const k of kinds) if (k !== "explorer") world.useDefault(player, k);
      return json(res, 200, { ok: true, kinds, ready: world.isReady(player), phase: world.phase, practice: true });
    }
    // the quick explorer only in a round being played, for a player in it (400 otherwise, as before v1.9)
    if (kinds.includes("explorer") && !(typeof world.quickExplorer === "function" && world.quickExplorer(player))) return json(res, 400, { ok: false, error: "the quick explorer is for a player in a round", phase: world.phase });
    for (const k of kinds) if (k !== "explorer") world.useDefault(player, k);
    return json(res, 200, { ok: true, kinds, ready: world.isReady(player), phase: world.phase });
  }
  if (url.pathname === "/practice") {
    // v1.9 PRACTICE (owner, 10 Oct 14:08): PLAY WHILE YOU WAIT. { player, device, on: true } puts a READY player of the lobby
    // into the practice world (their ship and controller copied; their phone's stream, inputs and explorer drawings follow
    // them there); { on: false } brings them back (BACK TO LOBBY). The round's START brings everybody back (endAllPractice).
    const player = Contract.cleanName(body.player);
    if (!player || !world.players[player]) return json(res, 400, { ok: false, error: "join first" });
    if (boundElsewhere(player, body)) return json(res, 403, { ok: false, error: "name taken" });
    const on = !(body.on === false || body.on === 0 || body.on === "0" || body.on === "false");
    if (!on) { endPractice(player, "back"); return json(res, 200, { ok: true, practicing: false, phase: world.phase }); }
    if (world.phase !== "lobby") return json(res, 409, { ok: false, error: "not in the lobby", phase: world.phase });
    if (!world.isReady(player)) return json(res, 409, { ok: false, error: "not ready", phase: world.phase });
    if (!practicing.has(player) && !startPractice(player)) return json(res, 400, { ok: false, error: "the practice is full" });
    const startIn = world.startIn;
    return json(res, 200, { ok: true, practicing: true, phase: world.phase, ...(startIn != null ? { startIn } : {}) });
  }
  if (url.pathname === "/generate") {
    // Drawing budget (PLAN.md): only finished (non-speculative), successful drawings count, in the world the player
    // is in when they send it (the lobby counts as space). Speculative calls are free and never change the layout,
    // but at most SPECULATIVE_MAX per player per SPECULATIVE_WINDOW_MS. anyway / expect / pad pass through to Astra;
    // refusals come back as Astra says them (looksLike, thing) and spend nothing.
    const player = Contract.cleanName(body.player);
    const finished = !body.speculative;
    // v1.3: a drawing from a name that has not joined (a phone that outlived a server restart) joins it first, so the
    // drawing lands on a real player (setEntity / setLayout never create players: no ghosts). A name bound to
    // another phone, or a bot's name, is refused.
    if (player && !world.players[player] && typeof body.image === "string" && body.image.startsWith("data:image/") && !world.join(player, tokenOf(body))) {
      return json(res, 400, { ok: false, error: "the game is full", message: "The game is full right now.", drawingsLeft: world.drawingsLeft(player) });
    }
    if (player && boundElsewhere(player, body)) {
      return json(res, 403, { ok: false, error: "name taken", message: "That name is playing on another phone. Join with a new name.", drawingsLeft: world.drawingsLeft(player) });
    }
    if (player && practice && practicing.has(player)) return practiceGenerate(req, res, body, player); // v1.9 PRACTICE
    // v1.4: a player back after a long pause takes a seat again; with 25 active humans there is none (never 26).
    if (player && world.players[player] && typeof world.seat === "function" && !world.seat(player)) {
      return json(res, 400, { ok: false, error: "the game is full", message: "The game is full right now.", drawingsLeft: world.drawingsLeft(player) });
    }
    if (!finished && player && !speculativeOk(player)) return json(res, 200, { ok: false, error: "slow down", message: "", drawingsLeft: world.drawingsLeft(player) });
    const where = world.drawingWorld(player);
    if (finished && player && world.drawingsLeft(player)[where] <= 0) {
      return json(res, 200, { ok: false, error: "no drawings left", message: plainMessage(body.kind, "no drawings left"), drawingsLeft: world.drawingsLeft(player) });
    }
    // where: the player's world now ("space" | "planet"), so Astra (and its mock) reads a button as the one that world
    // needs (no LAND on the planet).
    // v1.4: the phone gives up after about 15 s (it aborts the fetch, the connection closes before the answer): stop
    // waiting and spend or change nothing for this request (no drawing, layout, entity or generated message).
    const gone = new AbortController();
    res.on("close", () => { if (!res.writableEnded) gone.abort(); });
    if (res.destroyed || (req.socket && req.socket.destroyed)) gone.abort(); // it closed before we started listening
    const round0 = world.round;
    let { status, result } = await generate({ ...body, where }, gone.signal);
    if (gone.signal.aborted) {
      logOnce(`generate ${String(body.kind).slice(0, 12)}`, `${player || "-"} gave up waiting: nothing spent`);
      return;
    }
    // v1.5 (every round from scratch): a drawing sent in one round and answered in the next belongs to neither: nothing
    // spent, kept or changed; the phone (already back at "1 · DRAW YOUR SHIP") says a new round started.
    if (world.round !== round0) {
      return json(res, 200, { ok: false, error: "new round", message: plainMessage(body.kind, "new round"), ...(player ? { drawingsLeft: world.drawingsLeft(player) } : {}) });
    }
    // A finished ship / explorer always comes back as an entity (fallbackEntity), unless it was refused.
    if (finished && player && DRAWING_KINDS[body.kind] && !(result && result.ok) && !ENTITY_NO_FALLBACK.test(String((result && result.error) || ""))) {
      logOnce(`generate ${body.kind} fell back to the plain entity`, (result && result.error) || "no answer");
      status = 200;
      result = { ok: true, entity: fallbackEntity(body.kind), fallback: true, free: true, failed: result && result.error === "timeout" ? "timeout" : "error" };
    }
    // v1.5 (QA M1): a drawing nobody could read (fallback, free) costs nothing; the phone offers TRY AGAIN.
    const free = !!(result && result.ok && result.fallback && result.free && DRAWING_KINDS[body.kind]);
    if (result && result.ok && finished && player && !free && !world.spendDrawing(player, where)) result = { ok: false, error: "no drawings left" };
    if (result && result.ok && player && (body.kind === "controller" || body.kind === "button") && result.layout) {
      // Never stuck: a controller with no way to turn gets a steer stick (auto: true) where there is room. v1.5 (QA N1):
      // first where the player drew it: an unused circle in the drawing (steerFromInk), so the hit area sits on the ink.
      if (body.kind === "controller") result = { ...result, layout: withSteer(steerFromInk(result.layout, body.inkRegions)) };
      // The whole pad (the drawn controller plus added buttons) as HTML, now; Sol's own version follows.
      const padLayout = mergeLayout(world.layoutOf(player), result.layout, body.kind);
      if (finished) world.setLayout(player, result.layout, body.kind);
      const image = body.kind === "controller" ? body.image : (ctrl[player] && ctrl[player].image) || null;
      let h = null;
      try { h = await controllerHtml(player, padLayout, image, finished); } catch (err) { logOnce("controller html failed", err); }
      const extra = h ? { html: h.html, controls: h.controls, htmlSource: h.source, padLayout } : {};
      result = { ...result, ...extra };
      if (finished) broadcast({ type: "generated", player, kind: body.kind, layout: result.layout, ...extra });
      // v1.6 hall of fame: the finished controller drawing, its pad and the pad's HTML now (Sol's own follows: noteControllerHtml)
      if (finished && body.kind === "controller") hallArchive({ player, color: world.players[player] && world.players[player].color, round: world.round, kind: "controller", image: body.image, layout: padLayout, html: h && h.html, htmlSource: h && h.source });
    }
    // v1.5 (QA M1): an unread redraw never takes away a drawing that was read: the player keeps that entity (kept: true)
    // and nothing changes; only a player with no read drawing for that world yet gets the plain entity (never stuck).
    const p0 = player && world.players[player];
    const read0 = p0 && p0.drawn && p0.drawn[body.kind === "ship" ? "space" : "planet"];
    if (free && finished && read0 && read0.source !== "fallback" && result.entity) {
      const type = read0.type || result.entity.type, verbs = Verbs.entityVerbs(type, (read0.unlocked || []).map((u) => u.verb));
      const kept = { type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked: read0.unlocked || [], parts: read0.parts || [], source: read0.source, card: read0.card };
      result = { ...result, entity: drawnEntity(player, kept), kept: true };
    } else if (result && result.ok && finished && player && DRAWING_KINDS[body.kind] && result.entity) {
      // A full redraw: the drawn parts replace that world's entity and its skills (world.setEntity), now if the
      // player drives one, else at the next mode switch (an explorer drawn in space shows up on landing). The drawn
      // look rides along as `image`.
      const image = keepDrawing(player, body.kind, body.image);
      if (image && result.entity.spec) noteShipSpec(vOfUrl(image), result.entity.spec); // v1.4: ship and body specs alike
      if (typeof result.entity.card !== "string" && typeof Verbs.cardOf === "function") result = { ...result, entity: { ...result.entity, card: Verbs.cardOf(result.entity.type, result.entity.unlocked) } };
      // v1.6 hall of fame: the drawing, its spec (a late one comes through noteShipSpec) and the skills it unlocked
      if (image) hallArchive({ player, color: world.players[player] && world.players[player].color, round: world.round, kind: body.kind, image: body.image, spec: result.entity.spec || shipSpecOf(image), unlocked: result.entity.unlocked, card: result.entity.card, type: result.entity.type, source: result.entity.source });
      const before = world.players[player] && world.players[player].entity;
      const now = world.setEntity(player, body.kind, result.entity);
      result = { ...result, entity: image ? { ...result.entity, image } : result.entity };
      // setEntity already broadcast when the skills changed; else the new look alone still has to go out.
      if (image && now && now === before && kindOfEntity(now) === body.kind) broadcast({ type: "entity", player, entity: now });
      // A ship redrawn while landed: the parked ship on the pad shows the new drawing on every screen
      // (island.parked[].image, added by withDrawings).
      const p = world.players[player];
      if (image && body.kind === "ship" && p && p.mode === "planet") broadcast(world.worldMessage({ entities: false }));
    }
    if (result && !result.ok) result = { ...result, message: plainMessage(body.kind, result.error) };
    else if (free) result = { ...result, message: plainMessage(body.kind, result.failed === "timeout" ? "fallback timeout" : "fallback error") };
    return json(res, status, player && result ? { ...result, drawingsLeft: world.drawingsLeft(player) } : result);
  }
  if (url.pathname === "/controller-html") {
    // { player, wait? } → the player's controller HTML now; wait: true waits for a Sol call still running.
    const player = Contract.cleanName(body.player);
    if (!player || !world.players[player]) return json(res, 404, { ok: false, error: "unknown player" });
    const h = await currentHtml(player, body.wait === true);
    if (!h) return json(res, 503, { ok: false, error: "controller html unavailable" });
    return json(res, 200, { ok: true, html: h.html, controls: h.controls, htmlSource: h.source, padLayout: h.padLayout, pending: h.pending });
  }
  if (url.pathname === "/hall/judge" || url.pathname === "/hall/reset") {
    // v1.6 hall of fame: start judging every drawing not judged yet (idempotent: a running judge goes on), or
    // { confirm: true } starts a brand-new session (the archive, its hall/ copy and the call count are emptied).
    const H = loadHall();
    if (!H) return json(res, 503, { ok: false, error: "hall unavailable" });
    if (url.pathname === "/hall/judge") return json(res, 200, { ok: true, judging: H.judge() });
    if (body.confirm !== true) return json(res, 400, { ok: false, error: "confirm: true required" });
    return json(res, 200, H.newSession());
  }
  if (url.pathname === "/restart") {
    // v1.6.1 RESTART: the big screen's two-step RESTART. { confirm: true } required (the TV page sends it only after the
    // second tap / R twice). Answers first, then restartServer() tells every screen and hands over to a fresh server.
    // v1.8: without a supervisor the fresh copy is started (and has loaded) before anything else, so a copy that cannot
    // start (a broken file, say) is a 500 and nothing is lost: the TV says RESTART FAILED, no screen heard anything.
    if (body.confirm !== true) return json(res, 400, { ok: false, error: "confirm: true required" });
    if (restarting) return json(res, 409, { ok: false, error: "already restarting" });
    const how = supervised() ? "supervisor" : "respawn";
    restarting = true; // a second tap meanwhile is a 409
    if (how === "respawn" && !(await spawnCopy())) { restarting = false; return json(res, 500, { ok: false, error: "restart failed" }); }
    json(res, 200, { ok: true, restarting: true, how, session: SESSION_ID });
    restartServer(how);
    return;
  }
  if (url.pathname === "/perf") {
    if (Contract.CHECKS.perf(body).length) return json(res, 400, { error: Contract.CHECKS.perf(body).join("; ") });
    perf(body);
    return res.writeHead(204).end();
  }
  res.writeHead(404).end();
}

// The request target as a URL, or null. "//" or "//host/x" stay paths on this server (new URL("//", base) throws).
function parseUrl(raw) {
  raw = String(raw || "/");
  try { return raw.startsWith("/") ? new URL(`http://localhost${raw}`) : new URL(raw); } catch { return null; }
}

async function handler(req, res) {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const url = parseUrl(req.url);
    if (!url) return json(res, 400, { error: "bad request" });
    if (req.method === "GET" && url.pathname === "/events") openStream(req, res, url);
    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/info") json(res, 200, info());
    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/drawings/")) serveDrawing(req, res, url);
    else if ((req.method === "GET" || req.method === "HEAD") && /^\/hall(\/|$)/.test(url.pathname)) serveHall(req, res, url); // v1.6
    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/ship-spec") {
      // v1.4: the spec of a ship drawing by its hash (the phone's result card); 404 until Astra has one.
      const spec = shipSpecs.get(specKey(String(url.searchParams.get("v") || "").slice(0, 40))); // v1.5: by the drawing's hash, this round only
      json(res, spec ? 200 : 404, spec ? { ok: true, spec } : { ok: false, error: "no spec" });
    }
    else if (req.method === "POST") await handlePost(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, url);
    else res.writeHead(405).end();
  } catch (err) {
    if (!err || !err.status) logOnce(`${req.method} ${String(req.url).slice(0, 80)} failed`, err);
    try {
      if (!res.headersSent) json(res, (err && err.status) || 500, { error: err && err.status ? err.message : "server error" });
      else res.destroy();
    } catch {}
  }
}

// Last resort: log and keep the party going (the step, the ticks and every request are already guarded).
process.on("unhandledRejection", (err) => logOnce("unhandled rejection", err));
process.on("uncaughtException", (err) => logOnce("uncaught exception", err));

// https.js may not exist yet (another lane): guarded, and a failure there never stops the HTTP server.
let httpsLib = null;
try { httpsLib = require("./https"); } catch (err) { console.log(`HTTPS off: ${err.code === "MODULE_NOT_FOUND" ? "no https.js" : err.message}`); }

const server = http.createServer((req, res) => { handler(req, res); });
server.on("clientError", (err, socket) => {
  try { if (socket.writable && err.code !== "ECONNRESET") socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); else socket.destroy(); } catch {}
});
// v1.6.1 RESTART: a copy started by restartServer() (SPACE_RESPAWN_OF = the old pid) waits for the old process to be gone,
// then retries listen while the ports are still taken (up to RESPAWN_RETRY_MS). A normal start fails at once, as before.
const RESPAWN_OF = Number(process.env.SPACE_RESPAWN_OF) || 0;
const RESPAWN_RETRY_MS = 30000, startedAt = Date.now();
const retryListen = (err) => RESPAWN_OF && err && err.code === "EADDRINUSE" && Date.now() - startedAt < RESPAWN_RETRY_MS;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };
let secure = null;
server.on("error", (err) => {
  if (retryListen(err)) return setTimeout(() => server.listen(PORT, "0.0.0.0"), 250);
  console.log(`HTTP server failed: ${err.message}`); process.exit(1);
});
server.on("listening", () => {
  const ip = lanAddress();
  console.log(`Space Party on http://localhost:${PORT}${BOTS ? ` with ${BOTS} bots` : ""}${RESPAWN_OF ? ` (restarted, session ${SESSION_ID})` : ""}`);
  console.log(`  big screen: http://${ip}:${PORT}/space.html`);
  console.log(`  phones:     http://${ip}:${PORT}/controller.html`);
  if (canEndless() && world.endless) console.log("  mode:       ENDLESS free-for-all (the host ends it from the big screen)");
});

function startHttps() {
  if (!httpsLib || !(HTTPS_PORT > 0)) return;
  try {
    secure = httpsLib.startHttps((req, res) => { handler(req, res); }, { port: HTTPS_PORT });
    secure.on("listening", () => (httpsUp = true));
    secure.on("error", (err) => {
      httpsUp = false;
      if (retryListen(err)) return setTimeout(() => secure.listen(HTTPS_PORT, "0.0.0.0"), 250);
      console.log(`HTTPS off: ${err.message}`);
    });
  } catch (err) {
    console.log(`HTTPS off: ${err.message}`);
  }
}
function startListening() {
  server.listen(PORT, "0.0.0.0");
  startHttps();
}
if (RESPAWN_OF) {
  // v1.8: everything above loaded: tell the old server (spawnCopy waits for this before it lets go of the ports)
  if (typeof process.send === "function") { try { process.send({ restart: "loaded" }); } catch {} }
  const waitFrom = Date.now();
  (function waitOld() {
    if (alive(RESPAWN_OF) && Date.now() - waitFrom < 10000) return setTimeout(waitOld, 100);
    startListening();
  })();
} else startListening();

// ---- v1.6.1 RESTART: POST /restart { confirm: true } (the big screen) -----------------------------------------------
// supervised(): something restarts `node server.js` when it exits. KEEPALIVE=1 (or true / yes) says so; KEEPALIVE=0 says
// not; unset, the parent process's command line is checked for a known supervisor (our scratchpad keepalive.sh, pm2,
// nodemon, forever, supervisord, runit, systemd). Anything else takes the self-respawn path (the default).
let restarting = false;
function supervised() {
  const env = String(process.env.KEEPALIVE || "").trim().toLowerCase();
  if (env) return !["0", "false", "no", "off"].includes(env);
  if (RESPAWN_OF || process.ppid <= 1) return false; // a respawned copy is detached: nobody restarts it
  try {
    const cmd = require("child_process").execFileSync("ps", ["-o", "command=", "-p", String(process.ppid)], { encoding: "utf8", timeout: 1000 });
    return /keep-?alive|supervis|pm2|nodemon|forever|runsv|systemd/i.test(cmd);
  } catch { return false; }
}
// The self-respawn: a detached copy of this server (same argv, env and cwd; its output goes where ours goes, stdin is not
// held), told our pid (SPACE_RESPAWN_OF) so it waits for us to be gone before it listens. Resolves true once the copy has
// loaded (every module and its world: it says so over IPC, below), false when it cannot start, exits first or says nothing
// within 10 s (then it is stopped and this server keeps running). Ctrl-C does not reach the copy (it is detached): stop it
// with `kill <pid>` (logged here) or by its port.
function spawnCopy() {
  return new Promise((resolve) => {
    let child = null, done = false, timer = 0;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ok) console.log(`RESTART: new server pid ${child.pid} (it takes the ports once this one exits)`);
      else {
        console.log(`RESTART: the new server${child && child.pid ? ` (pid ${child.pid})` : ""} did not start (${why}); this one keeps running`);
        if (child && child.pid && child.exitCode === null) { try { child.kill(); } catch {} }
      }
      if (child) { try { child.disconnect(); } catch {} try { child.unref(); } catch {} }
      resolve(ok);
    };
    timer = setTimeout(() => finish(false, "no answer in 10 s"), 10000);
    try {
      const { spawn } = require("child_process");
      child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        cwd: process.cwd(), detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"], env: { ...process.env, SPACE_RESPAWN_OF: String(process.pid) },
      });
    } catch (err) { return finish(false, err.message); }
    child.on("error", (err) => finish(false, err.message));
    child.on("exit", (code, signal) => finish(false, `it exited (${signal || code})`));
    child.on("message", (m) => { if (m && m.restart === "loaded") finish(true); });
  });
}
// Every screen hears {type:"restart"}, then (a moment later, so it is delivered) every stream and connection closes, the
// ports are released and this process exits 0: the supervisor starts a fresh server, or the copy spawnCopy() started does.
function restartServer(how) {
  restarting = true;
  console.log(`RESTART from the big screen (${how}): every screen rejoins; the world and the hall of fame start empty`);
  writeAll(sse({ type: "restart", session: SESSION_ID }));
  setTimeout(() => {
    for (const res of streams.keys()) { try { res.end(); } catch {} }
    streams.clear();
    for (const s of [server, secure]) {
      if (!s) continue;
      try { s.close(); } catch {}
      try { s.closeAllConnections(); } catch {}
    }
    setTimeout(() => process.exit(0), 150);
  }, 300);
}
