// hall.js: the HALL OF FAME (v1.6, owner 10 Oct 11:57: "when the demo finishes we should rank all the drawings and
// provide a hall of fame for them ranked. use decisions api from openai to rank how good the drawings are and display
// them (side by side to the generations)").
//
// Archive: every finished drawing of the session (ship, explorer, controller) is kept here the moment the server
// accepts it (server.js /generate), with the player's name and colour, the round, the PNG, its spec (ship3d.js /
// entity3d.js build the 3D generation from it) or the controller layout and HTML, and the unlocked skills. Gameplay
// still starts from scratch every round (server.js freshRound): this archive only feeds the hall of fame. In memory,
// mirrored to hall/ (git-ignored: <id>.png + archive.json). Cleared when the server starts and by newSession().
//
// Judge: the OpenAI DECISIONS API (public beta since 6 Oct 2026; guide https://developers.openai.com/api/docs/guides/decisions):
// POST https://api.openai.com/v1/decisions, model gpt-6-luna (the only model it serves), the drawing as an inline base64
// data URL (input_image; hosted URLs are not accepted), four SCORE questions (creativity, effort, readability, fun: five
// ordered levels each; the API answers a probability-weighted level index, mapped here to 0-100) and one CHOICE question
// that picks the playful one-liner from COMMENTS (the API picks among predefined answers, it writes no prose). One call
// per drawing, at most MAX_CALLS per session (retries count), cached by the PNG's hash; a failure (no key, HTTP error,
// timeout, refusal) leaves the drawing unscored but still in the hall. ASTRA_MOCK=1 or HALL_MOCK=1: deterministic mock
// scores from the hash, no network (flagged mock: true).
//
// API (server.js):
//   init()                                   once at server start: clears hall/ (a restart is a new session)
//   archive({ player, color, round, kind, image, spec?, layout?, html?, htmlSource?, unlocked?, card?, type?, source? })
//       → entry id | null       kind "ship" | "explorer" | "controller"; image: PNG data URL or Buffer. The same PNG for the
//                               same player, kind and round updates that entry. The newest per (round, player, kind) is final.
//   noteSpec(v10, spec)          a ship / body spec that arrived late (astra.onShipSpec), by the drawing's 10-hex hash
//   noteControllerHtml(image, html, source)   Sol's controller HTML for the controller drawing `image` (data URL)
//   list() → { ok, session, judging: status(), entries: [ranked, see publicEntry] }       GET /hall
//   judge() → status()           POST /hall/judge: queue every drawing not judged yet (idempotent; a running judge goes on)
//   newSession() → { ok, session }   POST /hall/reset { confirm: true }: a brand-new session (archive, disk and call count)
//   image(id) → Buffer | null    GET /hall/img/<id>.png        html(id) → string | null    GET /hall/ctrl/<id>.html
// Never logs or returns the key; the key loader is astra.js's (OPENAI_API_KEY, else a .env next to this file; set but
// empty means no key).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API_URL = "https://api.openai.com/v1/decisions";
const MODEL = "gpt-6-luna";
// at most 60 calls per session (owner brief); HALL_MAX_CALLS can only lower it (dev/v16-hall/probe.js runs with 3)
const MAX_CALLS = /^\d+$/.test(String(process.env.HALL_MAX_CALLS || "")) ? Math.min(60, Number(process.env.HALL_MAX_CALLS)) : 60;
const CONCURRENCY = 3;
const TIMEOUT_MS = 20000;
const MAX_TRIES = 2;            // per drawing, over every judge() (a failure can be retried once by the next POST /hall/judge)
const MAX_ENTRIES = 300;        // the oldest superseded drawings go first past this
const MAX_HTML = 200 * 1024;
const DIR = process.env.HALL_DIR || path.join(__dirname, "hall");
const OWN_FILE = /^([a-z0-9]{1,40}\.(png|html)|archive\.json)$/;
const ID = /^[a-z0-9]{1,40}$/;
const KINDS = new Set(["ship", "explorer", "controller"]);
const LEVELS = 5; // per criterion: index 0..4 → 0..100

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mock = () => process.env.ASTRA_MOCK === "1" || process.env.HALL_MOCK === "1";

