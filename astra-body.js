// astra-body.js: the drawn PLANET entity as a 3D body plan, the "body spec" (v1.4, owner 10:12: "We're doing the character
// 3d modelling as well?"). One vision call reads the drawing (person, quadruped, car, bike or blob) and answers strict JSON:
// the type, the view it was drawn from, the head (shape, size, helmet, visor or eyes), torso, arms, legs (or four legs and a
// tail, or a vehicle body with wheels), the tools and attachments that were drawn (shovel, drill, blaster, lamp, backpack,
// saddle, ...) and where they sit, each coloured with the colours actually used in the drawing. entity3d.js builds the chunky
// rigged 3D model from it on every screen. Shared by the server (CommonJS) and the dev harnesses; the same shape as
// astra-ship.js (ships).
//
//   request(image, { source, model, tier, effort, maxTokens, detail }) → the Responses API body (no key in it)
//   normalize(raw, { seed }) → spec | throws          // every field checked, clamped, defaulted; deterministic
//   reconcile(spec, entity) → spec                    // the type follows the entity reading; the parts the reading unlocked
//                                                     // are visible on the body (a shovel for dig, a drill for drill, ...)
//   fromEntity(entity, seed) → spec                   // no model answer (mock, dev kit, bots, a failed call): a plausible
//                                                     // body from the entity's own type and parts
//   verbOfItem(kind) → verb | null                    // which skill an item stands for (the entity table's words)
//
// Proportions are fractions, measured on the drawing (the builder caricatures them into chunky, Fortnite-like limits):
//   person:    head.size = head height / total height; torso.width = shoulder width / total height;
//              arms.length, legs.length = arm and leg length / total height
//   quadruped: head.size = head length / body length; legs.length = leg length / body length; neck = neck length / body length
//   car, bike: vehicle.height = height / length (without wheels); vehicle.wheelSize = wheel diameter / length
// Colours are "#rrggbb" or "" (none drawn: the player's colour is used).
//
// spec (version 1):
//   { v: 1, type: "person"|"quadruped"|"car"|"bike"|"blob", view, facing, style, seed,
//     head:  { shape, size, gear, face, eyes, snout, color, gearColor, faceColor },
//     torso: { shape, width, color, belt, emblem },
//     arms:  { count: 0|2, length, thickness, hands, color },
//     legs:  { count: 0|2|4, length, thickness, feet, color },
//     neck, tail: { kind, color },
//     vehicle: { body, height, cabin, wheels, wheelSize, color, rider },
//     items: [{ kind, where, size, color, verb }],                                   // ≤ 6
//     palette: { colored, main, second, accent, skin } }
"use strict";

const SPEC_VERSION = 1;
const TYPES = ["person", "quadruped", "car", "bike", "blob"];
const VIEWS = ["front", "side", "back", "angled", "top"];
const FACINGS = ["viewer", "left", "right"];
const STYLES = ["cute", "chunky", "sleek", "menacing", "robot", "retro"];
const HEAD_SHAPES = ["round", "square", "oval", "none"];
const GEARS = ["none", "astronaut helmet", "helmet", "cap", "hat", "hair", "crown", "antenna", "horns", "ears", "mohawk"];
const FACES = ["visor", "eyes", "goggles", "mask", "none"];
const TORSOS = ["box", "round", "tall", "slim", "barrel"];
const THICK = ["thin", "normal", "thick"];
const HANDS = ["mitten", "claw", "robot", "none"];
const FEET = ["boots", "shoes", "paws", "hooves", "claws", "wheels", "none"];
const TAILS = ["none", "short", "long", "bushy", "curly"];
const VEHICLES = ["none", "sedan", "truck", "buggy", "van", "tank", "monster truck", "race car", "rover", "bicycle", "motorbike", "scooter"];
const CABINS = ["none", "open", "closed", "bubble"];
const ITEMS = ["shovel", "drill", "pickaxe", "saw", "blaster", "cannon", "lamp", "torch", "shield", "sword", "wand", "magnet",
  "antenna", "dish", "backpack", "jetpack", "cape", "cross", "bomb", "spikes", "lightning", "octopus", "ink bottle", "saddle",
  "wings", "flag", "claws", "springs", "eye", "star", "flames", "other"];
const WHERES = ["right hand", "left hand", "both hands", "back", "head", "chest", "front", "roof", "top", "side", "feet", "tail"];
const MAX_ITEMS = 6;

