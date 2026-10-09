// The 10 entity rig templates (PLAN.md section 6, ORCHESTRATE.md section 4), shared by the server (checks, capsules)
// and the browser (rigging, animation). Adding an 11th type is one entry.
//
// Each template:
//   type, zones ("space" | "planet" | "water", water = planet water), moves (what verbs.js requires checks),
//   joints:     the 2D points the entity call places on the drawing (bone heads plus tips),
//   bones:      [bone, parent], parent null for the root bone; [] for rigid types,
//   sockets:    socket -> bone ("root" = the entity's root Object3D, for rigid types),
//   body:       "inflate" | "extrude",  skin: "smooth" | "rigid-parts" | "none",
//   procedural: motions added on top of clips,
//   clips:      the clips the A-008 reference rig ships for this type ([] = effects only),
//   slots:      slot (Verbs.SLOTS) -> this type's clip or effect.
// Names are lowercase with underscores: three.js strips dots from animation track names.
(function (root) {
  const chain = (prefix, n, parent) => Array.from({ length: n }, (_, i) => [`${prefix}${i + 1}`, i ? `${prefix}${i}` : parent]);

  const personBones = [
    ["hips", null], ["spine", "hips"], ["chest", "spine"], ["neck", "chest"], ["head", "neck"],
    ...["l", "r"].flatMap((s) => [
      [`shoulder_${s}`, "chest"], [`upper_arm_${s}`, `shoulder_${s}`], [`fore_arm_${s}`, `upper_arm_${s}`], [`hand_${s}`, `fore_arm_${s}`],
      [`thigh_${s}`, "hips"], [`shin_${s}`, `thigh_${s}`], [`foot_${s}`, `shin_${s}`],
    ]),
  ];
  const quadLegs = ["front_l", "front_r", "back_l", "back_r"];
  const quadBones = [
    ["hips", null], ["spine_1", "hips"], ["spine_2", "spine_1"], ["neck", "spine_2"], ["head", "neck"],
    ["tail_1", "hips"], ["tail_2", "tail_1"],
    ...quadLegs.flatMap((l) => [[`${l}_upper`, l.startsWith("front") ? "spine_2" : "hips"], [`${l}_lower`, `${l}_upper`], [`${l}_foot`, `${l}_lower`]]),
  ];
  const crawlerBones = [["body", null], ...Array.from({ length: 8 }, (_, i) => [[`leg_${i + 1}_upper`, "body"], [`leg_${i + 1}_lower`, `leg_${i + 1}_upper`]]).flat()];

  // Rigid types share their effect slots; skinned types name clips from ORCHESTRATE.md section 4.
  const rigidSlots = (extra) => Object.assign({
    move: "engine_flame", look: "turn", jump: "dash", primary: "muzzle_flash", secondary: "muzzle_flash", use: "pulse",
    defend: "shield_bubble", interact: "pulse", mount: "dock", emote: "spin", hit: "shake", die: "explode",
  }, extra);

  const TEMPLATES = {
    ship: {
      type: "ship", zones: ["space"], moves: ["fly6dof"],
      joints: ["nose", "tail", "wing_l", "wing_r", "seat"], bones: [],
      sockets: { nose: "root", wing_l: "root", wing_r: "root", back: "root", belly: "root", seat: "root" },
      body: "extrude", skin: "rigid-parts", procedural: ["banking", "engine_flame"], clips: [],
      slots: rigidSlots({ mount: "landing_gear", emote: "barrel_roll" }),
    },
    person: {
      type: "person", zones: ["planet"], moves: ["walk"],
      joints: ["head", "neck", "chest", "hips", "hand_l", "hand_r", "elbow_l", "elbow_r", "knee_l", "knee_r", "foot_l", "foot_r"],
      bones: personBones,
      sockets: { head: "head", hand_l: "hand_l", hand_r: "hand_r", back: "chest", feet: "foot_r" },
      body: "inflate", skin: "smooth", procedural: ["foot_planting"],
      clips: ["idle", "walk", "run", "sprint", "jump", "fall", "land", "crouch", "roll", "aim", "shoot", "swing", "throw", "block", "dig", "climb", "swim", "glide", "sit", "push", "pick_up", "kneel", "drink", "cast", "look", "read", "flip", "hit", "die", "celebrate", "wave"],
      slots: { move: "walk", look: "look", jump: "jump", primary: "shoot", secondary: "throw", use: "swing", defend: "block", interact: "pick_up", mount: "sit", emote: "wave", hit: "hit", die: "die" },
    },
    quadruped: {
      type: "quadruped", zones: ["planet"], moves: ["walk", "rideable"],
      joints: ["head", "neck", "hips", "shoulders", "tail_tip", ...quadLegs.flatMap((l) => [`${l}_knee`, `${l}_foot`])],
      bones: quadBones,
      sockets: { mouth: "head", seat: "spine_1", back: "spine_1", tail: "tail_2" },
      body: "inflate", skin: "smooth", procedural: ["gait_cycle"],
      clips: ["idle", "walk", "gallop", "jump", "sit", "bite", "dig", "roar", "hit", "die"],
      slots: { move: "walk", look: "idle", jump: "jump", primary: "bite", secondary: "bite", use: "dig", defend: "sit", interact: "bite", mount: "sit", emote: "roar", hit: "hit", die: "die" },
    },
    car: {
      type: "car", zones: ["planet"], moves: ["drive"],
      joints: ["front", "back", "roof", "seat", "wheel_fl", "wheel_fr", "wheel_bl", "wheel_br"], bones: [],
      sockets: { seat: "root", roof: "root", front: "root", back: "root" },
      body: "extrude", skin: "rigid-parts", procedural: ["wheel_spin", "suspension", "steer_tilt"], clips: [],
      slots: rigidSlots({ move: "wheel_spin", jump: "suspension_hop", mount: "door" }),
    },
    boat: {
      type: "boat", zones: ["water"], moves: ["float"],
      joints: ["bow", "stern", "mast", "seat"], bones: [],
      sockets: { seat: "root", mast: "root", bow: "root", stern: "root" },
      body: "extrude", skin: "rigid-parts", procedural: ["buoyancy_bob", "wake"], clips: [],
      slots: rigidSlots({ move: "wake", jump: "bob", mount: "dock" }),
    },
    flyer: {
      type: "flyer", zones: ["planet"], moves: ["fly"],
      joints: ["head", "neck", "body", "tail", "wing_l_mid", "wing_l_tip", "wing_r_mid", "wing_r_tip"],
      bones: [["body", null], ["neck", "body"], ["head", "neck"], ["wing_l_1", "body"], ["wing_l_2", "wing_l_1"], ["wing_r_1", "body"], ["wing_r_2", "wing_r_1"], ["tail", "body"]],
      sockets: { seat: "body", nose: "head", claws: "body", wing_l: "wing_l_1", wing_r: "wing_r_1" },
      body: "inflate", skin: "smooth", procedural: ["flap_or_propeller"],
      clips: ["flap", "glide", "dive", "land", "hit", "die"],
      slots: { move: "flap", look: "glide", jump: "flap", primary: "dive", secondary: "dive", use: "glide", defend: "glide", interact: "land", mount: "land", emote: "dive", hit: "hit", die: "die" },
    },
    swimmer: {
      type: "swimmer", zones: ["water"], moves: ["swim"],
      joints: ["mouth", "spine_2", "spine_3", "spine_4", "spine_5", "tail_tip"],
      bones: chain("spine_", 6, null),
      sockets: { mouth: "spine_1", seat: "spine_3", back: "spine_3" },
      body: "inflate", skin: "smooth", procedural: ["body_wave"],
      clips: ["swim", "dart", "hit", "die"],
      slots: { move: "swim", look: "swim", jump: "dart", primary: "dart", secondary: "dart", use: "dart", defend: "dart", interact: "swim", mount: "swim", emote: "dart", hit: "hit", die: "die" },
    },
    crawler: {
      type: "crawler", zones: ["planet"], moves: ["crawl", "walls"],
      joints: ["body", "front", ...Array.from({ length: 8 }, (_, i) => `leg_${i + 1}_tip`)],
      bones: crawlerBones,
      sockets: { mouth: "body", back: "body", front: "body" },
      body: "inflate", skin: "smooth", procedural: ["leg_ik"],
      clips: ["idle", "hit", "die"],
      slots: { move: "leg_ik", look: "idle", jump: "idle", primary: "idle", secondary: "idle", use: "idle", defend: "idle", interact: "idle", mount: "idle", emote: "idle", hit: "hit", die: "die" },
    },
    serpent: {
      type: "serpent", zones: ["planet"], moves: ["slither"],
      joints: ["head", "spine_2", "spine_3", "spine_4", "spine_5", "spine_6", "spine_7", "tail_tip"],
      bones: chain("spine_", 8, null),
      sockets: { mouth: "spine_1", tail: "spine_8" },
      body: "inflate", skin: "smooth", procedural: ["spine_follows_path"],
      clips: ["slither", "strike", "coil", "hit", "die"],
      slots: { move: "slither", look: "coil", jump: "strike", primary: "strike", secondary: "strike", use: "strike", defend: "coil", interact: "strike", mount: "coil", emote: "coil", hit: "hit", die: "die" },
    },
    blob: {
      type: "blob", zones: ["space", "planet"], moves: ["bounce"],
      joints: ["centre", "top"], bones: [],
      sockets: { centre: "root", top: "root" },
      body: "inflate", skin: "none", procedural: ["squash_stretch"], clips: [],
      slots: rigidSlots({ move: "squash_stretch", jump: "squash_stretch", emote: "wobble" }),
    },
  };

  const TYPES = Object.keys(TEMPLATES);
  const FALLBACK = "blob";
  const get = (type) => TEMPLATES[type] || null;
  const clipFor = (type, slot) => (TEMPLATES[type] && TEMPLATES[type].slots[slot]) || null;

  const Rigs = { TEMPLATES, TYPES, FALLBACK, get, clipFor };
  root.Rigs = Rigs;
  if (typeof module !== "undefined") module.exports = Rigs;
})(typeof globalThis !== "undefined" ? globalThis : this);
