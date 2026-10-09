// BASELINE COPY of astra.js as committed in 7f895ea (v1.1 server track), used only for the "before" scorecard.
// Requires and the .env path are rewritten to the repo root; nothing else changed.

// Astra: drawing or photo in, checked controller layout out (PLAN.md section 3, Generation).
// One OpenAI vision call (Responses API, strict JSON schema) reads the drawing; everything after it is plain code:
// labels bind to actions through Verbs.resolveLabel, rectangles are clamped, and Contract.CHECKS.layout has the last word.
//
//   generate({ player, kind, image, speculative, requestId, region?, source? })
//     → Promise<{ ok: true, layout } | { ok: false, error }>
//   kind "controller": the whole pad. kind "button": one new control inside `region` ({x, y, w, h}, fractions).
//   kind "ship" | "explorer": one vision call (same request style, strict JSON) reads the drawn entity →
//   { ok: true, entity: { type, rig, verbs, unlocked: [{verb, part}], parts: [{name, x, y}], source, anims } }.
//   Skills come ONLY from drawn parts (PLAN.md "Unlockable skills"); verbs = Verbs.entityVerbs(type, drawn skills).
//   ASTRA_MOCK=1, no key, a timeout or a failed call: the generous dev kit (Verbs.DEV_KIT, source "devkit").
//   Keeps the drawing at controllers/<player>-<kind>.png (finished only).
//
// Env: OPENAI_API_KEY (else a .env next to this file), OPENAI_MODEL, OPENAI_SERVICE_TIER ("" or "none" omits it),
// OPENAI_REASONING_EFFORT, ASTRA_MOCK=1 (no network, deterministic layouts after 300 ms).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Contract = require("../../../contract.js");
const Verbs = require("../../../verbs.js");
const Anims = require("../../../anims.js");

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_TIER = "ultrafast";
const TIMEOUT_MS = 4000;
const MOCK_MS = 300;
const MAX_BUTTONS = 16;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = { controller: 900, button: 200, ship: 500, explorer: 500 };
const MAX_PARTS = 12;

const ACTIONS = [...Object.keys(Verbs.VERBS), ...Verbs.MOVES, ...Verbs.STICKS, ...Contract.META_ACTIONS];

let fetchImpl = (...args) => globalThis.fetch(...args);
let outDir = path.join(__dirname, "controllers");
let timeoutMs = TIMEOUT_MS;
let defaultTierOnly = false; // set once a call proves the fast tier rejects images or structured output
let envKey; // undefined = not read yet
const cache = new Map(); // hash → layout
const inflight = new Map(); // hash → { promise, controller, owners: Set<token> }
const slots = new Map(); // "player:kind" → token of the newest call

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (envKey === undefined) {
    envKey = null;
    try {
      const text = fs.readFileSync(path.join(__dirname, "../../../.env"), "utf8");
      const match = text.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m);
      if (match) envKey = match[1].trim().replace(/^["']|["']$/g, "") || null;
    } catch {}
  }
  return envKey;
}

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const round3 = (v) => Math.round(v * 1000) / 1000;

function defaultLayout() {
  return {
    buttons: [
      { type: "stick", action: "steer", label: "", x: 0.04, y: 0.35, w: 0.3, h: 0.55 },
      { type: "button", action: "shoot", label: "SHOOT", x: 0.74, y: 0.5, w: 0.22, h: 0.36 },
      { type: "button", action: "boost", label: "BOOST", x: 0.5, y: 0.6, w: 0.2, h: 0.3 },
    ],
    source: "default",
  };
}

function cleanRegion(region) {
  const r = region || {};
  const x = clamp01(r.x ?? 0), y = clamp01(r.y ?? 0);
  const w = Math.min(clamp01(r.w ?? 1), 1 - x), h = Math.min(clamp01(r.h ?? 1), 1 - y);
  return w > 0 && h > 0 ? { x: round3(x), y: round3(y), w: round3(w), h: round3(h) } : { x: 0, y: 0, w: 1, h: 1 };
}

// ---- Prompt and schema -------------------------------------------------------------------------------------------

