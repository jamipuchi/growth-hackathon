// Astra HTML: the drawn controller, written by Sol as one self-contained HTML document (PLAN.md section 0, "The
// controller is written by Sol as HTML"). One gpt-6.1-sol call (Responses API, service tier ultrafast, reasoning
// effort low) gets the photo of the drawing plus the layout Astra already read from it and returns a clean sci-fi
// controller in the HUD style, laid out where the player drew each control. Everything after the call is plain
// code: the answer is checked here (size, no network, no storage, no escape from the frame, only allowed actions,
// every drawn control present) and on any failure the deterministic template below is used instead: same look,
// always works. The phone runs the result with ctrl-sandbox.js, whose kit does all the input handling.
//
//   generateControllerHtml({ image, layout, allowedActions, style, signal, timeoutMs, player })
//     → Promise<{ ok: true, html, controls: [{ action, kind: "button"|"stick"|"toggle", label }],
//                 source: "model"|"template", ms, bytes, error?, warnings? }
//       | { ok: false, error }                       // only when the layout has no usable control at all
//     image: PNG/JPEG data URL of the drawing (optional; without it Sol works from the layout alone).
//     layout: contract layout v2 { buttons: [{ type, action, label, x, y, w, h }] } (fractions of the drawing,
//       which maps onto the whole play area). allowedActions: the actions the HTML may use (default: the
//       layout's own). style: { accent: "#2f8bff" } (stick knob colour). error says why the model's HTML was not used.
//   templateHtml(layout, { allowedActions, style }) → html          (sync, deterministic, < 1 ms)
//   validateHtml(html, { allowedActions, layout }) → { ok, errors, warnings, controls, bytes }
//
// Markup contract (kit v1, dev/v12-modules/SPEC.md): buttons carry data-action (+ data-toggle), sticks
// data-stick="steer"|"move" with a data-knob child, labels data-label; the kit sets .is-down/.is-on/.is-disabled.
//
// Env: OPENAI_API_KEY (else a .env next to this file, the same loader as astra.js), OPENAI_MODEL,
// OPENAI_SERVICE_TIER ("" or "none" omits it), ASTRA_HTML_EFFORT (default low), ASTRA_HTML_TIMEOUT_MS,
// ASTRA_HTML_CALL_LOG (append one JSON line per model call), ASTRA_MOCK=1 (no network: the template, at once).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Contract = require("./contract.js");
const Verbs = require("./verbs.js");

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-6.1-sol";
const DEFAULT_TIER = "ultrafast";
const DEFAULT_EFFORT = "low";
const TIMEOUT_MS = 45000;
const MAX_HTML_BYTES = 60 * 1024;
const MAX_OUTPUT_TOKENS = 12000;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_CONTROLS = 16;
const MIN_TOUCH_PX = 56;
const MIN_STICK_PX = 110;
const ACCENT = "#2f8bff";   // stick knobs and the default line of the HUD blue
const STICKS = Verbs.STICKS;
const ACTIONS = [...Object.keys(Verbs.VERBS), ...Verbs.MOVES, ...Verbs.STICKS, ...Contract.META_ACTIONS];

let fetchImpl = (...args) => globalThis.fetch(...args);
let timeoutMs = Number(process.env.ASTRA_HTML_TIMEOUT_MS) || TIMEOUT_MS;
let defaultTierOnly = false;
let envKey;
const cache = new Map();     // key → result (newest 64)
const inflight = new Map();  // key → { promise, controller, owners }

function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (envKey === undefined) {
    envKey = null;
    try {
      const text = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
      const match = text.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/m);
      if (match) envKey = match[1].trim().replace(/^["']|["']$/g, "") || null;
    } catch {}
  }
  return envKey;
}

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const round3 = (v) => Math.round(v * 1000) / 1000;
const fix = (v) => +v.toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- Layout → controls -------------------------------------------------------------------------------------------

function allowedSet(allowedActions, controls) {
  const list = Array.isArray(allowedActions) && allowedActions.length ? allowedActions : controls.map((c) => c.action);
  return new Set(list.map((a) => Contract.normaliseAction(a)));
}

