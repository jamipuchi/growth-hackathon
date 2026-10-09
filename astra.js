// Astra: drawing or photo in, checked controller layout out (PLAN.md section 3, Generation).
// One OpenAI vision call (Responses API, strict JSON schema) reads the drawing; everything after it is plain code:
// labels bind to actions through Verbs.resolveLabel, rectangles are clamped, and Contract.CHECKS.layout has the last word.
//
//   generate({ player, kind, image, speculative, requestId, region?, source?, expect?, anyway? })
//     → Promise<{ ok: true, layout | entity, looksLike } | { ok: false, error, looksLike?, thing? }>
//   kind "controller": the whole pad. kind "button": one new control; the image is that control alone (the phone crops
//   it) and its rectangle on the pad is `region` ({x, y, w, h}, fractions). `expect` (optional verb id): the button the
//   game asked for (a ghost box); used only when the drawing itself cannot be read. `pad` (optional, action ids): the
//   controls already on the phone; by default Astra remembers each player's last finished controller and added
//   buttons. When a photo shows the whole page again, the model answers with the control that is not on the pad yet.
//   kind "ship" | "explorer": one vision call (same request style, strict JSON) reads the drawn entity →
//   { ok: true, entity: { type, rig, verbs, unlocked: [{verb, part}], parts: [{name, x, y}], source, anims } }.
//   Skills come ONLY from drawn parts (PLAN.md "Unlockable skills"); verbs = Verbs.entityVerbs(type, drawn skills).
//   ASTRA_MOCK=1, no key, a timeout or a failed call: the generous dev kit (Verbs.DEV_KIT, source "devkit").
//   Keeps the drawing at controllers/<player>-<kind>.png (finished only).
//
// looksLike (every answer the model gave): what the drawing really is, "controller" | "entity" | "nothing".
//   A drawing of the wrong kind is refused, so it costs no drawing: an entity in the controller or button step →
//   { ok: false, error: "looks like a ship", looksLike: "entity", thing: "ship" } (thing: ship, person, car, bike,
//   animal, creature, object); a controller in the ship or explorer step → { ok: false, error: "looks like a
//   controller", looksLike: "controller" }. Posting the same image again with `anyway: true` ("Use it anyway") skips
//   that check and answers from the cache at once: the controller read from it (else the default layout), the entity.
//
// Robustness: output budgets large enough for the reasoning tokens; a hedged second request when the first is slow
// (HEDGE_MS); one retry with a bigger budget after an "incomplete" answer, and one stricter retry when a controller or
// button answer has no usable control.
//
// Env: OPENAI_API_KEY (else a .env next to this file), OPENAI_MODEL, OPENAI_SERVICE_TIER ("" or "none" omits it),
// OPENAI_REASONING_EFFORT (default "low"; "" or "none" omits it), ASTRA_MOCK=1 (no network, deterministic layouts
// after 300 ms).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Contract = require("./contract.js");
const Verbs = require("./verbs.js");
const Anims = require("./anims.js");

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_TIER = "ultrafast";
const DEFAULT_EFFORT = "low";
const TIMEOUT_MS = 4000;
const MOCK_MS = 300;
const MAX_BUTTONS = 16;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
// Reasoning tokens count against max_output_tokens: a 200-token button budget ran out in play ("incomplete"). These
// leave room for both; measured live (dev/gen-corpus): answers use ≤ 400 tokens, reasoning included.
const MAX_OUTPUT_TOKENS = { controller: 2000, button: 1200, ship: 1600, explorer: 1600 };
const RETRY_OUTPUT_TOKENS = 4000;
const RETRY_BEFORE_MS = 1800; // a retry only starts if it can still finish inside the timeout
// Tail latency: most answers take 1-2 s, but a call sometimes hangs past the 4 s timeout (2 of 101 in the corpus run).
// If the first request has not answered after HEDGE_MS, an identical second one starts; the first answer wins.
const HEDGE_MS = 2200;
const MAX_PARTS = 12;
const LOOKS = ["controller", "entity", "nothing"];
const THINGS = ["none", "ship", "person", "car", "bike", "animal", "creature", "object"];