const verbList = () =>
  Object.entries(Verbs.VERBS).map(([id, v]) => `${id} (${v.synonyms.slice(0, 4).join(", ")})`).join("; ");

function promptFor(kind, source, region) {
  const input = source === "draw"
    ? "The image is a finger drawing made on the phone screen, white ink on dark or dark ink on light."
    : "The image is usually a PHOTO of a notebook page, already cropped by the phone to the drawn controller. It is greyscale and may show ruled or squared paper lines, shadows, smudges, slight perspective or a thumb at the edge. Ignore paper lines, grids, shadows, fingers and anything that was not deliberately drawn as a control.";
  const rules = [
    "Controls: a circle, joystick, D-pad or cluster of arrows is ONE control of type \"stick\" whose rectangle covers the whole cluster; its action is \"steer\" if it is on the left half, else \"move\".",
    "A single arrow drawn on its own is a \"button\" with action left, right, up or down.",
    "A box, circle or shape with a word or symbol in it is a \"button\" (a drawn switch or slider is a \"toggle\"). Copy the written word exactly into label, in UPPERCASE (FIRE, LAND, PEW, DIG...). Use \"\" if nothing is written.",
    `action: the closest game action, or "none". Verbs with typical labels: ${verbList()}. Movement: ${Verbs.MOVES.join(", ")}. Meta: ready, view.`,
  ];
  if (kind === "button") {
    return [
      "You read one hand-drawn button for a landscape phone game controller.",
      input,
      `The image is the player's whole controller pad. They just drew ONE new control inside this region (fractions of the image, origin top left): x=${region.x}, y=${region.y}, w=${region.w}, h=${region.h}. Read only the strokes inside that region and ignore everything outside it.`,
      ...rules,
      "Return exactly that one control: its type, label and action.",
    ].join("\n");
  }
  return [
    "You read a hand-drawn game controller for a phone held in landscape.",
    input,
    ...rules,
    "Rectangles: x, y are the top-left corner and w, h the size, all as fractions (0 to 1) of the whole image, origin top left. Make each rectangle hug the drawn control.",
    `Return every drawn control, at most ${MAX_BUTTONS}, no duplicates. Never invent controls that are not drawn.`,
  ].join("\n");
}

const controlProps = {
  type: { type: "string", enum: ["button", "stick", "toggle"] },
  label: { type: "string" },
  action: { type: "string", enum: [...ACTIONS, "none"] },
};
const SCHEMAS = {
  controller: {
    type: "object",
    additionalProperties: false,
    required: ["buttons"],
    properties: {
      buttons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "label", "action", "x", "y", "w", "h"],
          properties: { ...controlProps, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
        },
      },
    },
  },
  button: { type: "object", additionalProperties: false, required: ["type", "label", "action"], properties: controlProps },
  ship: entitySchema("space", ["ship"]),
  explorer: entitySchema("planet", Verbs.PLANET_TYPES),
};

function entitySchema(world, types) {
  const skill = { type: "string", enum: Verbs.SKILLS[world] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["type", "parts", "verbs", "unlocked"],
    properties: {
      type: { type: "string", enum: types },
      parts: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "x", "y"], properties: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" } } } },
      verbs: { type: "array", items: skill },
      unlocked: { type: "array", items: { type: "object", additionalProperties: false, required: ["verb", "part"], properties: { verb: skill, part: { type: "string" } } } },
    },
  };
}

// The entity prompt: what each drawn part unlocks, generous when a part is unclear.
function entityPrompt(kind, source) {
  const world = kind === "ship" ? "space" : "planet";
  const input = source === "draw"
    ? "The image is a finger drawing made on the phone screen."
    : "The image is usually a PHOTO of a notebook page, cropped to the drawing. Ignore paper lines, grids, shadows and fingers.";
  const table = Verbs.SKILLS[world].map((v) => `${v}: ${Verbs.PARTS[v]}`).join("; ");
  return [
    kind === "ship"
      ? "You read a hand-drawn SPACESHIP for a party game. type is always \"ship\"."
      : "You read a hand-drawn EXPLORER that walks or drives on a planet. type: person (a person, astronaut, robot on legs), car, bike, quadruped (any four-legged animal) or blob (anything else).",
    input,
    "parts: every distinct part that was deliberately drawn on it (cannon, exhaust flames, wheels, shovel, legs...), each with the centre of the part as x, y fractions of the image (origin top left). At most 12.",
    `Skills are unlocked ONLY by drawn parts. A plain body unlocks nothing (it can still move). Part → skill: ${table}.`,
    "Be generous: when a part is unclear or only roughly fits, unlock the closest skill. Never unlock a skill with no part on the drawing that could mean it.",
    "verbs: the unlocked skills. unlocked: one entry per skill, with the part that unlocks it (its name as in parts).",
  ].join("\n");
}

