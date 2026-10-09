// Phone extras (v1.1 client track, Fortnite style): chunky HP / SHIELD / BOOST bars, hand-drawn hint sketches, the
// drawings-left counter, the radar, and the example sketches of the drawing steps.
// No dependencies. update() only writes values that changed, and only touches transform / opacity / textContent, so
// it never forces layout. Every user-facing string comes in through the `copy` argument (controller.html owns the COPY
// table); the defaults below only keep the module usable on its own (dev/phone-extras/demo.html).

const STYLE_ID = "pe-styles";
const HEAD_FONT = 'var(--f-head,"Barlow Condensed","Avenir Next Condensed","Arial Narrow",Impact,system-ui,sans-serif)';

const CSS = `
.pe-vitals{display:flex;flex-direction:column;gap:6px;width:158px;pointer-events:none;font-family:${HEAD_FONT}}
.pe-row{display:flex;align-items:center;gap:6px;position:relative;transition:opacity .25s}
.pe-row.pe-off{opacity:.45}
.pe-ico{flex:none;width:24px;height:24px;display:grid;place-items:center;border:2px solid #120a2e;border-radius:6px;
  box-shadow:0 3px 0 #0a0830;transform:skewX(-10deg)}
.pe-ico svg{width:14px;height:14px;transform:skewX(10deg);fill:#fff;stroke:#120a2e;stroke-width:1.6;stroke-linejoin:round}
.pe-hp .pe-ico{background:linear-gradient(#8dff7a,#2fbf4a)}
.pe-sh .pe-ico{background:linear-gradient(#8fd8ff,#2b7bff)}
.pe-bo .pe-ico{background:linear-gradient(#ffe27a,#ff8a1f)}
.pe-bar{position:relative;flex:1;height:22px}
.pe-track{position:absolute;inset:0;transform:skewX(-14deg);background:#0d0b2e;border:2px solid #120a2e;border-radius:3px;
  box-shadow:0 3px 0 #0a0830;overflow:hidden}
.pe-fill{position:absolute;inset:0;transform-origin:0 50%;will-change:transform}
.pe-hp .pe-fill{background:linear-gradient(#a6ff86,#32c24b)}
.pe-sh .pe-fill{background:linear-gradient(#a6e2ff,#2b7bff)}
.pe-bo .pe-fill{background:linear-gradient(#ffe88a,#ff8a1f)}
.pe-hp.pe-low .pe-fill{background:linear-gradient(#ff9a8a,#ff3b5c)}
.pe-txt{position:absolute;left:9px;right:8px;top:0;bottom:0;display:flex;align-items:center;justify-content:space-between;
  font-weight:900;font-style:italic;font-size:13px;line-height:1;letter-spacing:.05em;text-transform:uppercase;color:#fff;
  -webkit-text-stroke:2.5px #120a2e;paint-order:stroke fill;text-shadow:0 2px 0 rgba(10,6,30,.5);white-space:nowrap}
.pe-flash{position:absolute;inset:-4px -6px;border-radius:6px;background:rgba(255,59,92,.6);opacity:0;pointer-events:none}
.pe-dead .pe-hp .pe-txt span:first-child{color:#ffd0d8;animation:pe-blink 1s steps(2,jump-none) infinite}
.pe-dead .pe-hp .pe-fill{opacity:.25}
.pe-low .pe-fill{animation:pe-blink .6s steps(2,jump-none) infinite}
@keyframes pe-blink{50%{opacity:.4}}

.pe-sketch{position:absolute;pointer-events:none;opacity:0;transition:opacity 2.4s ease-out;z-index:1}
.pe-sketch.pe-on{opacity:.34}
.pe-sketch svg{width:100%;height:100%;display:block;overflow:visible}
.pe-sketch path{fill:none;stroke:#e9f4ff;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pe-sketch path.pe-thin{stroke-width:.9;opacity:.75}

.pe-count{display:inline-flex;align-items:center;gap:9px;pointer-events:none;white-space:nowrap;font-family:${HEAD_FONT};
  font-weight:900;font-style:italic;font-size:15px;line-height:1;letter-spacing:.04em;text-transform:uppercase;color:#fff;
  -webkit-text-stroke:2.5px #120a2e;paint-order:stroke fill;text-shadow:0 2px 0 rgba(10,6,30,.5)}
.pe-pips{display:flex;gap:4px}
.pe-pip{width:11px;height:11px;box-sizing:border-box;border:2px solid #120a2e;border-radius:2px;transform:skewX(-14deg) scale(.8);
  background:rgba(13,11,46,.7);transition:transform .2s,background .2s}
.pe-pip.pe-full{transform:skewX(-14deg) scale(1);background:linear-gradient(#ffe27a,#ffb000);box-shadow:0 2px 0 #0a0830}
.pe-ctxt{display:inline-block}
.pe-closed .pe-ctxt{color:#ffb3c0}
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
  const name = el("span", "", txt, label);
  const val = el("span", "", txt, "");
  return { row, name, val, fill, last: -1, lastVal: "" };
}

function setBar(b, frac) {
  const f = Math.round(clamp01(frac) * 200) / 200;
  if (f === b.last) return;
  b.last = f;
  b.fill.style.transform = "scaleX(" + f + ")";
}

// copy: { hp, shield, boost, respawn: "BACK IN {n}…" }
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
  let lastLow = false;
  let lastShOff = false;
  let lastBoOff = false;

  // s: { hp, maxHp, shieldEnergy, boostEnergy, dead, respawnIn, shieldOff?, boostOff? } (…Off dims a bar whose skill is locked)
  function update(s) {
    const maxHp = s.maxHp > 0 ? s.maxHp : 100;
    const dead = !!s.dead || s.hp <= 0;
    const frac = s.hp / maxHp;
    setBar(hp, frac);
    setBar(sh, s.shieldEnergy);
    setBar(bo, s.boostEnergy);

    if (prevHp != null && s.hp < prevHp && !dead && flash.animate) {
      flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: "ease-out" });
    }
    prevHp = s.hp;

    const text = dead ? T.respawn.replace("{n}", Math.max(1, Math.ceil(s.respawnIn || 0))) : T.hp;
    if (text !== lastText) {
      lastText = text;
      hp.name.textContent = text;
    }
    const val = dead ? "" : String(Math.max(0, Math.ceil(s.hp)));
    if (val !== hp.lastVal) {
      hp.lastVal = val;
      hp.val.textContent = val;
    }
    if (dead !== lastDead) {
      lastDead = dead;
      root.classList.toggle("pe-dead", dead);
    }
    const low = !dead && frac < 0.25;
    if (low !== lastLow) {
      lastLow = low;
      hp.row.classList.toggle("pe-low", low);
    }
    const shOff = !!s.shieldOff;
    if (shOff !== lastShOff) {
      lastShOff = shOff;
      sh.row.classList.toggle("pe-off", shOff);
    }
    const boOff = !!s.boostOff;
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

function wobble(pts, rnd, amp) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 9));
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

// A chunky round radar, heading-up: you are the gold arrow in the middle looking up. Items are
// { kind: "player"|"boss"|"target"|"objective", dx, dz } in metres (dx to my right, dz ahead), as hud().radar gives them.
export function createRadar(canvas, { size = 84, range = 300 } = {}) {
  injectStyles();
  const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
  canvas.classList.add("pe-radar");
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  let lastKey = "";
  let lastRange = range;

  function update(items, r) {
    const rng = r || lastRange;
    const key =
      rng + "|" + (items || []).map((i) => i.kind + Math.round(i.dx / 4) + "," + Math.round(i.dz / 4)).join("|");
    if (key === lastKey) return;
    lastKey = key;
    lastRange = rng;
    const s = canvas.width;
    const c = s / 2;
    const u = dpr;
    const R = c - 5 * u;
    ctx.clearRect(0, 0, s, s);
    // body: dark glass disc with a thick cyan ring and a dark outline
    ctx.fillStyle = "rgba(13,11,46,.78)";
    ctx.beginPath();
    ctx.arc(c, c, R, 0, 7);
    ctx.fill();
    ctx.lineWidth = 5 * u;
    ctx.strokeStyle = "#120a2e";
    ctx.beginPath();
    ctx.arc(c, c, R + 1.5 * u, 0, 7);
    ctx.stroke();
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = "#19d3ff";
    ctx.beginPath();
    ctx.arc(c, c, R, 0, 7);
    ctx.stroke();
    // rings and cross
    ctx.lineWidth = u;
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.beginPath();
    ctx.arc(c, c, R * 0.5, 0, 7);
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.stroke();
    // items
    for (const it of items || []) {
      if (it.kind === "you") continue;
      const d = Math.hypot(it.dx, it.dz);
      const k = (Math.min(1, d / rng) * (R - 7 * u)) / (d || 1);
      const x = c + it.dx * k;
      const y = c - it.dz * k; // ahead (+dz) is up
      ctx.lineWidth = 1.6 * u;
      ctx.strokeStyle = "#120a2e";
      if (it.kind === "objective" || it.kind === "boss") {
        const z = 6 * u;
        ctx.fillStyle = it.kind === "boss" ? "#ff3b5c" : "#ffcb3d";
        ctx.beginPath();
        ctx.moveTo(x, y - z);
        ctx.lineTo(x + z, y);
        ctx.lineTo(x, y + z);
        ctx.lineTo(x - z, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = it.kind === "player" ? "#7ad0ff" : "#ff3b5c";
        ctx.beginPath();
        ctx.arc(x, y, (it.kind === "player" ? 3.6 : 2.6) * u, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
    // you
    ctx.fillStyle = "#ffcb3d";
    ctx.strokeStyle = "#120a2e";
    ctx.lineWidth = 2 * u;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(c, c - 8 * u);
    ctx.lineTo(c + 6 * u, c + 6 * u);
    ctx.lineTo(c, c + 3 * u);
    ctx.lineTo(c - 6 * u, c + 6 * u);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  update([], range);
  return { update, destroy: () => canvas.classList.remove("pe-radar") };
}

// ---------------------------------------------------------------- example sketches

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const HAND = "Marker Felt,Chalkboard SE,Comic Sans MS,cursive";

// The little "drawn on paper" examples of the drawing steps, as inline SVG strings. labels: the words written on them.
//   ship:       { a: "flames = BOOST", b: "cannon = SHOOT" }
//   controller: { stick: "circle = STEER", boxA: "FIRE", boxB: "BOOST", note: "box + word = button" }
//   explorer:   { a: "astronaut", b: "car, from the side" }
export function exampleSvg(kind, labels = {}) {
  const L = labels;
  if (kind === "ship") {
    return (
      '<svg viewBox="0 0 240 150" aria-hidden="true"><rect width="240" height="150" rx="10" fill="#fffdf5"/>' +
      '<g fill="none" stroke="#1b1840" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M40 54C32 52 24 54 15 52c6 5 6 7 0 10-7 0-10-1-13 0 7 4 9 6 4 10 7-1 11 0 9 5 7-3 16 1 25 5z" fill="#ff8a1f"/>' +
      '<path d="M40 60c-7 0-13 0-20 2 5 3 6 5 1 7 6 0 12 2 19 7z" fill="#ffd23d" stroke-width="2"/>' +
      '<rect x="38" y="54" width="14" height="28" rx="2" fill="#d9d6ee"/>' +
      '<path d="M72 47 58 20h40l10 27z" fill="#ff5a6e"/><path d="M72 89 58 116h40l10-27z" fill="#ff5a6e"/>' +
      '<path d="M52 52l96-6c38 0 64 10 76 22-12 12-38 22-76 22L52 84c-4 0-6-8-6-16s2-16 6-16z" fill="#fff"/>' +
      '<circle cx="150" cy="67" r="12" fill="#8fd3ff"/><path d="M144 64q4-6 11-4" stroke-width="2"/>' +
      '<path d="M100 54v26" stroke-width="2" opacity=".45"/>' +
      '<path d="M164 90v8h12"/><rect x="170" y="93" width="44" height="11" rx="2" fill="#6c6a8f"/>' +
      '<rect x="210" y="90" width="9" height="17" rx="2" fill="#4a4870"/>' +
      '<path d="M226 97l10-4M226 102h12M226 108l10 4" stroke="#ff7a00" stroke-width="2.5"/></g>' +
      '<g font-family="' + HAND + '" font-weight="700" font-size="11.5">' +
      '<text x="5" y="143" fill="#e26a00">' + esc(L.a) + "</text>" +
      '<path d="M26 130c2-8 0-18-2-30" fill="none" stroke="#e26a00" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M19 105l5-7 6 6" fill="none" stroke="#e26a00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="128" y="143" fill="#3b5bff">' + esc(L.b) + "</text>" +
      '<path d="M170 130c6-4 16-6 20-16" fill="none" stroke="#3b5bff" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M183 114l8-3 2 8" fill="none" stroke="#3b5bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>'
    );
  }
  if (kind === "controller") {
    return (
      '<svg viewBox="0 0 240 130" aria-hidden="true"><rect width="240" height="130" rx="10" fill="#fffdf5"/>' +
      '<g fill="none" stroke="#1b1840" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="54" cy="58" r="34" fill="#eaf7ff"/><circle cx="54" cy="58" r="11" fill="#fff"/>' +
      '<rect x="112" y="14" width="112" height="42" rx="9" fill="#fff2f2"/><rect x="112" y="66" width="84" height="38" rx="9" fill="#fff8e6"/></g>' +
      '<g font-family="' + HAND + '" font-weight="700">' +
      '<text x="168" y="44" font-size="23" text-anchor="middle" fill="#1b1840">' + esc(L.boxA) + "</text>" +
      '<text x="154" y="92" font-size="19" text-anchor="middle" fill="#1b1840">' + esc(L.boxB) + "</text>" +
      '<text x="54" y="121" font-size="11.5" text-anchor="middle" fill="#0a8fbf">' + esc(L.stick) + "</text>" +
      '<text x="168" y="121" font-size="11.5" text-anchor="middle" fill="#0a8fbf">' + esc(L.note) + "</text></g></svg>"
    );
  }
  if (kind === "explorer") {
    return (
      '<svg viewBox="0 0 240 130" aria-hidden="true"><rect width="240" height="130" rx="10" fill="#fffdf5"/>' +
      '<g fill="none" stroke="#1b1840" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 108h228" stroke-width="2" stroke-dasharray="2 6"/>' +
      '<rect x="18" y="52" width="14" height="32" rx="4" fill="#c9c6e6"/>' +
      '<path d="M36 84v22h10l1-16M50 90l2 16h10V84" fill="#fff"/>' +
      '<rect x="30" y="48" width="36" height="42" rx="10" fill="#fff"/><rect x="40" y="58" width="16" height="10" rx="3" fill="#ff5a6e" stroke-width="2"/>' +
      '<path d="M66 58l12 12-6 6M30 58l-8 14"/>' +
      '<circle cx="48" cy="34" r="19" fill="#fff"/><path d="M38 30q10-6 22 0 2 12-10 14-12 0-12-14z" fill="#7cc8ff" stroke-width="2.5"/>' +
      '<path d="M104 100V86q0-6 8-8l16-12q4-4 12-4h30q8 0 12 6l10 10q14 2 16 10v12z" fill="#ffb000"/>' +
      '<path d="M132 76l10-9h14v11zM161 67h11l8 11h-19z" fill="#cfeaff" stroke-width="2.5"/>' +
      '<circle cx="124" cy="102" r="12" fill="#fff"/><circle cx="124" cy="102" r="4" fill="#1b1840"/>' +
      '<circle cx="188" cy="102" r="12" fill="#fff"/><circle cx="188" cy="102" r="4" fill="#1b1840"/></g>' +
      '<g font-family="' + HAND + '" font-weight="700" font-size="11.5" text-anchor="middle" fill="#e26a00">' +
      '<text x="46" y="124">' + esc(L.a) + "</text><text x=\"156\" y=\"124\">" + esc(L.b) + "</text></g></svg>"
    );
  }
  return "";
}
