// Phone extras (v1.3 phone track, Fortnite style, readable over bright scenes): chunky HP / SHIELD / BOOST bars on a dark
// slanted plate, hand-drawn hint sketches, the drawings-left counter, the radar, and the pencil example sketches of the
// drawing steps.
// No dependencies. update() only writes values that changed, and only touches transform / opacity / textContent / class,
// so it never forces layout; CSS animates only transform and opacity, and there is no backdrop-filter. Every user-facing
// string comes in through the `copy` argument (controller.html owns the COPY table); the defaults below only keep the
// module usable on its own (dev/phone-extras/demo.html).

const STYLE_ID = "pe-styles";
const HEAD_FONT = 'var(--f-head,"Barlow Condensed","Avenir Next Condensed","Arial Narrow",Impact,system-ui,sans-serif)';
// What every panel shares: a dark translucent slanted plate (a scrim, so it reads on white sand or a pink nebula)
// and white text with a dark outline.
const PLATE = "background:rgb(13 11 46 / .78);border:3px solid #120a2e;box-shadow:0 4px 0 #0a0830";
const OUTLINE = "color:#fff;-webkit-text-stroke:2.5px #120a2e;paint-order:stroke fill;text-shadow:0 2px 0 rgb(10 6 30 / .55)";

const CSS = `
.pe-vitals{position:relative;z-index:0;isolation:isolate;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;
  width:178px;padding:7px 12px 8px 11px;pointer-events:none;font-family:${HEAD_FONT}}
.pe-vitals::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-9deg);border-radius:6px;${PLATE}}
.pe-vitals.pe-dead::before{background:rgb(78 12 40 / .84)}
.pe-row{position:relative;display:flex;align-items:center;gap:7px;transition:opacity .25s}
.pe-row:nth-child(1){transform:translateX(4px)}
.pe-row:nth-child(3){transform:translateX(-4px)}
.pe-row.pe-off{opacity:.85}
.pe-ico{flex:none;box-sizing:border-box;width:24px;height:24px;display:grid;place-items:center;border:2px solid #120a2e;
  border-radius:6px;box-shadow:0 3px 0 #0a0830;transform:skewX(-10deg)}
.pe-ico svg{width:14px;height:14px;transform:skewX(10deg);fill:#fff;stroke:#120a2e;stroke-width:1.6;stroke-linejoin:round}
.pe-hp .pe-ico{background:linear-gradient(#a6ff86,#2fae45)}
.pe-hp.pe-mid .pe-ico{background:linear-gradient(#fff09a,#f0a400)}
.pe-hp.pe-low .pe-ico{background:linear-gradient(#ff9aa8,#d42246)}
.pe-sh .pe-ico{background:linear-gradient(#b5f6ff,#0a9fd6)}
.pe-bo .pe-ico{background:linear-gradient(#ffd98a,#ff8a1f)}
.pe-off .pe-ico{background:linear-gradient(#aeabc8,#5f5c84)}
.pe-bar{position:relative;flex:1;min-width:0;height:22px}
.pe-track{position:absolute;inset:0;transform:skewX(-14deg);background:rgb(4 3 20 / .9);border:2px solid #120a2e;border-radius:3px;
  box-shadow:inset 0 0 0 1px rgb(255 255 255 / .12);overflow:hidden}
.pe-off .pe-track{background:repeating-linear-gradient(-45deg,rgb(98 94 132 / .6) 0 4px,rgb(52 49 84 / .6) 4px 8px)}
.pe-fill{position:absolute;inset:0;transform-origin:0 50%;will-change:transform;transition:transform .12s linear}
.pe-hp .pe-fill{background:linear-gradient(#b4ff8f,#4ade5a 55%,#2fae45)}
.pe-hp.pe-mid .pe-fill{background:linear-gradient(#fff3a6,#ffcb3d 55%,#f0a400)}
.pe-hp.pe-low .pe-fill{background:linear-gradient(#ffa3b0,#ff3b5c 55%,#d42246);animation:pe-blink .6s steps(2,jump-none) infinite}
.pe-sh .pe-fill{background:linear-gradient(#b5f6ff,#19d3ff 55%,#0a9fd6)}
.pe-bo .pe-fill{background:linear-gradient(#ffe48a,#ffb000 50%,#ff8a1f)}
.pe-off .pe-fill{opacity:0}
.pe-txt{position:absolute;left:8px;right:9px;top:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:6px;
  font-weight:900;font-style:italic;font-size:14px;line-height:1;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;
  ${OUTLINE}}
.pe-val{font-size:15px;font-variant-numeric:tabular-nums}
.pe-off .pe-name{color:#d6d3ec}
.pe-off .pe-name::before{content:"🔒";display:inline-block;margin-right:4px;font-size:11px;font-style:normal;letter-spacing:0;
  -webkit-text-stroke:0;text-shadow:none;transform:translateY(-1px)}
.pe-flash{position:absolute;inset:-3px -5px;transform:skewX(-9deg);border-radius:5px;background:rgb(255 59 92 / .6);opacity:0;
  pointer-events:none}
.pe-dead .pe-hp .pe-name{color:#ffd0d8;animation:pe-blink 1s steps(2,jump-none) infinite}
.pe-dead .pe-hp .pe-fill{opacity:.25}
@keyframes pe-blink{50%{opacity:.4}}
@media (prefers-reduced-motion:reduce){.pe-hp.pe-low .pe-fill,.pe-dead .pe-hp .pe-name{animation:none}}

.pe-sketch{position:absolute;pointer-events:none;opacity:0;transition:opacity 2.4s ease-out;z-index:1}
.pe-sketch.pe-on{opacity:.34}
.pe-sketch svg{width:100%;height:100%;display:block;overflow:visible}
.pe-sketch path{fill:none;stroke:#e9f4ff;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pe-sketch path.pe-thin{stroke-width:.9;opacity:.75}

.pe-count{position:relative;z-index:0;isolation:isolate;display:inline-flex;align-items:center;gap:10px;padding:5px 15px 6px;
  pointer-events:none;white-space:nowrap;font-family:${HEAD_FONT};font-weight:900;font-style:italic;font-size:15px;line-height:1;
  letter-spacing:.04em;text-transform:uppercase;${OUTLINE}}
.pe-count::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-9deg);border-radius:5px;${PLATE}}
.pe-count.pe-closed::before{background:linear-gradient(#ff5d76,#d42246)}
.pe-pips{display:flex;gap:4px}
.pe-pip{display:block;flex:none;box-sizing:border-box;width:14px;height:14px;border:2px solid #120a2e;border-radius:3px;
  background:#0a0824;box-shadow:inset 0 0 0 1.5px rgb(255 255 255 / .22);transform:skewX(-12deg) scale(.9);transition:transform .2s}
.pe-pip.pe-full{background:linear-gradient(#fff3a6,#ffcb3d 50%,#ffb000);box-shadow:inset 0 2px 0 rgb(255 255 255 / .6),0 2px 0 #0a0830;
  transform:skewX(-12deg) scale(1)}
.pe-ctxt{display:inline-block}
.pe-closed .pe-pips{display:none}

.pe-radar{display:block;border-radius:50%}

.pe-example{width:100%;height:100%;display:block}
.pe-example svg{width:100%;height:100%;display:block}
`;