// ---- Key (the same loader as astra.js / astra-html.js) --------------------------------------------------------------
let envKey; // undefined = not read yet
function apiKey() {
  if ("OPENAI_API_KEY" in process.env) return process.env.OPENAI_API_KEY || null;
  if (envKey === undefined) {
    envKey = null;
    try {
      const text = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
      const match = text.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m);
      if (match) envKey = match[1].trim().replace(/^["']|["']$/g, "") || null;
    } catch {}
  }
  return envKey;
}
// Anything that looks like a key never reaches a log line or a client.
const redact = (s) => String(s || "").replace(/\b(sk|rk|pk)-[A-Za-z0-9_*.-]{4,}/g, "[redacted]").slice(0, 240);

// ---- What the judge is asked ---------------------------------------------------------------------------------------
const WHAT = {
  ship: "a SPACESHIP. Its drawn parts (guns, flames, shields...) became its skills in the game",
  explorer: "a planet EXPLORER (an astronaut, a car, a bike, an animal or a creature). Its drawn tools (a shovel, a drill...) became its skills",
  controller: "a phone CONTROLLER: boxes with words like FIRE or BOOST became the buttons on the player's phone",
};
const promptFor = (kind) =>
  `Space Party is a party game: players draw on paper or on their phone in about a minute, and each drawing becomes a 3D model or a working controller in the game. ` +
  `This image is ${WHAT[kind] || WHAT.ship}. Judge the DRAWING like a friendly, enthusiastic party judge: reward imagination, care and charm, not art training. ` +
  `A messy but inventive drawing can beat a neat but boring one.`;
const CRITERIA = [
  { name: "creativity", instructions: "How original and imaginative is this drawing?", levels: [
    ["Generic", "The most basic version of the thing, nothing added."],
    ["A spark", "One small original touch."],
    ["Inventive", "Several fun ideas of its own."],
    ["Very original", "A clear personality and surprising ideas."],
    ["Mind-blowing", "Wildly imaginative: nobody else would have drawn this."]] },
  { name: "effort", instructions: "How much effort and detail went into this drawing?", levels: [
    ["Scribble", "A few quick lines."],
    ["Quick sketch", "The basic shape, little detail."],
    ["Solid", "Clear shapes and some details."],
    ["Detailed", "Many parts and careful details."],
    ["Masterwork", "Rich detail everywhere: clearly made with lots of care."]] },
  { name: "readability", instructions: "How easy is it to tell what this is (for a controller: what each button does)?", levels: [
    ["Unreadable", "Impossible to tell what it is."],
    ["Puzzling", "Hard to read: you have to guess."],
    ["Readable", "You can tell what it is on a second look."],
    ["Clear", "Instantly clear what it is."],
    ["Crystal clear", "Instantly clear, and every part reads at a glance."]] },
  { name: "fun", instructions: "How much would a party crowd laugh, cheer or shout 'I want that!' when this shows up on the big screen?", levels: [
    ["Flat", "Nobody reacts."],
    ["A smile", "A small smile."],
    ["Fun", "People point at it."],
    ["Crowd pleaser", "Laughs and cheers."],
    ["Show stealer", "The room goes wild."]] },
];
// The playful one-liner: the API picks one (a choice question); {thing} becomes ship / explorer / controller.
const COMMENTS = [
  { value: "legend", text: "Museum grade. Frame it, then fly it.", description: "An outstanding drawing: imaginative, detailed and clear." },
  { value: "chaos", text: "Pure chaos energy. We love it.", description: "Wild and messy, lots going on everywhere." },
  { value: "minimal", text: "Minimalist masterpiece. Less is more... right?", description: "Very simple: only a few lines." },
  { value: "armed", text: "Armed to the teeth. Rivals, beware!", description: "Lots of guns, cannons, blades or other weapons." },
  { value: "speed", text: "Built for speed. Blink and it's gone.", description: "Flames, exhausts, wings or a sleek shape: it looks fast." },
  { value: "cute", text: "Too cute to lose.", description: "Cute, friendly, smiling or adorable." },
  { value: "scary", text: "Certified nightmare fuel. Respect.", description: "Menacing, spiky, monster-like or scary." },
  { value: "mystery", text: "Abstract art. The judges are still debating.", description: "Hard to tell what it is." },
  { value: "craft", text: "Every line counts. Serious craft.", description: "Careful and neat, with many small details." },
  { value: "funny", text: "Made the whole room laugh.", description: "Funny, silly or goofy." },
  { value: "colourful", text: "A rainbow on a mission.", description: "Many bright colours." },
  { value: "buttons", text: "So many buttons. Pilot licence required.", description: "A controller packed with buttons." },
  { value: "pro", text: "Clean layout, pro gamer vibes.", description: "A tidy, well organised controller with clear buttons." },
  { value: "solid", text: "Solid {thing}. Ready for action.", description: "A decent, ordinary drawing with nothing special." },
];
const COMMENT_BY = new Map(COMMENTS.map((c) => [c.value, c]));
const commentText = (value, kind) => {
  const c = COMMENT_BY.get(value);
  return c ? c.text.replace("{thing}", kind === "controller" ? "controller" : kind === "explorer" ? "explorer" : "ship") : null;
};

// The request body: exactly the documented fields (model, input, questions).
function buildRequest(kind, dataUrl) {
  return {
    model: MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text: promptFor(kind) }, { type: "input_image", image_url: dataUrl }] }],
    questions: [
      ...CRITERIA.map((c) => ({ type: "score", name: c.name, instructions: c.instructions, levels: c.levels.map(([label, description]) => ({ label, description })) })),
      { type: "choice", name: "comment", instructions: "Which one-liner would a hype party host shout about this drawing?", choices: COMMENTS.map(({ value, description }) => ({ value, description })) },
    ],
  };
}

