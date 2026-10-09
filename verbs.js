// The ability vocabulary. Generated entities can only pick from these verbs; the game engine implements each one
// generically from its params, which is what lets any drawing map onto real gameplay.
(function (root) {
  const VERBS = {
    shoot: { modes: ["space", "planet"], hold: true, params: { damage: [5, 40, 12], rate: [1, 10, 5], count: [1, 5, 1], speed: [60, 200, 140] }, hint: "guns, cannons, lasers, bows" },
    boost: { modes: ["space", "planet"], hold: true, params: { multiplier: [1.5, 4, 2.5] }, hint: "engines, rockets, thrusters, wheels" },
    shield: { modes: ["space", "planet"], hold: true, params: {}, hint: "shields, bubbles, armor" },
    blast: { modes: ["space", "planet"], params: { range: [20, 90, 60], damage: [20, 80, 50], cooldown: [6, 20, 12] }, hint: "bombs, big cannons, the word WIN" },
    invisible: { modes: ["space", "planet"], params: { duration: [2, 10, 6], cooldown: [8, 30, 15] }, hint: "cloaks, ghosts, capes" },
    shapeshift: { modes: ["space", "planet"], params: {}, hint: "masks, chameleons, transformers. Toggles a disguise" },
    teleport: { modes: ["space", "planet"], params: { distance: [10, 80, 40], cooldown: [3, 15, 6] }, hint: "portals, warp drives, magic wands" },
    heal: { modes: ["space", "planet"], params: { amount: [10, 60, 30], cooldown: [5, 20, 10] }, hint: "red crosses, potions, repair kits" },
    jump: { modes: ["planet", "space"], params: { power: [8, 30, 16] }, hint: "legs, springs, boots. In space it is a quick dash" },
    land: { modes: ["space"], params: {}, hint: "landing gear, legs, parachutes. Lands on the planet when close" },
    takeoff: { modes: ["planet"], params: {}, hint: "rockets, jetpacks. Back to space" },
    scan: { modes: ["space", "planet"], params: { range: [100, 400, 250] }, hint: "radars, antennas, eyes, binoculars" },
    flare: { modes: ["space", "planet"], params: { duration: [5, 20, 14] }, hint: "lights, lamps, torches, flares" },
    drill: { modes: ["space"], hold: true, params: { power: [10, 40, 20] }, hint: "drills, saws, picks" },
    dig: { modes: ["planet"], hold: true, params: { speed: [0.5, 2, 1] }, hint: "shovels, spades, claws" },
    drive: { modes: ["planet"], params: { speed: [1.5, 4, 2.5] }, hint: "cars, bikes, wheels, skateboards. Toggles fast driving" },
    fly: { modes: ["planet"], hold: true, params: { lift: [5, 20, 10] }, hint: "wings, jetpacks, propellers, balloons" },
    swim: { modes: ["planet"], params: {}, hint: "fins, flippers, boats. Fast on water" },
    grapple: { modes: ["space", "planet"], params: { range: [30, 120, 70] }, hint: "hooks, ropes, tentacles, magnets" },
  };

  const MOVES = ["left", "right", "up", "down", "forward", "back", "strafeleft", "straferight", "rise", "sink"];
  const STICKS = ["steer", "move"];
  const DEFAULT_ABILITIES = {
    ship: [{ verb: "shoot", label: "Laser" }, { verb: "boost", label: "Boost" }],
    person: [{ verb: "jump", label: "Jump" }, { verb: "takeoff", label: "Back to ship" }],
  };

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

  const Verbs = { VERBS, MOVES, STICKS, DEFAULT_ABILITIES, clampParams };
  root.Verbs = Verbs;
  if (typeof module !== "undefined") module.exports = Verbs;
})(typeof globalThis !== "undefined" ? globalThis : this);