const ACTIONS = [...Object.keys(Verbs.VERBS), ...Verbs.MOVES, ...Verbs.STICKS, ...Contract.META_ACTIONS];

let fetchImpl = (...args) => globalThis.fetch(...args);
let outDir = path.join(__dirname, "controllers");
let timeoutMs = TIMEOUT_MS;
let defaultTierOnly = false; // set once a call proves the fast tier rejects images or structured output
let envKey; // undefined = not read yet
const cache = new Map(); // hash → reading { value, looksLike, thing, wrong }
const inflight = new Map(); // hash → { promise, controller, owners: Set<token> }
const slots = new Map(); // "player:kind" → token of the newest call
const pads = new Map(); // player → [{ type, action, label }] on their phone now (last finished controller + buttons)
const MAX_PADS = 500;

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
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

// Icons mean a verb with no word written (the corpus showed flames read as shoot, drill bits as arrows).
const ICON_RULES = "An icon needs no word: crosshair or target → shoot; flame or fire → boost; shield shape → shield; drill bit (a cone or point with ridges or a spiral) → drill; shovel or spade → dig; landing legs, a parachute or an arrow down onto a line → land; antenna, radar dish or a big eye → scan; light bulb, torch, lamp or sun → flare; plus sign or cross → heal; bomb → blast; spiral or portal → teleport.";

function promptFor(kind, source, region, opts = {}) {
  const input = source === "draw"
    ? "The image is a finger drawing made on the phone screen, dark ink on a light background."
    : "The image is usually a PHOTO of a notebook page, already cropped by the phone to the drawing. It is greyscale and may show ruled or squared paper lines, shadows, smudges, slight perspective or a thumb at the edge. Ignore paper lines, grids, shadows, fingers and anything that was not deliberately drawn as a control.";
  const control = [
    "Controls:",
    "- A circle with a smaller circle or knob inside, a D-pad cross, a circle with arrows inside, or four arrows around one point is ONE control of type \"stick\" whose rectangle covers the whole cluster; its action is \"steer\" if it is on the left half of the image, else \"move\".",
    "- A single arrow on its own (or alone inside its own circle) is a \"button\" with action left, right, up or down.",
    "- A box, circle or shape with a word or an icon in it is a \"button\" (a drawn on/off switch or slider is a \"toggle\"). A word written just under, over or next to a shape, or joined to it by an arrow, is that shape's label, not a separate control.",
    "- label: the written word exactly, in UPPERCASE (FIRE, LAND, PEW, DIG...). Use \"\" if no word is written.",
    `- action: the closest game action, or "none" if nothing fits. Verbs with typical labels: ${verbList()}. Movement: ${Verbs.MOVES.join(", ")}. Meta: ready, view.`,
    `- ${ICON_RULES}`,
    "- Ignore anything crossed out or scribbled over: it was deleted.",
  ];
  if (kind === "button") {
    const pad = opts.pad && opts.pad.length ? [`Already on this player's pad: ${opts.pad.map(describeControl).join(", ")}. Only if the image shows several controls (for example a photo of the whole page), answer with the one that is not on the pad yet; a single control is always the answer, even if the pad has one like it.`] : [];
    const expect = opts.expect ? [`The game asked this player to add a ${opts.expect.toUpperCase()} button. If the drawing could mean that, use action "${opts.expect}"; if it clearly says something else, follow the drawing.`] : [];
    return [
      "You read ONE hand-drawn button that a player just added to their phone game controller.",
      input,
      `The image shows only that ONE new control, cropped to it (a photo may be turned by 90 degrees). It will sit on the pad at x=${region.x}, y=${region.y}, w=${region.w}, h=${region.h} (fractions); you do not need to place it.`,
      "looksLike: \"controller\" if it is a button: a shape with a word or an icon in it, or just a word, an icon or an arrow. \"entity\" if it is instead a picture of a thing: a spaceship, rocket, vehicle, person, stick figure, robot, animal or creature. \"nothing\" if it is blank or unreadable scribbles. thing: what such a picture shows (ship, person, car, bike, animal, creature, object), \"none\" for a button.",
      ...control,
      ...pad,
      ...expect,
      opts.strict ? "Look again carefully: the player drew exactly one button. Read its word or icon and give its closest action." : "",
      "Return that one control: looksLike, thing, its type, label and action.",
    ].filter(Boolean).join("\n");
  }
  return [
    "You read a hand-drawn game controller for a phone held in landscape. Players draw their own buttons and sticks.",
    input,
    "First, looksLike: \"controller\" if the drawing is a game controller: sticks, D-pads, arrows, boxes or circles with words or icons, even a single button. \"entity\" if it is instead a picture of a thing: a spaceship, rocket, plane, car, bike, person, astronaut, robot, animal or creature (notes, labels or arrows written around a picture do not make it a controller). \"nothing\" if it is blank or random scribbles. thing: what such a picture shows (ship, person, car, bike, animal, creature, object), \"none\" for a controller.",
    "Then buttons: every drawn control when looksLike is \"controller\"; [] otherwise.",
    ...control,
    "Rectangles: x, y are the top-left corner and w, h the size, all as fractions (0 to 1) of the whole image, origin top left. Make each rectangle hug the drawn shape.",
    `Return every drawn control, at most ${MAX_BUTTONS}, no duplicates. Never invent controls that are not drawn.`,
    opts.strict ? "Look again carefully: this drawing is a controller, so list every box, circle, arrow cluster or word as a control with its closest action." : "",
  ].filter(Boolean).join("\n");
}

