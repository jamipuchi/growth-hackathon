// Astra: drawing or photo in, checked controller layout out (PLAN.md section 3, Generation).
// One OpenAI vision call (Responses API, strict JSON schema) reads the drawing; everything after it is plain code:
// labels bind to actions through Verbs.resolveLabel, rectangles are clamped, and Contract.CHECKS.layout has the last word.
//
//   generate({ player, kind, image, speculative, requestId, region?, source?, expect?, anyway? }, { signal? })
//     → Promise<{ ok: true, layout | entity, looksLike } | { ok: false, error, looksLike?, thing? }>
//   signal (optional AbortSignal): the caller gave up; resolves { ok: false, error: "superseded" } and aborts the model
//   call when no other request waits for that drawing.
//   A ship entity also carries `spec` (v1.4, astra-ship.js): the drawing as 3D parts for ship3d.js (see "Ship spec"); an explorer
//   entity carries its body spec the same way (v1.4, astra-body.js, for entity3d.js).
//   kind "controller": the whole pad. kind "button": one new control; the image is that control alone (the phone crops
//   it) and its rectangle on the pad is `region` ({x, y, w, h}, fractions). `expect` (optional verb id): the button the
//   game asked for (a ghost box); used only when the drawing itself cannot be read. `pad` (optional, action ids): the
//   controls already on the phone; by default Astra remembers each player's last finished controller and added
//   buttons. When a photo shows the whole page again, the model answers with the control that is not on the pad yet.
//   kind "ship" | "explorer": one vision call (same request style, strict JSON) reads the drawn entity →
//   { ok: true, entity: { type, rig, verbs, unlocked: [{verb, part}], parts: [{name, x, y}], source, anims } }.
//   Skills come ONLY from drawn parts (PLAN.md "Unlockable skills"); verbs = Verbs.entityVerbs(type, drawn skills).
//   ASTRA_MOCK=1 or no key (development only): the generous dev kit (Verbs.DEV_KIT, source "devkit").
//   v1.5 (QA M1): a timeout or a failed call read nothing, so it unlocks nothing: a plain entity with only its type's
//   innate skills (source "fallback"), and the answer says so: { ok: true, entity, fallback: true, free: true,
//   failed: "timeout" | "error" }. server.js spends no drawing for it and the phone offers a retry. Never cached.
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
// inkRegions (optional, controller kind): the connected ink components the phone found, [{ x, y, w, h, round }] as
// fractions of the drawing. When the model cannot answer (ASTRA_MOCK=1, no key, a timeout) the layout is built from
// them: round → a stick (steer on the left half, move on the right), the rest → buttons in drawing order with the
// usual verbs (source "regions"). Without them a controller timeout is { ok: false, error: "timeout" } (nothing is
// spent and the phone keeps its controller: PLAN.md "If generation fails"); a button timeout uses `expect` if given.
//
// Env: OPENAI_API_KEY (else a .env next to this file; set but empty means no key, the .env is not read),
// OPENAI_MODEL (only a gpt-6.1-sol snapshot: the model is pinned), OPENAI_SERVICE_TIER ("" or "none" omits it),
// OPENAI_REASONING_EFFORT (default "low"; "" or "none" omits it), ASTRA_MOCK=1 (no network, deterministic layouts
// after 300 ms).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Contract = require("./contract.js");
const Verbs = require("./verbs.js");
// anims.js belongs to another lane: a broken copy mid-edit must not take entity creation down with it (the entity then
// comes without anims and world.js wires them on the next mode switch). Retried on every use until it loads.
let AnimsLib = null;
function animsLib() {
  if (!AnimsLib) {
    try { AnimsLib = require("./anims.js"); } catch (err) { console.log(`astra: anims.js unavailable (${err.message})`); }
  }
  return AnimsLib;
}
animsLib();
// v1.4 ship spec (astra-ship.js, owner 09:30: "it looks like a cookie"): the drawn ship as a 3D part list for ship3d.js.
// Loaded like anims.js: a broken copy costs the spec (render.js then inflates the drawing as before), never the entity.
let ShipSpecLib = null;
function shipSpecLib() {
  if (!ShipSpecLib) {
    try { ShipSpecLib = require("./astra-ship.js"); } catch (err) { console.log(`astra: astra-ship.js unavailable (${err.message})`); }
  }
  return ShipSpecLib;
}
// v1.4 body spec (astra-body.js, owner 10:12: "We're doing the character 3d modelling as well?"): the drawn explorer as a body
// plan for entity3d.js (head, torso, limbs or wheels, tools, colours). Same call, cache and late path as the ship spec.
let BodySpecLib = null;
function bodySpecLib() {
  if (!BodySpecLib) {
    try { BodySpecLib = require("./astra-body.js"); } catch (err) { console.log(`astra: astra-body.js unavailable (${err.message})`); }
  }
  return BodySpecLib;
}
const specLibFor = (kind) => (kind === "ship" ? shipSpecLib() : kind === "explorer" ? bodySpecLib() : null);

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
// The ship spec call (v1.4): its own budget and timeout; it runs next to the entity call, so the unlock card never waits
// for it longer than SPEC_GRACE_MS (measured 10 Oct: p50 3.0 s, p90 3.3 s, 200-600 output tokens on gpt-6.1-sol).
const SPEC_OUTPUT_TOKENS = 1800;
const SPEC_TIMEOUT_MS = 9000;
const SPEC_HEDGE_MS = 5000;
const SPEC_GRACE_MS = 100; // owner: the spec must not slow the unlock card (measured 10:08: a 700 ms grace did, 4 of 5)
const MAX_SPECS = 300;
const LOOKS = ["controller", "entity", "nothing"];
const THINGS = ["none", "ship", "person", "car", "bike", "animal", "creature", "object"];