function buildRequest(kind, image, region, source, useTier = true) {
  const req = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    input: [{ role: "user", content: [
      { type: "input_text", text: ENTITY_KINDS[kind] ? entityPrompt(kind, source) : promptFor(kind, source, region) },
      { type: "input_image", image_url: image, detail: "low" },
    ] }],
    text: { format: { type: "json_schema", name: ENTITY_KINDS[kind] ? "entity" : "layout", schema: SCHEMAS[kind], strict: true } },
    max_output_tokens: MAX_OUTPUT_TOKENS[kind],
    store: false,
  };
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  if (useTier && !defaultTierOnly && tier && tier !== "none") req.service_tier = tier;
  if (process.env.OPENAI_REASONING_EFFORT) req.reasoning = { effort: process.env.OPENAI_REASONING_EFFORT };
  return req;
}

// ---- Model answer → layout -----------------------------------------------------------------------------------------

// The raw Responses API body: the first output[].content[] item of type output_text.
function extractText(data) {
  if (!data || typeof data !== "object") throw new Error("empty response");
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "output_text" && typeof part.text === "string") return part.text;
      if (part && part.type === "refusal") throw new Error("model refused");
    }
  }
  if (typeof data.output_text === "string") return data.output_text;
  if (data.status === "incomplete") throw new Error(`incomplete: ${(data.incomplete_details && data.incomplete_details.reason) || "unknown"}`);
  throw new Error("no output_text in response");
}

function parseJson(text) {
  const body = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("bad model output: not JSON");
  }
}

// One control from the model → a contract control, or null when it binds to nothing.
function cleanControl(raw, rect) {
  if (!raw || typeof raw !== "object") return null;
  let type = ["button", "stick", "toggle"].includes(raw.type) ? raw.type : "button";
  const label = String(raw.label ?? "").trim().toUpperCase().slice(0, 16);
  const modelAction = raw.action == null ? "" : Contract.normaliseAction(raw.action);
  let action = Verbs.resolveLabel(label) || (ACTIONS.includes(modelAction) ? modelAction : null);
  if (Verbs.STICKS.includes(action)) type = "stick";
  if (type === "stick" && !Verbs.STICKS.includes(action)) {
    // An unlabelled circle or arrow cluster: left half steers, right half moves.
    if (action && !Verbs.MOVES.includes(action) && label) type = "button";
    else action = Number(rect.x) + Number(rect.w) / 2 < 0.5 ? "steer" : "move";
  }
  if (!action) return null;
  const x = clamp01(rect.x), y = clamp01(rect.y);
  const w = Math.min(clamp01(rect.w), 1 - x), h = Math.min(clamp01(rect.h), 1 - y);
  if (w < 0.02 || h < 0.02) return null;
  return { type, action, label, x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
}

function finishLayout(buttons, source) {
  const layout = { buttons: buttons.slice(0, MAX_BUTTONS), source };
  const errors = Contract.CHECKS.layout(layout);
  if (errors.length) throw new Error(layout.buttons.length ? `invalid layout: ${errors[0]}` : "no controls found");
  return layout;
}

function layoutFromModel(kind, data, region) {
  if (!data || typeof data !== "object") throw new Error("bad model output: not an object");
  if (kind === "button") {
    const control = cleanControl(data, region);
    if (!control) throw new Error("unreadable button");
    return finishLayout([control], "model");
  }
  if (!Array.isArray(data.buttons)) throw new Error("bad model output: no buttons");
  return finishLayout(data.buttons.map((b) => cleanControl(b, b || {})).filter(Boolean), "model");
}

function mockLayout(kind, hash, region) {
  const j = (i) => (parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255) * 0.06; // deterministic jitter, 0..0.06
  if (kind === "button") return finishLayout([{ type: "button", action: "land", label: "LAND", ...region }], "model");
  return finishLayout([
    { type: "stick", action: "steer", label: "", x: round3(0.03 + j(0)), y: round3(0.35 + j(1)), w: 0.3, h: 0.55 },
    { type: "button", action: "shoot", label: "SHOOT", x: round3(0.72 + j(2)), y: round3(0.5 + j(3)), w: 0.2, h: 0.35 },
    { type: "button", action: "boost", label: "BOOST", x: round3(0.48 + j(4)), y: round3(0.6 + j(5)), w: 0.2, h: 0.3 },
  ], "model");
}

// ---- Network -------------------------------------------------------------------------------------------------------

async function post(req, key, signal) {
  return fetchImpl(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}

async function callModel(kind, image, region, source, signal) {
  const key = apiKey();
  if (!key) throw new Error("no OPENAI_API_KEY");
  let req = buildRequest(kind, image, region, source);
  let res = await post(req, key, signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const tierProblem = res.status >= 400 && res.status < 500 && req.service_tier && /service_tier|image|format|schema/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    defaultTierOnly = true; // remembered for the process
    console.log(`astra: service tier ${req.service_tier} rejected (HTTP ${res.status}); using the default tier from now on`);
    req = buildRequest(kind, image, region, source, false);
    res = await post(req, key, signal);
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("bad response: not JSON");
  });
  const answer = parseJson(extractText(data));
  return ENTITY_KINDS[kind] ? entityFromModel(kind, answer) : layoutFromModel(kind, answer, region);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))), { once: true });
});