const cleanLabel = (label) => String(label || "").toUpperCase().replace(/[^A-Z0-9 +]/g, " ").replace(/\s+/g, " ").trim().slice(0, 16);
const describeControl = (c) => {
  const label = cleanLabel(c.label);
  return c.type === "stick" ? `a ${c.action} stick` : label && Verbs.resolveLabel(label) === c.action ? label : `${label ? label + " " : ""}(${c.action})`;
};

const controlProps = {
  type: { type: "string", enum: ["button", "stick", "toggle"] },
  label: { type: "string" },
  action: { type: "string", enum: [...ACTIONS, "none"] },
};
const looksProps = {
  looksLike: { type: "string", enum: LOOKS },
  thing: { type: "string", enum: THINGS },
};
const SCHEMAS = {
  controller: {
    type: "object",
    additionalProperties: false,
    required: ["looksLike", "thing", "buttons"],
    properties: {
      ...looksProps,
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
  button: { type: "object", additionalProperties: false, required: ["looksLike", "thing", "type", "label", "action"], properties: { ...looksProps, ...controlProps } },
  ship: entitySchema("space", ["ship"]),
  explorer: entitySchema("planet", Verbs.PLANET_TYPES),
};

function entitySchema(world, types) {
  const skill = { type: "string", enum: Verbs.SKILLS[world] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["looksLike", "type", "parts", "verbs", "unlocked"],
    properties: {
      looksLike: looksProps.looksLike,
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
    : "The image is usually a PHOTO of a notebook page, cropped to the drawing and possibly turned by 90 degrees. Ignore paper lines, grids, shadows and fingers.";
  const table = Verbs.SKILLS[world].map((v) => `${v}: ${Verbs.PARTS[v]}`).join("; ");
  const looks = "looksLike: \"entity\" for any picture of a thing (a ship, rocket, vehicle, person, robot, animal, creature or object), even a rough one. \"controller\" ONLY if the drawing is a game-controller layout instead: joystick circles, D-pads, arrows, or boxes and circles labelled with action words (FIRE, BOOST, LAND, DIG...), with no vehicle or creature drawn. \"nothing\" if it is blank.";
  const hints = kind === "ship"
    ? "How parts look: wavy tongues of fire behind the ship or under a rocket = exhaust flames → boost; a tube or barrel = cannon → shoot; a cone or triangle with ridges, zigzag or spiral lines on the nose = drill → drill; struts with feet under the ship = landing legs → land; a big circle or bubble around the whole ship = shield → shield; a small circle or bulb with straight rays fanning out = lamp → flare; a stick with a dish or ball = antenna → scan; a plus sign or cross = red cross → heal; a ball with a fuse = bomb → blast. Windows, a cockpit, fins and wings unlock nothing."
    : "How parts look: a shovel, spade or big claws on the feet or hands → dig; a drill: any hand-held tool or front part ending in a cone or point with ridges, zigzag or spiral lines, even with a gun-like grip → drill; a gun or blaster with a straight barrel → shoot; a jetpack or exhaust with flames → boost; a torch or lamp with rays → flare; a shield → shield; an antenna or radar dish → scan; a red cross → heal. The eyes of a face and a helmet visor unlock nothing; wheels and legs are how it moves (no skill).";
  return [
    kind === "ship"
      ? "You read a hand-drawn SPACESHIP for a party game. type is always \"ship\"."
      : "You read a hand-drawn EXPLORER that walks or drives on a planet. type: person (a person, astronaut, or robot on two legs), car, bike (bicycle or motorbike), quadruped (any four-legged animal) or blob (anything else: blobs, snakes, birds, fish...).",
    input,
    looks,
    "parts: every distinct part that was deliberately drawn on it (cannon, exhaust flames, wheels, shovel, legs...), each with the centre of the part as x, y fractions of the image (origin top left). At most 12.",
    `Skills are unlocked ONLY by drawn parts. A plain body unlocks nothing (it can still move). Part → skill: ${table}.`,
    hints,
    "Be generous: when a part is unclear or only roughly fits, unlock the closest skill. When a part could be either of two things, unlock BOTH skills: a pointed tool that could be a drill or a gun → drill and shoot; rays that could be a lamp's light or flames → flare and boost. Never unlock a skill with no part on the drawing that could mean it.",
    "verbs: the unlocked skills. unlocked: one entry per skill, with the part that unlocks it (its name as in parts).",
  ].join("\n");
}

function buildRequest(kind, image, region, source, useTier = true, opts = {}) {
  const req = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    input: [{ role: "user", content: [
      { type: "input_text", text: ENTITY_KINDS[kind] ? entityPrompt(kind, source) : promptFor(kind, source, region, opts) },
      { type: "input_image", image_url: image, detail: "low" },
    ] }],
    text: { format: { type: "json_schema", name: ENTITY_KINDS[kind] ? "entity" : "layout", schema: SCHEMAS[kind], strict: true } },
    max_output_tokens: opts.maxTokens || MAX_OUTPUT_TOKENS[kind],
    store: false,
  };
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  if (useTier && !defaultTierOnly && tier && tier !== "none") req.service_tier = tier;
  const effort = process.env.OPENAI_REASONING_EFFORT ?? DEFAULT_EFFORT;
  if (effort && effort !== "none") req.reasoning = { effort };
  return req;
}

// ---- Model answer → layout -----------------------------------------------------------------------------------------

// The raw Responses API body: the first output[].content[] item of type output_text.
function extractText(data) {
  if (!data || typeof data !== "object") throw new Error("empty response");
  // A cut-off answer can still carry partial text: it is incomplete either way (callModel retries with more tokens).
  if (data.status === "incomplete") throw new Error(`incomplete: ${(data.incomplete_details && data.incomplete_details.reason) || "unknown"}`);
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "output_text" && typeof part.text === "string") return part.text;
      if (part && part.type === "refusal") throw new Error("model refused");
    }
  }
  if (typeof data.output_text === "string") return data.output_text;
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

// The same control drawn twice (or a label read as its own control): keep the first of each action and rectangle.
function dedupe(controls) {
  const out = [];
  for (const c of controls) {
    const twin = out.find((o) => o.action === c.action && Math.abs(o.x - c.x) < 0.03 && Math.abs(o.y - c.y) < 0.03 && Math.abs(o.w - c.w) < 0.05 && Math.abs(o.h - c.h) < 0.05);
    if (!twin) out.push(c);
  }
  return out;
}

function layoutFromModel(kind, data, region, expect) {
  if (!data || typeof data !== "object") throw new Error("bad model output: not an object");
  if (kind === "button") {
    let control = cleanControl(data, region);
    // Nothing readable, but the game asked for one verb (a ghost box) and the model saw a button: that verb.
    if (!control && expect && region.w >= 0.02 && region.h >= 0.02 && data.looksLike !== "entity" && data.looksLike !== "nothing") {
      control = { type: data.type === "toggle" ? "toggle" : "button", action: expect, label: String(data.label ?? "").trim().toUpperCase().slice(0, 16), ...region };
    }
    if (!control) {
      const label = String(data.label ?? "").trim().toUpperCase().replace(/[^A-Z0-9 +]/g, "").trim();
      throw new Error(label ? `no skill called "${label.slice(0, 16)}"` : "unreadable button");
    }
    return finishLayout([control], "model");
  }
  if (!Array.isArray(data.buttons)) throw new Error("bad model output: no buttons");
  return finishLayout(dedupe(data.buttons.map((b) => cleanControl(b, b || {})).filter(Boolean)), "model");
}

// Model answer → reading: the layout or entity, plus what the drawing looks like and whether it is the wrong kind.
// Throws when a right-kind answer has nothing usable (the caller may retry once).
function readAnswer(kind, data, region, expect) {
  if (!data || typeof data !== "object") throw new Error("bad model output: not an object");
  const looksLike = LOOKS.includes(data.looksLike) ? data.looksLike : null;
  const thing = THINGS.includes(data.thing) && data.thing !== "none" ? data.thing : null;
  if (ENTITY_KINDS[kind]) {
    const value = entityFromModel(kind, data);
    // Refused (no drawing spent): a controller drawn in the entity step, or a blank page with nothing on it.
    return { value, looksLike, thing: null, wrong: looksLike === "controller" || (looksLike === "nothing" && !value.parts.length) };
  }
  const wrong = looksLike === "entity";
  try {
    return { value: layoutFromModel(kind, data, region, expect), looksLike, thing, wrong };
  } catch (err) {
    if (wrong) return { value: null, looksLike, thing, wrong };
    err.looksLike = looksLike;
    throw err;
  }
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

// Run attempt(signal); if it has not settled after hedgeMs, start a second identical attempt. The first success
// wins and the other is aborted; a failure before the hedge starts is reported at once. Both follow `parent`.
function hedged(attempt, parent, hedgeMs = HEDGE_MS) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let settled = false, pending = 0, firstErr = null, timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parent.removeEventListener("abort", onAbort);
      for (const c of ctrls) c.abort();
      fn(value);
    };
    const onAbort = () => finish(reject, Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    const launch = () => {
      const c = new AbortController();
      ctrls.push(c);
      pending++;
      attempt(c.signal).then((value) => finish(resolve, value), (err) => {
        pending--;
        firstErr = firstErr || err;
        if (pending === 0) finish(reject, firstErr);
      });
    };
    if (parent.aborted) return onAbort();
    parent.addEventListener("abort", onAbort, { once: true });
    launch();
    timer = setTimeout(() => { if (!settled) launch(); }, hedgeMs);
  });
}