const ACTIONS = [...Object.keys(Verbs.VERBS), ...Verbs.MOVES, ...Verbs.STICKS, ...Contract.META_ACTIONS];

let fetchImpl = (...args) => globalThis.fetch(...args);
let outDir = path.join(__dirname, "controllers");
let timeoutMs = TIMEOUT_MS;
// Set for TIER_MEMORY_MS once the fast tier rejected a request that the default tier then answered (v1.0 review: one
// unrelated 4xx used to switch the whole process off the fast tier for good).
const TIER_MEMORY_MS = 10 * 60 * 1000;
let defaultTierUntil = 0;
const defaultTierOnly = () => Date.now() < defaultTierUntil;
let envKey; // undefined = not read yet
const cache = new Map(); // hash → reading { value, looksLike, thing, wrong }
const inflight = new Map(); // hash → { promise, controller, owners: Set<token> }
const slots = new Map(); // "player:kind" → token of the newest call
const pads = new Map(); // player → [{ type, action, label }] on their phone now (last finished controller + buttons)
const MAX_PADS = 500;
// v1.5 (owner, 10 Oct 11:31: every round starts from scratch): the round generation. newRound() (server.js, at each new
// lobby) bumps it and clears every cache; it is part of every cache key (readings and specs alike), so a call of an earlier
// round that finishes later can never answer a drawing sent in this one: the same photo sent again is read afresh.
let roundGen = 0;
const genKey = () => (roundGen ? `round:${roundGen}:` : "");

function apiKey() {
  // Present but blank (a harness turning the network off) means no key: never fall back to the .env then.
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
    "- An empty circle or ring with nothing written or drawn inside (the game tells players: circle = MOVE) is also ONE control of type \"stick\": \"steer\" if it is on the left half of the image, else \"move\".",
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
      "looksLike: \"controller\" if it is a button: a shape with a word or an icon in it, or just a word, an icon or an arrow. \"entity\" if it is instead a picture of a thing: a spaceship, rocket, vehicle, person, stick figure, robot, animal or creature. \"nothing\" if it is blank or unreadable scribbles. thing: what such a picture shows (ship, person, car, bike, animal, creature, object), \"none\" for a button. When looksLike is \"entity\", thing is never \"none\": pick the closest (spaceship, rocket, UFO or plane → ship; person, astronaut, stick figure or robot → person; car, truck, rover or tank → car; bicycle, motorbike or scooter → bike; dog, cat, horse or any animal → animal; monster, alien or blob → creature; anything else → object).",
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
    "First, looksLike: \"controller\" if the drawing is a game controller: sticks, D-pads, arrows, boxes or circles with words or icons, even a single button. \"entity\" if it is instead a picture of a thing: a spaceship, rocket, plane, car, bike, person, astronaut, robot, animal or creature (notes, labels or arrows written around a picture do not make it a controller). \"nothing\" if it is blank or random scribbles. thing: what such a picture shows (ship, person, car, bike, animal, creature, object), \"none\" for a controller. When looksLike is \"entity\", thing is never \"none\": pick the closest (spaceship, rocket, UFO or plane → ship; person, astronaut, stick figure or robot → person; car, truck, rover or tank → car; bicycle, motorbike or scooter → bike; dog, cat, horse or any animal → animal; monster, alien or blob → creature; anything else → object).",
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
  const looks = kind === "ship"
    ? "looksLike: \"entity\" for any picture of a thing (a ship, rocket, plane, vehicle, person, robot, animal, creature or object), even a rough one: it becomes this player's ship as drawn. \"controller\" ONLY if the drawing is a game-controller layout instead: joystick circles, D-pads, arrows, or boxes and circles labelled with action words (FIRE, BOOST, LAND, DIG...), with no vehicle or creature drawn. \"nothing\" if it is blank."
    : "looksLike: \"entity\" for any picture of a thing (a person, astronaut, robot, animal, creature, car, bike, rover, even a spaceship or rocket), even a rough one: it becomes this player's explorer as drawn. \"controller\" ONLY if the drawing is a game-controller layout instead: joystick circles, D-pads, arrows, or boxes and circles labelled with action words (FIRE, BOOST, DIG, DRILL...), with no vehicle or creature drawn. \"nothing\" if it is blank.";
  // Mischief parts (v1.3, PLAN.md "Mischief"), the same on ships and explorers.
  const mischief = `a zigzag lightning bolt → emp (part "lightning bolt"); a magnet (a U or horseshoe shape, often with lines coming off its tips) → tractor (part "magnet"); spikes along the back, or bombs hanging behind or under it → mine (part "spikes" or "bombs"); an octopus, a squid or an ink bottle → inkbomb (part "octopus", "squid" or "ink bottle"); a second, smaller copy of the ${kind === "ship" ? "ship" : "explorer"} drawn next to it → decoy (part "mini copy")`;
  const hints = kind === "ship"
    ? `How parts look: wavy tongues of fire behind the ship or under a rocket = exhaust flames → boost; a tube, barrel or laser = cannon → shoot; struts with feet under the ship = landing legs → land; a parachute → land; a big circle or bubble around the whole ship = shield → shield; a small circle or bulb with straight rays fanning out = lamp → flare; a stick with a dish or ball = antenna → scan; a big eye → scan; a plus sign or cross = red cross → heal; a ball with a fuse = bomb → blast; a swirl or portal → teleport; a cape or a ghost sheet → invisible; ${mischief}. A drill or saw on a ship counts as a weapon: shoot (there is no drill in space). Windows, a cockpit, fins and wings unlock nothing.`
    : `How parts look: a shovel, spade or big claws on the feet or hands → dig; a drill: any hand-held tool or front part ending in a cone or point with ridges, zigzag or spiral lines, even with a gun-like grip → drill; a saw or a pickaxe → drill; a gun or blaster with a straight barrel → shoot; a jetpack or exhaust with flames → boost; springs or big boots → jump; a torch or lamp with rays → flare; a shield → shield; an antenna, a radar dish or a big eye → scan; a red cross → heal; a ball with a fuse → blast; a swirl, a portal or a magic wand → teleport; a cape or a ghost sheet → invisible; ${mischief}. The eyes of a face and a helmet visor unlock nothing; wheels and legs are how it moves (no skill).`;
  const type = kind === "ship"
    ? "You read a hand-drawn SPACESHIP for a party game. type is always \"ship\"."
    : [
      "You read a hand-drawn EXPLORER for a party game: what this player walks or drives around a planet with. type is how it moves:",
      "- \"person\": a person, astronaut, robot, alien, stick figure or anything standing on two legs.",
      "- \"quadruped\": any animal on four legs (dog, cat, horse, cow, dinosaur, lion...).",
      "- \"bike\": a bicycle, motorbike or scooter, with or without a rider.",
      "- \"car\": a car, truck, rover, buggy, tank, train or any other vehicle on wheels or tracks.",
      "- \"blob\": everything else: blobs, slimes, snakes, worms, birds, fish, ghosts, balls, a spaceship or rocket without wheels.",
    ].join("\n");
  return [
    type,
    input,
    looks,
    "parts: every distinct part that was deliberately drawn on it, each with the centre of the part as x, y fractions of the image (origin top left). At most 12. Name each part in plain words a player would use, lowercase, one to three words: \"cannon\", \"exhaust flames\", \"landing legs\", \"shovel\", \"drill\", \"lightning bolt\", \"wheels\".",
    `Skills are unlocked ONLY by drawn parts. A plain body unlocks nothing (it can still ${kind === "ship" ? "fly" : "move"}). Part → skill: ${table}.`,
    hints,
    "Be generous: when a part is unclear or only roughly fits, unlock the closest skill. When a part could be either of two things, unlock BOTH skills: a pointed tool that could be a drill or a gun → drill and shoot; rays that could be a lamp's light or flames → flare and boost. Never unlock a skill with no part on the drawing that could mean it. A word written on or next to a part names it (FIRE next to a tube → cannon → shoot).",
    "verbs: the unlocked skills. unlocked: one entry per unlocked skill, with the name of the part that unlocks it, exactly as in parts.",
  ].join("\n");
}

