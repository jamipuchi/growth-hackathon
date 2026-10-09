// The shared animation table (PLAN.md section 6, "Animations: Astra wires them too"). Used by astra.js on the server
// (wireAnimations) and by anim.js in the browser (createAnimator).
//
// ROWS[type][slot] = { clip, profile, fx, shake, hitStop, byVerb? }
//   clip      the rig clip to play when the entity has one (null for rigid types and for effects-only slots),
//   profile   the named motion recipe anim.js implements procedurally (PROFILES),
//   fx        [{ kind, at (seconds after the trigger), socket }]: effects for the renderer / the built-in particles,
//   shake     camera shake 0..1 added on trigger, hitStop  frames (60 fps) the entity freezes for (2 to 4 on hits),
//   byVerb    slots are shared by several verbs (primary: shoot, blast, drill), so a verb can override any field.
// Slots are Verbs.SLOTS plus the always-on and state-driven extras in EXTRA_SLOTS.
(function (root) {
  const SLOTS = ["idle", "move", "look", "jump", "primary", "secondary", "use", "defend", "interact", "mount", "emote", "hit", "die", "respawn", "celebrate", "stepOut"];
  const ALWAYS = ["idle", "move", "hit", "die", "respawn"];
  const PROFILES = [
    "none", "idleBob", "breathe", "engineIdle", "wobbleIdle", "bank", "walkCycle", "gait", "drive", "boostSurge", "dashLunge",
    "recoil", "blastRecoil", "lunge", "shieldPop", "cloak", "drillShake", "knockback", "spinOut", "fall", "flop", "pop",
    "warpIn", "blink", "jumpSquash", "hop", "digLoop", "celebrate", "barrelRoll", "pulse", "stepOut", "dock", "morph",
  ];

  const fx = (kind, at, socket) => ({ kind, at, socket });
  const E = (profile, o) => Object.assign({ clip: null, profile, fx: [], shake: 0, hitStop: 0 }, o);
  // A row entry with verb overrides merged in at build time, so consumers never merge.
  const withVerbs = (base, verbs) => {
    const out = Object.assign({}, base, { byVerb: {} });
    for (const v of Object.keys(verbs)) out.byVerb[v] = Object.assign({}, base, verbs[v]);
    return out;
  };

  const ship = {
    idle: E("idleBob"),
    move: withVerbs(E("bank"), {
      boost: { profile: "boostSurge", fx: [fx("burst", 0, "engine_l"), fx("burst", 0, "engine_r")], shake: 0.28 },
      teleport: { profile: "blink", fx: [fx("warp", 0, "root"), fx("warp", 0.17, "root")], shake: 0.15 },
    }),
    look: E("bank"),
    jump: E("dashLunge", { fx: [fx("burst", 0, "engine_l"), fx("burst", 0, "engine_r")], shake: 0.18 }),
    primary: withVerbs(E("recoil", { fx: [fx("muzzle", 0, "nose")], shake: 0.07 }), {
      blast: { profile: "blastRecoil", fx: [fx("muzzleBig", 0.12, "nose")], shake: 0.45, hitStop: 3 },
      drill: { profile: "drillShake", fx: [fx("spark", 0, "nose")], shake: 0.22 },
    }),
    secondary: E("recoil", { fx: [fx("muzzle", 0, "nose")], shake: 0.05 }),
    use: withVerbs(E("pulse", { fx: [fx("ring", 0, "root")] }), {
      scan: { fx: [fx("ring", 0, "root"), fx("ring", 0.22, "root")] },
      flare: { fx: [fx("glow", 0, "nose")] },
      heal: { fx: [fx("heal", 0, "root")] },
      grapple: { profile: "lunge", fx: [fx("muzzle", 0, "nose")] },
    }),
    defend: withVerbs(E("shieldPop", { fx: [fx("shield", 0, "root")] }), {
      invisible: { profile: "cloak", fx: [fx("warp", 0, "root")] },
    }),
    interact: E("pulse", { fx: [fx("ring", 0, "root")] }),
    mount: E("dock"),
    emote: withVerbs(E("barrelRoll", { fx: [fx("burst", 0.25, "engine_l"), fx("burst", 0.25, "engine_r")] }), {
      shapeshift: { profile: "morph", fx: [fx("warp", 0, "root")] },
    }),
    hit: E("knockback", { fx: [fx("spark", 0, "root")], shake: 0.5, hitStop: 3 }),
    die: E("spinOut", { fx: [fx("explosion", 0.68, "root")], shake: 0.9, hitStop: 4 }),
    respawn: E("warpIn", { fx: [fx("warp", 0, "root")], shake: 0.1 }),
    celebrate: E("barrelRoll", { fx: [fx("glow", 0.3, "root")] }),
    stepOut: E("none"),
  };

  const person = {
    idle: E("breathe", { clip: "idle" }),
    move: withVerbs(E("walkCycle", { clip: "walk" }), {
      boost: { profile: "walkCycle", clip: "run", fx: [fx("dust", 0, "feet")], shake: 0.1 },
      drive: { profile: "walkCycle", clip: "run" },
      teleport: { profile: "blink", fx: [fx("warp", 0, "root"), fx("warp", 0.17, "root")] },
    }),
    look: E("breathe", { clip: "look" }),
    jump: E("jumpSquash", { clip: "jump", fx: [fx("dust", 0, "feet")], shake: 0.04 }),
    primary: withVerbs(E("recoil", { clip: "shoot", fx: [fx("muzzle", 0, "hand_r")], shake: 0.08 }), {
      blast: { profile: "blastRecoil", fx: [fx("muzzleBig", 0.12, "hand_r")], shake: 0.4, hitStop: 3 },
    }),
    secondary: E("recoil", { clip: "throw", shake: 0.03 }),
    use: withVerbs(E("pulse", { clip: "swing", fx: [fx("ring", 0, "root")] }), {
      dig: { profile: "digLoop", clip: "dig", fx: [fx("dirt", 0.5, "ground")] },
      scan: { clip: null, fx: [fx("ring", 0, "root"), fx("ring", 0.22, "root")] },
      flare: { clip: null, fx: [fx("glow", 0, "head")] },
      heal: { clip: null, fx: [fx("heal", 0, "root")] },
    }),
    defend: withVerbs(E("shieldPop", { clip: "block", fx: [fx("shield", 0, "root")] }), {
      invisible: { profile: "cloak", clip: null, fx: [fx("warp", 0, "root")] },
    }),
    interact: E("pulse", { clip: "pick_up" }),
    mount: E("dock", { clip: "sit" }),
    emote: withVerbs(E("celebrate", { clip: "wave" }), { shapeshift: { profile: "morph", clip: null, fx: [fx("warp", 0, "root")] } }),
    hit: E("knockback", { clip: "hit", fx: [fx("spark", 0, "root")], shake: 0.45, hitStop: 3 }),
    die: E("fall", { clip: "die", fx: [fx("dust", 0.5, "ground")], shake: 0.6, hitStop: 4 }),
    respawn: E("warpIn", { fx: [fx("warp", 0, "root")] }),
    celebrate: E("celebrate", { clip: "celebrate", fx: [fx("glow", 0.25, "head")] }),
    stepOut: E("stepOut", { fx: [fx("dust", 0.35, "ground")] }),
  };

  const car = {
    idle: E("engineIdle"),
    move: withVerbs(E("drive"), {
      boost: { profile: "boostSurge", fx: [fx("burst", 0, "back")], shake: 0.2 },
      drive: { profile: "drive" },
    }),
    look: E("drive"),
    jump: E("hop", { fx: [fx("dust", 0, "back")], shake: 0.06 }),
    primary: withVerbs(E("recoil", { fx: [fx("muzzle", 0, "front")], shake: 0.07 }), {
      blast: { profile: "blastRecoil", fx: [fx("muzzleBig", 0.12, "front")], shake: 0.4, hitStop: 3 },
    }),
    secondary: E("recoil", { fx: [fx("muzzle", 0, "front")] }),
    use: E("pulse", { fx: [fx("ring", 0, "root")] }),
    defend: withVerbs(E("shieldPop", { fx: [fx("shield", 0, "root")] }), { invisible: { profile: "cloak", fx: [fx("warp", 0, "root")] } }),
    interact: E("pulse"),
    mount: E("dock"),
    emote: E("hop", { fx: [fx("dust", 0, "back")] }),
    hit: E("knockback", { fx: [fx("spark", 0, "root")], shake: 0.5, hitStop: 3 }),
    die: E("spinOut", { fx: [fx("explosion", 0.68, "root")], shake: 0.9, hitStop: 4 }),
    respawn: E("warpIn", { fx: [fx("warp", 0, "root")] }),
    celebrate: E("hop", { fx: [fx("glow", 0.2, "root")] }),
    stepOut: E("none"),
  };

  const quadruped = {
    idle: E("breathe", { clip: "idle" }),
    move: withVerbs(E("gait", { clip: "walk" }), { boost: { profile: "gait", clip: "gallop", fx: [fx("dust", 0, "ground")], shake: 0.1 } }),
    look: E("breathe", { clip: "idle" }),
    jump: E("jumpSquash", { clip: "jump", fx: [fx("dust", 0, "ground")], shake: 0.05 }),
    primary: E("lunge", { clip: "bite", fx: [fx("spark", 0.12, "mouth")], shake: 0.1 }),
    secondary: E("lunge", { clip: "bite", shake: 0.06 }),
    use: withVerbs(E("digLoop", { clip: "dig", fx: [fx("dirt", 0.5, "ground")] }), { heal: { profile: "pulse", clip: null, fx: [fx("heal", 0, "root")] } }),
    defend: E("shieldPop", { clip: "sit", fx: [fx("shield", 0, "root")] }),
    interact: E("lunge", { clip: "bite" }),
    mount: E("dock", { clip: "sit" }),
    emote: E("celebrate", { clip: "roar", fx: [fx("glow", 0.2, "mouth")], shake: 0.15 }),
    hit: E("knockback", { clip: "hit", fx: [fx("spark", 0, "root")], shake: 0.45, hitStop: 3 }),
    die: E("flop", { clip: "die", fx: [fx("dust", 0.45, "ground")], shake: 0.6, hitStop: 4 }),
    respawn: E("warpIn", { fx: [fx("warp", 0, "root")] }),
    celebrate: E("celebrate", { clip: "roar" }),
    stepOut: E("stepOut", { fx: [fx("dust", 0.3, "ground")] }),
  };

  const blob = {
    idle: E("wobbleIdle"),
    move: withVerbs(E("hop"), { boost: { profile: "boostSurge", fx: [fx("burst", 0, "centre")], shake: 0.15 } }),
    look: E("wobbleIdle"),
    jump: E("jumpSquash", { fx: [fx("dust", 0, "ground")], shake: 0.04 }),
    primary: E("recoil", { fx: [fx("muzzle", 0, "centre")], shake: 0.06 }),
    secondary: E("recoil", { fx: [fx("muzzle", 0, "centre")] }),
    use: E("pulse", { fx: [fx("ring", 0, "root")] }),
    defend: withVerbs(E("shieldPop", { fx: [fx("shield", 0, "root")] }), { invisible: { profile: "cloak", fx: [fx("warp", 0, "root")] } }),
    interact: E("pulse"),
    mount: E("dock"),
    emote: E("morph", { fx: [fx("warp", 0, "root")] }),
    hit: E("knockback", { fx: [fx("spark", 0, "root")], shake: 0.45, hitStop: 3 }),
    die: E("pop", { fx: [fx("explosion", 0.22, "root")], shake: 0.7, hitStop: 4 }),
    respawn: E("warpIn", { fx: [fx("warp", 0, "root")] }),
    celebrate: E("hop", { fx: [fx("glow", 0.2, "root")] }),
    stepOut: E("stepOut", { fx: [fx("dust", 0.3, "ground")] }),
  };

  const ROWS = { ship, person, car, quadruped, blob };
  const FALLBACK = "blob";
  const get = (type) => ROWS[type] || ROWS[FALLBACK];

  const Anims = { ROWS, SLOTS, ALWAYS, PROFILES, FALLBACK, get };
  root.Anims = Anims;
  if (typeof module !== "undefined") module.exports = Anims;
})(typeof globalThis !== "undefined" ? globalThis : this);