export function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);

// ---------------------------------------------------------------- vitals

const ICONS = {
  heart: '<path d="M12 20.5S4.5 16 4.5 10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 6-7.5 10.5-7.5 10.5z"/>',
  shield: '<path d="M12 3l7 3v5.2c0 4.8-3.2 8.2-7 9.8-3.8-1.6-7-5-7-9.8V6z"/>',
  bolt: '<path d="M13.5 2L5 13.5h5.5L9.5 22 19 9.5h-5.8z"/>',
};

function bar(parent, cls, label, icon) {
  const row = el("div", "pe-row " + cls, parent);
  const ico = el("div", "pe-ico", row);
  ico.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icon + "</svg>";
  const wrap = el("div", "pe-bar", row);
  const track = el("div", "pe-track", wrap);
  const fill = el("div", "pe-fill", track);
  fill.style.transform = "scaleX(0)";
  const txt = el("div", "pe-txt", wrap);
  const name = el("span", "pe-name", txt, label);
  const val = el("span", "pe-val", txt, "");
  return { row, name, val, fill, last: -1, lastVal: "" };
}

function setBar(b, frac) {
  const f = Math.round(clamp01(frac) * 200) / 200;
  if (f === b.last) return;
  b.last = f;
  b.fill.style.transform = "scaleX(" + f + ")";
}

