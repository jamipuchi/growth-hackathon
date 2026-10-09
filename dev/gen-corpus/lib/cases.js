// The corpus: every case is drawn with HAND strokes and carries its ground truth (browser, classic script → window.CASES).
// Controllers are authored on a 200 × 100 pad (units), entities on 100 × 100, a new button inside `region` of the pad.
//   controls: { type, a (expected action), label, rect (units) }; sticks: left half → steer, right half → move.
//   entity:   { types: acceptable types, must: skills that must unlock, ok: acceptable extra skills }.
//   wrong:    the kind the drawing really is ("entity" | "controller"), for the wrong-step cases.
(function () {
  const { button, stick, ENT, PARTS } = window.HAND;

  // Draw a list of control specs; returns GT controls (+ excluded crossed-out boxes).
  function controls(d, specs) {
    const out = [], excluded = [];
    for (const s of specs) {
      if (s.t === "stick") {
        const rect = stick(d, s);
        out.push({ type: "stick", a: s.a || (s.cx < d.w / 2 ? "steer" : "move"), label: s.label || "", rect });
        if (s.label) d.text(s.label, s.cx, s.cy + s.r + 9, 7);
      } else if (s.t === "arrow") {
        const from = d.mark();
        if (s.ring) d.ellipse(s.cx, s.cy, s.s * 1.25, s.s * 1.25);
        d.triArrow(s.cx, s.cy, s.s, s.dir);
        out.push({ type: "button", a: s.a, label: "", rect: d.box(from) });
      } else if (s.t === "toggle") {
        const from = d.mark();
        d.rect(s.x, s.y, s.w, s.h, { round: s.h / 2 });
        d.ellipse(s.x + s.h / 2 + 1, s.y + s.h / 2, s.h * 0.36, s.h * 0.36);
        const rect = d.box(from);
        d.text(s.label, s.x + s.w / 2, s.y + s.h + 8, 6.5);
        out.push({ type: "toggle", a: s.a, label: s.label, rect });
      } else if (s.t === "crossed") {
        const rect = button(d, s);
        d.scribble(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4);
        excluded.push({ what: `crossed-out ${s.label || s.icon}`, rect });
      } else {
        const rect = button(d, s);
        out.push({ type: "button", a: s.a, label: s.label || "", icon: s.icon || null, rect });
      }
    }
    return { controls: out, excluded };
  }

  const C = [];
  const ctl = (id, source, desc, specs, opt = {}) => C.push({ id, kind: "controller", source, desc, w: 200, h: 100, seed: hash(id), mess: opt.mess ?? 0.35, photo: opt.photo, build: (d) => controls(d, specs) });
  function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

  // ---- controllers: finger drawings --------------------------------------------------------------------------------
  ctl("C01", "draw", "knob stick left, FIRE and BOOST boxes", [
    { t: "stick", cx: 40, cy: 62, r: 25, style: "knob" },
    { x: 150, y: 50, w: 40, h: 30, label: "FIRE", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 28, label: "BOOST", a: "boost" },
  ]);
  ctl("C02", "draw", "D-pad, PEW circle, TURBO rounded box", [
    { t: "stick", cx: 38, cy: 60, r: 26, style: "dpad" },
    { x: 152, y: 45, w: 36, h: 36, shape: "circle", label: "PEW", a: "shoot" },
    { x: 100, y: 64, w: 42, h: 24, shape: "round", label: "TURBO", a: "boost" },
  ]);
  ctl("C03", "draw", "four loose arrows cluster, SHOOT box, LAND box top right", [
    { t: "stick", cx: 40, cy: 58, r: 24, style: "arrows" },
    { x: 140, y: 58, w: 46, h: 28, label: "SHOOT", a: "shoot" },
    { x: 150, y: 12, w: 38, h: 24, label: "LAND", a: "land" },
  ]);
  ctl("C04", "draw", "two sticks and a BOOST box between them", [
    { t: "stick", cx: 36, cy: 60, r: 24, style: "knob" },
    { t: "stick", cx: 164, cy: 60, r: 24, style: "ring" },
    { x: 80, y: 66, w: 40, h: 24, label: "BOOST", a: "boost" },
  ]);
  ctl("C05", "draw", "left and right arrow buttons in rings, FIRE circle, GO box", [
    { t: "arrow", cx: 25, cy: 70, s: 10, dir: 180, ring: true, a: "left" },
    { t: "arrow", cx: 70, cy: 70, s: 10, dir: 0, ring: true, a: "right" },
    { x: 150, y: 48, w: 38, h: 38, shape: "circle", label: "FIRE", a: "shoot" },
    { x: 105, y: 20, w: 30, h: 22, label: "GO", a: "forward" },
  ]);
  ctl("C06", "draw", "stick plus six labelled boxes", [
    { t: "stick", cx: 34, cy: 64, r: 24, style: "knob" },
    { x: 80, y: 10, w: 34, h: 20, label: "SCAN", a: "scan" },
    { x: 122, y: 10, w: 34, h: 20, label: "LAND", a: "land" },
    { x: 162, y: 10, w: 34, h: 20, label: "DRILL", a: "drill" },
    { x: 80, y: 62, w: 34, h: 24, label: "SHIELD", a: "shield" },
    { x: 122, y: 62, w: 34, h: 24, label: "BOOST", a: "boost" },
    { x: 162, y: 58, w: 34, h: 30, label: "SHOOT", a: "shoot" },
  ]);
  ctl("C07", "draw", "lowercase labels: fire, boost, land", [
    { t: "stick", cx: 40, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 52, w: 40, h: 30, label: "fire", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 26, label: "boost", a: "boost" },
    { x: 150, y: 10, w: 40, h: 26, label: "land", a: "land" },
  ]);
  ctl("C08", "draw", "icons only: crosshair, flame, shield", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 50, w: 38, h: 38, shape: "circle", icon: "crosshair", a: "shoot" },
    { x: 100, y: 58, w: 36, h: 34, icon: "flame", a: "boost" },
    { x: 140, y: 6, w: 32, h: 32, icon: "shield", a: "shield" },
  ]);
  ctl("C09", "draw", "circles with the word written under each, D-pad", [
    { t: "stick", cx: 38, cy: 55, r: 25, style: "circle-arrows" },
    { x: 150, y: 38, w: 30, h: 30, shape: "circle", label: "FIRE", labelPos: "below", textH: 10, a: "shoot" },
    { x: 105, y: 46, w: 26, h: 26, shape: "circle", label: "BOOST", labelPos: "below", textH: 9, a: "boost" },
  ]);
  ctl("C10", "draw", "a crossed-out JUMP box next to FIRE and BOOST", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 54, w: 40, h: 30, label: "FIRE", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 26, label: "BOOST", a: "boost" },
    { t: "crossed", x: 120, y: 12, w: 40, h: 24, label: "JUMP" },
  ]);
  ctl("C11", "draw", "FIRE written off to the side with an arrow to a circle", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { x: 152, y: 52, w: 34, h: 34, shape: "circle", label: "FIRE", labelPos: "arrow", textH: 11, a: "shoot" },
    { x: 92, y: 66, w: 38, h: 24, label: "BOOST", a: "boost" },
  ]);
  ctl("C12", "draw", "very messy stick, FIRE and BOOST", [
    { t: "stick", cx: 42, cy: 58, r: 26, style: "knob" },
    { x: 148, y: 50, w: 42, h: 32, label: "FIRE", a: "shoot" },
    { x: 98, y: 60, w: 42, h: 30, label: "BOOST", a: "boost" },
  ], { mess: 0.85 });
  ctl("C13", "draw", "mixed case: Fire, Boost, Shield", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "dpad" },
    { x: 150, y: 54, w: 40, h: 30, shape: "round", label: "Fire", a: "shoot" },
    { x: 100, y: 64, w: 42, h: 26, shape: "round", label: "Boost", a: "boost" },
    { x: 140, y: 12, w: 46, h: 24, shape: "round", label: "Shield", a: "shield" },
  ]);
  ctl("C14", "draw", "icon plus word: flame BOOST, crosshair FIRE, drill DRILL", [
    { t: "stick", cx: 36, cy: 60, r: 24, style: "knob" },
    { x: 152, y: 46, w: 40, h: 42, label: "FIRE", icon: "crosshair", a: "shoot" },
    { x: 104, y: 50, w: 40, h: 42, label: "BOOST", icon: "flame", a: "boost" },
    { x: 128, y: 2, w: 40, h: 40, label: "DRILL", icon: "drill", a: "drill" },
  ]);
  ctl("C15", "draw", "minimal: one stick and one FIRE button", [
    { t: "stick", cx: 45, cy: 55, r: 30, style: "knob" },
    { x: 140, y: 40, w: 46, h: 40, shape: "circle", label: "FIRE", a: "shoot" },
  ]);
  ctl("C16", "draw", "plus sign (heal), BOMB, WARP, stick", [
    { t: "stick", cx: 36, cy: 60, r: 24, style: "knob" },
    { x: 100, y: 58, w: 32, h: 32, shape: "circle", icon: "cross", a: "heal" },
    { x: 148, y: 54, w: 42, h: 30, label: "BOMB", a: "blast" },
    { x: 140, y: 10, w: 44, h: 26, label: "WARP", a: "teleport" },
  ]);
  ctl("C17", "draw", "LEFT, RIGHT, THRUST and FIRE words in boxes, no stick", [
    { x: 8, y: 60, w: 40, h: 26, label: "LEFT", a: "left" },
    { x: 56, y: 60, w: 44, h: 26, label: "RIGHT", a: "right" },
    { x: 30, y: 16, w: 52, h: 26, label: "THRUST", a: "forward" },
    { x: 150, y: 50, w: 40, h: 34, label: "FIRE", a: "shoot" },
  ]);
  ctl("C18", "draw", "a drawn switch labelled SHIELD, stick, FIRE", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { t: "toggle", x: 92, y: 20, w: 36, h: 16, label: "SHIELD", a: "shield" },
    { x: 150, y: 52, w: 40, h: 32, label: "FIRE", a: "shoot" },
  ]);
  ctl("C19", "draw", "small controls far apart", [
    { t: "stick", cx: 22, cy: 74, r: 15, style: "knob" },
    { x: 172, y: 70, w: 22, h: 18, label: "FIRE", textH: 6, a: "shoot" },
    { x: 172, y: 10, w: 22, h: 16, label: "LAND", textH: 5.5, a: "land" },
    { x: 90, y: 80, w: 24, h: 14, label: "BOOST", textH: 4.5, a: "boost" },
  ]);
  ctl("C20", "draw", "planet controller: stick, DIG, JUMP, TAKE OFF", [
    { t: "stick", cx: 38, cy: 62, r: 25, style: "knob" },
    { x: 150, y: 56, w: 40, h: 30, label: "DIG", a: "dig" },
    { x: 100, y: 62, w: 40, h: 26, label: "JUMP", a: "jump" },
    { x: 130, y: 10, w: 60, h: 24, label: "TAKE OFF", a: "takeoff" },
  ]);
  // ---- controllers: notebook photos --------------------------------------------------------------------------------
  const P = (o) => ({ paper: "lined", pen: "pen", rot: 0, keystone: 0, shadow: 0.25, thumb: null, ...o });
  ctl("C21", "photo", "photo: knob stick, FIRE, BOOST (pen, lined, shadow)", [
    { t: "stick", cx: 40, cy: 62, r: 25, style: "knob" },
    { x: 150, y: 50, w: 40, h: 30, label: "FIRE", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 28, label: "BOOST", a: "boost" },
  ], { photo: P({ rot: -3, shadow: 0.35 }) });
  ctl("C22", "photo", "photo: D-pad, SHOOT, LAND, DRILL (pencil, grid, thumb)", [
    { t: "stick", cx: 38, cy: 60, r: 26, style: "dpad" },
    { x: 146, y: 56, w: 46, h: 30, label: "SHOOT", a: "shoot" },
    { x: 96, y: 62, w: 38, h: 26, label: "LAND", a: "land" },
    { x: 140, y: 10, w: 44, h: 26, label: "DRILL", a: "drill" },
  ], { photo: P({ paper: "grid", pen: "pencil", rot: 2, thumb: "bottom" }) });
  ctl("C23", "photo", "photo: lowercase fire, boost, shield (perspective)", [
    { t: "stick", cx: 40, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 52, w: 40, h: 30, label: "fire", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 26, label: "boost", a: "boost" },
    { x: 146, y: 10, w: 44, h: 26, label: "shield", a: "shield" },
  ], { photo: P({ keystone: 0.09, rot: -2 }) });
  ctl("C24", "photo", "photo: icons crosshair, flame, landing legs (marker)", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 50, w: 38, h: 38, shape: "circle", icon: "crosshair", a: "shoot" },
    { x: 100, y: 58, w: 36, h: 34, icon: "flame", a: "boost" },
    { x: 140, y: 4, w: 36, h: 36, icon: "legs", a: "land" },
  ], { photo: P({ pen: "marker", paper: "plain", rot: 4 }) });
  ctl("C25", "photo", "photo: crossed-out SCAN, FIRE, BOOST (strong shadow)", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { x: 150, y: 54, w: 40, h: 30, label: "FIRE", a: "shoot" },
    { x: 100, y: 62, w: 40, h: 26, label: "BOOST", a: "boost" },
    { t: "crossed", x: 124, y: 10, w: 40, h: 24, label: "SCAN" },
  ], { photo: P({ shadow: 0.55, rot: 1 }) });
  ctl("C26", "photo", "photo: words under circles, four arrows (pencil, lined)", [
    { t: "stick", cx: 40, cy: 56, r: 24, style: "arrows" },
    { x: 150, y: 36, w: 30, h: 30, shape: "circle", label: "FIRE", labelPos: "below", textH: 10, a: "shoot" },
    { x: 105, y: 44, w: 26, h: 26, shape: "circle", label: "LAND", labelPos: "below", textH: 9, a: "land" },
  ], { photo: P({ pen: "pencil", rot: -4 }) });
  ctl("C27", "photo", "photo: stick plus seven boxes (perspective, thumb)", [
    { t: "stick", cx: 30, cy: 64, r: 22, style: "knob" },
    { x: 66, y: 10, w: 36, h: 20, label: "SCAN", a: "scan" },
    { x: 108, y: 10, w: 36, h: 20, label: "LAND", a: "land" },
    { x: 150, y: 10, w: 40, h: 20, label: "DRILL", a: "drill" },
    { x: 66, y: 66, w: 36, h: 24, label: "FLARE", a: "flare" },
    { x: 108, y: 66, w: 38, h: 24, label: "SHIELD", a: "shield" },
    { x: 152, y: 62, w: 38, h: 30, label: "FIRE", a: "shoot" },
    { x: 108, y: 38, w: 38, h: 20, label: "BOOST", a: "boost" },
  ], { photo: P({ keystone: 0.07, thumb: "right", rot: 2 }) });
  ctl("C28", "photo", "photo: messy writing, label arrow to a circle", [
    { t: "stick", cx: 40, cy: 60, r: 25, style: "knob" },
    { x: 152, y: 54, w: 34, h: 34, shape: "circle", label: "FIRE", labelPos: "arrow", textH: 11, a: "shoot" },
    { x: 94, y: 64, w: 40, h: 26, label: "BOOST", a: "boost" },
  ], { mess: 0.8, photo: P({ rot: -2 }) });
  ctl("C29", "photo", "photo: two sticks and FIRE (marker, rotated page)", [
    { t: "stick", cx: 36, cy: 60, r: 24, style: "knob" },
    { t: "stick", cx: 164, cy: 60, r: 24, style: "knob" },
    { x: 82, y: 20, w: 36, h: 28, label: "FIRE", a: "shoot" },
  ], { photo: P({ pen: "marker", rot: 6 }) });
  ctl("C30", "photo", "photo: planet controller DIG, JUMP, DRILL", [
    { t: "stick", cx: 38, cy: 62, r: 25, style: "knob" },
    { x: 150, y: 56, w: 40, h: 30, label: "DIG", a: "dig" },
    { x: 100, y: 62, w: 40, h: 26, label: "JUMP", a: "jump" },
    { x: 146, y: 10, w: 44, h: 26, label: "DRILL", a: "drill" },
  ], { photo: P({ paper: "grid", shadow: 0.4 }) });
  ctl("C31", "photo", "photo: icon + word, mixed case Land, Scan, Flare", [
    { t: "stick", cx: 36, cy: 60, r: 24, style: "dpad" },
    { x: 150, y: 46, w: 40, h: 42, label: "Land", icon: "legs", a: "land" },
    { x: 102, y: 50, w: 40, h: 42, label: "Scan", icon: "antenna", a: "scan" },
    { x: 126, y: 2, w: 40, h: 40, label: "Flare", icon: "bulb", a: "flare" },
  ], { photo: P({ rot: -3, thumb: "bottom" }) });
  ctl("C32", "photo", "photo: heavy shadow, stick and FIRE only", [
    { t: "stick", cx: 45, cy: 55, r: 30, style: "knob" },
    { x: 140, y: 40, w: 46, h: 40, shape: "circle", label: "FIRE", a: "shoot" },
  ], { photo: P({ shadow: 0.7, rot: 3 }) });
  ctl("C33", "photo", "photo: PEW PEW, NITRO, SHIELD with small writing", [
    { t: "stick", cx: 34, cy: 62, r: 24, style: "circle-arrows" },
    { x: 150, y: 56, w: 40, h: 30, label: "PEW PEW", textH: 6, a: "shoot" },
    { x: 100, y: 64, w: 40, h: 24, label: "NITRO", textH: 6, a: "boost" },
    { x: 146, y: 12, w: 44, h: 24, label: "SHIELD", textH: 6, a: "shield" },
  ], { photo: P({ pen: "pencil", keystone: 0.05 }) });
  ctl("C34", "photo", "photo: toggle switch for SHIELD, stick, FIRE, LAND", [
    { t: "stick", cx: 38, cy: 60, r: 25, style: "knob" },
    { t: "toggle", x: 92, y: 22, w: 36, h: 16, label: "SHIELD", a: "shield" },
    { x: 150, y: 54, w: 40, h: 32, label: "FIRE", a: "shoot" },
    { x: 92, y: 64, w: 38, h: 24, label: "LAND", a: "land" },
  ], { photo: P({ rot: -5 }) });

  // ---- added buttons (one control, drawn inside `region` of the pad) -----------------------------------------------
  // pad: the controls already on the phone (in play there always is one by the time a button is added).
  const PAD = ["steer", "shoot", "boost"];
  const btn = (id, source, desc, spec, region, a, opt = {}) => C.push({
    id, kind: "button", source, desc, w: 200, h: 100, seed: hash(id), mess: opt.mess ?? 0.35, photo: opt.photo, region, pad: opt.pad || PAD, expect: { action: a, type: opt.type || "button" },
    build: (d) => {
      const R = { x: region.x * 200, y: region.y * 100, w: region.w * 200, h: region.h * 100 };
      const m = 0.12;
      const box = { x: R.x + R.w * m, y: R.y + R.h * m, w: R.w * (1 - 2 * m), h: R.h * (1 - 2 * m) };
      button(d, { ...box, ...spec });
      return { controls: [] };
    },
  });
  btn("B01", "draw", "LAND in a box", { label: "LAND" }, { x: 0.62, y: 0.08, w: 0.2, h: 0.28 }, "land");
  btn("B02", "draw", "DIG in a circle", { label: "DIG", shape: "circle" }, { x: 0.45, y: 0.1, w: 0.16, h: 0.3 }, "dig");
  btn("B03", "draw", "DRILL in a rounded box", { label: "DRILL", shape: "round" }, { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, "drill");
  btn("B04", "draw", "drill icon only", { icon: "drill" }, { x: 0.5, y: 0.1, w: 0.16, h: 0.3 }, "drill");
  btn("B05", "draw", "shovel icon only", { icon: "shovel", shape: "circle" }, { x: 0.3, y: 0.08, w: 0.16, h: 0.32 }, "dig");
  btn("B06", "draw", "the word land, no box", { label: "land", shape: "none", textH: 9 }, { x: 0.55, y: 0.1, w: 0.22, h: 0.26 }, "land");
  btn("B07", "draw", "SHOVEL in a box", { label: "SHOVEL" }, { x: 0.4, y: 0.12, w: 0.24, h: 0.26 }, "dig");
  btn("B08", "draw", "landing legs icon + LAND", { label: "LAND", icon: "legs" }, { x: 0.6, y: 0.05, w: 0.2, h: 0.4 }, "land");
  btn("B09", "draw", "antenna icon + SCAN", { label: "SCAN", icon: "antenna" }, { x: 0.35, y: 0.05, w: 0.2, h: 0.4 }, "scan");
  btn("B10", "draw", "FIRE in a circle", { label: "FIRE", shape: "circle" }, { x: 0.7, y: 0.4, w: 0.18, h: 0.34 }, "shoot");
  btn("B11", "draw", "messy BOOST", { label: "BOOST" }, { x: 0.45, y: 0.55, w: 0.22, h: 0.28 }, "boost", { mess: 0.85 });
  btn("B12", "photo", "photo: LAND in a box (pen)", { label: "LAND" }, { x: 0.62, y: 0.08, w: 0.2, h: 0.28 }, "land", { photo: P({ rot: 3 }) });
  btn("B13", "photo", "photo: DIG in a circle (pencil)", { label: "DIG", shape: "circle" }, { x: 0.45, y: 0.1, w: 0.16, h: 0.3 }, "dig", { photo: P({ pen: "pencil", paper: "grid" }) });
  btn("B14", "photo", "photo: drill icon + DRILL (marker)", { label: "DRILL", icon: "drill" }, { x: 0.5, y: 0.05, w: 0.2, h: 0.4 }, "drill", { photo: P({ pen: "marker", rot: -4 }) });
  btn("B15", "photo", "photo: parachute icon only", { icon: "parachute" }, { x: 0.55, y: 0.05, w: 0.16, h: 0.34 }, "land", { photo: P({ shadow: 0.4 }) });
  btn("B16", "photo", "photo: Shield in a circle", { label: "Shield", shape: "circle" }, { x: 0.4, y: 0.4, w: 0.2, h: 0.36 }, "shield", { photo: P({ keystone: 0.06, thumb: "bottom" }) });
  btn("B17", "photo", "photo: crosshair icon only", { icon: "crosshair", shape: "circle" }, { x: 0.7, y: 0.4, w: 0.18, h: 0.34 }, "shoot", { photo: P({ rot: 2 }) });
  // The whole page photographed again: the old controller plus the new button drawn next to it.
  const page = (id, desc, specs, region, a, pad, opt = {}) => C.push({
    id, kind: "button", source: "photo", desc, w: 200, h: 100, seed: hash(id), mess: 0.35, photo: opt.photo, region, pad, expect: { action: a, type: "button" },
    build: (d) => { controls(d, specs); return { controls: [] }; },
  });
  page("B18", "photo of the whole page: stick, FIRE, BOOST and the new LAND box", [
    { t: "stick", cx: 40, cy: 62, r: 25, style: "knob" }, { x: 150, y: 50, w: 40, h: 30, label: "FIRE" }, { x: 100, y: 62, w: 40, h: 28, label: "BOOST" },
    { x: 150, y: 8, w: 40, h: 26, label: "LAND" },
  ], { x: 0.62, y: 0.08, w: 0.2, h: 0.28 }, "land", ["steer", "shoot", "boost"], { photo: P({ rot: -2 }) });
  page("B19", "photo of the whole page: D-pad, SHOOT and the new shovel + DIG box", [
    { t: "stick", cx: 38, cy: 60, r: 26, style: "dpad" }, { x: 146, y: 56, w: 46, h: 30, label: "SHOOT" },
    { x: 100, y: 10, w: 40, h: 40, label: "DIG", icon: "shovel" },
  ], { x: 0.45, y: 0.1, w: 0.18, h: 0.3 }, "dig", ["steer", "shoot"], { photo: P({ pen: "pencil", rot: 3 }) });

  // ---- entities ----------------------------------------------------------------------------------------------------
  const ent = (id, kind, source, desc, draw, entity, opt = {}) => C.push({
    id, kind, source, desc, w: opt.w || 100, h: opt.h || 100, seed: hash(id), mess: opt.mess ?? 0.35, photo: opt.photo, entity,
    build: (d) => { draw(d); return { controls: [] }; },
  });
  const SHIP = (must, ok = []) => ({ types: ["ship"], must, ok });
  const fighter = (d) => ENT.fighter(d, 15, 38, 65, 30);
  ent("E01", "ship", "draw", "plain fighter", (d) => fighter(d), SHIP([]));
  ent("E02", "ship", "draw", "fighter + exhaust flames", (d) => { const a = fighter(d); PARTS.flames(d, a.tail, { s: 9 }); }, SHIP(["boost"]));
  ent("E03", "ship", "draw", "fighter + cannon on top", (d) => { const a = fighter(d); PARTS.cannon(d, a.top, { s: 10 }); }, SHIP(["shoot"]));
  ent("E04", "ship", "draw", "fighter + flames + cannon", (d) => { const a = fighter(d); PARTS.flames(d, a.tail, { s: 9 }); PARTS.cannon(d, a.top, { s: 10 }); }, SHIP(["shoot", "boost"]));
  ent("E05", "ship", "draw", "fighter + landing legs", (d) => { const a = fighter(d); PARTS.legs(d, a.bottom, { s: 9 }); }, SHIP(["land"]));
  ent("E06", "ship", "draw", "fighter + drill on the nose", (d) => { const a = fighter(d); PARTS.drill(d, a.nose, { s: 9 }); }, SHIP(["drill"], ["shoot"]));
  ent("E07", "ship", "draw", "fighter inside a shield bubble", (d) => { fighter(d); PARTS.bubble(d, 48, 52, 46, 34); }, SHIP(["shield"]));
  ent("E08", "ship", "draw", "saucer + legs + lamp", (d) => { const a = ENT.saucer(d, 15, 25, 70, 45); PARTS.legs(d, a.bottom, { s: 9, spread: 1.6 }); PARTS.lamp(d, a.nose, { s: 7 }); }, SHIP(["land", "flare"], ["scan"]));
  ent("E09", "ship", "draw", "rocket + flames + legs", (d) => { const a = ENT.rocket(d, 40, 10, 22, 58); PARTS.flames(d, a.tail, { s: 9, vertical: true }); PARTS.legs(d, [a.tail[0], a.tail[1] - 6], { s: 10, spread: 1.4 }); }, SHIP(["boost", "land"]));
  ent("E10", "ship", "draw", "chunky ship with cannon, drill, flames, legs", (d) => { const a = ENT.block(d, 18, 30, 62, 40); PARTS.cannon(d, a.top, { s: 9 }); PARTS.drill(d, a.nose, { s: 8 }); PARTS.flames(d, a.tail, { s: 8 }); PARTS.legs(d, a.bottom, { s: 8 }); }, SHIP(["shoot", "drill", "boost", "land"]));
  ent("E11", "ship", "draw", "fighter + antenna dish", (d) => { const a = fighter(d); PARTS.antenna(d, a.top, { s: 10 }); }, SHIP(["scan"]));
  ent("E12", "ship", "draw", "fighter + red cross + flames", (d) => { const a = fighter(d); PARTS.redcross(d, [48, 52], { s: 9 }); PARTS.flames(d, a.tail, { s: 9 }); }, SHIP(["heal", "boost"]));
  ent("E13", "ship", "photo", "photo: fighter + cannon + flames", (d) => { const a = fighter(d); PARTS.flames(d, a.tail, { s: 9 }); PARTS.cannon(d, a.top, { s: 10 }); }, SHIP(["shoot", "boost"]), { photo: P({ rot: -3 }) });
  ent("E14", "ship", "photo", "photo: saucer + landing legs", (d) => { const a = ENT.saucer(d, 15, 25, 70, 45); PARTS.legs(d, a.bottom, { s: 9, spread: 1.6 }); }, SHIP(["land"]), { photo: P({ pen: "pencil", paper: "grid" }) });
  ent("E15", "ship", "photo", "photo: rocket + nose drill + flames", (d) => { const a = ENT.rocket(d, 40, 22, 22, 50); PARTS.drill(d, a.nose, { s: 9, vertical: true }); PARTS.flames(d, a.tail, { s: 9, vertical: true }); }, SHIP(["drill", "boost"]), { photo: P({ pen: "marker", rot: 3 }) });
  ent("E16", "ship", "photo", "photo: chunky ship + bomb + bubble", (d) => { const a = ENT.block(d, 20, 30, 58, 36); PARTS.bomb(d, a.bottom, { s: 9 }); PARTS.bubble(d, 50, 52, 46, 40); }, SHIP(["blast", "shield"]), { photo: P({ shadow: 0.45, thumb: "bottom" }) });

  const EXP = (types, must, ok = []) => ({ types, must, ok: [...ok, "jump"] });
  const astro = (d) => ENT.astronaut(d, 50, 8, 84);
  ent("E17", "explorer", "draw", "astronaut + shovel", (d) => { const a = astro(d); PARTS.shovel(d, a.handR, { s: 10 }); }, EXP(["person"], ["dig"]));
  ent("E18", "explorer", "draw", "astronaut + hand drill", (d) => { const a = astro(d); PARTS.handdrill(d, a.handR, { s: 10 }); }, EXP(["person"], ["drill"]));
  ent("E19", "explorer", "draw", "astronaut + blaster", (d) => { const a = astro(d); PARTS.blaster(d, a.handR, { s: 10 }); }, EXP(["person"], ["shoot"]));
  ent("E20", "explorer", "draw", "astronaut + jetpack with flames", (d) => { const a = astro(d); PARTS.jetpack(d, a.back, { s: 12 }); }, EXP(["person"], ["boost"], ["fly"]));
  ent("E21", "explorer", "draw", "robot with a shovel", (d) => { const a = ENT.robot(d, 50, 8, 84); PARTS.shovel(d, a.handR, { s: 10 }); }, EXP(["person", "blob"], ["dig"], ["scan"]));
  ent("E22", "explorer", "draw", "plain car", (d) => ENT.car(d, 10, 30, 80, 40), EXP(["car"], [], ["boost"]));
  ent("E23", "explorer", "draw", "car + cannon on the roof", (d) => { const a = ENT.car(d, 10, 34, 80, 40); PARTS.cannon(d, a.roof, { s: 9 }); }, EXP(["car"], ["shoot"], ["boost"]));
  ent("E24", "explorer", "draw", "car + drill at the front", (d) => { const a = ENT.car(d, 6, 30, 72, 40); PARTS.drill(d, a.front, { s: 9 }); }, EXP(["car"], ["drill"], ["boost"]));
  ent("E25", "explorer", "draw", "plain bike", (d) => ENT.bike(d, 10, 30, 80, 45), EXP(["bike"], [], ["boost"]));
  ent("E26", "explorer", "draw", "bike + headlamp", (d) => { const a = ENT.bike(d, 8, 32, 74, 45); PARTS.lamp(d, a.front, { s: 7 }); }, EXP(["bike"], ["flare"], ["boost"]));
  ent("E27", "explorer", "draw", "dog", (d) => ENT.dog(d, 8, 25, 84, 60), EXP(["quadruped"], []));
  ent("E28", "explorer", "draw", "dog with big digging claws", (d) => { const a = ENT.dog(d, 8, 25, 84, 60); PARTS.claws(d, a.footF, { s: 9 }); PARTS.claws(d, [a.footF[0] - 9, a.footF[1]], { s: 9 }); }, EXP(["quadruped"], ["dig"]));
  ent("E29", "explorer", "draw", "blob with a face", (d) => ENT.blob(d, 50, 50, 30), EXP(["blob"], []));
  ent("E30", "explorer", "draw", "snake", (d) => ENT.snake(d, 8, 30, 76, 40), EXP(["blob"], []));
  ent("E31", "explorer", "draw", "astronaut + torch", (d) => { const a = astro(d); PARTS.torch(d, a.handR, { s: 10 }); }, EXP(["person"], ["flare"]));
  ent("E32", "explorer", "photo", "photo: astronaut + shovel", (d) => { const a = astro(d); PARTS.shovel(d, a.handR, { s: 10 }); }, EXP(["person"], ["dig"]), { photo: P({ rot: 2 }) });
  ent("E33", "explorer", "photo", "photo: car + roof cannon", (d) => { const a = ENT.car(d, 10, 34, 80, 40); PARTS.cannon(d, a.roof, { s: 9 }); }, EXP(["car"], ["shoot"], ["boost"]), { photo: P({ pen: "marker", shadow: 0.4 }) });
  ent("E34", "explorer", "photo", "photo: dog with claws", (d) => { const a = ENT.dog(d, 8, 25, 84, 60); PARTS.claws(d, a.footF, { s: 9 }); PARTS.claws(d, [a.footF[0] - 9, a.footF[1]], { s: 9 }); }, EXP(["quadruped"], ["dig"]), { photo: P({ pen: "pencil", keystone: 0.06 }) });
  ent("E35", "explorer", "photo", "photo: astronaut + round shield", (d) => { const a = astro(d); PARTS.roundshield(d, a.handL, { s: 11 }); }, EXP(["person"], ["shield"]), { photo: P({ thumb: "right", rot: -2 }) });

  // ---- wrong kind: an entity in the controller / button step, a controller in the entity step ----------------------
  const wrong = (id, kind, source, desc, really, draw, opt = {}) => C.push({
    id, kind, source, desc, w: opt.w || (kind === "controller" ? 200 : 100), h: opt.h || 100, seed: hash(id), mess: opt.mess ?? 0.35, photo: opt.photo,
    region: opt.region, wrong: really, build: (d) => { draw(d); return { controls: [] }; },
  });
  wrong("W01", "controller", "draw", "fighter with flames and cannon, drawn in the controller step", "entity", (d) => { const a = ENT.fighter(d, 40, 30, 120, 45); PARTS.flames(d, a.tail, { s: 14 }); PARTS.cannon(d, a.top, { s: 14 }); });
  wrong("W02", "controller", "draw", "rocket drawn in the controller step", "entity", (d) => { const a = ENT.rocket(d, 88, 12, 24, 62); PARTS.flames(d, a.tail, { s: 9, vertical: true }); });
  wrong("W03", "controller", "photo", "photo: saucer with legs in the controller step", "entity", (d) => { const a = ENT.saucer(d, 50, 15, 100, 55); PARTS.legs(d, a.bottom, { s: 12, spread: 1.8 }); }, { photo: P({ rot: 2 }) });
  wrong("W04", "controller", "draw", "astronaut with a shovel in the controller step", "entity", (d) => { const a = ENT.astronaut(d, 100, 8, 84); PARTS.shovel(d, a.handR, { s: 10 }); });
  wrong("W05", "controller", "photo", "photo: car in the controller step", "entity", (d) => ENT.car(d, 40, 20, 120, 60), { photo: P({ pen: "marker" }) });
  wrong("W06", "controller", "draw", "ship with handwritten notes LASER and FLAMES pointing at parts", "entity", (d) => {
    const a = ENT.fighter(d, 50, 40, 100, 38); PARTS.flames(d, a.tail, { s: 12 }); PARTS.cannon(d, a.top, { s: 12 });
    d.text("LASER", 150, 14, 8); d.arrow(140, 18, a.top[0] + 14, a.top[1] - 4); d.text("FLAMES", 30, 92, 8); d.arrow(36, 84, a.tail[0] - 8, a.tail[1] + 4);
  });
  wrong("W07", "button", "draw", "a little ship drawn as a new button", "entity", (d) => { const a = ENT.fighter(d, 110, 12, 50, 20); PARTS.flames(d, a.tail, { s: 6 }); }, { w: 200, region: { x: 0.5, y: 0.05, w: 0.35, h: 0.4 } });
  wrong("W08", "button", "photo", "photo: a dog drawn as a new button", "entity", (d) => ENT.dog(d, 60, 10, 80, 50), { w: 200, region: { x: 0.3, y: 0.05, w: 0.4, h: 0.5 }, photo: P({ rot: -2 }) });
  wrong("W09", "ship", "draw", "a controller (stick, FIRE, BOOST) drawn in the ship step", "controller", (d) => controls(d, [
    { t: "stick", cx: 40, cy: 62, r: 25, style: "knob" }, { x: 150, y: 50, w: 40, h: 30, label: "FIRE" }, { x: 100, y: 62, w: 40, h: 28, label: "BOOST" },
  ]), { w: 200 });
  wrong("W10", "ship", "photo", "photo: a controller (D-pad, SHOOT, LAND) in the ship step", "controller", (d) => controls(d, [
    { t: "stick", cx: 38, cy: 60, r: 26, style: "dpad" }, { x: 146, y: 56, w: 46, h: 30, label: "SHOOT" }, { x: 96, y: 62, w: 38, h: 26, label: "LAND" },
  ]), { w: 200, photo: P({ rot: 3 }) });
  wrong("W11", "explorer", "draw", "a controller (stick, DIG, JUMP) in the explorer step", "controller", (d) => controls(d, [
    { t: "stick", cx: 38, cy: 62, r: 25, style: "knob" }, { x: 150, y: 56, w: 40, h: 30, label: "DIG" }, { x: 100, y: 62, w: 40, h: 26, label: "JUMP" },
  ]), { w: 200 });
  wrong("W12", "ship", "draw", "just a LAND button drawn in the ship step", "controller", (d) => controls(d, [{ x: 30, y: 30, w: 40, h: 30, label: "LAND" }]));
  wrong("W13", "explorer", "photo", "photo: a controller with arrows and FIRE in the explorer step", "controller", (d) => controls(d, [
    { t: "stick", cx: 40, cy: 58, r: 24, style: "arrows" }, { x: 140, y: 58, w: 46, h: 28, label: "FIRE" }, { x: 150, y: 12, w: 38, h: 24, label: "DIG" },
  ]), { w: 200, photo: P({ pen: "pencil" }) });

  window.CASES = C;
})();