// Which skill an item stands for: the same words as the entity reading (verbs.js PARTS, astra.js entityPrompt).
const ITEM_VERB = { shovel: "dig", claws: "dig", drill: "drill", pickaxe: "drill", saw: "drill", blaster: "shoot", cannon: "shoot",
  sword: null, lamp: "flare", torch: "flare", shield: "shield", wand: "teleport", magnet: "tractor", antenna: "scan", dish: "scan",
  eye: "scan", jetpack: "boost", cape: "invisible", cross: "heal", bomb: "blast", spikes: "mine", lightning: "emp", octopus: "inkbomb",
  "ink bottle": "inkbomb", springs: "jump", flames: "boost" };
const verbOfItem = (kind) => ITEM_VERB[kind] || null;

// ---- The model call ------------------------------------------------------------------------------------------------

const num = { type: "number" };
const int = { type: "integer" };
const str = { type: "string" };
const bool = { type: "boolean" };
const enumOf = (list) => ({ type: "string", enum: list });
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  type: enumOf(TYPES),
  view: enumOf(VIEWS),
  facing: enumOf(FACINGS),
  style: enumOf(STYLES),
  head: obj({ shape: enumOf(HEAD_SHAPES), size: num, gear: enumOf(GEARS), face: enumOf(FACES), eyes: int, snout: num, color: str, gearColor: str, faceColor: str }),
  torso: obj({ shape: enumOf(TORSOS), width: num, color: str, belt: bool, emblem: str }),
  arms: obj({ count: int, length: num, thickness: enumOf(THICK), hands: enumOf(HANDS), color: str }),
  legs: obj({ count: int, length: num, thickness: enumOf(THICK), feet: enumOf(FEET), color: str }),
  neck: num,
  tail: obj({ kind: enumOf(TAILS), color: str }),
  vehicle: obj({ body: enumOf(VEHICLES), height: num, cabin: enumOf(CABINS), wheels: int, wheelSize: num, color: str, rider: bool }),
  items: { type: "array", items: obj({ kind: enumOf(ITEMS), where: enumOf(WHERES), size: num, color: str }) },
  palette: obj({ colored: bool, main: str, second: str, accent: str, skin: str }),
});

