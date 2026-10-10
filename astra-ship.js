// astra-ship.js: the drawn ship as a 3D part list, the "ship spec" (v1.4, owner 09:30: "now it looks like a cookie").
// One vision call reads the drawing and answers strict JSON: the hull (shape and proportions), the cockpit, wings, fins,
// engines (with or without flames), weapons and the extras the drawing shows, each placed along the ship and coloured
// with the colours actually used in the drawing. ship3d.js builds the chunky 3D ship from it on every screen; the
// drawing itself goes on the hull as a decal. Shared by the server (CommonJS) and the dev harnesses.
//
//   request(image, { source, model, tier, effort, maxTokens, detail }) → the Responses API body (no key in it)
//   normalize(raw, { seed }) → spec | throws          // every field checked, clamped, defaulted; deterministic
//   reconcile(spec, entity) → spec                    // the parts the entity reading unlocked are visible on the ship
//   fromEntity(entity, seed) → spec                   // no model answer (mock, dev kit, bots): a plausible spec from
//                                                     // the entity's own parts
//   verbOfPart(group, kind) → verb | null             // which skill a spec part stands for (the entity table's words)
//
// The ship frame (ship3d.js): nose towards -Z, up +Y, right +X, about 3 m long. A part's `at` is where its centre sits
// along the ship, 0 = the tip of the nose, 1 = the back of the tail; `size` is its length as a fraction of the ship's
// length; `mount` says where on the hull it sits. Colours are "#rrggbb" or "" (none drawn: the player's colour is used).
//
// spec (version 1):
//   { v: 1, view: "side"|"top"|"front"|"angled", noseDir: "right"|"left"|"up"|"down", style, seed,
//     hull: { shape: "capsule"|"wedge"|"saucer"|"box"|"dart"|"rocket", width, height, nose, tail, color, stripe },
//     cockpit: { kind: "none"|"bubble"|"canopy"|"visor"|"windows", at, size, color },
//     wings: { count: 0|2|4, shape, at, span, chord, mount, color },
//     fins: [{ kind: "tail"|"side"|"belly", at, size, color }],                      // ≤ 3
//     engines: { count: 0..4, size, flame, flameColor, layout },
//     weapons: [{ kind, count: 1|2, at, mount, size, color, verb }],                // ≤ 4
//     extras: [{ kind, at, mount, size, color, label, verb }],                      // ≤ 6
//     palette: { colored, main, second, accent } }
"use strict";

const SPEC_VERSION = 1;
const VIEWS = ["side", "top", "front", "angled"];
const NOSE_DIRS = ["right", "left", "up", "down"];
const STYLES = ["sleek", "chunky", "cute", "menacing", "retro"];
const HULLS = ["capsule", "wedge", "saucer", "box", "dart", "rocket"];
const NOSES = ["pointed", "round", "blunt", "flat"];
const TAILS = ["tapered", "flat", "round"];
const COCKPITS = ["none", "bubble", "canopy", "visor", "windows"];
const WING_SHAPES = ["delta", "swept", "straight", "forward", "round"];
const MOUNTS_WING = ["low", "mid", "high"];
const FINS = ["tail", "side", "belly"];
const ENGINE_LAYOUTS = ["single", "pair", "row", "stack", "pods"];
const WEAPONS = ["cannon", "laser", "missile", "drill", "saw", "bomb"];
const WEAPON_MOUNTS = ["nose", "top", "belly", "wings", "sides"];
const EXTRAS = ["antenna", "dish", "eye", "legs", "parachute", "lamp", "shield", "cross", "bomb", "portal", "cape", "spikes",
  "magnet", "lightning", "octopus", "mini copy", "window", "stripe", "star", "number", "text", "skull", "flag", "propeller", "other"];
const EXTRA_MOUNTS = ["top", "belly", "sides", "nose", "tail", "around"];
const MAX_FINS = 3, MAX_WEAPONS = 4, MAX_EXTRAS = 6;

