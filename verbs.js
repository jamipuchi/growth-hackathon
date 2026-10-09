// The ability vocabulary. Generated entities can only pick from these verbs; the game engine implements each one
// generically from its params, which is what lets any drawing map onto real gameplay.
//
// Each verb (PLAN.md section 5):
//   modes, hold, params ([min, max, default], clamped), hint: as before.
//   requires: { moves?, sockets? }  who can use it. Empty means anyone. "*" means any move / any socket with a part.
//                                   When both are given, either one is enough (fly: flies, or a jetpack on the back).
//   slot:     the generic animation intent, one of SLOTS; each rig turns it into its own clip (rigs.js).
//   synonyms: uppercase controller labels that bind to the verb.
//   tags:     what obstacles check for.
//   cost:     spent from an entity's power budget of 10 points.
(function (root) {
  const ANY = ["*"];
  const VERBS = {
    shoot: { modes: ["space", "planet"], hold: true, params: { damage: [5, 40, 12], rate: [1, 10, 5], count: [1, 5, 1], speed: [60, 200, 140] }, hint: "guns, cannons, lasers, bows",
      requires: { sockets: ANY }, slot: "primary", synonyms: ["SHOOT", "FIRE", "PEW", "LASER", "X", "GUN", "BANG", "ATTACK", "ZAP"], tags: ["weapon"], cost: 2 },
    boost: { modes: ["space", "planet"], hold: true, params: { multiplier: [1.5, 4, 2.5] }, hint: "engines, rockets, thrusters, wheels",
      requires: { moves: ANY }, slot: "move", synonyms: ["BOOST", "TURBO", "NITRO", "FAST", "SPEED", "ZOOM", "DASH"], tags: ["speed"], cost: 2 },
    shield: { modes: ["space", "planet"], hold: true, params: {}, hint: "shields, bubbles, armor",
      requires: {}, slot: "defend", synonyms: ["SHIELD", "BUBBLE", "ARMOR", "ARMOUR", "PROTECT", "DEFEND", "BLOCK"], tags: ["defend"], cost: 2 },
    blast: { modes: ["space", "planet"], params: { range: [20, 90, 60], damage: [20, 80, 50], cooldown: [6, 20, 12] }, hint: "bombs, big cannons, the word WIN",
      requires: { sockets: ANY }, slot: "primary", synonyms: ["BLAST", "BOMB", "WIN", "NUKE", "BOOM", "KABOOM", "MEGA"], tags: ["weapon", "explosive"], cost: 4 },
    invisible: { modes: ["space", "planet"], params: { duration: [2, 10, 6], cooldown: [8, 30, 15] }, hint: "cloaks, ghosts, capes",
      requires: {}, slot: "defend", synonyms: ["INVISIBLE", "CLOAK", "GHOST", "HIDE", "STEALTH", "INVIS"], tags: ["stealth"], cost: 3 },
    shapeshift: { modes: ["space", "planet"], params: {}, hint: "masks, chameleons, transformers. Toggles a disguise",
      requires: {}, slot: "emote", synonyms: ["SHAPESHIFT", "MASK", "DISGUISE", "MORPH", "TRANSFORM", "CHAMELEON"], tags: ["disguise"], cost: 2 },
    teleport: { modes: ["space", "planet"], params: { distance: [10, 80, 40], cooldown: [3, 15, 6] }, hint: "portals, warp drives, magic wands",
      requires: {}, slot: "move", synonyms: ["TELEPORT", "WARP", "BLINK", "PORTAL", "WAND", "MAGIC"], tags: ["move"], cost: 3 },
    heal: { modes: ["space", "planet"], params: { amount: [10, 60, 30], cooldown: [5, 20, 10] }, hint: "red crosses, potions, repair kits",
      requires: {}, slot: "use", synonyms: ["HEAL", "REPAIR", "POTION", "MEDKIT", "HEALTH", "FIX", "+"], tags: ["heal"], cost: 3 },
    jump: { modes: ["planet", "space"], params: { power: [8, 30, 16] }, hint: "legs, springs, boots. In space it is a quick dash",
      requires: { moves: ["walk", "crawl", "drive"] }, slot: "jump", synonyms: ["JUMP", "HOP", "SPRING", "LEAP", "A"], tags: ["jump"], cost: 1 },
    land: { modes: ["space"], params: {}, hint: "landing gear, legs, parachutes. Lands on the planet when close",
      requires: {}, slot: "mount", synonyms: ["LAND", "LANDING", "TOUCHDOWN", "DOCK", "PARACHUTE"], tags: ["land"], cost: 0 },
    takeoff: { modes: ["planet"], params: {}, hint: "rockets, jetpacks. Back to space",
      requires: {}, slot: "mount", synonyms: ["TAKEOFF", "TAKE OFF", "LAUNCH", "LIFTOFF", "LIFT OFF", "SHIP", "BACK TO SHIP"], tags: ["takeoff"], cost: 0 },
    scan: { modes: ["space", "planet"], params: { range: [100, 400, 250], cooldown: [2, 20, 5] }, hint: "radars, antennas, eyes, binoculars",
      requires: {}, slot: "use", synonyms: ["SCAN", "RADAR", "EYE", "SONAR", "SEARCH", "BINOCULARS", "DETECT", "PING"], tags: ["reveal"], cost: 1 },
    flare: { modes: ["space", "planet"], params: { duration: [5, 20, 14], cooldown: [2, 20, 8] }, hint: "lights, lamps, torches, flares",
      requires: { sockets: ANY }, slot: "use", synonyms: ["FLARE", "LIGHT", "TORCH", "LAMP", "FLASH", "FLASHLIGHT", "SUN", "BRIGHT"], tags: ["light"], cost: 1 },
    // v1.2 (PLAN.md section 0): the drill belongs to planet entities (rock chests), never to ships.
    drill: { modes: ["planet"], hold: true, params: { power: [10, 40, 20] }, hint: "drills, saws, picks",
      requires: { sockets: ["hand_r", "hand_l", "front", "mouth"] }, slot: "primary", synonyms: ["DRILL", "SAW", "PICK", "PICKAXE", "BORE", "CRACK"], tags: ["drill"], cost: 2 },
    dig: { modes: ["planet"], hold: true, params: { speed: [0.5, 2, 1] }, hint: "shovels, spades, claws",
      requires: { sockets: ["hand_r", "hand_l", "mouth", "front"] }, slot: "use", synonyms: ["DIG", "SHOVEL", "SPADE", "CLAW", "SCOOP", "EXCAVATE"], tags: ["dig"], cost: 2 },
    drive: { modes: ["planet"], params: { speed: [1.5, 4, 2.5] }, hint: "cars, bikes, wheels, skateboards. Toggles fast driving",
      requires: { moves: ["drive"] }, slot: "move", synonyms: ["DRIVE", "CAR", "WHEELS", "BIKE", "SKATE", "RIDE"], tags: ["drive"], cost: 2 },
    fly: { modes: ["planet"], hold: true, params: { lift: [5, 20, 10] }, hint: "wings, jetpacks, propellers, balloons",
      requires: { moves: ["fly", "fly6dof"], sockets: ["back"] }, slot: "move", synonyms: ["FLY", "WINGS", "JETPACK", "HOVER", "PROPELLER", "BALLOON"], tags: ["fly"], cost: 3 },
    swim: { modes: ["planet"], params: {}, hint: "fins, flippers, boats. Fast on water",
      requires: { moves: ["swim", "float", "walk"] }, slot: "move", synonyms: ["SWIM", "FINS", "FLIPPERS", "BOAT", "PADDLE", "SAIL"], tags: ["swim"], cost: 1 },
    grapple: { modes: ["space", "planet"], params: { range: [30, 120, 70] }, hint: "hooks, ropes, tentacles",
      requires: { sockets: ANY }, slot: "use", synonyms: ["GRAPPLE", "HOOK", "ROPE", "GRAB", "TENTACLE"], tags: ["grapple"], cost: 2 },
    // v1.3 mischief (PLAN.md "Mischief"): unlocked only by a drawn part (grantedBy), pressed once, a cooldown of 10 to
    // 20 s. They hit the nearest human rival in the same world within range (bots are fillers, never targets), never
    // one in the lobby, landing, taking off, dead, cloaked or behind a spawn shield (world.js). The victim's phone gets
    // { type: "mischief", kind, player, from, seconds } and the kill feed announces it. range: metres in space (a
    // quarter of it on the island). label: how the game writes the skill (refusal toasts, the unlock card).
    mine: { modes: ["space", "planet"], params: { cooldown: [10, 20, 10], damage: [10, 50, 30], life: [10, 60, 45] }, hint: "spikes or bombs on the back. Drops a mine behind you",
      requires: {}, slot: "secondary", synonyms: ["MINE", "MINES", "TRAP", "SPIKES", "LANDMINE", "DROP"], tags: ["mischief", "explosive"], cost: 2,
      grantedBy: ["spikes on the back", "bombs on the back", "a mine"] },
    tractor: { modes: ["space", "planet"], params: { cooldown: [10, 20, 12], range: [40, 160, 120], seconds: [0.5, 3, 1.5], speed: [10, 40, 26] }, hint: "magnets. Pulls the nearest rival toward you, or into a rock",
      requires: {}, slot: "use", synonyms: ["TRACTOR", "TRACTOR BEAM", "MAGNET", "PULL", "BEAM", "TOW", "ATTRACT"], tags: ["mischief", "pull"], cost: 3,
      grantedBy: ["a magnet", "a horseshoe magnet", "a tractor beam"] },
    emp: { modes: ["space", "planet"], params: { cooldown: [10, 20, 20], seconds: [3, 6, 5], range: [40, 200, 150] }, hint: "lightning bolts. Scrambles the nearest rival's buttons",
      requires: {}, slot: "use", synonyms: ["EMP", "LIGHTNING", "BOLT", "SHOCK", "SCRAMBLE", "ELECTRIC", "THUNDER", "STORM"], tags: ["mischief", "electric"], cost: 3,
      grantedBy: ["a lightning bolt"] },
    inkbomb: { modes: ["space", "planet"], params: { cooldown: [10, 20, 15], seconds: [2, 4, 4], range: [40, 200, 150] }, hint: "octopuses, squids, ink bottles. Splats ink over the nearest rival's screen",
      requires: {}, slot: "secondary", synonyms: ["INK", "INKBOMB", "INK BOMB", "SPLAT", "OCTOPUS", "SQUID", "BLOT", "BLIND"], tags: ["mischief", "ink"], cost: 2,
      grantedBy: ["an octopus", "a squid", "an ink bottle"], label: "ink bomb" },
    decoy: { modes: ["space", "planet"], params: { cooldown: [10, 20, 18], seconds: [4, 12, 8], hp: [10, 60, 30] }, hint: "a second, smaller copy. A fake you that draws fire",
      requires: {}, slot: "defend", synonyms: ["DECOY", "FAKE", "CLONE", "COPY", "DUMMY", "HOLOGRAM", "TWIN"], tags: ["mischief", "decoy"], cost: 3,
      grantedBy: ["a second, smaller copy of it"] },
  };

  const MOVES = ["left", "right", "up", "down", "forward", "back", "strafeleft", "straferight", "rise", "sink"];
  const STICKS = ["steer", "move"];
  const META = ["ready", "view"];
  const SLOTS = ["move", "look", "jump", "primary", "secondary", "use", "defend", "interact", "mount", "emote", "hit", "die"];
  const POWER_BUDGET = 10;
  const DEFAULT_ABILITIES = {
    ship: [{ verb: "shoot", label: "Laser" }, { verb: "boost", label: "Boost" }],
    person: [{ verb: "jump", label: "Jump" }, { verb: "takeoff", label: "Back to ship" }],
  };

  // ---- Unlockable skills (PLAN.md section 0 and "Unlockable skills") -----------------------------------------------
  // An entity's verbs come ONLY from its drawn parts, plus what its type does by itself (INNATE). A plain ship only flies.
  const ENTITY_TYPES = ["ship", "person", "car", "bike", "quadruped", "blob"];
  const PLANET_TYPES = ["person", "car", "bike", "quadruped", "blob"];
  const RIG_OF = { ship: "ship", person: "person", car: "car", bike: "car", quadruped: "quadruped", blob: "blob" };
  // Movement is free: flying, walking, driving. Take-off is free (a wrecked ship needs a redraw, world.js).
  const INNATE = { ship: [], person: ["jump", "takeoff"], car: ["drive", "takeoff"], bike: ["drive", "takeoff"], quadruped: ["jump", "takeoff"], blob: ["jump", "takeoff"] };
  // The skills a drawing can unlock, per world, and what to draw for each (the refusal toast and the hint riddles).
  // v1.2: no drill in space (it is a planet skill). v1.3: the mischief skills in both worlds.
  const MISCHIEF = ["mine", "tractor", "emp", "inkbomb", "decoy"];
  const SKILLS = {
    space: ["shoot", "boost", "shield", "land", "scan", "flare", "invisible", "heal", "blast", "teleport", ...MISCHIEF],
    planet: ["shoot", "boost", "shield", "dig", "drill", "jump", "scan", "flare", "invisible", "heal", "blast", "teleport", ...MISCHIEF],
  };
  const PARTS = {
    shoot: "a gun, cannon or laser", boost: "an exhaust with fire", shield: "a shield or a bubble", drill: "a drill or a saw",
    land: "landing legs or a parachute", dig: "a shovel or claws", drive: "wheels", jump: "legs or springs",
    scan: "an antenna, a radar dish or an eye", flare: "a lamp or a torch", invisible: "a cape or a ghost", heal: "a red cross",
    blast: "a bomb", teleport: "a portal or a magic wand", takeoff: "rockets",
    mine: "spikes or bombs on the back", tractor: "a magnet", emp: "a lightning bolt", inkbomb: "an octopus or an ink bottle",
    decoy: "a second, smaller copy of it",
  };
  // The skills that gate a round (assists hand them out at 3:00). Any weapon hurts the boss.
  const GATE_SKILLS = { space: ["shoot", "land"], planet: ["dig", "drill"] };
  const WEAPONS = ["shoot", "blast", "drill"];
  // ASTRA_MOCK=1, no key or a failed call: every gate skill plus the basics, so development stays playable.
  // Two mischief skills per world so they can be tried without a key. No drill on the ship (v1.2).
  const DEV_KIT = {
    space: [{ verb: "shoot", part: "cannon" }, { verb: "boost", part: "exhaust flames" }, { verb: "shield", part: "bubble" }, { verb: "land", part: "landing legs" }, { verb: "scan", part: "antenna" }, { verb: "flare", part: "lamp" }, { verb: "emp", part: "lightning bolt" }, { verb: "mine", part: "spikes" }],
    planet: [{ verb: "dig", part: "shovel" }, { verb: "drill", part: "drill" }, { verb: "shoot", part: "blaster" }, { verb: "shield", part: "shield" }, { verb: "scan", part: "antenna" }, { verb: "flare", part: "torch" }, { verb: "inkbomb", part: "ink bottle" }, { verb: "tractor", part: "magnet" }],
  };
  // How the game writes a skill to players ("INK BOMB", not "inkbomb").
  const labelOf = (verb) => ((VERBS[verb] && VERBS[verb].label) || verb).toUpperCase();
  const worldOf = (type) => (type === "ship" ? "space" : "planet");
  // Everything the entity can do: innate ∪ drawn (filtered to its world) ∪ extra (assists). Ordered as SKILLS.
  function entityVerbs(type, drawn, extra) {
    const world = worldOf(type);
    const set = new Set([...(INNATE[type] || []), ...(drawn || []).filter((v) => SKILLS[world].includes(v)), ...(extra || [])]);
    if (type === "car" || type === "bike") set.delete("jump");
    const order = [...SKILLS[world], ...(INNATE[type] || [])];
    return [...new Set([...order.filter((v) => set.has(v)), ...set])];
  }

  function clampParams(verb, params) {
    const spec = VERBS[verb].params;
    const out = {};
    for (const key of Object.keys(spec)) {
      const [min, max, def] = spec[key];
      const value = Number(params && params[key]);
      out[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : def;
    }
    return out;
  }

  // Labels for movement, sticks and meta actions. Arrows map to the movement names.
  const OTHER_LABELS = {
    left: ["LEFT", "L", "◀", "←", "<", "⬅", "TURN LEFT"],
    right: ["RIGHT", "R", "▶", "→", ">", "➡", "TURN RIGHT"],
    up: ["UP", "▲", "↑", "^", "⬆", "PITCH UP"],
    down: ["DOWN", "▼", "↓", "V", "⬇", "PITCH DOWN"],
    forward: ["FORWARD", "THRUST", "GO", "ACCEL", "GAS", "FWD"],
    back: ["BACK", "REVERSE", "BRAKE", "BACKWARD", "BACKWARDS"],
    strafeleft: ["STRAFE LEFT", "STRAFELEFT", "SLIDE LEFT"],
    straferight: ["STRAFE RIGHT", "STRAFERIGHT", "SLIDE RIGHT"],
    rise: ["RISE", "ASCEND", "CLIMB"],
    sink: ["SINK", "DESCEND", "DIVE", "LOWER"],
    steer: ["STEER", "STICK", "JOYSTICK", "JOY", "ARROWS", "DPAD", "D-PAD", "AIM"],
    move: ["MOVE", "WALK", "RUN"],
    ready: ["READY", "START", "OK", "PLAY"],
    view: ["VIEW", "CAM", "CAMERA", "COCKPIT", "LOOK"],
  };

  const normLabel = (s) => String(s || "").toUpperCase().replace(/[!?.,:;'"`*_~]+/g, " ").replace(/\s+/g, " ").trim();
  const LABELS = {};
  for (const [id, verb] of Object.entries(VERBS)) for (const s of [id.toUpperCase(), ...verb.synonyms]) LABELS[normLabel(s)] = id;
  for (const [id, list] of Object.entries(OTHER_LABELS)) for (const s of [id.toUpperCase(), ...list]) if (!LABELS[normLabel(s)]) LABELS[normLabel(s)] = id;

  // A drawn label → verb id, move name, stick name, meta action ("ready", "view") or null.
  // Tries the whole label, then without spaces, then each word (longest first), then a trailing plural "S".
  function resolveLabel(label) {
    const text = normLabel(label);
    if (!text) return null;
    if (LABELS[text]) return LABELS[text];
    const squashed = text.replace(/[\s-]+/g, "");
    if (LABELS[squashed]) return LABELS[squashed];
    const words = text.split(/[\s-]+/).filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
    for (const w of words) if (LABELS[w]) return LABELS[w];
    for (const w of words) if (w.endsWith("S") && LABELS[w.slice(0, -1)]) return LABELS[w.slice(0, -1)];
    return null;
  }

  // Does an entity with these moves and filled sockets meet the verb's requires? (PLAN.md section 7 binding.)
  function supports(verb, entity) {
    const req = VERBS[verb] && VERBS[verb].requires;
    if (!req) return false;
    const moves = (entity && entity.moves) || [];
    const sockets = (entity && entity.sockets) || [];
    const hasMoves = !!req.moves, hasSockets = !!req.sockets;
    if (!hasMoves && !hasSockets) return true;
    const okMoves = hasMoves && (req.moves.includes("*") ? moves.length > 0 : req.moves.some((m) => moves.includes(m)));
    const okSockets = hasSockets && (req.sockets.includes("*") ? sockets.length > 0 : req.sockets.some((s) => sockets.includes(s)));
    return okMoves || okSockets;
  }

  const Verbs = {
    VERBS, MOVES, STICKS, META, SLOTS, POWER_BUDGET, DEFAULT_ABILITIES, LABELS, clampParams, resolveLabel, supports,
    ENTITY_TYPES, PLANET_TYPES, RIG_OF, INNATE, SKILLS, PARTS, GATE_SKILLS, WEAPONS, DEV_KIT, MISCHIEF, worldOf, entityVerbs, labelOf,
  };
  root.Verbs = Verbs;
  if (typeof module !== "undefined") module.exports = Verbs;
})(typeof globalThis !== "undefined" ? globalThis : this);