// copy: { hp, shield, boost, respawn: "BACK IN {n}…" }
// One dark slanted plate holds three chunky bars: HP (green, gold under half, red and blinking under a quarter), SHIELD (cyan)
// and BOOST (gold / orange). A bar whose skill the ship has not drawn yet is greyed, hatched, empty and carries a 🔒.
export function createVitals(container, copy = {}) {
  injectStyles();
  const T = { hp: "HP", shield: "SHIELD", boost: "BOOST", respawn: "BACK IN {n}…", ...copy };
  const root = el("div", "pe-vitals", container);
  const hp = bar(root, "pe-hp", T.hp, ICONS.heart);
  const sh = bar(root, "pe-sh", T.shield, ICONS.shield);
  const bo = bar(root, "pe-bo", T.boost, ICONS.bolt);
  const flash = el("div", "pe-flash", hp.row);
  let prevHp = null;
  let lastText = T.hp;
  let lastDead = false;
  let lastTier = 0; // 0 green, 1 gold, 2 red
  let lastShOff = false;
  let lastBoOff = false;

  // s: { hp, maxHp, shieldEnergy, boostEnergy, dead, respawnIn, shieldOff?, boostOff? } (…Off: that skill is not unlocked)
  function update(s) {
    if (!s) return;
    const maxHp = s.maxHp > 0 ? s.maxHp : 100;
    const dead = !!s.dead || s.hp <= 0;
    const frac = s.hp / maxHp;
    const shOff = !!s.shieldOff;
    const boOff = !!s.boostOff;
    setBar(hp, frac);
    setBar(sh, shOff ? 0 : s.shieldEnergy);
    setBar(bo, boOff ? 0 : s.boostEnergy);

    if (prevHp != null && s.hp < prevHp && !dead && flash.animate) {
      flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: "ease-out" });
    }
    prevHp = s.hp;

    const text = dead ? T.respawn.replace("{n}", Math.max(1, Math.ceil(s.respawnIn || 0))) : T.hp;
    if (text !== lastText) {
      lastText = text;
      hp.name.textContent = text;
    }
    const val = dead || !Number.isFinite(s.hp) ? "" : String(Math.max(0, Math.ceil(s.hp)));
    if (val !== hp.lastVal) {
      hp.lastVal = val;
      hp.val.textContent = val;
    }
    if (dead !== lastDead) {
      lastDead = dead;
      root.classList.toggle("pe-dead", dead);
    }
    const tier = dead ? 0 : frac < 0.25 ? 2 : frac < 0.5 ? 1 : 0;
    if (tier !== lastTier) {
      lastTier = tier;
      hp.row.classList.toggle("pe-mid", tier === 1);
      hp.row.classList.toggle("pe-low", tier === 2);
    }
    if (shOff !== lastShOff) {
      lastShOff = shOff;
      sh.row.classList.toggle("pe-off", shOff);
    }
    if (boOff !== lastBoOff) {
      lastBoOff = boOff;
      bo.row.classList.toggle("pe-off", boOff);
    }
  }

  return { update, destroy: () => root.remove() };
}

// ---------------------------------------------------------------- sketches

// Strokes are polylines in a 100x100 box. They are turned into wobbly,
// doubled pencil lines with a seeded jitter, so they look drawn, not iconic.
const STROKES = {
  drill: [
    // chuck and shank
    [[38, 6], [62, 5], [63, 17], [37, 18], [38, 6]],
    [[42, 18], [41, 30], [59, 30], [58, 18]],
    // conical bit
    [[40, 30], [48, 58], [50, 84], [52, 58], [60, 30]],
    // flutes, drawn as slanted bands
    [[41, 36], [58, 31]],
    [[43, 43], [60, 38]],
    [[45, 50], [57, 46]],
    [[47, 58], [55, 55]],
    [[48, 66], [53, 64]],
    [[49, 74], [52, 73]],
    // crack lines below the tip
    [[50, 86], [46, 93], [49, 96]],
    [[50, 86], [56, 92]],
  ],
  landing: [
    // hull belly
    [[18, 20], [28, 12], [72, 12], [82, 20], [74, 30], [26, 30], [18, 20]],
    // legs
    [[32, 30], [24, 58], [20, 74]],
    [[68, 30], [76, 58], [80, 74]],
    [[40, 30], [38, 50]],
    [[60, 30], [62, 50]],
    // feet pads
    [[12, 76], [28, 75]],
    [[72, 75], [88, 76]],
    // ground line, plus little hatch marks
    [[2, 78], [30, 79], [60, 77], [98, 78]],
    [[10, 84], [6, 90]],
    [[30, 84], [26, 90]],
    [[56, 84], [52, 90]],
    [[78, 84], [74, 90]],
  ],
  shovel: [
    // D grip
    [[36, 6], [64, 5], [66, 16], [56, 20], [44, 20], [34, 16], [36, 6]],
    // shaft
    [[48, 20], [47, 58]],
    [[53, 20], [52, 58]],
    // blade
    [[40, 56], [60, 56], [66, 72], [58, 88], [50, 94], [42, 88], [34, 72], [40, 56]],
    [[50, 58], [50, 88]],
    // dirt mound and flying specks
    [[66, 94], [76, 90], [86, 94], [96, 96]],
    [[78, 80], [80, 77]],
    [[88, 84], [91, 80]],
  ],
  gun: [
    // long barrel, tilted a little, with a muzzle ring
    [[8, 44], [64, 34], [67, 48], [11, 58], [8, 44]],
    [[62, 31], [72, 29], [75, 51], [65, 53], [62, 31]],
    // carriage and wheel
    [[24, 56], [30, 78], [56, 78], [58, 46]],
    [[44, 80], [52, 82], [56, 88], [52, 95], [44, 97], [36, 95], [32, 88], [36, 82], [44, 80]],
    [[44, 84], [44, 93]],
    [[38, 88], [50, 88]],
    // muzzle flash
    [[80, 34], [96, 24]],
    [[82, 41], [99, 41]],
    [[80, 48], [96, 58]],
  ],
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

// step: roughly one jittered point every `step` units (9 for the hint sketches)
function wobble(pts, rnd, amp, step = 9) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([x0 + (x1 - x0) * t + rnd() * amp, y0 + (y1 - y0) * t + rnd() * amp]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0] + rnd() * amp * 0.5, last[1] + rnd() * amp * 0.5]);
  let d = "M" + out[0][0].toFixed(1) + " " + out[0][1].toFixed(1);
  for (let i = 1; i < out.length - 1; i++) {
    const mx = (out[i][0] + out[i + 1][0]) / 2;
    const my = (out[i][1] + out[i + 1][1]) / 2;
    d += "Q" + out[i][0].toFixed(1) + " " + out[i][1].toFixed(1) + " " + mx.toFixed(1) + " " + my.toFixed(1);
  }
  const e = out[out.length - 1];
  return d + "L" + e[0].toFixed(1) + " " + e[1].toFixed(1);
}