// One in-flight request per image hash; every caller waiting on it is an owner.
function startEntry(hash, kind, image, region, source) {
  const controller = new AbortController();
  const entry = { controller, owners: new Set(), timedOut: false, superseded: false, done: false };
  const timer = setTimeout(() => ((entry.timedOut = true), controller.abort()), timeoutMs);
  const t0 = Date.now();
  entry.promise = (async () => {
    try {
      const layout = process.env.ASTRA_MOCK === "1"
        ? (await sleep(ENTITY_KINDS[kind] ? 0 : MOCK_MS, controller.signal), ENTITY_KINDS[kind] ? devKitEntity(kind) : mockLayout(kind, hash, region))
        : await callModel(kind, image, region, source, controller.signal);
      cache.set(hash, layout);
      return { ok: true, layout, ms: Date.now() - t0, outcome: outcomeOf(layout) };
    } catch (err) {
      const ms = Date.now() - t0;
      // An entity always comes back: the dev kit keeps the game playable without a key or when the call fails.
      if (ENTITY_KINDS[kind] && !entry.superseded) return { ok: true, layout: devKitEntity(kind), ms, outcome: `${entry.timedOut ? "timeout" : `error: ${err && err.message}`} → dev kit` };
      if (entry.timedOut) {
        if (kind === "controller") return { ok: true, layout: defaultLayout(), ms, outcome: "timeout → default layout" };
        return { ok: false, error: "timeout", ms, outcome: "timeout" };
      }
      if (entry.superseded) return { ok: false, error: "superseded", ms, outcome: "superseded" };
      return { ok: false, error: String(err && err.message || err), ms, outcome: `error: ${err && err.message}` };
    } finally {
      clearTimeout(timer);
      entry.done = true;
      inflight.delete(hash);
    }
  })();
  inflight.set(hash, entry);
  return entry;
}

function save(player, kind, image, result) {
  const base = path.join(outDir, `${player}-${kind}`);
  const png = Buffer.from(image.replace(/^data:[^,]*;base64,/, ""), "base64");
  const json = JSON.stringify(result.ok ? result.layout : { error: result.error }, null, 2);
  fs.promises.mkdir(outDir, { recursive: true })
    .then(() => Promise.all([fs.promises.writeFile(`${base}.png`, png), fs.promises.writeFile(`${base}.json`, json)]))
    .catch((err) => console.log(`astra: could not save ${player}-${kind}: ${err.message}`));
}