// One model call (hedged) → the parsed JSON answer.
const ask = (kind, image, region, source, signal, opts) => hedged((s) => askOnce(kind, image, region, source, s, opts), signal);

// One request. A 4xx naming the tier, images or the schema retries once on the default tier (remembered for the
// process).
async function askOnce(kind, image, region, source, signal, opts) {
  const key = apiKey();
  if (!key) throw new Error("no OPENAI_API_KEY");
  let req = buildRequest(kind, image, region, source, true, opts);
  let res = await post(req, key, signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const tierProblem = res.status >= 400 && res.status < 500 && req.service_tier && /service_tier|image|format|schema/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    defaultTierOnly = true; // remembered for the process
    console.log(`astra: service tier ${req.service_tier} rejected (HTTP ${res.status}); using the default tier from now on`);
    req = buildRequest(kind, image, region, source, false, opts);
    res = await post(req, key, signal);
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("bad response: not JSON");
  });
  return parseJson(extractText(data));
}

// The model reading of one drawing, with at most one retry: a bigger budget after an "incomplete" answer, or a
// stricter prompt when a controller or button answer had no usable control (only while time is left).
async function callModel(kind, image, region, source, signal, extra = {}) {
  const { expect, pad } = extra;
  const t0 = Date.now();
  const timeLeft = () => Date.now() - t0 < RETRY_BEFORE_MS && !signal.aborted;
  let answer;
  try {
    answer = await ask(kind, image, region, source, signal, { expect, pad });
  } catch (err) {
    if (!/^incomplete: max_output_tokens/.test(err.message) || !timeLeft()) throw err;
    console.log(`astra ${kind}: ${err.message} after ${Date.now() - t0} ms, retrying with ${RETRY_OUTPUT_TOKENS} tokens`);
    answer = await ask(kind, image, region, source, signal, { expect, pad, maxTokens: RETRY_OUTPUT_TOKENS });
  }
  try {
    return readAnswer(kind, answer, region, expect);
  } catch (err) {
    const empty = /^(no controls found|unreadable button|no skill called)/.test(err.message);
    if (ENTITY_KINDS[kind] || !empty || err.looksLike === "nothing" || !timeLeft()) throw err;
    console.log(`astra ${kind}: ${err.message} after ${Date.now() - t0} ms, retrying with a stricter prompt`);
    try {
      return readAnswer(kind, await ask(kind, image, region, source, signal, { expect, pad, strict: true }), region, expect);
    } catch {
      // The first answer was definite (nothing usable): report it, not the retry's failure or the timeout.
      err.final = true;
      throw err;
    }
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))), { once: true });
});