// answers → { scores: { creativity... 0-100 }, score, commentKey } | throws (nothing usable: refused or malformed)
function parseAnswers(data, levels = LEVELS) {
  const answers = data && Array.isArray(data.answers) ? data.answers : null;
  if (!answers) throw new Error("bad response: no answers");
  const by = new Map(answers.filter((a) => a && typeof a === "object").map((a) => [a.name, a]));
  const scores = {};
  for (const c of CRITERIA) {
    const a = by.get(c.name);
    if (a && a.type === "score" && Number.isFinite(Number(a.score))) scores[c.name] = Math.round(clamp(Number(a.score) / (levels - 1), 0, 1) * 100);
  }
  const got = Object.values(scores);
  if (!got.length) throw new Error(by.size && [...by.values()].every((a) => a.type === "refusal") ? "refused" : "no scores");
  const c = by.get("comment");
  const commentKey = c && c.type === "choice" && COMMENT_BY.has(c.choice) ? c.choice : null;
  return { scores, score: Math.round(got.reduce((s, v) => s + v, 0) / got.length), commentKey };
}

// Deterministic mock (no network): 35-95 per criterion from the hash.
function mockAnswers(hash) {
  const b = Buffer.from(String(hash).padEnd(40, "0").slice(0, 40), "hex");
  const scores = {};
  CRITERIA.forEach((c, i) => (scores[c.name] = 35 + (b[i] % 61)));
  const got = Object.values(scores);
  return { scores, score: Math.round(got.reduce((s, v) => s + v, 0) / got.length), commentKey: COMMENTS[b[8] % COMMENTS.length].value };
}

// ---- State ---------------------------------------------------------------------------------------------------------
let fetchImpl = (...args) => globalThis.fetch(...args);
let session = null;            // { id, startedAt, calls }
let entries = [];              // archive order (oldest first)
const pngs = new Map();        // id → Buffer
const cache = new Map();       // PNG sha1 → { scores, score, commentKey, ms, mock } (kept across sessions: same pixels, same verdict)
let queue = [];
let active = 0;
let seq = 0;
const inflight = new Set();    // AbortControllers of running calls
let persistTimer = null;