// Which skill a part stands for: the same words as the entity reading (verbs.js PARTS, astra.js entityPrompt).
const EXTRA_VERB = { antenna: "scan", dish: "scan", eye: "scan", legs: "land", parachute: "land", lamp: "flare", shield: "shield",
  cross: "heal", bomb: "blast", portal: "teleport", cape: "invisible", spikes: "mine", magnet: "tractor", lightning: "emp",
  octopus: "inkbomb", "mini copy": "decoy" };
function verbOfPart(group, kind) {
  if (group === "weapons") return kind === "bomb" ? "blast" : WEAPONS.includes(kind) ? "shoot" : null;
  if (group === "engines") return "boost";
  return EXTRA_VERB[kind] || null;
}

// ---- The model call ------------------------------------------------------------------------------------------------

const num = { type: "number" };
const int = { type: "integer" };
const str = { type: "string" };
const enumOf = (list) => ({ type: "string", enum: list });
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const SCHEMA = obj({
  view: enumOf(VIEWS),
  noseDir: enumOf(NOSE_DIRS),
  style: enumOf(STYLES),
  hull: obj({ shape: enumOf(HULLS), width: num, height: num, nose: enumOf(NOSES), tail: enumOf(TAILS), color: str, stripe: str }),
  cockpit: obj({ kind: enumOf(COCKPITS), at: num, size: num, color: str }),
  wings: obj({ count: int, shape: enumOf(WING_SHAPES), at: num, span: num, chord: num, mount: enumOf(MOUNTS_WING), color: str }),
  fins: { type: "array", items: obj({ kind: enumOf(FINS), at: num, size: num, color: str }) },
  engines: obj({ count: int, size: num, flame: { type: "boolean" }, flameColor: str, layout: enumOf(ENGINE_LAYOUTS) }),
  weapons: { type: "array", items: obj({ kind: enumOf(WEAPONS), count: int, at: num, mount: enumOf(WEAPON_MOUNTS), size: num, color: str }) },
  extras: { type: "array", items: obj({ kind: enumOf(EXTRAS), at: num, mount: enumOf(EXTRA_MOUNTS), size: num, color: str, label: str }) },
  palette: obj({ colored: { type: "boolean" }, main: str, second: str, accent: str }),
});