// One in-flight request per image hash; every caller waiting on it is an owner.
function startEntry(hash, kind, image, region, source, extra) {
  const controller = new AbortController();
  const entry = { controller, owners: new Set(), timedOut: false, superseded: false, done: false };
  const timer = setTimeout(() => ((entry.timedOut = true), controller.abort()), timeoutMs);
  const t0 = Date.now();
  entry.promise = (async () => {
    try {
      const reading = process.env.ASTRA_MOCK === "1"
        ? (await sleep(ENTITY_KINDS[kind] ? 0 : MOCK_MS, controller.signal), { value: ENTITY_KINDS[kind] ? devKitEntity(kind) : mockLayout(kind, hash, region), looksLike: null, thing: null, wrong: false })
        : await callModel(kind, image, region, source, controller.signal, extra);
      cache.set(hash, reading);
      return { ok: true, reading, ms: Date.now() - t0, outcome: outcomeOf(reading) };
    } catch (err) {
      const ms = Date.now() - t0;
      // An entity always comes back: the dev kit keeps the game playable without a key or when the call fails.
      if (ENTITY_KINDS[kind] && !entry.superseded) return { ok: true, reading: { value: devKitEntity(kind), looksLike: null, thing: null, wrong: false }, ms, outcome: `${entry.timedOut ? "timeout" : `error: ${err && err.message}`} → dev kit` };
      if (err && err.final && !entry.superseded) return { ok: false, error: err.message, looksLike: err.looksLike, ms, outcome: `error: ${err.message}` };
      if (entry.timedOut) {
        if (kind === "controller") return { ok: true, reading: { value: defaultLayout(), looksLike: null, thing: null, wrong: false }, ms, outcome: "timeout → default layout" };
        return { ok: false, error: "timeout", ms, outcome: "timeout" };
      }
      if (entry.superseded) return { ok: false, error: "superseded", ms, outcome: "superseded" };
      return { ok: false, error: String(err && err.message || err), looksLike: err && err.looksLike, ms, outcome: `error: ${err && err.message}` };
    } finally {
      clearTimeout(timer);
      entry.done = true;
      inflight.delete(hash);
    }
  })();
  inflight.set(hash, entry);
  return entry;
}