function freshSession() {
  session = { id: `s${Date.now().toString(36)}`, startedAt: Date.now(), calls: 0 };
  for (const c of inflight) { try { c.abort(); } catch {} }
  inflight.clear();
  entries = [];
  pngs.clear();
  queue = [];
}
freshSession();

function cleanDisk() {
  try {
    for (const name of fs.readdirSync(DIR)) if (OWN_FILE.test(name)) { try { fs.unlinkSync(path.join(DIR, name)); } catch {} }
  } catch {}
}
let inited = false;
function init() {
  if (inited) return;
  inited = true;
  cleanDisk();
}

function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const doc = { session: session.id, startedAt: new Date(session.startedAt).toISOString(), calls: session.calls, model: MODEL, api: API_URL, entries: entries.map((e) => ({ ...internalView(e), html: e.html || null })) };
    fs.mkdir(DIR, { recursive: true }, () => fs.writeFile(path.join(DIR, "archive.json"), JSON.stringify(doc), () => {}));
  }, 1000);
  if (persistTimer.unref) persistTimer.unref();
}
function writePng(id, buf) {
  fs.mkdir(DIR, { recursive: true }, () => fs.writeFile(path.join(DIR, `${id}.png`), buf, () => {}));
}
function removeEntry(e) {
  entries = entries.filter((x) => x !== e);
  queue = queue.filter((x) => x !== e);
  pngs.delete(e.id);
  fs.unlink(path.join(DIR, `${e.id}.png`), () => {});
}

// ---- Archive -------------------------------------------------------------------------------------------------------
const toColor = (c) => (typeof c === "number" && Number.isFinite(c) ? `#${(c >>> 0 & 0xffffff).toString(16).padStart(6, "0")}` : typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#22d3ee");
const pngOf = (image) => {
  if (Buffer.isBuffer(image)) return image;
  const m = /^data:image\/png;base64,(.+)$/.exec(String(image || ""));
  return m ? Buffer.from(m[1], "base64") : null;
};
const isPng = (buf) => !!buf && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("latin1", 12, 16) === "IHDR";
const skillsOf = (unlocked) => (Array.isArray(unlocked) ? unlocked : []).filter((u) => u && typeof u.verb === "string").slice(0, 16).map((u) => ({ verb: u.verb.slice(0, 24), part: String(u.part || "").slice(0, 40) }));
const cleanLayout = (layout) => {
  if (!layout || !Array.isArray(layout.buttons)) return null;
  const n = (v) => Math.round(clamp(Number(v) || 0, 0, 1) * 1000) / 1000;
  return { buttons: layout.buttons.slice(0, 24).filter((b) => b && typeof b === "object").map((b) => ({ type: String(b.type || "button").slice(0, 12), action: String(b.action || "").slice(0, 24), label: String(b.label || "").slice(0, 24), x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h), ...(b.auto ? { auto: true } : {}) })) };
};

function archive({ player, color, round, kind, image, spec = null, layout = null, html = null, htmlSource = null, unlocked = null, card = null, type = null, source = null } = {}) {
  try {
    if (!KINDS.has(kind) || !player) return null;
    const buf = pngOf(image);
    if (!isPng(buf)) return null;
    const hash = sha1(buf);
    const name = String(player).slice(0, 24);
    const rnd = Number(round) || 0;
    const same = entries.find((e) => e.hash === hash && e.player === name && e.kind === kind && e.round === rnd);
    const fields = {
      spec: spec && typeof spec === "object" ? spec : null,
      layout: cleanLayout(layout),
      html: typeof html === "string" && html.length <= MAX_HTML ? html : null,
      htmlSource: htmlSource ? String(htmlSource).slice(0, 16) : null,
      skills: skillsOf(unlocked),
      card: typeof card === "string" ? card.slice(0, 200) : null,
      type: kind === "controller" ? "controller" : String(type || (kind === "ship" ? "ship" : "person")).slice(0, 16),
      source: source ? String(source).slice(0, 16) : null,
    };
    if (same) {
      for (const [k, v] of Object.entries(fields)) if (v != null && !(Array.isArray(v) && !v.length && same[k] && same[k].length)) same[k] = v;
      for (const e of entries) if (e.player === name && e.kind === kind && e.round === rnd) e.final = e === same; // sent again: the one they play now
      persist();
      return same.id;
    }
    for (const e of entries) if (e.player === name && e.kind === kind && e.round === rnd) e.final = false;
    const id = `${(++seq).toString(36)}${hash.slice(0, 6)}`;
    const e = { id, n: seq, hash, player: name, color: toColor(color), round: rnd, kind, at: Date.now(), final: true, ...fields,
      state: "new", tries: 0, error: null, scores: null, score: null, commentKey: null, ms: null, mock: false, cached: false };
    entries.push(e);
    pngs.set(id, buf);
    writePng(id, buf);
    while (entries.length > MAX_ENTRIES) removeEntry(entries.find((x) => !x.final && x.state !== "judging") || entries.find((x) => x.state !== "judging") || entries[0]);
    persist();
    return id;
  } catch (err) {
    console.log(`hall: archive failed: ${redact(err && err.message)}`);
    return null;
  }
}