function prompt(source) {
  const input = source === "draw"
    ? "The image is a finger drawing made on a phone screen."
    : "The image is usually a PHOTO of a paper drawing, cropped to the drawing and possibly turned by 90 degrees. Ignore paper lines, grids, shadows and fingers.";
  return [
    "You turn a hand-drawn EXPLORER (what a player walks or drives around a planet with) into a 3D model for a cartoony party game (Fortnite style: chunky, bright). Read the drawing and describe its body plan. A builder makes the 3D model from your answer, so describe what the PLAYER DREW, as faithfully as you can: proportions, parts and colours.",
    input,
    "type: \"person\" (a person, astronaut, robot, alien or stick figure: anything standing on two legs), \"quadruped\" (any four-legged animal: dog, cat, horse, cow, dinosaur), \"car\" (a car, truck, rover, buggy, tank or any vehicle on wheels or tracks), \"bike\" (a bicycle, motorbike or scooter), \"blob\" (anything else: a blob, slime, snake, worm, ghost, ball).",
    "view: where it was drawn from (\"front\": facing the viewer; \"side\": in profile). facing: \"viewer\" for a front view, else the side its front (face, nose, headlights) points to in the image.",
    "head (person and quadruped; blob: its face): shape round, square (a box head: robots), oval or none. size: for a person the head's height as a fraction of the whole height (a stick figure with a big round head ~0.3, a realistic person ~0.13); for an animal the head's length as a fraction of the body's length (~0.3). gear: what is on the head: \"astronaut helmet\" (a big round head with a visor = an astronaut), helmet, cap, hat, hair, crown, antenna (a stick with a ball on top), horns, ears (pointy or floppy animal ears), mohawk, or none. face: visor (a band or window across the face), eyes (dots or circles), goggles, mask or none. eyes: how many eyes are drawn (0 if none). snout: an animal's nose or muzzle length as a fraction of its head length (a dog ~0.5, a cat ~0.2; 0 for a person). color, gearColor, faceColor: as drawn.",
    "torso: the body. shape: box (square or rectangular), round, tall, slim (a stick body), barrel. width: for a person the shoulder width as a fraction of the whole height (a stick figure ~0.12, a chunky astronaut box body ~0.35). color as drawn. belt: true when a belt or waist line is drawn. emblem: a symbol drawn on the chest or body (\"star\", \"heart\", \"X\", a letter or number, \"lightning\"), else \"\".",
    "arms: count 0 or 2 (a person always has 2 unless none are drawn; animals and vehicles 0). length: arm length as a fraction of the whole height (~0.38). thickness: thin (lines), normal, thick. hands: mitten (round), claw, robot (pincers), none. color.",
    "legs: count 0 (vehicles, blobs without legs), 2 (a person) or 4 (an animal). length: a person's legs as a fraction of the whole height (~0.45, short stubby legs ~0.3); an animal's legs as a fraction of its body length (~0.5). thickness. feet: boots, shoes, paws, hooves, claws (big claws drawn on the feet or paws), wheels, none. color.",
    "neck: an animal's neck length as a fraction of its body length (a dog ~0.15, a horse or giraffe ~0.45); 0 for a person or vehicle. tail: none, short, long, bushy or curly, and its color.",
    "vehicle (car and bike only; else body \"none\"): body sedan, truck, buggy, van, tank, \"monster truck\" (huge wheels, lifted body), \"race car\", rover, bicycle, motorbike, scooter. height: the body's height without the wheels as a fraction of its length (a sedan ~0.35, a bicycle ~0.5). cabin: none, open (seats in the open), closed (a roof with windows), bubble (a glass dome). wheels: the total number of wheels it has (a car seen from the side shows 2 and has 4; a bicycle 2). wheelSize: a wheel's diameter as a fraction of the vehicle's length (a sedan ~0.2, a monster truck ~0.4, a bicycle ~0.4). color. rider: true when a rider or driver is drawn on it.",
    "items: every tool, weapon or attachment deliberately drawn, at most 6, each with where it is: shovel (a handle with a blade or scoop), drill (a cone or point with ridges, zigzag or spiral lines, often with a grip), pickaxe, saw, blaster (a gun with a straight barrel), cannon (a big gun on a vehicle or on the back), lamp (a circle or bulb with straight rays fanning out, or a handle with a round light on top: headlamps, headlights and hand lamps too), torch (a handle with a flame or a light on top), shield, sword, wand (ONLY a thin stick with a star or sparkle on its tip; a handle with a bulb or rays is a lamp), magnet (a U shape), antenna, dish, backpack, jetpack (a backpack with flames), cape, cross (a red or plus-sign cross), bomb, spikes (along the back), lightning (a zigzag bolt), octopus, ink bottle, saddle (a seat on an animal's back), wings, flag, claws (big claws on an animal's paws or a person's hands), springs (under the feet), eye (a big eye), star, flames (fire or exhaust coming out of the back of a vehicle, a jetpack or a rocket: where \"back\"), other. where: \"right hand\" means the hand on the RIGHT side of the IMAGE, \"left hand\" the left side of the image; back, head, chest, front (a vehicle's nose or an animal's mouth), roof, top, side, feet, tail. size: its length as a fraction of the whole height (person) or length (animal, vehicle). color.",
    "palette: colored = true only if the drawing uses colours other than a single dark pen or pencil; main, second, accent = the drawing's colours, most used first; skin = the colour of a drawn face or hands, else \"\". With a single dark pen every colour stays \"\": the game paints the body in the player's colour. Every colour is \"#rrggbb\" or a simple colour name (\"red\", \"teal\").",
    "style: the drawing's mood: cute, chunky, sleek, menacing, robot (a robot or machine-like figure) or retro.",
    "Each drawn thing appears ONCE: a symbol on the chest goes only in torso.emblem (not in items); head gear (antenna, helmet, horns, ears, hair) only in head.gear; pincer or claw hands only in arms.hands; claws on an animal's feet only in legs.feet; a horse's mane is head.gear \"hair\"; straps, stirrups, buckles and handles belong to their item and are not items. Use \"other\" only for a clearly separate object that fits no kind.",
    "Be generous: an unclear blob becomes the closest plausible part. Every explorer has a body; never return an empty one. Do not invent tools, weapons or attachments that are not drawn.",
  ].join("\n");
}