// The model is pinned (owner): gpt-6.1-sol, or a dated gpt-6.1-sol snapshot from OPENAI_MODEL; anything else is ignored.
let modelWarned = false;
function modelId() {
  const m = process.env.OPENAI_MODEL;
  if (!m || /^gpt-6\.1-sol(-[\w.-]+)?$/.test(m)) return m || DEFAULT_MODEL;
  if (!modelWarned) { modelWarned = true; console.log(`astra: OPENAI_MODEL=${String(m).slice(0, 40)} ignored; the model is pinned to ${DEFAULT_MODEL}`); }
  return DEFAULT_MODEL;
}

function buildRequest(kind, image, region, source, useTier = true, opts = {}) {
  const req = {
    model: modelId(),
    input: [{ role: "user", content: [
      { type: "input_text", text: ENTITY_KINDS[kind] ? entityPrompt(kind, source) : promptFor(kind, source, region, opts) },
      { type: "input_image", image_url: image, detail: "low" },
    ] }],
    text: { format: { type: "json_schema", name: ENTITY_KINDS[kind] ? "entity" : "layout", schema: SCHEMAS[kind], strict: true } },
    max_output_tokens: opts.maxTokens || MAX_OUTPUT_TOKENS[kind],
    store: false,
  };
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  if (useTier && !defaultTierOnly() && tier && tier !== "none") req.service_tier = tier;
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

// The usual verbs for drawn buttons nobody could read, in drawing order (inkRegions fallback).
const REGION_VERBS = ["shoot", "boost", "land", "dig", "drill", "shield", "scan", "flare", "jump", "blast", "heal", "invisible", "teleport", "takeoff"];

// inkRegions from the phone → a layout that follows the drawing, or null (none usable).
function regionsLayout(regions) {
  if (!Array.isArray(regions)) return null;
  const list = regions.slice(0, 40).filter((r) => r && typeof r === "object").map((r) => {
    const x = clamp01(r.x), y = clamp01(r.y);
    return { x: round3(x), y: round3(y), w: round3(Math.min(clamp01(r.w), 1 - x)), h: round3(Math.min(clamp01(r.h), 1 - y)), round: r.round === true };
  }).filter((r) => r.w >= 0.03 && r.h >= 0.03);
  const out = [];
  let verb = 0;
  const sticks = new Set();
  for (const r of list) {
    if (out.length >= MAX_BUTTONS) break;
    const stick = r.round ? (r.x + r.w / 2 < 0.5 ? "steer" : "move") : null;
    if (stick && !sticks.has(stick)) {
      sticks.add(stick);
      out.push({ type: "stick", action: stick, label: "", x: r.x, y: r.y, w: r.w, h: r.h });
    } else if (verb < REGION_VERBS.length) {
      out.push({ type: "button", action: REGION_VERBS[verb], label: REGION_VERBS[verb].toUpperCase(), x: r.x, y: r.y, w: r.w, h: r.h });
      verb++;
    }
  }
  try { return out.length ? finishLayout(out, "regions") : null; } catch { return null; }
}

// ASTRA_MOCK=1 buttons: the verb the game asked for (`expect`), else the first skill of the player's world (`where`,
// space when unknown) that is not on the pad yet. Never LAND on the planet, never DIG / DRILL in space.
const MOCK_BUTTONS = { space: ["land", "shoot", "boost"], planet: ["dig", "drill", "shoot"] };
function mockButtonAction(extra = {}) {
  if (extra.expect && ACTIONS.includes(extra.expect) && !Verbs.STICKS.includes(extra.expect)) return extra.expect;
  const list = MOCK_BUTTONS[extra.where === "planet" ? "planet" : "space"];
  const on = new Set((Array.isArray(extra.pad) ? extra.pad : []).map((c) => c && c.action));
  return list.find((v) => !on.has(v)) || list[0];
}

// How the game writes a skill on a button nobody labelled: "INK BOMB", not "INKBOMB".
const labelWord = (action) => (typeof Verbs.labelOf === "function" ? Verbs.labelOf(action) : String(action).toUpperCase());

function mockLayout(kind, hash, region, extra = {}) {
  const j = (i) => (parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255) * 0.06; // deterministic jitter, 0..0.06
  if (kind === "button") {
    const action = mockButtonAction(extra);
    return finishLayout([{ type: "button", action, label: labelWord(action), ...region }], "model");
  }
  const fromInk = regionsLayout(extra.inkRegions);
  if (fromInk) return fromInk;
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
    // Only an error that names the tier is a tier problem (a bad image or schema is not), and it is remembered only
    // once the default tier has answered the same request.
    const tier = req.service_tier;
    const tierProblem = res.status >= 400 && res.status < 500 && tier && /service[_ ]?tier|ultrafast|\btier\b/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    req = buildRequest(kind, image, region, source, false, opts);
    res = await post(req, key, signal);
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    if (!defaultTierOnly()) console.log(`astra: service tier ${tier} rejected (HTTP 4xx); using the default tier for the next ${TIER_MEMORY_MS / 60000} min`);
    defaultTierUntil = Date.now() + TIER_MEMORY_MS;
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
    // A rate limit, a server error or a dropped connection: one quick retry while time is left (v1.0 review: 25
    // phones generating at once in the lobby got no second chance).
    const transient = /^OpenAI HTTP (429|5\d\d)$/.test(err.message) || err.name === "TypeError" || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(err.message);
    if (transient && timeLeft()) {
      console.log(`astra ${kind}: ${err.message} after ${Date.now() - t0} ms, retrying once`);
      await sleep(250, signal);
      answer = await ask(kind, image, region, source, signal, { expect, pad });
    } else {
      if (!/^incomplete: max_output_tokens/.test(err.message) || !timeLeft()) throw err;
      console.log(`astra ${kind}: ${err.message} after ${Date.now() - t0} ms, retrying with ${RETRY_OUTPUT_TOKENS} tokens`);
      answer = await ask(kind, image, region, source, signal, { expect, pad, maxTokens: RETRY_OUTPUT_TOKENS });
    }
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
  const gen = roundGen;
  const controller = new AbortController();
  const entry = { controller, owners: new Set(), timedOut: false, superseded: false, done: false };
  const timer = setTimeout(() => ((entry.timedOut = true), controller.abort()), timeoutMs);
  const t0 = Date.now();
  entry.promise = (async () => {
    try {
      const reading = process.env.ASTRA_MOCK === "1"
        ? (await sleep(ENTITY_KINDS[kind] ? 0 : MOCK_MS, controller.signal), { value: ENTITY_KINDS[kind] ? devKitEntity(kind) : mockLayout(kind, hash, region, extra), looksLike: null, thing: null, wrong: false })
        : await callModel(kind, image, region, source, controller.signal, extra);
      if (gen === roundGen) cache.set(hash, reading); // v1.5: never fill this round's cache with an earlier round's reading
      return { ok: true, reading, ms: Date.now() - t0, outcome: outcomeOf(reading) };
    } catch (err) {
      const ms = Date.now() - t0;
      const noKey = /^no OPENAI_API_KEY/.test(String(err && err.message));
      // An entity always comes back. Without a key (development) the dev kit keeps the game playable; a timeout or a
      // failed call (v1.5, QA M1) gets the plain entity: nothing read means nothing unlocked, and it is not charged.
      if (ENTITY_KINDS[kind] && !entry.superseded) {
        const why = entry.timedOut ? "timeout" : `error: ${err && err.message}`;
        if (noKey) return { ok: true, reading: { value: devKitEntity(kind), looksLike: null, thing: null, wrong: false }, ms, outcome: `${why} → dev kit` };
        return { ok: true, reading: { value: plainEntity(kind), looksLike: null, thing: null, wrong: false, failed: entry.timedOut ? "timeout" : "error" }, ms, outcome: `${why} → plain entity, free` };
      }
      if (err && err.final && !entry.superseded) return { ok: false, error: err.message, looksLike: err.looksLike, ms, outcome: `error: ${err.message}` };
      // No answer in time (or no key): the drawing's own ink regions, the button the game asked for, else nothing
      // (a fallback layout the player never drew would be charged and sit under the wrong ink).
      if ((entry.timedOut || noKey) && !entry.superseded) {
        const why = entry.timedOut ? "timeout" : "no key";
        const fromInk = kind === "controller" ? regionsLayout(extra.inkRegions) : null;
        if (fromInk) return { ok: true, reading: { value: fromInk, looksLike: null, thing: null, wrong: false }, ms, outcome: `${why} → ink regions` };
        if (kind === "button" && extra.expect && !Verbs.STICKS.includes(extra.expect)) {
          try { return { ok: true, reading: { value: finishLayout([{ type: "button", action: extra.expect, label: labelWord(extra.expect), ...region }], "model"), looksLike: null, thing: null, wrong: false }, ms, outcome: `${why} → expected ${extra.expect}` }; } catch {}
        }
        return { ok: false, error: entry.timedOut ? "timeout" : "generation unavailable", ms, outcome: why };
      }
      if (entry.superseded) return { ok: false, error: "superseded", ms, outcome: "superseded" };
      return { ok: false, error: String(err && err.message || err), looksLike: err && err.looksLike, ms, outcome: `error: ${err && err.message}` };
    } finally {
      clearTimeout(timer);
      entry.done = true;
      if (inflight.get(hash) === entry) inflight.delete(hash);
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
    if (skills.includes(v) && !unlocked.some((x) => x.verb === v)) unlocked.push({ verb: v, part: partFor(v, parts) });
  }
  return finishEntity(type, unlocked, parts, "model");
}

// A skill the model listed only in `verbs`: the drawn part whose name matches what unlocks it ("shovel" for dig),
// else "drawing" (the card then shows the skill alone, never a wrong part like "dig (wheels)").
const words = (text) => String(text || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2).map((w) => w.replace(/(es|s)$/, ""));
function partFor(verb, parts) {
  const v = Verbs.VERBS[verb] || {};
  const want = new Set(words(`${Verbs.PARTS[verb] || ""} ${v.hint || ""} ${(v.grantedBy || []).join(" ")}`));
  const hit = parts.find((p) => words(p.name).some((w) => want.has(w)));
  return hit ? hit.name : "drawing";
}

function finishEntity(type, unlocked, parts, source) {
  const verbs = Verbs.entityVerbs(type, unlocked.map((u) => u.verb));
  const kept = unlocked.filter((u) => verbs.includes(u.verb));
  return { type, rig: Verbs.RIG_OF[type] || "blob", verbs, unlocked: kept, parts, source, card: cardFor(type, kept) };
}

// entity.card (v1.3, PLAN.md section 0): the unlock card in plain words, "Your ship can: fly, shoot (cannon)", the same
// text the phone and the TV show (Verbs.cardOf). "" only if verbs.js has no cardOf yet.
function cardFor(type, unlocked) {
  try { return typeof Verbs.cardOf === "function" ? String(Verbs.cardOf(type, unlocked) || "") : ""; } catch { return ""; }
}

// What the phone gets for an entity: a copy with its card and animations. Never throws: a broken anims table costs the
// anims (world.js wires them again on the next mode switch), never the entity.
function entityAnswer(kind, value) {
  let entity;
  try { entity = structuredClone(value); } catch { entity = devKitEntity(kind); }
  if (typeof entity.card !== "string" || !entity.card) entity.card = cardFor(entity.type, entity.unlocked);
  let anims = {};
  try { anims = wireAnimations(entity.rig, entity.verbs) || {}; } catch (err) { console.log(`astra ${kind}: no anims (${err.message})`); }
  return { ...entity, anims };
}

// The generous development kit: every gate skill (ASTRA_MOCK=1 or no key: development only).
function devKitEntity(kind) {
  const { type, world } = ENTITY_KINDS[kind];
  const unlocked = Verbs.DEV_KIT[world].map((u) => ({ ...u }));
  return finishEntity(type, unlocked, unlocked.map((u, i) => ({ name: u.part, x: round3(0.2 + 0.1 * i), y: 0.5 })), "devkit");
}
// v1.5 (QA M1): the entity when the drawing could not be read (a timeout, a failed call): only what its type does by
// itself (a plain ship flies, a person walks and jumps), source "fallback". A slow answer is never a gameplay advantage.
function plainEntity(kind) {
  return finishEntity(ENTITY_KINDS[kind].type, [], [], "fallback");
}
// Development (no network answers at all): ASTRA_MOCK=1 or no key. Only then does a failure get the dev kit.
const devMode = () => process.env.ASTRA_MOCK === "1" || !apiKey();

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

// ---- Ship spec (v1.4) -----------------------------------------------------------------------------------------------
// A ship drawing gets a second vision call in parallel with the entity call (it never slows the unlock card): the ship as
// parts (astra-ship.js: hull, cockpit, wings, fins, engines, weapons, extras, colours), which ship3d.js builds on every
// screen. Cached by image like the readings. A ship answer waits at most SPEC_GRACE_MS for it after the entity reading
// (a speculative call usually has it ready by DONE); still running, the answer goes out without one and the model's spec
// follows through the onShipSpec listeners (server.js sends the entity again; a failed call sends one made from the
// entity's own parts, source "entity"). ASTRA_MOCK=1 / no key / a failure: the entity's parts at once.
//   entity.spec = astra-ship.js spec + source: "model" | "entity"   (ship entities)
//   entity.spec = astra-body.js spec + source: "model" | "entity"   (explorer entities: person, quadruped, car, bike, blob)
// The same machinery runs for both kinds (specLibFor(kind)); the cache key carries the kind. onShipSpec listeners get
// { player, kind: "ship" | "explorer", image, spec }.
const specCache = new Map(); // image hash → { spec (normalized, not yet reconciled), ms }
const specInflight = new Map(); // image hash → { p: Promise<{ spec, ms } | null>, ctrl, owners: Set<token>, wanted, done }
const specListeners = new Set();
function onShipSpec(fn) {
  if (typeof fn === "function") specListeners.add(fn);
  return () => specListeners.delete(fn);
}
function specRequest(image, source, useTier, kind = "ship") {
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  const effort = process.env.OPENAI_REASONING_EFFORT ?? DEFAULT_EFFORT;
  return specLibFor(kind).request(image, { source, model: modelId(), tier: useTier && !defaultTierOnly() && tier ? tier : "none", effort: effort || "none", maxTokens: SPEC_OUTPUT_TOKENS });
}
// One spec request (the same tier fallback as askOnce).
async function askSpecOnce(image, source, signal, kind = "ship") {
  const key = apiKey();
  if (!key) throw new Error("no OPENAI_API_KEY");
  let req = specRequest(image, source, true, kind);
  let res = await post(req, key, signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const tierProblem = res.status >= 400 && res.status < 500 && req.service_tier && /service[_ ]?tier|ultrafast|\btier\b/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    req = specRequest(image, source, false, kind);
    res = await post(req, key, signal);
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("bad response: not JSON");
  });
  return parseJson(extractText(data));
}
// The model's spec of a ship (or, kind "explorer", body) drawing → Promise<{ spec, ms } | null> (null: mock, no key, no
// astra-ship.js / astra-body.js, a failure). owner: the request waiting for it; a spec call nobody waits for any more (every
// owner superseded: the player kept drawing) is aborted, unless a finished answer already counts on it (the late listeners).
const specHash = (image, kind) => sha1(`${genKey()}${kind === "explorer" ? "bodyspec" : "shipspec"}${image}`);
function shipSpec(image, source, owner = null, kind = "ship") {
  const Lib = specLibFor(kind);
  if (!Lib || process.env.ASTRA_MOCK === "1" || !apiKey()) return Promise.resolve(null);
  const hash = specHash(image, kind);
  if (specCache.has(hash)) return Promise.resolve(specCache.get(hash));
  const running = specInflight.get(hash);
  if (running) {
    if (owner) running.owners.add(owner);
    return running.p;
  }
  const gen = roundGen;
  const entry = { p: null, ctrl: null, owners: new Set(owner ? [owner] : []), wanted: false, done: false };
  const ctrl = (entry.ctrl = new AbortController());
  const timer = setTimeout(() => ctrl.abort(), SPEC_TIMEOUT_MS);
  const t0 = Date.now();
  const p = hedged((signal) => askSpecOnce(image, source, signal, kind), ctrl.signal, SPEC_HEDGE_MS)
    .then((raw) => {
      const got = { spec: Lib.normalize(raw, { seed: Lib.seedOf(hash) }), ms: Date.now() - t0 };
      if (gen === roundGen) specCache.set(hash, got); // v1.5: this round's only
      if (specCache.size > MAX_SPECS) specCache.delete(specCache.keys().next().value);
      const sp = got.spec;
      if (kind === "ship") console.log(`astra ship-spec model=${got.ms}ms ok ${sp.hull.shape} wings=${sp.wings.count} engines=${sp.engines.count}${sp.engines.flame ? "+flame" : ""} weapons=${sp.weapons.length} extras=${sp.extras.length}${sp.palette.colored ? " coloured" : ""}`);
      else console.log(`astra body-spec model=${got.ms}ms ok ${sp.type} head=${sp.head.shape}/${sp.head.gear} items=${sp.items.map((x) => x.kind).join(",") || "-"}${sp.palette.colored ? " coloured" : ""}`);
      return got;
    }, (err) => {
      console.log(`astra ${kind === "ship" ? "ship" : "body"}-spec failed after ${Date.now() - t0} ms (${err && err.message})`);
      return null;
    })
    .finally(() => {
      clearTimeout(timer);
      entry.done = true;
      if (specInflight.get(hash) === entry) specInflight.delete(hash);
    });
  entry.p = p;
  specInflight.set(hash, entry);
  return p;
}
// A request lets go of its drawing's spec call: kept (wanted) when it got an entity, aborted when it was superseded or
// refused and nobody else waits for it ("Use it anyway" then starts a fresh one).
function releaseSpec(image, owner, superseded, kind = "ship") {
  const entry = specInflight.get(specHash(image, kind));
  if (!entry || !owner) return;
  entry.owners.delete(owner);
  if (!superseded) entry.wanted = true;
  else if (!entry.owners.size && !entry.wanted && !entry.done) entry.ctrl.abort();
}
// The spec that rides on an entity: the model's, reconciled with what the reading unlocked (every unlocked skill shows as a
// part; a body spec also takes the reading's type), else one built from the entity's own parts. null when the lib is missing.
function specFor(entity, got, seedText) {
  const Lib = entity && (entity.type === "ship" ? shipSpecLib() : bodySpecLib());
  if (!Lib || !entity) return null;
  try {
    const spec = got && got.spec ? Lib.reconcile(got.spec, entity) : Lib.fromEntity(entity, seedText);
    spec.source = got && got.spec ? "model" : "entity";
    return spec;
  } catch (err) {
    console.log(`astra ${entity.type === "ship" ? "ship" : "body"}-spec: ${err.message}`);
    return null;
  }
}
// Waits for the spec at most SPEC_GRACE_MS → { got, late } (late: still running; got null then).
function specWithin(specP) {
  let timer = null;
  const grace = new Promise((resolve) => (timer = setTimeout(() => resolve({ got: null, late: true }), SPEC_GRACE_MS)));
  return Promise.race([specP.then((got) => ({ got, late: false })), grace]).finally(() => clearTimeout(timer));
}

// A finished ship / explorer always comes back (owner, v1.3: "make sure the entity creation works"): the only entity
// answers with ok: false are the wrong-kind refusals ("looks like a controller", "nothing to read"), "superseded" (a
// newer call from the same player) and a malformed request. An exception anywhere → the plain entity, free (v1.5, QA
// M1; the dev kit in development).
async function generate(body, opts = {}) {
  try {
    return await generateOnce(body, opts);
  } catch (err) {
    const kind = body && body.kind;
    if (!ENTITY_KINDS[kind]) throw err;
    const dev = devMode();
    console.log(`astra ${kind} ${Contract.cleanName(body.player) || "-"} failed (${err && err.message}) → ${dev ? "dev kit" : "plain entity, free"}`);
    if (dev) return { ok: true, entity: entityAnswer(kind, devKitEntity(kind)) };
    return { ok: true, entity: entityAnswer(kind, plainEntity(kind)), fallback: true, free: true, failed: "error" };
  }
}

async function generateOnce(body, opts = {}) {
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
  const inkRegions = kind === "controller" && Array.isArray(body.inkRegions) ? body.inkRegions.slice(0, 40) : null;
  // where (v1.3, from server.js): the player's world now, "space" | "planet"; the mock button answers a skill of it.
  const where = kind === "button" && (body.where === "space" || body.where === "planet") ? body.where : null;
  const hash = sha1(genKey() + kind + image + (region ? JSON.stringify(region) : "") + (expect ? `expect:${expect}` : "") + (pad.length ? `pad:${pad.map((c) => c.action).join(",")}` : "") + (where ? `where:${where}` : ""));
  const slotKey = `${player}:${kind}`;
  const gen = roundGen; // v1.5: a new round while this call runs: no late spec and no saved copy for it

  // The newest request for this player and kind wins; the older one resolves "superseded".
  const token = { slotKey };
  token.superseded = new Promise((resolve) => (token.supersede = resolve));
  const previous = slots.get(slotKey);
  slots.set(slotKey, token);

  // v1.4: a ship drawing's spec call starts now, next to the entity call (cached by image: a speculative call's spec is
  // ready by the time the player taps DONE).
  // v1.4: an explorer drawing's body spec too (astra-body.js), the same way.
  const specP = (kind === "ship" || kind === "explorer") && specLibFor(kind) ? shipSpec(image, source, token, kind) : null;
  const cached = cache.get(hash);
  let entry = null;
  let hit = "hit";
  if (!cached) {
    entry = inflight.get(hash);
    hit = entry ? "joined" : "miss";
    if (!entry) entry = startEntry(hash, kind, image, region, source, { expect, pad, inkRegions, where });
    entry.owners.add(token);
    token.entry = entry;
  }
  if (previous) release(previous);
  // opts.signal (server.js: the phone closed its request): this request lets go of the model call, which is aborted when
  // nobody else waits for it. A call that finishes anyway is still cached (tapping DONE again answers at once).
  const signal = opts && opts.signal;
  if (signal && typeof signal.addEventListener === "function") {
    if (signal.aborted) release(token);
    else signal.addEventListener("abort", () => release(token), { once: true });
  }

  const result = cached
    ? { ok: true, reading: cached, ms: 0, outcome: outcomeOf(cached) }
    : await Promise.race([entry.promise, token.superseded]);
  if (slots.get(slotKey) === token) slots.delete(slotKey);
  if (entry) entry.owners.delete(token);

  const answer = answerOf(kind, result, body.anyway === true, { region, expect });
  if (specP) releaseSpec(image, token, !answer.ok, kind); // superseded or refused: its spec call stops unless someone else waits
  if (specP && answer.ok && answer.entity) {
    const seedText = sha1(image);
    const { got, late } = await specWithin(specP);
    // In time (or no model spec possible: mock, no key, a failure): the spec rides on this answer. Still running: none now
    // (every screen shows the drawing inflated for that second), and the listeners (server.js) send the entity again
    // with the model's spec, or with one from the entity's parts if that call fails.
    if (!late) answer.entity.spec = specFor(answer.entity, got, seedText);
    if (!answer.entity.spec) delete answer.entity.spec;
    if (late && !body.speculative && specListeners.size) {
      const entity = answer.entity;
      specP.then((g) => {
        if (gen !== roundGen) return; // v1.5: that round is over, so is its drawing
        const spec = specFor(entity, g, seedText);
        if (!spec) return;
        for (const fn of specListeners) {
          try { fn({ player, kind, image, spec }); } catch (err) { console.log(`astra ${kind === "ship" ? "ship" : "body"}-spec listener: ${err.message}`); }
        }
      });
    }
  }
  if (answer.ok && answer.layout && !body.speculative) rememberPad(player, kind, answer.layout);
  log(kind, player, hit, result.ms, answer.ok || !result.ok ? result.outcome : `${result.outcome} → refused (${answer.error})`, body.speculative);
  // A speculative ship / explorer is not kept (the drawing on disk is the finished one; controllers keep theirs).
  // A refused ship / explorer is not kept either: the drawing on disk stays the last accepted one.
  // v1.5: nor is one that could not be read (answer.fallback).
  if (gen === roundGen && result.error !== "superseded" && !(ENTITY_KINDS[kind] && (body.speculative || !answer.ok || answer.fallback))) save(player, kind, image, answer);
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
  // A picture in the controller or button step always names its thing (the phone words it: "That looks like your
  // ship"); "object" when the model gave none.
  const thing = reading.thing || (!ENTITY_KINDS[kind] && reading.looksLike === "entity" ? "object" : null);
  if (reading.wrong && !anyway) return { ok: false, error: wrongKindError(kind, reading), ...looks, ...(thing ? { thing } : {}) };
  let value = reading.value;
  if (!value && kind === "controller") value = defaultLayout();
  if (!value && kind === "button" && expect) {
    try { value = finishLayout([{ type: "button", action: expect, label: "", ...region }], "model"); } catch {}
  }
  // v1.5 (QA M1): an entity nobody could read unlocks nothing (the plain entity) and costs nothing (free: true).
  let failed = ENTITY_KINDS[kind] && reading.failed ? reading.failed : null;
  if (!value && ENTITY_KINDS[kind]) { value = devMode() ? devKitEntity(kind) : plainEntity(kind); if (value.source === "fallback") failed = failed || "error"; }
  if (!value) return { ok: false, error: "unreadable button", ...looks };
  if (ENTITY_KINDS[kind]) return { ok: true, entity: entityAnswer(kind, value), ...looks, ...(failed ? { fallback: true, free: true, failed } : {}) };
  return { ok: true, layout: structuredClone(value), ...looks };
}

const outcomeOf = (r) => {
  const v = r.value;
  const what = !v ? "nothing usable" : v.buttons ? `ok ${v.buttons.length} control(s)` : `ok ${v.type} [${v.verbs.join(" ")}] (${v.source})`;
  return r.looksLike ? `${what} looksLike=${r.looksLike}${r.thing ? `/${r.thing}` : ""}` : what;
};

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
  const Anims = animsLib();
  if (!Anims || typeof Anims.get !== "function") return undefined; // world.js caches truthy tables only: retried later
  const row = Anims.get(type) || {};
  const verbSet = new Set();
  const slots = new Set(Array.isArray(Anims.ALWAYS) ? Anims.ALWAYS : []);
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

// v1.5 (owner, 10 Oct 11:31: every round starts from scratch). server.js calls it at each new lobby with every player's
// name: the round generation moves on (every cache key carries it), each waiting call answers "superseded" and its model
// call stops, every reading, spec and pad is forgotten, and the saved copies of those players' drawings
// (controllers/<player>-<kind>.png / .json) are deleted. Nothing of an earlier round can answer a drawing sent now.
const SAVED_KINDS = ["controller", "button", "ship", "explorer"];
function newRound({ players = [] } = {}) {
  roundGen++;
  for (const token of [...slots.values()]) { try { release(token); } catch {} }
  slots.clear();
  for (const entry of inflight.values()) { entry.superseded = true; try { entry.controller.abort(); } catch {} }
  inflight.clear();
  cache.clear();
  pads.clear();
  for (const entry of specInflight.values()) { try { entry.ctrl.abort(); } catch {} }
  specInflight.clear();
  specCache.clear();
  const dir = outDir;
  for (const name of Array.isArray(players) ? players : []) {
    const player = Contract.cleanName(name);
    if (!player) continue;
    for (const kind of SAVED_KINDS) for (const ext of ["png", "json"]) fs.promises.unlink(path.join(dir, `${player}-${kind}.${ext}`)).catch(() => {});
  }
  return roundGen;
}

const _internals = {
  setFetch: (fn) => (fetchImpl = fn),
  setDir: (dir) => (outDir = dir),
  setTimeoutMs: (ms) => (timeoutMs = ms),
  reset: () => {
    roundGen = 0;
    cache.clear();
    inflight.clear();
    slots.clear();
    pads.clear();
    specCache.clear();
    specInflight.clear();
    defaultTierUntil = 0;
    timeoutMs = TIMEOUT_MS;
  },
  state: () => ({ cache: cache.size, inflight: inflight.size, slots: slots.size, pads: pads.size, defaultTierOnly: defaultTierOnly() }),
  padOf: (player) => (pads.get(Contract.cleanName(player)) || []).map((c) => ({ ...c })),
  TIMEOUT_MS, MOCK_MS, HEDGE_MS, SCHEMAS, ACTIONS, ENTITY_KINDS, MAX_OUTPUT_TOKENS, LOOKS, THINGS, entityFromModel, devKitEntity, plainEntity,
  entityPrompt, buildRequest, promptFor, extractText, parseJson, cleanControl, layoutFromModel, readAnswer, mockLayout,
  cleanRegion, sha1, wrongKindError, hedged, regionsLayout, modelId, REGION_VERBS,
  entityAnswer, cardFor, mockButtonAction, MOCK_BUTTONS,
  shipSpec, specFor, specRequest, releaseSpec, SPEC_GRACE_MS, SPEC_TIMEOUT_MS,
};

module.exports = { generate, defaultLayout, wireAnimations, onShipSpec, newRound, _internals };