// A ship / body spec that arrived after the drawing was archived (by the drawing's 10-hex hash): the model's spec wins.
function noteSpec(v10, spec) {
  if (!spec || typeof spec !== "object") return;
  const v = String(v10 || "").slice(0, 10);
  if (!/^[0-9a-f]{10}$/.test(v)) return;
  let hit = false;
  for (const e of entries) if (e.kind !== "controller" && e.hash.startsWith(v) && (!e.spec || e.spec.source !== "model" || spec.source === "model")) { e.spec = spec; hit = true; }
  if (hit) persist();
}
// Sol's controller HTML for that controller drawing (the newest archived controller entry with that PNG).
function noteControllerHtml(image, html, source = "model") {
  const buf = pngOf(image);
  if (!buf || typeof html !== "string" || html.length > MAX_HTML) return;
  const hash = sha1(buf);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "controller" && e.hash === hash) { e.html = html; e.htmlSource = String(source || "model").slice(0, 16); persist(); return; }
  }
}

// ---- Judge ---------------------------------------------------------------------------------------------------------
function status() {
  const count = (s) => entries.filter((e) => e.state === s).length;
  const pending = count("queued") + count("judging");
  return {
    running: pending > 0, done: entries.length - pending - count("new"), judged: count("done"), failed: count("failed"), skipped: count("skipped"),
    pending, unjudged: count("new"), total: entries.length, calls: session.calls, maxCalls: MAX_CALLS,
    api: "openai decisions", model: MODEL, mock: mock(),
  };
}

function judge() {
  const fresh = entries.filter((e) => e.state === "new" || (e.state === "failed" && e.tries < MAX_TRIES));
  // the drawings players ended a round with first, then the ones they replaced; oldest first inside each group
  fresh.sort((a, b) => b.final - a.final || a.n - b.n);
  for (const e of fresh) { e.state = "queued"; queue.push(e); }
  pump();
  return status();
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const e = queue.shift();
    if (e.state !== "queued") continue;
    const hit = cache.get(e.hash);
    if (hit) { Object.assign(e, { scores: hit.scores, score: hit.score, commentKey: hit.commentKey, ms: 0, mock: !!hit.mock, cached: true, state: "done", error: null }); persist(); continue; }
    if (!mock() && session.calls >= MAX_CALLS) { Object.assign(e, { state: "skipped", error: "call cap" }); persist(); continue; }
    active++;
    const sid = session.id;
    judgeOne(e).then((r) => {
      if (session.id !== sid) return; // a new session started meanwhile: forget it
      cache.set(e.hash, r);
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      Object.assign(e, { scores: r.scores, score: r.score, commentKey: r.commentKey, ms: r.ms, mock: !!r.mock, state: "done", error: null });
      console.log(`hall: ${e.player} ${e.kind} r${e.round} scored ${r.score}${r.mock ? " (mock)" : ""} in ${r.ms} ms`);
    }, (err) => {
      if (session.id !== sid) return;
      Object.assign(e, { state: "failed", error: redact(err && err.message) || "error" });
      console.log(`hall: ${e.player} ${e.kind} r${e.round} not scored: ${e.error}`);
    }).finally(() => {
      if (session.id === sid) { active--; persist(); pump(); }
    });
  }
}