function save(player, kind, image, answer) {
  const base = path.join(outDir, `${player}-${kind}`);
  const png = Buffer.from(image.replace(/^data:[^,]*;base64,/, ""), "base64");
  const { anims, ...entity } = answer.entity || {};
  const body = answer.ok ? answer.layout || entity : { error: answer.error, ...(answer.looksLike ? { looksLike: answer.looksLike } : {}) };
  const json = JSON.stringify(body, null, 2);
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

// The refusal for a drawing of the wrong kind: what it looks like, in words the phone can show.
function wrongKindError(kind, reading) {
  if (reading.looksLike === "nothing") return "nothing to read";
  if (ENTITY_KINDS[kind]) return "looks like a controller";
  const thing = reading.thing && reading.thing !== "object" ? reading.thing : null;
  if (!thing) return kind === "button" ? "looks like a drawing, not a button" : "looks like a drawing, not a controller";
  return `looks like ${thing === "animal" ? "an" : "a"} ${thing}`;
}

const log = (kind, player, hit, ms, outcome, speculative) =>
  console.log(`astra ${kind} ${player} ${hit} model=${ms == null ? "-" : ms + "ms"}${speculative ? " speculative" : ""} ${outcome}`);

const VERB_IDS = new Set([...Object.keys(Verbs.VERBS), ...Verbs.MOVES]);

async function generate(body) {
  body = body || {};
  const kind = body.kind;
  const player = Contract.cleanName(body.player);
  if (kind !== "controller" && kind !== "button" && kind !== "ship" && kind !== "explorer") return { ok: false, error: "kind is controller, button, ship or explorer" };
  if (!player) return { ok: false, error: "player required" };
  const image = body.image;
  if (typeof image !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) return { ok: false, error: "image must be an image data URL" };
  if (image.length > MAX_IMAGE_CHARS) return { ok: false, error: "image too large" };
  const region = kind === "button" ? cleanRegion(body.region) : null;
  if (region && (region.w < 0.02 || region.h < 0.02)) return { ok: false, error: "region too small" };
  const source = body.source === "draw" ? "draw" : "photo";
  const expectRaw = kind === "button" && typeof body.expect === "string" ? Contract.normaliseAction(body.expect) : null;
  const expect = expectRaw && VERB_IDS.has(expectRaw) ? expectRaw : null;
  const pad = kind === "button" ? (Array.isArray(body.pad) ? cleanPad(body.pad) : pads.get(player) || []) : [];
  const hash = sha1(kind + image + (region ? JSON.stringify(region) : "") + (expect ? `expect:${expect}` : "") + (pad.length ? `pad:${pad.map((c) => c.action).join(",")}` : ""));
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
    if (!entry) entry = startEntry(hash, kind, image, region, source, { expect, pad });
    entry.owners.add(token);
    token.entry = entry;
  }
  if (previous) release(previous);

  const result = cached
    ? { ok: true, reading: cached, ms: 0, outcome: outcomeOf(cached) }
    : await Promise.race([entry.promise, token.superseded]);
  if (slots.get(slotKey) === token) slots.delete(slotKey);
  if (entry) entry.owners.delete(token);

  const answer = answerOf(kind, result, body.anyway === true, { region, expect });
  if (answer.ok && answer.layout && !body.speculative) rememberPad(player, kind, answer.layout);
  log(kind, player, hit, result.ms, answer.ok || !result.ok ? result.outcome : `${result.outcome} → refused (${answer.error})`, body.speculative);
  // A speculative ship / explorer is not kept (the drawing on disk is the finished one; controllers keep theirs).
  // A refused ship / explorer is not kept either: the drawing on disk stays the last accepted one.
  if (result.error !== "superseded" && !(ENTITY_KINDS[kind] && (body.speculative || !answer.ok))) save(player, kind, image, answer);
  return answer;
}