// Drawn ship / explorer (PLAN.md section 0, "Unlockable skills"): the look is the drawing itself, inflated on every
// screen (inflate.js); the model reads which parts are drawn and which skills they unlock.
const ENTITY_KINDS = { ship: { type: "ship", world: "space" }, explorer: { type: "person", world: "planet" } };

// Model answer → entity. Only skills of that world, each unlocked by a named part; type checked against the kind.
function entityFromModel(kind, data) {
  if (!data || typeof data !== "object") throw new Error("bad model output: not an object");
  const { world } = ENTITY_KINDS[kind];
  const type = kind === "ship" ? "ship" : Verbs.PLANET_TYPES.includes(data.type) ? data.type : "blob";
  const parts = (Array.isArray(data.parts) ? data.parts : []).filter((p) => p && typeof p.name === "string" && p.name.trim())
    .slice(0, MAX_PARTS).map((p) => ({ name: p.name.trim().toLowerCase().slice(0, 24), x: round3(clamp01(p.x)), y: round3(clamp01(p.y)) }));
  const skills = Verbs.SKILLS[world];
  const unlocked = [];
  for (const u of Array.isArray(data.unlocked) ? data.unlocked : []) {
    if (u && skills.includes(u.verb) && !unlocked.some((x) => x.verb === u.verb)) unlocked.push({ verb: u.verb, part: String(u.part || "drawing").trim().toLowerCase().slice(0, 24) || "drawing" });
  }
  for (const v of Array.isArray(data.verbs) ? data.verbs : []) {
    if (skills.includes(v) && !unlocked.some((x) => x.verb === v)) unlocked.push({ verb: v, part: (parts[0] && parts[0].name) || "drawing" });
  }
  return finishEntity(type, unlocked, parts, "model");
}

function finishEntity(type, unlocked, parts, source) {
  const verbs = Verbs.entityVerbs(type, unlocked.map((u) => u.verb));
  return { type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked: unlocked.filter((u) => verbs.includes(u.verb)), parts, source };
}

// The generous development kit: every gate skill (ASTRA_MOCK=1, no key, a timeout or a failed call).
function devKitEntity(kind) {
  const { type, world } = ENTITY_KINDS[kind];
  const unlocked = Verbs.DEV_KIT[world].map((u) => ({ ...u }));
  return finishEntity(type, unlocked, unlocked.map((u, i) => ({ name: u.part, x: round3(0.2 + 0.1 * i), y: 0.5 })), "devkit");
}

const log = (kind, player, hit, ms, outcome, speculative) =>
  console.log(`astra ${kind} ${player} ${hit} model=${ms == null ? "-" : ms + "ms"}${speculative ? " speculative" : ""} ${outcome}`);

async function generate(body) {
  body = body || {};
  const kind = body.kind;
  const player = Contract.cleanName(body.player);
  if (kind !== "controller" && kind !== "button" && !ENTITY_KINDS[kind]) return { ok: false, error: "kind is controller, button, ship or explorer" };
  if (!player) return { ok: false, error: "player required" };
  const image = body.image;
  if (typeof image !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) return { ok: false, error: "image must be an image data URL" };
  if (image.length > MAX_IMAGE_CHARS) return { ok: false, error: "image too large" };
  const region = kind === "button" ? cleanRegion(body.region) : null;
  const source = body.source === "draw" ? "draw" : "photo";
  const hash = sha1(kind + image + (region ? JSON.stringify(region) : ""));
  const slotKey = `${player}:${kind}`;

  // The newest request for this player and kind wins; the older one resolves "superseded".
  const token = { slotKey };
  token.superseded = new Promise((resolve) => (token.supersede = resolve));
  const previous = slots.get(slotKey);
  slots.set(slotKey, token);

  const cached = cache.get(hash);
  let entry = null;
  let hit = "hit";
  if (!cached) {
    entry = inflight.get(hash);
    hit = entry ? "joined" : "miss";
    if (!entry) entry = startEntry(hash, kind, image, region, source);
    entry.owners.add(token);
    token.entry = entry;
  }
  if (previous) release(previous);

  const result = cached
    ? { ok: true, layout: cached, ms: 0, outcome: outcomeOf(cached) }
    : await Promise.race([entry.promise, token.superseded]);
  if (slots.get(slotKey) === token) slots.delete(slotKey);
  if (entry) entry.owners.delete(token);

  log(kind, player, hit, result.ms, result.outcome, body.speculative);
  // A speculative ship / explorer is not kept (the drawing on disk is the finished one; controllers keep theirs).
  if (result.error !== "superseded" && !(ENTITY_KINDS[kind] && body.speculative)) save(player, kind, image, result);
  if (!result.ok) return { ok: false, error: result.error };
  if (ENTITY_KINDS[kind]) return { ok: true, entity: withAnims(structuredClone(result.layout)) };
  return { ok: true, layout: structuredClone(result.layout) };
}