function request(image, { source = "photo", model = "gpt-6.1-sol", tier = "ultrafast", effort = "low", maxTokens = 1800, detail = "low" } = {}) {
  const req = {
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt(source) }, { type: "input_image", image_url: image, detail }] }],
    text: { format: { type: "json_schema", name: "body_spec", schema: SCHEMA, strict: true } },
    max_output_tokens: maxTokens,
    store: false,
  };
  if (tier && tier !== "none") req.service_tier = tier;
  if (effort && effort !== "none") req.reasoning = { effort };
  return req;
}

// ---- Checking the answer -------------------------------------------------------------------------------------------

const clamp = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const pick = (v, list, def) => (list.includes(v) ? v : def);
const o = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
// Colour names the model may answer instead of hex (bright, saturated: the Fortnite look). The same table as astra-ship.js.
const NAMED = { red: "#e63946", crimson: "#d00030", orange: "#ff7b00", amber: "#ffb000", yellow: "#ffd23f", gold: "#f5b700",
  lime: "#9ef01a", green: "#2bb24c", "dark green": "#1b7a3a", teal: "#2a9d8f", turquoise: "#1fc8c0", cyan: "#22d3ee",
  "light blue": "#4cc9f0", "sky blue": "#4cc9f0", blue: "#2563eb", "dark blue": "#1e3a8a", navy: "#1e3a8a", indigo: "#4f46e5",
  purple: "#8338ec", violet: "#8b5cf6", magenta: "#e0218a", pink: "#ff5fa2", "hot pink": "#ff2e93", brown: "#8d5524",
  tan: "#d2a679", beige: "#e9d8a6", white: "#f4f4f6", silver: "#c0c7d1", grey: "#8a919e", gray: "#8a919e", black: "#16161e",
  skin: "#f1c27d", peach: "#ffcba4" };