function prompt(source) {
  const input = source === "draw"
    ? "The image is a finger drawing made on a phone screen."
    : "The image is usually a PHOTO of a paper drawing, cropped to the drawing and possibly turned by 90 degrees. Ignore paper lines, grids, shadows and fingers.";
  return [
    "You turn a hand-drawn SPACESHIP into a 3D model for a cartoony party game (Fortnite style: chunky, bright). Read the drawing and describe the ship as a list of parts. A builder makes the 3D ship from your answer, so describe what the PLAYER DREW, as faithfully as you can, and make it a cool, complete ship.",
    input,
    "view: where the drawing was seen from: \"side\" (profile), \"top\" (from above: wings spread out on BOTH sides of the body, e.g. one wing above and one below it in the image), \"front\" (nose towards the viewer) or \"angled\". noseDir: where the nose points in the image.",
    "The ship frame: the nose is the front, the tail the back. at = where a part's centre sits along the ship, 0 = tip of the nose, 1 = back of the tail. size = the part's length as a fraction of the whole ship's length (0.05 tiny to 1 the whole ship). Measure them on the drawing.",
    "hull: the main body. shape: \"dart\" (long, thin, pointed: jets, fighters), \"wedge\" (flat triangle-like), \"capsule\" (rounded tube), \"rocket\" (tall tube with a cone nose), \"saucer\" (round disc, UFO), \"box\" (blocky, square sides). width and height: the body's biggest width and height as fractions of its length (a slim jet ~0.18, a chunky box ~0.45, a saucer width ~1.0 height ~0.35). From a side view you cannot see the width and from a top view not the height: guess them from the shape. nose and tail: their shape. color: the body's colour as drawn; stripe: a second colour drawn on the body as stripes or panels, else \"\".",
    "cockpit: the cockpit, canopy, window or bubble where a pilot sits (\"windows\" = a row of small windows or portholes). \"none\" only if nothing like it is drawn. at, size, color as drawn (\"\" if no colour).",
    "wings: count 0, 2 or 4 (a pair counts as 2; a side view that shows one wing means 2). shape: delta (triangle), swept (angled back), straight, forward (swept forward) or round. at: where the wing root's centre is along the ship; span: tip to tip, as a fraction of the ship's length (a jet ~0.8, a rocket's small wings ~0.4); chord: the wing's depth along the ship. mount: low, mid or high on the body. A side view hides the wings: if the drawing is a plane-like ship with a fin or a wing line, give it a pair of plausible wings. Rockets and saucers may have none.",
    "fins: tail fins (upright, at the back), side fins, belly fins. At most 3 entries; a matching pair is ONE entry. Skip fins already counted as wings.",
    "engines: count = the nozzles or thrusters at the back (0 if none drawn; flames or exhaust lines alone count as 1). flame: true when fire, flames, exhaust lines or jets come out of the back. flameColor: their drawn colour, else \"\". layout: single, pair (side by side), row (three or four side by side), stack (one above the other) or pods (on the wings). size: the nozzle's diameter as a fraction of the ship's length.",
    "weapons: every gun, cannon, laser, blaster, missile, drill or saw (a drill or saw on a ship counts as a weapon), and bombs hanging under or behind it. A small box or block with a barrel or tube sticking out is a cannon (not a window). A cone or point with rings, ridges, zigzag or spiral lines, usually on the nose, is a \"drill\" (not a missile). count 1 or 2 (a pair under the wings is 2), at, mount (nose, top, belly, wings, sides), size, color. At most 4 entries.",
    "extras: everything else deliberately drawn, at most 6: antenna (a stick with a ball or tip), dish (a radar dish), eye (a big eye), legs (landing legs or struts with feet), parachute, lamp (a small circle or bulb with straight rays fanning out; it is NOT an exhaust, even at the back: flames are wavy tongues or jets), shield (a bubble or ring around the ship, mount \"around\"), cross (a red or plus-sign cross), bomb, portal (a swirl), cape (or a ghost sheet), spikes (along the back), magnet (a U shape), lightning (a zigzag bolt), octopus (or squid, ink bottle), mini copy (a second, smaller copy of the ship), window, stripe, star, number, text (letters or a name written on it: put them in label), skull, flag, propeller, other. label: the written text or number, else \"\".",
    "palette: colored = true only if the drawing uses colours other than a single dark pen or pencil; main, second, accent = the drawing's colours, most used first (\"\" when not drawn). With a single dark pen everything stays \"\": the game paints the ship in the player's colour. Every colour is \"#rrggbb\" or a simple colour name (\"red\", \"teal\").",
    "style: the drawing's mood: sleek, chunky, cute, menacing or retro.",
    "Be generous: an unclear blob becomes the closest plausible part (a bump on top → a cockpit, a line at the back → a fin, scribbles behind it → flames). Every ship has a hull; never return an empty ship. Do not invent weapons, legs, flames or extras that are not drawn.",
  ].join("\n");
}