// The layout's controls, cleaned like Contract.CHECKS.layout: known actions, rectangles inside 0..1, sticks only
// for steer/move. Controls whose action is not allowed are dropped (reported in `dropped`).
function cleanLayout(layout, allowedActions) {
  const raw = layout && Array.isArray(layout.buttons) ? layout.buttons.slice(0, MAX_CONTROLS) : [];
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const action = Contract.normaliseAction(b.action || "");
    if (!ACTIONS.includes(action)) continue;
    let type = ["button", "stick", "toggle"].includes(b.type) ? b.type : "button";
    if (STICKS.includes(action)) type = "stick";
    else if (type === "stick") type = "button";
    const x = clamp01(b.x), y = clamp01(b.y);
    const w = Math.max(0.02, Math.min(clamp01(b.w), 1 - x)), h = Math.max(0.02, Math.min(clamp01(b.h), 1 - y));
    const label = String(b.label ?? "").replace(/[^\p{L}\p{N} +\-!?.#*<>^←→↑↓◀▶▲▼⬅➡⬆⬇]/gu, "").trim().toUpperCase().slice(0, 16);
    out.push({ type, action, label, x: round3(x), y: round3(y), w: round3(w), h: round3(h) });
  }
  const allowed = allowedSet(allowedActions, out);
  return { controls: out.filter((c) => allowed.has(c.action)), dropped: out.filter((c) => !allowed.has(c.action)).map((c) => c.action), allowed };
}

// ---- Template: the same look, built in code ----------------------------------------------------------------------

// Stroke icons on a 24 × 24 grid, drawn in the line colour.
const ICONS = {
  shoot: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2"/><circle cx="12" cy="12" r="1.3" class="f"/>',
  boost: '<path d="M4.5 6l6 6-6 6M12 6l6 6-6 6"/>',
  shield: '<path d="M12 2.8l7.2 3v5.6c0 4.4-3 8-7.2 9.8-4.2-1.8-7.2-5.4-7.2-9.8V5.8z"/><path d="M12 7v10" class="d"/>',
  blast: '<path d="M12 2.5l2.1 5.4 5.6-1.6-3.2 4.9 4.2 3.8-5.8.4-.8 5.8-3.3-4.7-4.8 3.1 1.3-5.6L2.5 12.8l5.4-2.1-1.4-5.6 4.9 3z"/>',
  drill: '<path d="M7.5 2.8h9v4h-9zM9 6.8h6l-3 14.4z"/><path d="M9.6 10.4l4.6-1.4M10.4 14l3.2-1"/>',
  land: '<path d="M12 2.8v8.4M8.4 7.8L12 11.4l3.6-3.6"/><path d="M5 15.6h14M7.6 15.6l-2.2 4.6M16.4 15.6l2.2 4.6M3.4 20.2h4M16.6 20.2h4"/>',
  takeoff: '<path d="M12 2.4c3 2.6 4.2 6.2 4.2 9.8l-2.2 3.2h-4L7.8 12.2c0-3.6 1.2-7.2 4.2-9.8z"/><circle cx="12" cy="9" r="1.6"/><path d="M10.4 17.6l-1 3.6M13.6 17.6l1 3.6M12 18v3.8"/>',
  dig: '<path d="M12 2.8v10.4M9 2.8h6"/><path d="M7.8 13.2h8.4l-.9 5.2L12 21.4l-3.3-3z"/>',
  scan: '<circle cx="12" cy="12" r="1.6" class="f"/><path d="M12 12l6.6-5.6"/><path d="M4.8 15.6A8 8 0 0 1 8 4.9M19.2 8.4A8 8 0 0 1 16 19.1M8.4 13.6a4 4 0 0 1 1.5-5.1"/>',
  flare: '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2M5.4 5.4l2.2 2.2M16.4 16.4l2.2 2.2M5.4 18.6l2.2-2.2M16.4 7.6l2.2-2.2"/>',
  heal: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4"/><path d="M12 7.6v8.8M7.6 12h8.8"/>',
  invisible: '<path d="M2.6 12s3.4-6 9.4-6 9.4 6 9.4 6-3.4 6-9.4 6-9.4-6-9.4-6z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.4 19.6L19.6 4.4"/>',
  teleport: '<ellipse cx="12" cy="12.6" rx="5.2" ry="8.4"/><ellipse cx="12" cy="12.6" rx="2" ry="4.4"/><path d="M19.4 2.6v3.6M17.6 4.4h3.6"/>',
  jump: '<path d="M12 18.6V5.4M7.2 10.2L12 5.4l4.8 4.8"/><path d="M5.6 21h12.8"/>',
  shapeshift: '<path d="M4.6 9.4a7.6 7.6 0 0 1 13.6-2.6M19.4 14.6a7.6 7.6 0 0 1-13.6 2.6"/><path d="M18.6 3.4v3.6H15M5.4 20.6v-3.6H9"/>',
  grapple: '<path d="M12 2.6v10.6"/><path d="M6.6 12.4a5.4 5.4 0 0 0 10.8 0"/><path d="M6.6 12.4L4.6 10M17.4 12.4l2-2.4"/>',
  drive: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.6v6.2M12 14.2v6.2M3.6 12h6.2M14.2 12h6.2"/>',
  fly: '<path d="M12 9.6c-2.6-3.6-6.6-4.6-9.4-3.6 1.6 3.6 5 6 9.4 6.4 4.4-.4 7.8-2.8 9.4-6.4-2.8-1-6.8 0-9.4 3.6z"/><path d="M12 12.4v6.4"/>',
  swim: '<path d="M2.6 9.2c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 4.8-1M2.6 15.2c2.4-2 4.6-2 7 0s4.6 2 7 0 3.4-1.4 4.8-1"/>',
  left: '<path d="M14.6 5.4L8 12l6.6 6.6"/>',
  right: '<path d="M9.4 5.4L16 12l-6.6 6.6"/>',
  up: '<path d="M5.4 14.6L12 8l6.6 6.6"/>',
  down: '<path d="M5.4 9.4L12 16l6.6-6.6"/>',
  forward: '<path d="M5.4 12.6L12 6l6.6 6.6M5.4 18.6L12 12l6.6 6.6"/>',
  back: '<path d="M5.4 5.4L12 12l6.6-6.6M5.4 11.4L12 18l6.6-6.6"/>',
  strafeleft: '<path d="M10.6 5.4L4 12l6.6 6.6M20 12H5"/>',
  straferight: '<path d="M13.4 5.4L20 12l-6.6 6.6M4 12h15"/>',
  rise: '<path d="M12 19V6M6.6 11.4L12 6l5.4 5.4M5 3.4h14"/>',
  sink: '<path d="M12 5v13M6.6 12.6L12 18l5.4-5.4M5 20.6h14"/>',
  ready: '<path d="M4.6 12.6l4.6 4.6 10.2-10.2"/>',
  view: '<path d="M3.4 8.2h4l1.8-2.6h5.6l1.8 2.6h4v11H3.4z"/><circle cx="12" cy="13.4" r="3.4"/>',
};

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

// The look (PLAN.md section 0, "Style like Fortnite"): chunky slanted panels in rarity colours (gold for weapons,
// purple for powers, blue for moving and the gates), heavy condensed capitals in white with a dark outline, a press
// that sinks and bounces back, and a pop-in when the controller appears. The frame's CSP allows no web fonts, so
// the stack starts with the condensed heavy faces every iPhone and Mac has.
const FONT = '"Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Bebas Neue","Barlow Condensed","Arial Narrow",Impact,system-ui,sans-serif';
const TIERS = { gold: ["#ffe36e", "#ffb21f", "#d26a06"], purple: ["#d49bff", "#9d4dff", "#5a1bc4"], blue: ["#86dcff", "#2f8bff", "#1647c8"] };
const TIER_OF = { shoot: "gold", blast: "gold", drill: "gold", shield: "purple", invisible: "purple", teleport: "purple", shapeshift: "purple", heal: "purple", grapple: "purple", scan: "purple", flare: "purple" };
const OUTLINE = "#0b1033";

function templateCss(accent) {
  const rgb = hexRgb(accent);
  const dark = toHex(rgb.map((v) => v * 0.55));
  const o = OUTLINE;
  return [
    `:root{--k:${accent};--k2:${dark};--ol:${o}}`,
    `html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:${FONT};color:#fff}`,
    ".ctl{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;" +
      "transform-origin:0 0;transform:translate(-50%,-50%);animation:kpop .46s cubic-bezier(.26,1.5,.48,1) both;animation-delay:var(--d,0s);" +
      "transition:transform .14s cubic-bezier(.34,1.56,.64,1),box-shadow .1s,filter .1s}",
    // transform-origin 0 0 is the control's centre once translated: skew and scale pivot there, so a slanted tile stays
    // centred where it was drawn (skew listed first = applied last).
    ".btn{transform:skewX(-9deg) translate(-50%,-50%);border-radius:12px;border:3px solid rgba(255,255,255,.94);opacity:.92;" +
      "background:linear-gradient(180deg,var(--t1) 0%,var(--t2) 50%,var(--t3) 100%);" +
      `box-shadow:0 5px 0 ${o},0 9px 16px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.38),inset 0 -4px 0 rgba(0,0,0,.18)}`,
    ".btn.is-down{transform:skewX(-9deg) translateY(4px) scale(.95) translate(-50%,-50%);filter:brightness(1.2) saturate(1.1);" +
      `box-shadow:0 1px 0 ${o},0 3px 8px rgba(0,0,0,.3),inset 0 3px 0 rgba(255,255,255,.28),inset 0 -2px 0 rgba(0,0,0,.18)}`,
    `.ico{width:min(34px,46%);max-height:46%;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;overflow:visible;filter:drop-shadow(0 2px 0 ${o})}`,
    ".ico .f{fill:#fff}.ico .d{stroke-dasharray:2 2.4;opacity:.8}",
    ".only .ico{width:min(46px,62%);max-height:66%}",
    ".lab{font-size:var(--fs,16px);font-weight:900;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;line-height:.95;color:#fff;" +
      `text-shadow:0 2px 0 ${o},1.5px 0 0 ${o},-1.5px 0 0 ${o},0 -1.5px 0 ${o},0 4px 7px rgba(0,0,0,.45)}`,
    ".tog{flex-direction:row;gap:9px;border-radius:999px}",
    ".led{width:13px;height:13px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;flex:none;background:rgba(11,16,51,.6)}",
    `.tog.is-on{--t1:${TIERS.gold[0]};--t2:${TIERS.gold[1]};--t3:${TIERS.gold[2]}}`,
    ".tog.is-on .led{background:#fff;box-shadow:0 0 10px #fff}",
    ".stick{border-radius:50%;border:4px solid rgba(255,255,255,.8);background:radial-gradient(circle,rgba(47,139,255,.3) 0,rgba(11,16,51,.42) 64%,rgba(11,16,51,.3) 100%);" +
      `box-shadow:0 5px 0 rgba(11,16,51,.55),inset 0 0 0 9px rgba(255,255,255,.07)}`,
    `.chev{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:rgba(255,255,255,.88);stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;overflow:visible;filter:drop-shadow(0 2px 0 rgba(11,16,51,.65))}`,
    ".knob{position:absolute;left:30%;top:30%;width:40%;height:40%;box-sizing:border-box;border-radius:50%;border:3px solid #fff;display:grid;place-items:center;" +
      "background:radial-gradient(circle at 38% 30%,#d4f1ff 0,var(--k) 42%,var(--k2) 100%);" +
      `box-shadow:0 5px 0 ${o},0 8px 14px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.42);transition:transform .14s cubic-bezier(.34,1.56,.64,1),filter .1s}`,
    ".knob .lab{--fs:13px}",
    ".stick.is-down{border-color:#fff}",
    ".stick.is-down .knob{transform:scale(1.1);filter:brightness(1.15)}",
    "@keyframes kpop{0%{opacity:0;scale:.35}62%{opacity:1;scale:1.08}100%{opacity:1;scale:1}}",
  ].join("\n");
}

// Each control centred where it was drawn, never smaller than the touch minimum, always fully on screen.
function placeCss(id, c, n, i) {
  const cx = fix((c.x + c.w / 2) * 100), cy = fix((c.y + c.h / 2) * 100), W = fix(c.w * 100), H = fix(c.h * 100);
  const delay = `--d:${(i * 0.055).toFixed(3)}s;`;
  if (c.type === "stick") {
    const size = `max(${MIN_STICK_PX}px,min(${W}vw,${H}vh))`, half = `max(${MIN_STICK_PX / 2}px,min(${fix(W / 2)}vw,${fix(H / 2)}vh))`;
    return `#${id}{${delay}width:${size};height:${size};left:clamp(${half},${cx}vw,calc(100vw - ${half}));top:clamp(${half},${cy}vh,calc(100vh - ${half}))}`;
  }
  const tier = TIERS[TIER_OF[c.action] || "blue"];
  const hw = `max(${MIN_TOUCH_PX / 2}px,${fix(W / 2)}vw)`, hh = `max(${MIN_TOUCH_PX / 2}px,${fix(H / 2)}vh)`;
  // Label size: fits the width (≈ 0.56 em per heavy condensed capital), between 12 and 24 px.
  const fs = n ? `--fs:clamp(12px,${fix((W * 0.8) / Math.max(2.4, n * 0.56))}vw,24px);` : "";
  return `#${id}{${delay}--t1:${tier[0]};--t2:${tier[1]};--t3:${tier[2]};${fs}width:max(${MIN_TOUCH_PX}px,${W}vw);height:max(${MIN_TOUCH_PX}px,${H}vh);` +
    `left:clamp(${hw},${cx}vw,calc(100vw - ${hw}));top:clamp(${hh},${cy}vh,calc(100vh - ${hh}))}`;
}

const ARROW_LABELS = /^[←→↑↓◀▶▲▼⬅➡⬆⬇<>^V]$/;
const PLAIN_STICK = /^(|STICK|JOYSTICK|JOY|STEER|MOVE|ARROWS|DPAD|D-PAD)$/;

function controlHtml(id, c) {
  const icon = ICONS[c.action] ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.action]}</svg>` : "";
  if (c.type === "stick") {
    // Four chunky chevrons; a word the player wrote (WALK, FLY...) rides on the knob, nothing else is written.
    const custom = !PLAIN_STICK.test(c.label);
    const label = custom ? c.label : c.action.toUpperCase();
    return `<div class="ctl stick" id="${id}" data-stick="${c.action}" data-label="${esc(label)}">` +
      '<svg class="chev" viewBox="0 0 100 100" aria-hidden="true"><path d="M43 13l7-6 7 6M43 87l7 6 7-6M13 43l-6 7 6 7M87 43l6 7-6 7"/></svg>' +
      `<div class="knob" data-knob>${custom ? `<span class="lab">${esc(label)}</span>` : ""}</div></div>`;
  }
  // Arrows and unlabelled movement show only their icon; everything else shows the player's word.
  const iconOnly = icon && (!c.label || ARROW_LABELS.test(c.label)) && Verbs.MOVES.includes(c.action);
  const label = c.label && !ARROW_LABELS.test(c.label) ? c.label : c.action.toUpperCase();
  const cls = `ctl btn${c.type === "toggle" ? " tog" : ""}${iconOnly ? " only" : ""}`;
  const led = c.type === "toggle" ? '<i class="led"></i>' : "";
  const text = iconOnly ? "" : `<span class="lab">${esc(label)}</span>`;
  return `<div class="${cls}" id="${id}" data-action="${c.action}"${c.type === "toggle" ? " data-toggle" : ""} data-label="${esc(label)}">${led}${c.type === "toggle" ? "" : icon}${text}</div>`;
}

function templateHtml(layout, { allowedActions, style } = {}) {
  const { controls } = cleanLayout(layout, allowedActions);
  const accent = hexRgb(style && style.accent) ? toHex(hexRgb(style.accent)) : ACCENT;
  const css = [templateCss(accent)];
  const body = [];
  controls.forEach((c, i) => {
    const id = `k${i}`;
    const shown = c.type === "stick" ? "" : c.label && !ARROW_LABELS.test(c.label) ? c.label : c.action;
    const iconOnly = ICONS[c.action] && (!c.label || ARROW_LABELS.test(c.label)) && Verbs.MOVES.includes(c.action);
    css.push(placeCss(id, c, iconOnly ? 0 : shown.length, i));
    body.push(controlHtml(id, c));
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Controller</title><style>\n${css.join("\n")}\n</style></head>` +
    `<body>\n${body.join("\n")}\n</body></html>`;
}