function hex(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) return `#${m[1]}`;
  m = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : "";
}
// A drawn colour that is really the pen (near black or grey) is no colour: the player's colour is used instead.
function inkless(c) {
  if (!c) return "";
  const n = parseInt(c.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max < 70 || (max - min < 24 && max < 200) ? "" : c;
}
const color = (v) => inkless(hex(v));
// In a coloured drawing a grey is a real colour (a robot's grey arms, a steel drill): only the pen's near black is dropped.
const colorIn = (colored) => (v) => { const c = hex(v); if (!colored) return inkless(c); if (!c) return ""; const n = parseInt(c.slice(1), 16); return Math.max(n >> 16 & 255, n >> 8 & 255, n & 255) < 46 ? "" : c; };
const label = (v) => String(v == null ? "" : v).replace(/[^\p{L}\p{N} !?#+-]/gu, "").trim().slice(0, 12);
// 32-bit FNV-1a of a string → 0..2^32-1 (deterministic look per drawing).
function seedOf(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Per-type defaults: what a section looks like when the drawing does not say (or the section does not apply).
const VEHICLE_OF = { car: "sedan", bike: "bicycle" };
function normalize(raw, { seed = 0 } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("body spec: not an object");
  const type = pick(raw.type, TYPES, "person");
  const color = colorIn(o(raw.palette).colored === true);
  const animal = type === "quadruped", person = type === "person", wheeled = type === "car" || type === "bike";
  const h = o(raw.head);
  const head = {
    shape: pick(h.shape, HEAD_SHAPES, type === "blob" ? "none" : "round"),
    size: r3(clamp(h.size, 0.08, animal ? 0.6 : 0.5, animal ? 0.3 : 0.24)),
    gear: pick(h.gear, GEARS, "none"),
    face: pick(h.face, FACES, person ? "visor" : "eyes"),
    eyes: Math.round(clamp(h.eyes, 0, 6, type === "blob" || animal ? 2 : 0)),
    snout: r3(clamp(h.snout, 0, 1, animal ? 0.45 : 0)),
    color: color(h.color), gearColor: color(h.gearColor), faceColor: color(h.faceColor),
  };
  const t = o(raw.torso);
  const torso = { shape: pick(t.shape, TORSOS, "box"), width: r3(clamp(t.width, 0.06, 0.7, 0.28)), color: color(t.color), belt: t.belt === true, emblem: label(t.emblem) };
  const a = o(raw.arms);
  const armCount = Math.round(clamp(a.count, 0, 4, person ? 2 : 0));
  const arms = { count: person ? (armCount >= 1 ? 2 : 0) : 0, length: r3(clamp(a.length, 0.15, 0.6, 0.38)), thickness: pick(a.thickness, THICK, "normal"),
    hands: pick(a.hands, HANDS, "mitten"), color: color(a.color) };
  const l = o(raw.legs);
  const legCount = Math.round(clamp(l.count, 0, 4, person ? 2 : animal ? 4 : 0));
  const legs = { count: person ? 2 : animal ? 4 : type === "blob" ? (legCount >= 2 ? 2 : 0) : 0,
    length: r3(clamp(l.length, animal ? 0.15 : 0.15, animal ? 1.2 : 0.65, animal ? 0.5 : 0.45)), thickness: pick(l.thickness, THICK, "normal"),
    feet: pick(l.feet, FEET, animal ? "paws" : person ? "boots" : "none"), color: color(l.color) };
  const tl = o(raw.tail);
  const tail = { kind: pick(tl.kind, TAILS, animal ? "short" : "none"), color: color(tl.color) };
  const v = o(raw.vehicle);
  let body = pick(v.body, VEHICLES, "none");
  if (wheeled && (body === "none" || (type === "bike") !== ["bicycle", "motorbike", "scooter"].includes(body))) body = VEHICLE_OF[type];
  if (!wheeled) body = "none";
  const monster = body === "monster truck";
  const vehicle = {
    body,
    height: r3(clamp(v.height, 0.15, 0.9, type === "bike" ? 0.5 : 0.36)),
    cabin: pick(v.cabin, CABINS, type === "car" ? "closed" : "none"),
    wheels: type === "bike" ? (body === "scooter" ? 2 : 2) : type === "car" ? Math.max(4, Math.min(8, Math.round(clamp(v.wheels, 0, 12, 4)) + (Math.round(clamp(v.wheels, 0, 12, 4)) % 2))) : 0,
    wheelSize: r3(clamp(v.wheelSize, 0.1, 0.6, type === "bike" ? 0.4 : monster ? 0.42 : 0.22)),
    color: color(v.color),
    rider: v.rider === true,
  };
  if (vehicle.wheels > 4 && body === "sedan") vehicle.wheels = 4; // a side view counted twice
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((x) => x && typeof x === "object" && x.kind !== "other").slice(0, MAX_ITEMS)
    .map((x) => {
      const kind = pick(x.kind, ITEMS, "other");
      const def = defaultWhere(type, kind);
      return { kind, where: fixWhere(type, kind, pick(x.where, WHERES, def), def), size: r3(clamp(x.size, 0.05, 1, 0.3)), color: color(x.color), verb: verbOfItem(kind) };
    });
  // One drawn thing, one part: drop items that repeat what the head, hands, feet or chest already show.
  const emblemKind = /light|bolt|zap/i.test(torso.emblem) ? "lightning" : /star/i.test(torso.emblem) ? "star" : /^(x|\+|cross)$/i.test(torso.emblem) ? "cross" : "";
  for (let i = items.length - 1; i >= 0; i--) {
    const x = items[i];
    if ((x.kind === "claws" && (arms.hands === "claw" || arms.hands === "robot") && /hand/.test(x.where)) || (x.kind === "claws" && legs.feet === "claws" && x.where === "feet") ||
      (x.kind === "antenna" && head.gear === "antenna" && x.where === "head") || (emblemKind && x.kind === emblemKind && x.where === "chest")) items.splice(i, 1);
  }
  const p = o(raw.palette);
  const palette = { colored: p.colored === true, main: color(p.main), second: color(p.second), accent: color(p.accent), skin: color(p.skin) };
  if (!palette.colored) { palette.main = palette.second = palette.accent = ""; }
  return {
    v: SPEC_VERSION,
    type,
    view: pick(raw.view, VIEWS, person ? "front" : "side"),
    facing: pick(raw.facing, FACINGS, person ? "viewer" : "right"),
    style: pick(raw.style, STYLES, "chunky"),
    seed: (Number(seed) >>> 0) || seedOf(JSON.stringify(raw)),
    head, torso, arms, legs,
    neck: r3(clamp(raw.neck, 0, 0.8, animal ? 0.15 : 0)),
    tail, vehicle, items, palette,
  };
}

// Where an item goes when the drawing does not say, per type.
function defaultWhere(type, kind) {
  if (kind === "flames") return "back";
  if (type === "person") {
    if (["backpack", "jetpack", "cape", "spikes", "wings", "dish"].includes(kind)) return "back";
    if (["antenna", "eye", "star"].includes(kind)) return "head";
    if (["cross", "lightning"].includes(kind)) return "chest";
    if (kind === "springs" || kind === "claws") return "feet";
    if (kind === "shield") return "left hand";
    return "right hand";
  }
  if (type === "quadruped") {
    if (["saddle", "backpack", "jetpack", "cape", "spikes", "wings", "cannon", "blaster", "dish"].includes(kind)) return "back";
    if (["antenna", "lamp", "torch", "eye", "star"].includes(kind)) return "head";
    if (kind === "claws" || kind === "springs") return "feet";
    return "front";
  }
  if (type === "car" || type === "bike") {
    if (["cannon", "blaster", "antenna", "dish", "lamp", "flag", "spikes"].includes(kind)) return kind === "lamp" ? "front" : "roof";
    if (["drill", "saw", "shovel", "pickaxe", "magnet", "claws"].includes(kind)) return "front";
    if (kind === "jetpack") return "back";
    return "side";
  }
  return ["antenna", "eye", "star"].includes(kind) ? "head" : "top";
}
// An item somewhere its type has no such place (a hand on a car) moves to the default place.
function fixWhere(type, kind, where, def) {
  const hands = where === "right hand" || where === "left hand" || where === "both hands";
  if (hands && type !== "person") return def;
  if ((where === "roof") && type === "person") return def;
  return where;
}

// ---- Skills ↔ items ------------------------------------------------------------------------------------------------

// The item a skill needs when the spec has none (the entity reading saw it; the body must show it), per type.
const DEFAULT_ITEM = {
  dig: (t) => (t === "quadruped" ? "claws" : t === "car" || t === "bike" ? "shovel" : "shovel"),
  drill: () => "drill", shoot: (t) => (t === "car" ? "cannon" : "blaster"), flare: (t) => (t === "person" ? "lamp" : "lamp"),
  boost: (t) => (t === "person" ? "jetpack" : "flames"), shield: () => "shield", scan: () => "antenna", heal: () => "cross", blast: () => "bomb",
  teleport: () => "wand", invisible: () => "cape", mine: () => "spikes", tractor: () => "magnet", emp: () => "lightning",
  inkbomb: () => "octopus", jump: () => "springs",
};
const ITEM_ALIASES = { dig: ["shovel", "claws", "pickaxe"], drill: ["drill", "saw", "pickaxe"], shoot: ["blaster", "cannon"],
  flare: ["lamp", "torch"], boost: ["jetpack", "flames"], scan: ["antenna", "dish", "eye"], inkbomb: ["octopus", "ink bottle"], mine: ["spikes", "bomb"] };
// Skills the body shows by itself: legs jump, wheels drive.
const INNATE_SHOWN = new Set(["jump", "drive", "takeoff", "land", "decoy"]);

// The look follows the reading: the type is the entity's (the server, the rig and the animations use it); every skill the
// entity unlocked shows as an item (added where the spec missed it), each item is tagged with its skill when that skill is
// unlocked (null = decoration only).
function reconcile(spec, entity) {
  let s = JSON.parse(JSON.stringify(spec));
  const etype = entity && TYPES.includes(entity.type) ? entity.type : null;
  if (etype && etype !== s.type) {
    // The reading and the body plan disagree on the type: the reading wins; the plan keeps its colours, head and items.
    const keep = { head: s.head, torso: s.torso, items: s.items, palette: s.palette, style: s.style, seed: s.seed };
    s = normalize({ type: etype, head: keep.head, torso: keep.torso, items: keep.items, palette: { ...keep.palette, colored: keep.palette.colored }, style: keep.style }, { seed: keep.seed });
    s.typeFixed = spec.type;
  }
  const unlocked = new Set((entity && Array.isArray(entity.unlocked) ? entity.unlocked : []).map((u) => u && u.verb).filter(Boolean));
  for (const x of s.items) { const v = verbOfItem(x.kind); x.verb = v && unlocked.has(v) ? v : null; }
  for (const verb of unlocked) {
    if (INNATE_SHOWN.has(verb) && verb !== "jump") continue;
    if (verb === "jump" && (s.type !== "person" || s.legs.count)) continue; // legs already jump
    // Already shown by the body itself: an antenna or goggles on the head scan, claws on the feet or hands dig.
    if (verb === "scan" && (s.head.gear === "antenna" || s.head.face === "goggles")) continue;
    if (verb === "dig" && (s.legs.feet === "claws" || s.arms.hands === "claw" || s.arms.hands === "robot")) continue;
    // A symbol drawn on the body is the part: a bolt shows emp, a cross heal, a star nothing more.
    if (verb === "emp" && /light|bolt|zap/i.test(s.torso.emblem)) continue;
    if (verb === "heal" && /^(x|\+|cross|plus)$|cross/i.test(s.torso.emblem)) continue;
    const has = s.items.some((x) => x.verb === verb) || s.items.some((x) => (ITEM_ALIASES[verb] || []).includes(x.kind) && !x.verb && (x.verb = verb));
    if (has || !DEFAULT_ITEM[verb]) continue;
    const kind = DEFAULT_ITEM[verb](s.type);
    if (s.items.length >= MAX_ITEMS) {
      const i = s.items.findIndex((x) => !x.verb); // drop a decoration to make room
      if (i < 0) continue;
      s.items.splice(i, 1);
    }
    // A second hand tool goes to the other hand; with both hands busy a lamp goes on the head, anything else on the back.
    let where = defaultWhere(s.type, kind);
    const busy = (w) => s.items.some((x) => x.where === w || x.where === "both hands");
    if (s.type === "person" && (where === "right hand" || where === "left hand") && busy(where)) {
      const other = where === "right hand" ? "left hand" : "right hand";
      where = !busy(other) ? other : kind === "lamp" || kind === "torch" || kind === "antenna" ? "head" : "back";
    }
    s.items.push({ kind, where, size: kind === "claws" ? 0.15 : 0.32, color: "", verb, added: true });
  }
  return s;
}

// No model answer (ASTRA_MOCK=1, the dev kit, bots, a failed spec call): a plausible body from the entity's own type and
// parts, varied by the seed (the drawing's hash) so two players' explorers differ.
function fromEntity(entity, seed) {
  const n = seedOf(String(seed == null ? "" : seed));
  const r = (k) => ((Math.imul(n ^ (k * 0x9e3779b1), 2654435761) >>> 0) % 1000) / 1000;
  const type = entity && TYPES.includes(entity.type) ? entity.type : "person";
  const raw = {
    type, view: type === "person" ? "front" : "side", facing: type === "person" ? "viewer" : "right",
    style: ["cute", "chunky", "sleek", "chunky", "retro"][Math.floor(r(1) * 5)],
    head: { shape: type === "person" ? (r(2) < 0.7 ? "round" : "square") : "round", size: type === "person" ? 0.2 + r(3) * 0.08 : 0.3,
      gear: type === "person" ? (r(4) < 0.6 ? "astronaut helmet" : "helmet") : type === "quadruped" ? "ears" : "none",
      face: type === "person" ? "visor" : "eyes", eyes: type === "person" ? 0 : 2, snout: type === "quadruped" ? 0.45 : 0, color: "", gearColor: "", faceColor: "" },
    torso: { shape: ["box", "round", "barrel"][Math.floor(r(5) * 3)], width: 0.26 + r(6) * 0.08, color: "", belt: r(7) < 0.5, emblem: "" },
    arms: { count: type === "person" ? 2 : 0, length: 0.36, thickness: "normal", hands: "mitten", color: "" },
    legs: { count: type === "person" ? 2 : type === "quadruped" ? 4 : 0, length: type === "quadruped" ? 0.45 : 0.42, thickness: "normal", feet: type === "quadruped" ? "paws" : "boots", color: "" },
    neck: type === "quadruped" ? 0.15 : 0,
    tail: { kind: type === "quadruped" ? "long" : "none", color: "" },
    vehicle: { body: type === "car" ? ["sedan", "buggy", "rover", "truck"][Math.floor(r(8) * 4)] : type === "bike" ? "motorbike" : "none", height: 0.36, cabin: type === "car" ? "closed" : "none", wheels: type === "car" ? 4 : 2, wheelSize: type === "bike" ? 0.38 : 0.24, color: "", rider: false },
    items: [], palette: { colored: false, main: "", second: "", accent: "", skin: "" },
  };
  return reconcile(normalize(raw, { seed: n }), entity);
}

module.exports = { SPEC_VERSION, SCHEMA, prompt, request, normalize, reconcile, fromEntity, verbOfItem, seedOf, defaultWhere,
  TYPES, VIEWS, FACINGS, STYLES, HEAD_SHAPES, GEARS, FACES, TORSOS, HANDS, FEET, TAILS, VEHICLES, CABINS, ITEMS, WHERES };