const svgCache = {};

function sketchSvg(name) {
  if (svgCache[name]) return svgCache[name];
  const strokes = STROKES[name];
  if (!strokes) return "";
  const rnd = rng(name.length * 977 + name.charCodeAt(0) * 31);
  let paths = "";
  for (const pts of strokes) {
    paths += '<path d="' + wobble(pts, rnd, 1.6) + '"/>';
    paths += '<path class="pe-thin" d="' + wobble(pts, rnd, 2.4) + '"/>';
  }
  return (svgCache[name] =
    '<svg viewBox="-4 -4 108 108" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + paths + "</svg>");
}

export const SKETCHES = Object.keys(STROKES);

// rect: { x, y, w, h } in pad pixels, or fractions of the pad when all are <= 1.
// Default is a roomy spot near the top right; the server knows the real empty corner.
export function createSketchHint(padElement) {
  injectStyles();
  const box = el("div", "pe-sketch", padElement);
  let current = null;
  let hideTimer = 0;

  function place(rect) {
    const r = rect || { x: 0.66, y: 0.1, w: 0.26, h: 0.5 };
    const frac = r.x <= 1 && r.y <= 1 && r.w <= 1 && r.h <= 1;
    const u = frac ? (v) => v * 100 + "%" : (v) => v + "px";
    box.style.left = u(r.x);
    box.style.top = u(r.y);
    box.style.width = u(r.w);
    box.style.height = u(r.h);
  }

  function show(sketch, rect) {
    if (!STROKES[sketch]) return hide();
    clearTimeout(hideTimer);
    if (current !== sketch) {
      box.classList.remove("pe-on");
      box.innerHTML = sketchSvg(sketch);
      current = sketch;
    }
    place(rect);
    // next frame so the opacity transition runs from 0
    requestAnimationFrame(() => box.classList.add("pe-on"));
  }

  function hide() {
    box.classList.remove("pe-on");
    current = null;
    hideTimer = setTimeout(() => {
      if (!current) box.innerHTML = "";
    }, 2500);
  }

  return { show, hide, update: () => {}, destroy: () => (clearTimeout(hideTimer), box.remove()) };
}

// ---------------------------------------------------------------- counter

// copy: { left: "{left} OF {max} DRAWINGS LEFT", none: "NO DRAWINGS LEFT {where}", space: "IN SPACE", planet: "ON THE PLANET" }
// A slanted chip: outlined text and one gold pip per drawing left (dark pips for the used ones); red when none are left.
export function createDrawCounter(container, copy = {}) {
  injectStyles();
  const T = {
    left: "{left} OF {max} DRAWINGS LEFT",
    none: "NO DRAWINGS LEFT {where}",
    space: "IN SPACE",
    planet: "ON THE PLANET",
    ...copy,
  };
  const root = el("div", "pe-count", container);
  const txt = el("span", "pe-ctxt", root, "");
  const pipsEl = el("span", "pe-pips", root);
  let pips = [];
  let lastKey = "";

  function update(s) {
    if (!s) return;
    const max = Math.max(1, s.max | 0);
    const left = Math.max(0, Math.min(max, s.left | 0));
    const key = left + "/" + max + "/" + s.world;
    if (key === lastKey) return;
    lastKey = key;
    if (pips.length !== max) {
      pipsEl.textContent = "";
      pips = [];
      for (let i = 0; i < max; i++) pips.push(el("i", "pe-pip", pipsEl));
    }
    for (let i = 0; i < max; i++) pips[i].classList.toggle("pe-full", i < left);
    const closed = left === 0;
    root.classList.toggle("pe-closed", closed);
    txt.textContent = closed
      ? T.none.replace("{where}", s.world === "planet" ? T.planet : T.space)
      : T.left.replace("{left}", left).replace("{max}", max);
  }

  return { update, destroy: () => root.remove() };
}

// ---------------------------------------------------------------- radar

const TAU = Math.PI * 2;
const NO_ITEMS = [];
// Radar kinds in drawing order (0 = you: always the arrow in the middle). Anything unknown counts as hostile.
const radarCode = (k) => (k === "you" ? 0 : k === "player" ? 1 : k === "objective" ? 3 : k === "boss" ? 4 : 2);

// A chunky round radar, heading-up: you are the cyan arrow in the middle looking up. Items are
// { kind: "you"|"player"|"boss"|"target"|"objective", dx, dz, dy } in metres (dx to my right, dz ahead), as hud().radar
// gives them; ahead (+dz) is drawn UP (y = c - dz * k). A dark translucent disc with a 3 px dark outline and a bright cyan
// rim keeps it readable on bright scenes; every blip has a dark outline: blue-white dots = players (dim on the rim when out
// of range), small red dots = hostile shots, gold diamond = the objective, red burst = the boss (both pinned to the rim
// when out of range). The static disc is painted once; update() allocates nothing (it runs up to 10 times a second).
export function createRadar(canvas, { size = 84, range = 300 } = {}) {
  injectStyles();
  const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
  canvas.classList.add("pe-radar");
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  const s = canvas.width;
  const c = s / 2;
  const u = dpr;
  const R = c - 5 * u; // the disc; its outline and the hard drop shadow fit inside the canvas
  const RIN = R - 7 * u; // blips stay inside the cyan rim; out-of-range ones sit on this ring
  // the boss burst, 8 points (offsets computed once)
  const BX = new Float32Array(16);
  const BY = new Float32Array(16);
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8 - Math.PI / 2;
    const r = (k & 1 ? 3.6 : 7) * u;
    BX[k] = Math.cos(a) * r;
    BY[k] = Math.sin(a) * r;
  }

  function paintBase(g) {
    g.clearRect(0, 0, s, s);
    // hard drop shadow (a crescent under the disc, like the panels' 0 4px 0 shadow)
    g.fillStyle = "#0a0830";
    g.beginPath();
    g.arc(c, c + 3 * u, R + 1.5 * u, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(c, c, R + 1.5 * u, 0, TAU);
    g.fill();
    g.globalCompositeOperation = "source-over";
    // dark translucent disc
    g.fillStyle = "rgba(13,11,46,0.72)";
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();
    // heading-up view cone, half-range ring and cross
    g.fillStyle = "rgba(25,211,255,0.14)";
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, RIN, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath();
    g.fill();
    g.lineWidth = u;
    g.strokeStyle = "rgba(255,255,255,0.2)";
    g.beginPath();
    g.arc(c, c, RIN * 0.5, 0, TAU);
    g.moveTo(c - RIN, c);
    g.lineTo(c + RIN, c);
    g.moveTo(c, c - RIN);
    g.lineTo(c, c + RIN);
    g.stroke();
    // bright cyan inner rim, then the 3 px dark outline
    g.lineWidth = 2.5 * u;
    g.strokeStyle = "#19d3ff";
    g.beginPath();
    g.arc(c, c, R - 2.75 * u, 0, TAU);
    g.stroke();
    g.lineWidth = 3 * u;
    g.strokeStyle = "#120a2e";
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.stroke();
  }

  let base = null;
  if (ctx && typeof document !== "undefined") {
    const b = document.createElement("canvas");
    b.width = b.height = s;
    const g = b.getContext && b.getContext("2d");
    if (g) {
      paintBase(g);
      base = b;
    }
  }

  // Adds the blips of one kind to the current path; players come in two passes (in range, then out of range).
  function addBlips(list, n, code, rr, wantFar) {
    let count = 0;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      if (!it || radarCode(it.kind) !== code) continue;
      const dx = +it.dx;
      const dz = +it.dz;
      if (dx !== dx || dz !== dz) continue; // NaN
      const d = Math.sqrt(dx * dx + dz * dz);
      const far = d > rr;
      if (code === 1 ? far !== wantFar : code === 2 && far) continue; // far hostile shots are left out
      const k = (far ? RIN : (d / rr) * RIN) / (d || 1);
      const x = c + dx * k;
      const y = c - dz * k; // ahead (+dz) is up
      if (code === 4) {
        ctx.moveTo(x + BX[0], y + BY[0]);
        for (let j = 1; j < 16; j++) ctx.lineTo(x + BX[j], y + BY[j]);
        ctx.closePath();
      } else if (code === 3) {
        const z = 5.5 * u;
        ctx.moveTo(x, y - z);
        ctx.lineTo(x + z, y);
        ctx.lineTo(x, y + z);
        ctx.lineTo(x - z, y);
        ctx.closePath();
      } else {
        const r = (code === 2 ? 2.3 : far ? 2.5 : 3.5) * u;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      count++;
    }
    return count;
  }

  let lastKey = 0;
  let drawn = false;
  let lastRange = range > 0 ? range : 300;

  function update(items, r) {
    if (!ctx) return;
    const list = items || NO_ITEMS;
    const n = list.length | 0;
    const rr = r > 0 ? r : lastRange;
    // change key: an integer hash of kinds and positions at about half a CSS pixel (no strings, no arrays)
    const q = rr / 80;
    let h = Math.round(rr) | 0;
    for (let i = 0; i < n; i++) {
      const it = list[i];
      if (!it) continue;
      h = (Math.imul(h, 31) + radarCode(it.kind)) | 0;
      h = (Math.imul(h, 31) + (Math.round(it.dx / q) | 0)) | 0;
      h = (Math.imul(h, 31) + (Math.round(it.dz / q) | 0)) | 0;
    }
    h = (Math.imul(h, 31) + n) | 0;
    if (drawn && h === lastKey) return;
    drawn = true;
    lastKey = h;
    lastRange = rr;

    ctx.clearRect(0, 0, s, s);
    if (base) ctx.drawImage(base, 0, 0);
    else paintBase(ctx);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#120a2e";
    // players out of range: small and dim on the rim
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#bfe6ff";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    if (addBlips(list, n, 1, rr, true)) {
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // players in range
    ctx.lineWidth = 1.8 * u;
    ctx.beginPath();
    if (addBlips(list, n, 1, rr, false)) {
      ctx.fill();
      ctx.stroke();
    }
    // hostile shots
    ctx.fillStyle = "#ff3b5c";
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    if (addBlips(list, n, 2, rr, false)) {
      ctx.fill();
      ctx.stroke();
    }
    // the objective
    ctx.fillStyle = "#ffcb3d";
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    if (addBlips(list, n, 3, rr, false)) {
      ctx.fill();
      ctx.stroke();
    }
    // the boss
    ctx.fillStyle = "#ff3b5c";
    ctx.beginPath();
    if (addBlips(list, n, 4, rr, false)) {
      ctx.fill();
      ctx.stroke();
    }
    // you
    ctx.fillStyle = "#19d3ff";
    ctx.beginPath();
    ctx.moveTo(c, c - 8 * u);
    ctx.lineTo(c + 6 * u, c + 6 * u);
    ctx.lineTo(c, c + 3 * u);
    ctx.lineTo(c - 6 * u, c + 6 * u);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  update(NO_ITEMS, lastRange);
  return { update, destroy: () => canvas.classList.remove("pe-radar") };
}

// ---------------------------------------------------------------- example sketches

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// handwriting on iPhone (Marker Felt / Chalkboard SE); elsewhere Comic Sans, then the page's Barlow, never a script font
const HAND = "Marker Felt,Chalkboard SE,Comic Sans MS,Barlow,sans-serif";
const GRAPHITE = "#3d3c48"; // pencil strokes
const GRAPHITE_TEXT = "#2c2a38"; // pencil handwriting
const f1 = (v) => String(Math.round(v * 10) / 10);

// A pencil circle, ellipse or arc as a polyline. A full circle overshoots its start a little, as a hand does.
function ring(cx, cy, rx, ry = rx, a0 = -1.9, sweep = TAU + 0.45) {
  const n = Math.max(8, Math.round((Math.abs(sweep) * (rx + ry)) / 12));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

// a closed outline that overshoots its start a little
const loop = (pts) => pts.concat([pts[0], [pts[0][0] + (pts[1][0] - pts[0][0]) * 0.3, pts[0][1] + (pts[1][1] - pts[0][1]) * 0.3]]);

function rbox(x0, y0, x1, y1, r) {
  const k = r * 0.29;
  return loop([
    [x0 + r, y0], [x1 - r, y0], [x1 - k, y0 + k], [x1, y0 + r], [x1, y1 - r], [x1 - k, y1 - k],
    [x1 - r, y1], [x0 + r, y1], [x0 + k, y1 - k], [x0, y1 - r], [x0, y0 + r], [x0 + k, y0 + k],
  ]);
}

// a shaft plus a V head at its last point
function arrow(pts) {
  const [x1, y1] = pts[pts.length - 1];
  const [x0, y0] = pts[pts.length - 2];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const bx = x1 - ux * 6.5;
  const by = y1 - uy * 6.5;
  return [pts, [[bx - uy * 4.2, by + ux * 4.2], [x1, y1], [bx + uy * 4.2, by - ux * 4.2]]];
}

// The example drawings, in a 240x160 box (the card is paper-white; its top-left corner carries the page's EXAMPLE tag,
// so nothing important sits there). main: outlines (drawn twice, as pencil does), thin: shading and small details,
// dots: small solid pencil dots.
const ART = {
  ship: () => ({
    main: [
      // hull, nose to the right, with a round window
      loop([[58, 58], [96, 51], [150, 50], [188, 54], [210, 64], [218, 72], [210, 80], [188, 90], [150, 94], [96, 93], [58, 87], [53, 72]]),
      ring(176, 70, 10),
      // fins
      [[84, 54], [73, 32], [97, 33], [118, 51]],
      [[84, 90], [73, 112], [97, 111], [118, 93]],
      // exhaust and its flames
      [[58, 60], [45, 62], [45, 82], [58, 84]],
      [[45, 63], [32, 57], [36, 65], [14, 62], [28, 71], [6, 74], [28, 78], [16, 88], [36, 82], [45, 81]],
      [[45, 67], [34, 67], [38, 71], [26, 73], [38, 76], [34, 79], [45, 78]],
      // the cannon under the nose, with a bang
      [[166, 92], [167, 99], [187, 99], [188, 90]],
      loop([[160, 99], [214, 99], [214, 107], [160, 107]]),
      [[214, 96], [220, 96], [220, 110], [214, 110]],
      [[225, 97], [233, 92]],
      [[226, 103], [236, 103]],
      [[225, 109], [233, 114]],
      // arrows from the words to the parts
      ...arrow([[26, 121], [25, 110], [22, 98]]),
      ...arrow([[212, 121], [208, 116], [203, 110]]),
    ],
    thin: [
      [[170, 67], [172, 64], [176, 62]], // window shine
      [[112, 52], [113, 92]], // panel seam
      [[200, 18], [200, 30]], [[194, 24], [206, 24]], // sparkles
      [[224, 38], [224, 46]], [[220, 42], [228, 42]],
    ],
  }),
  explorer: () => ({
    main: [
      [[6, 118], [60, 117], [120, 119], [180, 117], [234, 118]], // the ground
      // the astronaut, waving
      ring(56, 50, 16),
      ring(58, 50, 10, 7),
      loop([[42, 66], [70, 66], [76, 72], [76, 96], [70, 100], [42, 100], [36, 96], [36, 72]]),
      loop([[48, 74], [64, 74], [64, 84], [48, 84]]),
      [[36, 73], [28, 85], [30, 95]],
      ring(30, 99, 4),
      [[76, 73], [86, 62], [90, 51]],
      ring(90, 47, 4.5),
      [[44, 100], [44, 114], [38, 117], [54, 117], [54, 100]],
      [[60, 100], [60, 117], [76, 117], [70, 114], [70, 100]],
      // the car, seen from the side, nose to the right
      ring(140, 106, 12),
      ring(206, 106, 12),
      [[114, 104], [114, 88], [124, 82], [136, 64], [176, 62], [196, 80], [226, 83], [234, 92], [234, 104]].concat(
        ring(206, 106, 15, 15, -0.13, 0.26 - Math.PI),
        ring(140, 106, 15, 15, -0.13, 0.26 - Math.PI),
        [[114, 104], [114, 99]],
      ),
      loop([[132, 80], [142, 67], [156, 66], [156, 80]]),
      loop([[162, 66], [174, 66], [188, 80], [162, 80]]),
      [[159, 82], [159, 102]],
      ring(106, 97, 4.5), // exhaust puffs
      ring(96, 90, 3),
    ],
    thin: [
      [[52, 54], [58, 45]], [[57, 56], [64, 46]], // visor shine
      [[97, 41], [101, 36]], [[99, 48], [105, 47]], // waving
      [[138, 78], [146, 69]], [[146, 78], [152, 71]], [[166, 78], [172, 69]], [[174, 78], [179, 72]], // glass
      [[164, 87], [170, 87]], // door handle
      ring(229, 89, 2.5), // headlight
    ],
    dots: [[140, 106, 3.5], [206, 106, 3.5], [52, 79, 1.7], [59, 79, 1.7]],
  }),
  controller: () => ({
    main: [
      // the stick: a big circle, its knob and four little arrows
      ring(62, 72, 36),
      ring(62, 72, 12),
      [[57, 52], [62, 47], [67, 52]],
      [[57, 92], [62, 97], [67, 92]],
      [[42, 67], [37, 72], [42, 77]],
      [[82, 67], [87, 72], [82, 77]],
      // two buttons: a box with a word in it
      rbox(124, 24, 232, 70, 9),
      rbox(124, 80, 214, 116, 9),
    ],
    thin: [],
    dots: [[62, 72, 3]],
  }),
};

const EXAMPLE_COPY = {
  ship: { a: "flames = BOOST", b: "cannon = SHOOT" },
  controller: { stick: "circle = STEER", boxA: "FIRE", boxB: "BOOST", note: "box + word = button" },
  explorer: { a: "astronaut", b: "car, from the side" },
};

// rough width of handwritten text in em, erring wide so the words never overflow the card
function emWidth(t) {
  let w = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === " ") w += 0.3;
    else if (".,:;'!|".includes(ch)) w += 0.28;
    else if ("iljtfr".includes(ch)) w += 0.38;
    else if (ch === "m" || ch === "w") w += 0.78;
    else if (ch === "M" || ch === "W") w += 0.9;
    else if (ch === "I") w += 0.36;
    else if (ch >= "A" && ch <= "Z") w += 0.72;
    else w += 0.58;
  }
  return w || 1;
}

// a natural break into two lines: "car," / "from the side", "flames =" / "BOOST"; else the space nearest the middle
function splitLabel(t) {
  let i = t.indexOf(", ");
  if (i > 0) return { rows: [t.slice(0, i + 1), t.slice(i + 2)], natural: true };
  i = t.indexOf(" = ");
  if (i > 0) return { rows: [t.slice(0, i + 2), t.slice(i + 3)], natural: true };
  let best = -1;
  for (let k = 1; k < t.length - 1; k++) {
    if (t[k] === " " && (best < 0 || Math.abs(k - t.length / 2) < Math.abs(best - t.length / 2))) best = k;
  }
  return best > 0 ? { rows: [t.slice(0, best), t.slice(best + 1)], natural: false } : null;
}

// capitalised words (BOOST, SHOOT, MOVE…) written bolder
const loud = (row) =>
  row
    .split(" ")
    .map((wd) => (wd.length > 1 && /[A-Z]/.test(wd) && wd === wd.toUpperCase() ? '<tspan font-weight="700">' + esc(wd) + "</tspan>" : esc(wd)))
    .join(" ");

const clean = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").trim();

// A handwritten label that fits `w`: one line, or two at a natural break when that is not smaller. The font shrinks to fit
// (down to 9); a label still too long is squeezed with textLength. y is the first baseline (the last one when `up`).
function label(text, x, y, w, maxFs, { lines = 2, anchor = "middle", up = false } = {}) {
  const t = clean(text);
  if (!t) return "";
  const room = w * 0.94;
  let rows = [t];
  let fs = Math.min(maxFs, room / emWidth(t));
  if (lines > 1) {
    const two = splitLabel(t);
    if (two) {
      const fs2 = Math.min(maxFs, room / Math.max(emWidth(two.rows[0]), emWidth(two.rows[1])));
      if (fs2 >= fs * (two.natural ? 1 : 1.12)) {
        rows = two.rows;
        fs = fs2;
      }
    }
  }
  fs = Math.max(9, fs);
  const lh = fs * 1.12;
  const y0 = up ? y - lh * (rows.length - 1) : y;
  let out = '<text x="' + x + '" y="' + f1(y0) + '" font-size="' + f1(fs) + '" text-anchor="' + anchor + '">';
  for (let i = 0; i < rows.length; i++) {
    const squeeze = emWidth(rows[i]) * fs > room ? ' textLength="' + f1(room) + '" lengthAdjust="spacingAndGlyphs"' : "";
    out += '<tspan x="' + x + '"' + (i ? ' dy="' + f1(lh) + '"' : "") + squeeze + ">" + loud(rows[i]) + "</tspan>";
  }
  return out + "</text>";
}

// the word written inside a button box, as big as the box allows (short words like DIG stay big, long ones shrink)
function boxWord(text, cx, cy, w, maxFs) {
  const t = clean(text);
  if (!t) return "";
  const room = w * 0.94;
  const fs = Math.max(9, Math.min(maxFs, room / emWidth(t)));
  const squeeze = emWidth(t) * fs > room ? ' textLength="' + f1(room) + '" lengthAdjust="spacingAndGlyphs"' : "";
  return (
    '<text x="' + cx + '" y="' + f1(cy + fs * 0.36) + '" font-size="' + f1(fs) + '" font-weight="700" text-anchor="middle"' + squeeze + ">" +
    esc(t) + "</text>"
  );
}

const artCache = {};

// the drawing of one kind as pencil strokes: seeded wobble, so it is the same every time (built once per kind)
function pencilArt(kind) {
  if (artCache[kind]) return artCache[kind];
  const art = ART[kind]();
  const rnd = rng(kind.length * 7919 + kind.charCodeAt(0) * 131);
  let main = "";
  let ghost = "";
  let thin = "";
  let dots = "";
  for (const pts of art.main) {
    main += '<path d="' + wobble(pts, rnd, 1.1, 7) + '"/>';
    ghost += '<path d="' + wobble(pts, rnd, 1.9, 11) + '"/>';
  }
  for (const pts of art.thin || []) thin += '<path d="' + wobble(pts, rnd, 0.8, 6) + '"/>';
  for (const d of art.dots || []) dots += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="' + d[2] + '"/>';
  return (artCache[kind] =
    '<g fill="none" stroke="' + GRAPHITE + '" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke-width="2.5">' + main + "</g>" +
    '<g stroke-width="1.1" opacity=".4">' + ghost + "</g>" +
    '<g stroke-width="1.4" opacity=".7">' + thin + "</g></g>" +
    '<g fill="' + GRAPHITE + '">' + dots + "</g>");
}

// The little pencil-on-paper examples of the drawing steps, as static inline SVG strings (no script, no external refs;
// the words are escaped). labels: the words written on them.
//   ship:       { a: "flames = BOOST", b: "cannon = SHOOT" }
//   controller: { stick: "circle = STEER", boxA: "FIRE", boxB: "BOOST", note: "box + word = button" }
//               (the planet controller: { stick: "circle = MOVE", boxA: "DIG", boxB: "DRILL", note })
//   explorer:   { a: "astronaut", b: "car, from the side" }
export function exampleSvg(kind, labels = {}) {
  if (kind !== "ship" && kind !== "explorer" && kind !== "controller") return "";
  const L = { ...EXAMPLE_COPY[kind], ...labels };
  let words;
  if (kind === "ship") {
    // under the flames (left) and under the cannon (right)
    words = label(L.a, 8, 155, 110, 17, { anchor: "start", up: true }) + label(L.b, 184, 155, 112, 17, { up: true });
  } else if (kind === "explorer") {
    // under the astronaut, above the car
    words = label(L.a, 56, 152, 104, 17, { up: true }) + label(L.b, 176, 26, 114, 17);
  } else {
    words =
      boxWord(L.boxA, 178, 47, 90, 26) +
      boxWord(L.boxB, 169, 98, 74, 21) +
      label(L.stick, 62, 129, 120, 17) +
      label(L.note, 180, 133, 112, 14);
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    pencilArt(kind) +
    '<g font-family="' + HAND + '" font-weight="400" fill="' + GRAPHITE_TEXT + '">' + words + "</g></svg>"
  );
}