function request(image, { source = "photo", model = "gpt-6.1-sol", tier = "ultrafast", effort = "medium", maxTokens = 1800, detail = "low" } = {}) {
  const req = {
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt(source) }, { type: "input_image", image_url: image, detail }] }],
    text: { format: { type: "json_schema", name: "ship_spec", schema: SCHEMA, strict: true } },
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
// Colour names the model may answer instead of hex (bright, saturated: the Fortnite look).
const NAMED = { red: "#e63946", crimson: "#d00030", orange: "#ff7b00", amber: "#ffb000", yellow: "#ffd23f", gold: "#f5b700",
  lime: "#9ef01a", green: "#2bb24c", "dark green": "#1b7a3a", teal: "#2a9d8f", turquoise: "#1fc8c0", cyan: "#22d3ee",
  "light blue": "#4cc9f0", "sky blue": "#4cc9f0", blue: "#2563eb", "dark blue": "#1e3a8a", navy: "#1e3a8a", indigo: "#4f46e5",
  purple: "#8338ec", violet: "#8b5cf6", magenta: "#e0218a", pink: "#ff5fa2", "hot pink": "#ff2e93", brown: "#8d5524",
  tan: "#d2a679", beige: "#e9d8a6", white: "#f4f4f6", silver: "#c0c7d1", grey: "#8a919e", gray: "#8a919e", black: "#16161e" };
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
const label = (v) => String(v == null ? "" : v).replace(/[^\p{L}\p{N} !?#+-]/gu, "").trim().slice(0, 12);
// 32-bit FNV-1a of a string → 0..2^32-1 (deterministic look per drawing).
function seedOf(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function normalize(raw, { seed = 0 } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("ship spec: not an object");
  const h = raw.hull && typeof raw.hull === "object" ? raw.hull : {};
  const shape = pick(h.shape, HULLS, "dart");
  const saucer = shape === "saucer";
  const hull = {
    shape,
    width: r3(clamp(h.width, 0.1, saucer ? 1.1 : 0.8, saucer ? 0.95 : 0.26)),
    height: r3(clamp(h.height, 0.08, saucer ? 0.6 : 0.7, saucer ? 0.32 : 0.22)),
    nose: pick(h.nose, NOSES, shape === "box" ? "blunt" : "pointed"),
    tail: pick(h.tail, TAILS, "flat"),
    color: color(h.color),
    stripe: color(h.stripe),
  };
  const c = raw.cockpit && typeof raw.cockpit === "object" ? raw.cockpit : {};
  const cockpit = { kind: pick(c.kind, COCKPITS, "canopy"), at: r3(clamp(c.at, 0, 1, 0.28)), size: r3(clamp(c.size, 0.06, 0.6, 0.22)), color: color(c.color) };
  const w = raw.wings && typeof raw.wings === "object" ? raw.wings : {};
  const count = Math.round(clamp(w.count, 0, 4, 2));
  const wings = {
    count: count >= 3 ? 4 : count >= 1 ? 2 : 0,
    shape: pick(w.shape, WING_SHAPES, "swept"),
    at: r3(clamp(w.at, 0.15, 0.95, 0.6)),
    span: r3(clamp(w.span, 0.2, 1.4, 0.8)),
    chord: r3(clamp(w.chord, 0.08, 0.8, 0.32)),
    mount: pick(w.mount, MOUNTS_WING, "mid"),
    color: color(w.color),
  };
  const view = pick(raw.view, VIEWS, "side");
  const fins = (Array.isArray(raw.fins) ? raw.fins : []).filter((f) => f && typeof f === "object").slice(0, MAX_FINS)
    .map((f) => ({ kind: pick(f.kind, FINS, "tail"), at: r3(clamp(f.at, 0, 1, 0.85)), size: r3(clamp(f.size, 0.06, 0.6, 0.22)), color: color(f.color) }));
  // A view from above cannot show an upright tail fin: a plane-like ship drawn that way gets one (generous: it reads as a
  // jet from every angle). implied: true = not drawn.
  if (view === "top" && !fins.some((f) => f.kind === "tail") && fins.length < MAX_FINS && wings.count && ["dart", "wedge", "capsule"].includes(shape)) {
    fins.push({ kind: "tail", at: 0.86, size: 0.24, color: wings.color, implied: true });
  }
  const e = raw.engines && typeof raw.engines === "object" ? raw.engines : {};
  const flame = e.flame === true;
  const engines = {
    count: Math.round(clamp(e.count, 0, 4, flame ? 1 : 0)) || (flame ? 1 : 0),
    size: r3(clamp(e.size, 0.06, 0.45, 0.16)),
    flame,
    flameColor: hex(e.flameColor), // a flame drawn in black is still a flame: kept as given ("" → hot orange)
    layout: pick(e.layout, ENGINE_LAYOUTS, "single"),
  };
  const weapons = (Array.isArray(raw.weapons) ? raw.weapons : []).filter((x) => x && typeof x === "object").slice(0, MAX_WEAPONS)
    .map((x) => {
      const kind = pick(x.kind, WEAPONS, "cannon");
      return { kind, count: clamp(x.count, 1, 2, 1) >= 1.5 ? 2 : 1, at: r3(clamp(x.at, 0, 1, 0.3)), mount: pick(x.mount, WEAPON_MOUNTS, kind === "drill" ? "nose" : "belly"),
        size: r3(clamp(x.size, 0.06, 0.6, 0.25)), color: color(x.color), verb: verbOfPart("weapons", kind) };
    });
  const extras = (Array.isArray(raw.extras) ? raw.extras : []).filter((x) => x && typeof x === "object").slice(0, MAX_EXTRAS)
    .map((x) => {
      const kind = pick(x.kind, EXTRAS, "other");
      return { kind, at: r3(clamp(x.at, 0, 1, 0.5)), mount: pick(x.mount, EXTRA_MOUNTS, kind === "legs" ? "belly" : kind === "shield" ? "around" : "top"),
        size: r3(clamp(x.size, 0.04, 1, 0.15)), color: color(x.color), label: label(x.label), verb: verbOfPart("extras", kind) };
    });
  const p = raw.palette && typeof raw.palette === "object" ? raw.palette : {};
  const palette = { colored: p.colored === true, main: color(p.main), second: color(p.second), accent: color(p.accent) };
  if (!palette.colored) { palette.main = palette.second = palette.accent = ""; }
  return {
    v: SPEC_VERSION,
    view,
    noseDir: pick(raw.noseDir, NOSE_DIRS, "right"),
    style: pick(raw.style, STYLES, "chunky"),
    seed: (Number(seed) >>> 0) || seedOf(JSON.stringify(raw)),
    hull, cockpit, wings, fins, engines, weapons, extras, palette,
  };
}

// ---- Skills ↔ parts ------------------------------------------------------------------------------------------------

// The part a skill needs when the spec has none (the entity reading saw it; the ship must show it).
const DEFAULT_PART = {
  shoot: (s) => ({ group: "weapons", part: { kind: "cannon", count: s.wings.count ? 2 : 1, at: 0.32, mount: s.wings.count ? "wings" : "nose", size: 0.28, color: "" } }),
  blast: () => ({ group: "extras", part: { kind: "bomb", at: 0.55, mount: "belly", size: 0.14, color: "", label: "" } }),
  land: () => ({ group: "extras", part: { kind: "legs", at: 0.5, mount: "belly", size: 0.2, color: "", label: "" } }),
  shield: () => ({ group: "extras", part: { kind: "shield", at: 0.5, mount: "top", size: 0.12, color: "", label: "" } }),
  scan: () => ({ group: "extras", part: { kind: "antenna", at: 0.45, mount: "top", size: 0.2, color: "", label: "" } }),
  flare: () => ({ group: "extras", part: { kind: "lamp", at: 0.08, mount: "nose", size: 0.1, color: "", label: "" } }),
  heal: () => ({ group: "extras", part: { kind: "cross", at: 0.55, mount: "sides", size: 0.14, color: "", label: "" } }),
  teleport: () => ({ group: "extras", part: { kind: "portal", at: 0.6, mount: "top", size: 0.14, color: "", label: "" } }),
  invisible: () => ({ group: "extras", part: { kind: "cape", at: 0.7, mount: "top", size: 0.3, color: "", label: "" } }),
  mine: () => ({ group: "extras", part: { kind: "spikes", at: 0.6, mount: "top", size: 0.35, color: "", label: "" } }),
  tractor: () => ({ group: "extras", part: { kind: "magnet", at: 0.15, mount: "belly", size: 0.14, color: "", label: "" } }),
  emp: () => ({ group: "extras", part: { kind: "lightning", at: 0.5, mount: "sides", size: 0.16, color: "", label: "" } }),
  inkbomb: () => ({ group: "extras", part: { kind: "octopus", at: 0.6, mount: "top", size: 0.16, color: "", label: "" } }),
  decoy: () => ({ group: "extras", part: { kind: "mini copy", at: 0.7, mount: "sides", size: 0.25, color: "", label: "" } }),
};
const PART_ALIASES = { mine: ["spikes", "bomb"], blast: ["bomb"], land: ["legs", "parachute"], scan: ["antenna", "dish", "eye"] };

// The look follows the reading: every skill the entity unlocked shows as a part (added where the spec missed it), and
// each part is tagged with its skill when that skill is unlocked (null = decoration only). Engines get flames for boost.
function reconcile(spec, entity) {
  const s = JSON.parse(JSON.stringify(spec));
  const unlocked = new Set((entity && Array.isArray(entity.unlocked) ? entity.unlocked : []).map((u) => u && u.verb).filter(Boolean));
  for (const x of s.weapons) x.verb = unlocked.has(verbOfPart("weapons", x.kind)) ? verbOfPart("weapons", x.kind) : null;
  for (const x of s.extras) {
    const v = verbOfPart("extras", x.kind);
    x.verb = v && unlocked.has(v) ? v : (x.kind === "bomb" && unlocked.has("mine") ? "mine" : null);
  }
  for (const verb of unlocked) {
    if (verb === "boost") {
      s.engines.flame = true;
      if (!s.engines.count) s.engines.count = 1;
      continue;
    }
    const has = verb === "shoot" ? s.weapons.some((x) => x.verb === "shoot")
      : s.weapons.some((x) => x.verb === verb) || s.extras.some((x) => x.verb === verb || (PART_ALIASES[verb] || []).includes(x.kind) && (x.verb = verb));
    if (has || !DEFAULT_PART[verb]) continue;
    const { group, part } = DEFAULT_PART[verb](s);
    const list = s[group];
    if (list.length >= (group === "weapons" ? MAX_WEAPONS : MAX_EXTRAS)) {
      const i = list.findIndex((x) => !x.verb); // drop a decoration to make room
      if (i < 0) continue;
      list.splice(i, 1);
    }
    list.push({ ...part, verb, added: true });
  }
  s.engines.verb = s.engines.flame && unlocked.has("boost") ? "boost" : null;
  return s;
}

// No model answer (ASTRA_MOCK=1, the dev kit, bots, a failed spec call): a plausible ship from the entity's own parts,
// varied by the seed (the drawing's hash) so two players' ships differ.
function fromEntity(entity, seed) {
  const n = seedOf(String(seed == null ? "" : seed));
  const r = (k) => ((Math.imul(n ^ (k * 0x9e3779b1), 2654435761) >>> 0) % 1000) / 1000;
  const shape = ["dart", "wedge", "capsule", "dart", "box", "rocket"][Math.floor(r(1) * 6)];
  const raw = {
    view: "side", noseDir: "right", style: ["sleek", "chunky", "cute", "menacing", "retro"][Math.floor(r(2) * 5)],
    hull: { shape, width: 0.22 + r(3) * 0.18, height: 0.18 + r(4) * 0.14, nose: shape === "box" ? "blunt" : "pointed", tail: "flat", color: "", stripe: "" },
    cockpit: { kind: r(5) < 0.5 ? "canopy" : "bubble", at: 0.25 + r(6) * 0.1, size: 0.2 + r(7) * 0.08, color: "" },
    wings: { count: shape === "rocket" ? 4 : 2, shape: ["delta", "swept", "straight", "forward"][Math.floor(r(8) * 4)], at: 0.58, span: shape === "rocket" ? 0.45 : 0.7 + r(9) * 0.3, chord: 0.3, mount: "mid", color: "" },
    fins: [{ kind: "tail", at: 0.86, size: 0.2 + r(10) * 0.1, color: "" }],
    engines: { count: 1 + Math.floor(r(11) * 2), size: 0.16, flame: false, flameColor: "", layout: "pair" },
    weapons: [], extras: [], palette: { colored: false, main: "", second: "", accent: "" },
  };
  return reconcile(normalize(raw, { seed: n }), entity);
}

module.exports = { SPEC_VERSION, SCHEMA, prompt, request, normalize, reconcile, fromEntity, verbOfPart, seedOf,
  VIEWS, HULLS, COCKPITS, WING_SHAPES, FINS, ENGINE_LAYOUTS, WEAPONS, EXTRAS, EXTRA_MOUNTS, WEAPON_MOUNTS };