// ---- Validation ----------------------------------------------------------------------------------------------------

const BAD_TAGS = /<\s*(iframe|frame|frameset|object|embed|applet|form|input|textarea|select|option|link|base|audio|video|source|track|portal|area|map|dialog|fencedframe|webview)\b/i;
const URL_ATTRS = /\s(src|href|xlink:href|action|formaction|poster|data|background|srcset|ping|codebase|manifest|cite|longdesc|lowsrc|dynsrc|usemap)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SAFE_URL = /^\s*(#|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,])/i;
const SVG_NAMESPACES = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace)/gi;
// Script checks (defence in depth: the frame's sandbox and CSP are the real wall).
const JS_DENY = [
  [/\bfetch\b/, "fetch"], [/XMLHttpRequest/, "XMLHttpRequest"], [/\bReflect\b/, "Reflect"], [/\bdefaultView\b/, "defaultView"],
  [/\.\s*(parent|top)\s*\.\s*(postMessage|location|document|frames|open)\b/, "window escape"], [/WebSocket/, "WebSocket"], [/\bimport\s*\(/, "import()"],
  [/(^|[;{}\s])import\s+[\w{*'"]/, "import"], [/\blocalStorage\b/, "localStorage"], [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"], [/\bcookie\b/, "document.cookie"], [/(^|[^.\w$])top\s*[.[]/, "top."], [/(^|[^.\w$])parent\s*[.[]/, "parent."],
  [/\b(window|self|globalThis)\s*\.\s*(top|parent|opener|frameElement)\b/, "window escape"], [/\bopener\b/, "opener"], [/\bframeElement\b/, "frameElement"],
  [/\bpostMessage\b/, "postMessage"], [/\beval\s*\(/, "eval"], [/\bFunction\s*\(/, "Function()"],
  [/\bset(Timeout|Interval)\s*\(\s*['"`]/, "string timer"], [/\bnavigator\s*\.\s*(sendBeacon|serviceWorker|clipboard|geolocation|mediaDevices|credentials|share|locks|storage)\b/, "navigator API"],
  [/\bsendBeacon\b/, "sendBeacon"], [/\bEventSource\b/, "EventSource"], [/RTC(PeerConnection|DataChannel)/, "WebRTC"], [/\b(Shared)?Worker\s*\(/, "Worker"],
  [/\bimportScripts\b/, "importScripts"], [/\bcaches\s*\./, "caches"], [/\blocation\b/, "location"], [/\bwindow\s*\.\s*open\b/, "window.open"],
  [/\bdocument\s*\.\s*(write|writeln|domain|open)\b/, "document.write"], [/\b(window|self|globalThis|document|frames)\s*\[/, "dynamic global access"],
  [/\bWebAssembly\b/, "WebAssembly"], [/\bfromCharCode\b|\batob\s*\(/, "obfuscation"], [/\\x[0-9a-f]{2}/i, "hex escape"],
  [/\bgame\s*\[/, "dynamic game access"], [/\bsetAttribute\s*\(\s*['"`]on/i, "handler attribute"], [/\bsrcdoc\b/, "srcdoc"],
  [/<\s*\/?\s*(script|iframe|frame|object|embed|link|base|form|meta)\b/i, "markup injection"], [/['"`][^'"`]*\son[a-z]+\s*=/i, "handler in markup"],
  [/data-(action|stick|toggle)|dataset\s*\.\s*(action|stick|toggle)/i, "script creates controls"],
  [/\.on(pointer|touch|mouse|click|key|gesture)[a-z]*\s*=/i, "input handler"], [/addEventListener\s*\(\s*['"`](pointer|touch|mouse|click|dblclick|key|gesture)/i, "input handler"],
];
const CSS_DENY = [[/@import\b/i, "@import"], [/expression\s*\(/i, "expression()"], [/-moz-binding|behavior\s*:/i, "binding"]];

function attrsOf(tagBody) {
  const out = {};
  String(tagBody).replace(/([^\s=\/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (m, name, _v, a, b, c) => {
    out[name.toLowerCase()] = a ?? b ?? c ?? "";
    return "";
  });
  return out;
}

function validateHtml(html, { allowedActions, layout } = {}) {
  const errors = [], warnings = [];
  if (typeof html !== "string" || !html.trim()) return { ok: false, errors: ["empty"], warnings, controls: [], bytes: 0 };
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_HTML_BYTES) errors.push(`too large: ${bytes} bytes`);
  const doc = html.replace(/<!--[\s\S]*?-->/g, "");
  const { controls: drawn, allowed } = cleanLayout(layout || { buttons: [] }, allowedActions);
  const allowedAll = allowedActions && allowedActions.length ? new Set(allowedActions.map((a) => Contract.normaliseAction(a))) : allowed;

  // Scripts: no src, classic scripts only, and the deny list on their text.
  if (/<script\b[^>]*\bsrc\s*=/i.test(doc)) errors.push("<script src>");
  const opens = (doc.match(/<script\b/gi) || []).length, closes = (doc.match(/<\/script\s*>/gi) || []).length;
  if (opens !== closes) errors.push("unclosed <script>");
  if ((doc.match(/<style\b/gi) || []).length !== (doc.match(/<\/style\s*>/gi) || []).length) errors.push("unclosed <style>");
  const scripts = [];
  doc.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => (scripts.push({ attrs: attrsOf(attrs), body }), ""));
  for (const s of scripts) {
    if (s.attrs.type && !/^(text|application)\/javascript$/i.test(s.attrs.type)) errors.push(`script type ${s.attrs.type.slice(0, 20)}`);
    for (const [re, what] of JS_DENY) if (re.test(s.body)) errors.push(`script uses ${what}`);
    s.body.replace(/\bgame\s*\.\s*(press|release|axis)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/g, (m, fn, q, action) => {
      if (!q) errors.push(`game.${fn} with a computed action`);
      else if (!allowedAll.has(action) || (fn === "axis") !== STICKS.includes(action)) errors.push(`game.${fn}("${action.slice(0, 20)}") not allowed`);
      return "";
    });
  }
  const markup = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  if (/<[^>]+\son[a-z]+\s*=/i.test(markup)) errors.push("inline event handler attribute");
  const badTag = BAD_TAGS.exec(markup);
  if (badTag) errors.push(`<${badTag[1].toLowerCase()}> not allowed`);
  for (const m of markup.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = attrsOf(m[1]);
    if (a["http-equiv"] != null) errors.push("<meta http-equiv>");
    else if (!("charset" in a) && !/^(viewport|color-scheme|description)$/i.test(a.name || "")) errors.push(`<meta ${(a.name || "").slice(0, 20)}>`);
  }
  for (const m of markup.matchAll(URL_ATTRS)) {
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    if (!SAFE_URL.test(value)) errors.push(`${m[1].toLowerCase()}="${value.slice(0, 30)}"`);
  }
  if (/(java|vb)script\s*:|data\s*:\s*text\/html/i.test(doc)) errors.push("script URL");
  if (/\b(?:https?|wss?|ftp):\/\//i.test(doc.replace(SVG_NAMESPACES, ""))) errors.push("network URL");
  const css = [...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join("\n") +
    [...markup.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3]).join("\n");
  for (const [re, what] of CSS_DENY) if (re.test(css)) errors.push(`css ${what}`);
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!SAFE_URL.test(m[2])) errors.push(`css url(${m[2].slice(0, 30)})`);
  for (const m of markup.matchAll(/\b(?:fill|stroke|filter|mask|clip-path|marker-(?:start|mid|end))\s*=\s*["']\s*url\(\s*['"]?([^'")]*)/gi)) if (!SAFE_URL.test(m[1])) errors.push(`svg url(${m[1].slice(0, 30)})`);

  // Controls: every data-action / data-stick, all allowed, and every drawn action present.
  const controls = [];
  for (const m of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const a = attrsOf(m[2]);
    if (a["data-stick"] == null && a["data-action"] == null) continue;
    const stick = a["data-stick"] != null;
    const action = String(stick ? a["data-stick"] : a["data-action"]).trim().toLowerCase();
    const kind = stick ? "stick" : a["data-toggle"] != null ? "toggle" : "button";
    if (!allowedAll.has(action)) errors.push(`action "${action.slice(0, 24)}" not allowed`);
    else if (stick !== STICKS.includes(action)) errors.push(stick ? `stick "${action}" must be steer or move` : `"${action}" must be a data-stick`);
    controls.push({ action, kind, label: String(a["data-label"] || "").trim().toUpperCase().slice(0, 24) });
  }
  if (!controls.length) errors.push("no controls");
  if (controls.length > 24) errors.push(`too many controls: ${controls.length}`);
  for (const c of drawn) if (!controls.some((k) => k.action === c.action)) errors.push(`missing control: ${c.action}`);
  if (controls.some((c) => c.kind === "stick") && !/\bdata-knob\b/i.test(markup)) warnings.push("stick without data-knob");
  if (!/<style\b/i.test(doc) && !/\sstyle\s*=/i.test(markup)) errors.push("no styles");
  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, controls, bytes };
}

// ---- Prompt ----------------------------------------------------------------------------------------------------------

const INSTRUCTIONS = `You write the touch controller for one player of SPACE PARTY, a multiplayer sci-fi party game played on phones held in LANDSCAPE. The player drew their controller on paper or on the phone; you get the picture of the drawing and the controls the game already read from it (action, label and where each one was drawn). Turn it into ONE self-contained HTML document: a bold, beautiful game controller that matches the game's UI and keeps the player's layout.

THE PAGE
- It is shown in a full-screen TRANSPARENT frame ON TOP of the live 3D game. html and body backgrounds stay transparent and nothing covers the screen with a solid or dark fill: only the controls are visible.
- The frame is the whole play area (about 800 x 390 CSS px on an iPhone, but any size). Position every control absolutely in vw / vh units, never in fixed pixel positions.
- No external resources at all: no <script src>, no <link>, no <img> except data: URIs (prefer inline SVG), no web fonts (system fonts only, see LOOK), no network, no storage, no cookies, no iframes, no forms or inputs, no links, no navigation, no alerts. Never mention parent, top, opener, postMessage, fetch, XMLHttpRequest, WebSocket, import, eval, location, localStorage.

INPUT IS HANDLED FOR YOU
- The game injects a kit that handles every touch: multi-touch, analog sticks, toggles and pressed states. Do NOT write pointer, touch, mouse, click or key handlers, and no inline on* attributes.
- Mark each control declaratively:
  - Button: an element with data-action="<action>" and data-label="<LABEL>", e.g. <div class="btn" data-action="shoot" data-label="FIRE">...</div>.
  - Toggle (type toggle): the same plus the data-toggle attribute.
  - Stick (type stick): an element with data-stick="steer" or data-stick="move" that contains exactly one child with the data-knob attribute. The kit moves the knob with the CSS translate property: centre the knob with left/top or margins, never with translate.
- The kit sets classes; style every one: .is-down (held), .is-on (toggle on), .is-disabled (dimmed; a default exists). Dragged sticks get --x and --y (-1..1).
- Use EXACTLY the action ids listed below, one control per entry, nothing added, dropped or renamed.

LOOK: MATCH THE GAME'S UI (bold, chunky and playful, like Fortnite)
- Buttons are chunky slanted tiles: skewX about -9deg (or slanted sides), a thick 3 px white border, rounded corners, a vertical gradient fill in a rarity colour, a light inner highlight on top and a hard dark drop shadow underneath (box-shadow 0 5px 0 #0b1033) so each one reads as a solid tile. Keep them slightly see-through (opacity about 0.9) so the game stays visible around them.
- Rarity colours: gold (#ffe36e to #ffb21f to #d26a06) for weapons (shoot, blast, drill); purple (#d49bff to #9d4dff to #5a1bc4) for powers (shield, invisible, teleport, heal, scan, flare, grapple, shapeshift); blue (#86dcff to #2f8bff to #1647c8) for moving and everything else. A toggle turns gold when on.
- Labels: heavy condensed capitals, white with a dark #0b1033 outline (text-shadow on all four sides plus a soft drop), 14-24 px, letter-spacing about 0.04em, weight 900. The frame cannot load web fonts, so use exactly this font stack: "Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Arial Narrow",Impact,sans-serif.
- Use the player's own word from the label (or the action name when the label is empty). Add a bold white stroke SVG icon that fits the action when it helps: crosshair (shoot), double chevron (boost), shield (shield), drill bit (drill), legs touching a line (land), shovel (dig), radar arcs (scan), sun (flare), arrows for movement; give icons the same dark drop shadow.
- Sticks: a round base (4 px white rim, dark translucent fill, four chunky white chevrons near the rim) with a big glossy knob about 40% of the base (3 px white rim, blue gradient, dark drop shadow). Its diameter is the smaller side of its rectangle and at least 110 px.
- Motion: every control pops in once when the page appears (scale from about 0.35 with a small overshoot, staggered by about 50 ms). Animate only opacity and the CSS scale property, never transform or translate, so the centring and the kit's own moves are untouched. .is-down sinks a button (translateY 4px, scale 0.95, a shorter shadow, brighter) and it bounces back on release with an overshoot easing. No animation that runs forever.
- Nothing overlaps: labels, icons, chevrons and the knob each keep clear space. A stick label is optional; if you add one put it on the knob.
- Echo the drawing: a button drawn round is round, a square one is square, a star is a star, arrows look like arrows, a joystick is a round base with a knob. Keep it bold, clean and readable at phone size.
- Touch: every button at least 56 x 56 CSS px (use max(56px, ...)); keep every control fully on screen (use clamp() on its centre).
- Layout: centre each control on the centre of the rectangle where the player drew it. Rectangles are fractions of the drawing (x, y = top left; w, h = size) and the drawing maps onto the whole frame, so centre = left (x + w/2) * 100vw, top (y + h/2) * 100vh. Keep the player's relative sizes; grow small controls to the minimum.
- iPhone performance over a 3D game: no backdrop-filter, no blur filters on large areas. Keep the whole document under 10 KB.
- A <script> is optional and only for cosmetics; it must never handle input or call the game.

OUTPUT: only the HTML document, starting with <!doctype html>. No markdown fences, no explanations.`;

function layoutText(controls, style) {
  const lines = controls.map((c, i) => `${i + 1}. type ${c.type}, action "${c.action}", label "${c.label}", x ${c.x}, y ${c.y}, w ${c.w}, h ${c.h}` +
    ` (centre ${fix((c.x + c.w / 2) * 100)}vw ${fix((c.y + c.h / 2) * 100)}vh)`);
  return [
    "Controls read from the drawing (rectangles as fractions of the drawing):",
    ...lines,
    `Stick knob colour: ${(style && style.accent) || ACCENT}.`,
    "Write the controller now.",
  ].join("\n");
}

function buildRequest(controls, image, style, useTier = true) {
  const content = [{ type: "input_text", text: layoutText(controls, style) }];
  if (image) content.push({ type: "input_image", image_url: image, detail: "low" });
  const req = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    instructions: INSTRUCTIONS,
    input: [{ role: "user", content }],
    reasoning: { effort: process.env.ASTRA_HTML_EFFORT || DEFAULT_EFFORT },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  };
  const tier = process.env.OPENAI_SERVICE_TIER ?? DEFAULT_TIER;
  if (useTier && !defaultTierOnly && tier && tier !== "none") req.service_tier = tier;
  return req;
}

// ---- Network -------------------------------------------------------------------------------------------------------

function extractText(data) {
  if (!data || typeof data !== "object") throw new Error("empty response");
  if (data.status === "incomplete") throw new Error(`incomplete: ${(data.incomplete_details && data.incomplete_details.reason) || "unknown"}`);
  let text = "";
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "refusal") throw new Error("model refused");
      if (part && part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  if (!text && typeof data.output_text === "string") text = data.output_text;
  if (!text) throw new Error("no output_text in response");
  return text;
}

// The document out of the answer: fences dropped, from <!doctype or <html to </html>.
function extractHtml(text) {
  let body = String(text).trim();
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(body);
  if (fenced) body = fenced[1].trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) throw new Error("no HTML document in the answer");
  body = body.slice(start);
  const end = body.toLowerCase().lastIndexOf("</html>");
  return end >= 0 ? body.slice(0, end + 7) : body;
}

function logCall(entry) {
  const file = process.env.ASTRA_HTML_CALL_LOG;
  if (!file) return;
  try { fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n"); } catch {}
}

async function post(req, key, signal) {
  return fetchImpl(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}

async function callModel(controls, image, style, signal) {
  const key = apiKey();
  if (!key) throw new Error("no OPENAI_API_KEY");
  let req = buildRequest(controls, image, style);
  const t0 = Date.now();
  let res = await post(req, key, signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, outcome: "http error" });
    const tierProblem = res.status >= 400 && res.status < 500 && req.service_tier && /service_tier|image|format|reasoning/i.test(text);
    if (!tierProblem) throw new Error(`OpenAI HTTP ${res.status}`);
    defaultTierOnly = true;
    console.log(`astra-html: service tier ${req.service_tier} rejected (HTTP ${res.status}); using the default tier from now on`);
    req = buildRequest(controls, image, style, false);
    res = await post(req, key, signal);
    if (!res.ok) { logCall({ status: res.status, ms: Date.now() - t0, tier: null, outcome: "http error" }); throw new Error(`OpenAI HTTP ${res.status}`); }
  }
  const data = await res.json().catch(() => { throw new Error("bad response: not JSON"); });
  const usage = data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens, reasoning: data.usage.output_tokens_details && data.usage.output_tokens_details.reasoning_tokens } : null;
  try {
    const html = extractHtml(extractText(data));
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, bytes: Buffer.byteLength(html), usage, outcome: "html" });
    return { html, usage };
  } catch (err) {
    logCall({ status: res.status, ms: Date.now() - t0, tier: req.service_tier || null, usage, outcome: err.message });
    throw err;
  }
}

// ---- Main ------------------------------------------------------------------------------------------------------------

const templateResult = (controls, allowed, style, ms, error) => {
  const html = templateHtml({ buttons: controls }, { allowedActions: [...allowed], style });
  return { ok: true, html, controls: validateHtml(html, { allowedActions: [...allowed] }).controls, source: "template", ms, bytes: Buffer.byteLength(html), ...(error ? { error } : {}) };
};

async function generateControllerHtml({ image, layout, allowedActions, style, signal, timeoutMs: perCallTimeout, player } = {}) {
  const t0 = Date.now();
  const { controls, allowed, dropped } = cleanLayout(layout, allowedActions);
  if (!controls.length) return { ok: false, error: dropped.length ? `no allowed controls (${dropped.join(", ")})` : "layout has no controls" };
  const img = typeof image === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(image) && image.length <= MAX_IMAGE_CHARS ? image : null;
  const accent = hexRgb(style && style.accent) ? style.accent : ACCENT;
  const log = (r) => console.log(`astra-html ${Contract.cleanName(player) || "-"} ${r.source} ${r.ms}ms ${r.bytes}B${r.error ? ` (${r.error})` : ""}`);
  if (process.env.ASTRA_MOCK === "1") { const r = templateResult(controls, allowed, { accent }, Date.now() - t0, "mock"); log(r); return r; }
  if (signal && signal.aborted) return templateResult(controls, allowed, { accent }, 0, "aborted");

  const key = sha1(JSON.stringify([img ? sha1(img) : "", controls, [...allowed].sort(), accent]));
  const cached = cache.get(key);
  if (cached) return { ...cached, ms: Date.now() - t0 };

  let entry = inflight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, owners: 0, timedOut: false };
    const timer = setTimeout(() => ((entry.timedOut = true), controller.abort()), perCallTimeout || timeoutMs);
    entry.promise = (async () => {
      try {
        const { html } = await callModel(controls, img, { accent }, controller.signal);
        const check = validateHtml(html, { allowedActions: [...allowed], layout: { buttons: controls } });
        if (!check.ok) return templateResult(controls, allowed, { accent }, 0, `rejected: ${check.errors.slice(0, 4).join("; ")}`);
        const result = { ok: true, html, controls: check.controls, source: "model", ms: 0, bytes: check.bytes, ...(check.warnings.length ? { warnings: check.warnings } : {}) };
        cache.set(key, result);
        if (cache.size > 64) cache.delete(cache.keys().next().value);
        return result;
      } catch (err) {
        return templateResult(controls, allowed, { accent }, 0, entry.timedOut ? "timeout" : String((err && err.message) || err));
      } finally {
        clearTimeout(timer);
        inflight.delete(key);
      }
    })();
    inflight.set(key, entry);
  }
  entry.owners++;
  let onAbort = null;
  const aborted = signal ? new Promise((resolve) => {
    onAbort = () => resolve(templateResult(controls, allowed, { accent }, 0, "aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  }) : null;
  const result = await (aborted ? Promise.race([entry.promise, aborted]) : entry.promise);
  if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  entry.owners--;
  if (entry.owners <= 0 && signal && signal.aborted && inflight.get(key) === entry) entry.controller.abort(); // nobody waits any more
  const out = { ...result, ms: Date.now() - t0 };
  log(out);
  return out;
}

const _internals = {
  setFetch: (fn) => (fetchImpl = fn),
  setTimeoutMs: (ms) => (timeoutMs = ms),
  reset: () => { cache.clear(); inflight.clear(); defaultTierOnly = false; timeoutMs = Number(process.env.ASTRA_HTML_TIMEOUT_MS) || TIMEOUT_MS; },
  state: () => ({ cache: cache.size, inflight: inflight.size, defaultTierOnly }),
  INSTRUCTIONS, ICONS, MAX_HTML_BYTES, MIN_TOUCH_PX, MIN_STICK_PX, cleanLayout, buildRequest, layoutText, extractText, extractHtml, attrsOf,
};

module.exports = { generateControllerHtml, templateHtml, validateHtml, _internals };