const transient = (err) => /^OpenAI HTTP (429|5\d\d)$/.test(String(err && err.message)) || (err && err.name === "TypeError") || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err && err.message));

async function judgeOne(e) {
  e.tries++;
  e.state = "judging";
  const t0 = Date.now();
  if (mock()) {
    await new Promise((r) => setTimeout(r, 150));
    return { ...mockAnswers(e.hash), ms: Date.now() - t0, mock: true };
  }
  const key = apiKey();
  if (!key) throw new Error("no key");
  const buf = pngs.get(e.id);
  if (!buf) throw new Error("drawing gone");
  const body = JSON.stringify(buildRequest(e.kind, `data:image/png;base64,${buf.toString("base64")}`));
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (session.calls >= MAX_CALLS) throw lastErr || new Error("call cap");
    session.calls++;
    try {
      const data = await post(body, key);
      return { ...parseAnswers(data), ms: Date.now() - t0, mock: false };
    } catch (err) {
      lastErr = err;
      if (!transient(err)) throw err;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastErr;
}

async function post(body, key) {
  const controller = new AbortController();
  inflight.add(controller);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(API_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = "";
      try { msg = (JSON.parse(text).error || {}).message || ""; } catch {}
      // the reason helps with a beta API's shape; never on 401/403 (those messages can quote part of the key)
      if (res.status !== 401 && res.status !== 403 && msg) console.log(`hall: decisions HTTP ${res.status}: ${redact(msg)}`);
      throw new Error(`OpenAI HTTP ${res.status}`);
    }
    return await res.json().catch(() => { throw new Error("bad response: not JSON"); });
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("timeout");
    throw err;
  } finally {
    clearTimeout(timer);
    inflight.delete(controller);
  }
}

// ---- Views ---------------------------------------------------------------------------------------------------------
function internalView(e) {
  return {
    id: e.id, player: e.player, color: e.color, round: e.round, kind: e.kind, type: e.type, at: e.at, final: e.final,
    image: `/hall/img/${e.id}.png`, spec: e.spec, layout: e.layout, ctrl: e.html ? `/hall/ctrl/${e.id}.html` : null, htmlSource: e.htmlSource,
    skills: e.skills, card: e.card, source: e.source,
    judge: e.state === "new" ? "unjudged" : e.state, error: e.error, scores: e.scores, score: e.score,
    comment: commentText(e.commentKey, e.kind), mock: e.mock, cached: e.cached,
  };
}
// Ranked: scored drawings by score (ties: the earlier drawing), then the rest (the final ones first, oldest first).
function list() {
  const scored = entries.filter((e) => e.state === "done" && Number.isFinite(e.score)).sort((a, b) => b.score - a.score || a.n - b.n);
  const rest = entries.filter((e) => !(e.state === "done" && Number.isFinite(e.score))).sort((a, b) => b.final - a.final || a.n - b.n);
  return {
    ok: true, session: session.id, startedAt: session.startedAt, judging: status(),
    entries: [...scored.map((e, i) => ({ rank: i + 1, ...internalView(e) })), ...rest.map((e) => ({ rank: null, ...internalView(e) }))],
  };
}

function newSession() {
  freshSession();
  active = 0;
  cleanDisk();
  persist();
  return { ok: true, session: session.id };
}

const image = (id) => (ID.test(String(id)) ? pngs.get(String(id)) || null : null);
const html = (id) => { const e = ID.test(String(id)) && entries.find((x) => x.id === id); return (e && e.html) || null; };

module.exports = {
  init, archive, noteSpec, noteControllerHtml, list, judge, status, newSession, image, html,
  _internals: { buildRequest, parseAnswers, mockAnswers, promptFor, CRITERIA, COMMENTS, API_URL, MODEL, MAX_CALLS, setFetch: (f) => (fetchImpl = f), apiKeyPresent: () => !!apiKey() },
};