const outcomeOf = (v) => (v.buttons ? `ok ${v.buttons.length} control(s)` : `ok ${v.type} [${v.verbs.join(" ")}] (${v.source})`);
const withAnims = (entity) => ({ ...entity, anims: wireAnimations(entity.rig, entity.verbs) });

// Resolve a superseded call, and abort its model request if nobody else is waiting for that image.
function release(token) {
  token.supersede({ ok: false, error: "superseded", ms: null, outcome: "superseded" });
  const entry = token.entry;
  if (!entry) return;
  entry.owners.delete(token);
  if (entry.owners.size === 0 && !entry.done) {
    entry.superseded = true;
    entry.controller.abort();
  }
}

// Animations (PLAN.md section 6): the slots this entity's verbs use, plus the always-on ones, each with its clip,
// motion profile, effects, shake and hit-stop from the shared anims.js table. Unknown types use the blob row.
//   wireAnimations("ship", ["shoot", "boost"]) → { idle, move, hit, die, respawn, primary: {…, byVerb: { shoot… }} }
// `verbs` are verb ids or { verb } objects. byVerb keeps only this entity's verbs.
const cloneEntry = (e, verbSet) => {
  const out = { clip: e.clip, profile: e.profile, fx: e.fx.map((f) => ({ kind: f.kind, at: f.at, socket: f.socket })), shake: e.shake, hitStop: e.hitStop };
  if (e.byVerb) {
    for (const v of Object.keys(e.byVerb)) {
      if (!verbSet.has(v)) continue;
      const o = e.byVerb[v];
      (out.byVerb || (out.byVerb = {}))[v] = { clip: o.clip, profile: o.profile, fx: o.fx.map((f) => ({ kind: f.kind, at: f.at, socket: f.socket })), shake: o.shake, hitStop: o.hitStop };
    }
  }
  return out;
};

function wireAnimations(type, verbs) {
  const row = Anims.get(type);
  const verbSet = new Set();
  const slots = new Set(Anims.ALWAYS);
  for (const item of Array.isArray(verbs) ? verbs : []) {
    const id = typeof item === "string" ? item : item && item.verb;
    const verb = Verbs.VERBS[id];
    if (!verb) continue;
    verbSet.add(id);
    slots.add(verb.slot);
  }
  const out = {};
  for (const slot of slots) if (row[slot]) out[slot] = cloneEntry(row[slot], verbSet);
  return out;
}

const _internals = {
  setFetch: (fn) => (fetchImpl = fn),
  setDir: (dir) => (outDir = dir),
  setTimeoutMs: (ms) => (timeoutMs = ms),
  reset: () => {
    cache.clear();
    inflight.clear();
    slots.clear();
    defaultTierOnly = false;
    timeoutMs = TIMEOUT_MS;
  },
  state: () => ({ cache: cache.size, inflight: inflight.size, slots: slots.size, defaultTierOnly }),
  TIMEOUT_MS, MOCK_MS, SCHEMAS, ACTIONS, ENTITY_KINDS, entityFromModel, devKitEntity, entityPrompt,
  buildRequest, promptFor, extractText, parseJson, cleanControl, layoutFromModel, mockLayout, cleanRegion, sha1,
};

module.exports = { generate, defaultLayout, wireAnimations, _internals };