// The controls on a player's phone after a finished controller (replaces) or button (adds, same action replaced).
function rememberPad(player, kind, layout) {
  let list = kind === "controller" ? [] : (pads.get(player) || []).slice();
  for (const b of layout.buttons) list = [...list.filter((x) => x.action !== b.action), { type: b.type, action: b.action, label: b.label || "" }];
  pads.delete(player);
  pads.set(player, list.slice(-MAX_BUTTONS));
  if (pads.size > MAX_PADS) pads.delete(pads.keys().next().value);
}
// body.pad from the phone: action ids (or {action, label, type}); unknown actions dropped.
function cleanPad(list) {
  return list.slice(0, MAX_BUTTONS).map((c) => (typeof c === "string" ? { action: c } : c && typeof c === "object" ? c : {}))
    .map((c) => {
      const action = typeof c.action === "string" ? Contract.normaliseAction(c.action) : "";
      return { type: Verbs.STICKS.includes(action) ? "stick" : "button", action, label: typeof c.label === "string" ? cleanLabel(c.label) : "" };
    })
    .filter((c) => ACTIONS.includes(c.action));
}

// A finished entry → what the phone gets. Wrong-kind readings are refused unless the player insists (`anyway`).
function answerOf(kind, result, anyway, { region, expect } = {}) {
  if (!result.ok) return { ok: false, error: result.error, ...(result.looksLike ? { looksLike: result.looksLike } : {}) };
  const reading = result.reading;
  const looks = reading.looksLike ? { looksLike: reading.looksLike } : {};
  if (reading.wrong && !anyway) return { ok: false, error: wrongKindError(kind, reading), ...looks, ...(reading.thing ? { thing: reading.thing } : {}) };
  let value = reading.value;
  if (!value && kind === "controller") value = defaultLayout();
  if (!value && kind === "button" && expect) {
    try { value = finishLayout([{ type: "button", action: expect, label: "", ...region }], "model"); } catch {}
  }
  if (!value) return { ok: false, error: "unreadable button", ...looks };
  if (ENTITY_KINDS[kind]) return { ok: true, entity: withAnims(structuredClone(value)), ...looks };
  return { ok: true, layout: structuredClone(value), ...looks };
}

const outcomeOf = (r) => {
  const v = r.value;
  const what = !v ? "nothing usable" : v.buttons ? `ok ${v.buttons.length} control(s)` : `ok ${v.type} [${v.verbs.join(" ")}] (${v.source})`;
  return r.looksLike ? `${what} looksLike=${r.looksLike}${r.thing ? `/${r.thing}` : ""}` : what;
};
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
    pads.clear();
    defaultTierOnly = false;
    timeoutMs = TIMEOUT_MS;
  },
  state: () => ({ cache: cache.size, inflight: inflight.size, slots: slots.size, pads: pads.size, defaultTierOnly }),
  padOf: (player) => (pads.get(Contract.cleanName(player)) || []).map((c) => ({ ...c })),
  TIMEOUT_MS, MOCK_MS, HEDGE_MS, SCHEMAS, ACTIONS, ENTITY_KINDS, MAX_OUTPUT_TOKENS, LOOKS, THINGS, entityFromModel, devKitEntity,
  entityPrompt, buildRequest, promptFor, extractText, parseJson, cleanControl, layoutFromModel, readAnswer, mockLayout,
  cleanRegion, sha1, wrongKindError, hedged,
};

module.exports = { generate, defaultLayout, wireAnimations, _internals };
