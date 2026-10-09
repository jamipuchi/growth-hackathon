// Phone HUD extras: vitals bars, hand-drawn hint sketches, drawing counter.
// No dependencies. update() only writes values that changed, and only touches
// transform / opacity / textContent, so it never forces layout.

const STYLE_ID = "pe-styles";

const CSS = `
.pe-vitals{display:flex;flex-direction:column;gap:5px;width:132px;pointer-events:none;
  font:600 8px/1 -apple-system,"SF Pro Text",system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#8fdcf0}
.pe-row{position:relative}
.pe-lab{display:flex;justify-content:space-between;margin-bottom:3px;opacity:.85;white-space:nowrap}
.pe-track{position:relative;height:3px;background:rgba(120,200,230,.16);border-radius:2px;overflow:hidden}
.pe-fill{position:absolute;inset:0;transform-origin:0 50%;border-radius:2px;will-change:transform}
.pe-hp .pe-fill{background:linear-gradient(90deg,#ff3b3b,#ff9a3c);box-shadow:0 0 6px rgba(255,90,60,.8)}
.pe-hp .pe-lab{color:#ff9d8a}
.pe-sh .pe-fill,.pe-bo .pe-fill{background:linear-gradient(90deg,#27c4ff,#8ff3ff);box-shadow:0 0 6px rgba(80,220,255,.8)}
.pe-hp .pe-track{height:4px}
.pe-flash{position:absolute;inset:-4px -6px;border-radius:4px;background:rgba(255,70,50,.55);opacity:0;pointer-events:none}
.pe-dead .pe-hp .pe-lab span:first-child{color:#ff6a5a;animation:pe-blink 1s steps(2,jump-none) infinite}
.pe-dead .pe-hp .pe-fill{opacity:.25}
.pe-low .pe-fill{animation:pe-blink .8s steps(2,jump-none) infinite}
@keyframes pe-blink{50%{opacity:.35}}

.pe-sketch{position:absolute;pointer-events:none;opacity:0;transition:opacity 2.4s ease-out;z-index:1}
.pe-sketch.pe-on{opacity:.3}
.pe-sketch svg{width:100%;height:100%;display:block;overflow:visible}
.pe-sketch path{fill:none;stroke:#d6f0ff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pe-sketch path.pe-thin{stroke-width:.9;opacity:.75}

.pe-count{display:flex;align-items:center;gap:8px;pointer-events:none;white-space:nowrap;
  font:600 9px/1 -apple-system,"SF Pro Text",system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#8fdcf0}
.pe-pips{display:flex;gap:4px}
.pe-pip{width:7px;height:7px;box-sizing:border-box;border:1px solid rgba(143,220,240,.7);border-radius:50%;
  transform:scale(.6);opacity:.4;transition:transform .2s,opacity .2s}
.pe-pip.pe-full{transform:scale(1);opacity:1;background:#8ff3ff;box-shadow:0 0 6px rgba(80,220,255,.9)}
.pe-closed .pe-txt{color:#ff9d8a}
.pe-closed .pe-pips{display:none}
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

function bar(parent, cls, label) {
  const row = el("div", "pe-row " + cls, parent);
  const lab = el("div", "pe-lab", row);
  const name = el("span", "", lab, label);
  const val = el("span", "", lab, "");
  const track = el("div", "pe-track", row);
  const fill = el("div", "pe-fill", track);
  fill.style.transform = "scaleX(0)";
  return { row, name, val, fill, last: -1 };
}

function setBar(b, frac) {
  const f = Math.round(clamp01(frac) * 200) / 200;
  if (f === b.last) return;
  b.last = f;
  b.fill.style.transform = "scaleX(" + f + ")";
}

export function createVitals(container) {
  injectStyles();
  const root = el("div", "pe-vitals", container);
  const hp = bar(root, "pe-hp", "HEALTH");
  const sh = bar(root, "pe-sh", "SHIELD");
  const bo = bar(root, "pe-bo", "BOOST");
  const flash = el("div", "pe-flash", hp.row);
  let prevHp = null;
  let lastText = "HEALTH";
  let lastDead = false;
  let lastLow = false;

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

    const text = dead ? "RESPAWN " + Math.max(1, Math.ceil(s.respawnIn || 0)) + "…" : "HEALTH";
    if (text !== lastText) {
      lastText = text;
      hp.name.textContent = text;
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

export function createDrawCounter(container) {
  injectStyles();
  const root = el("div", "pe-count", container);
  const txt = el("span", "pe-txt", root, "");
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
      ? "NO DRAWINGS LEFT " + (s.world === "planet" ? "ON THE PLANET" : "IN SPACE")
      : left + " OF " + max + " LEFT";
  }

  return { update, destroy: () => root.remove() };
}
