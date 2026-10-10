// Phone extras (v1.3 phone track, Fortnite style, readable over bright scenes): chunky HP / SHIELD / BOOST bars on a dark
// slanted plate, hand-drawn hint sketches, the drawings-left counter, the radar, and the pencil example sketches of the
// drawing steps. v1.4: the 3-2-1-GO! countdown, the "draw the missing part" late hint card (with the part sketch at full
// ink), the iPhone "Add to Home Screen" hint and a Fullscreen helper.
// No dependencies. update() only writes values that changed, and only touches transform / opacity / textContent / class,
// so it never forces layout; CSS animates only transform and opacity, and there is no backdrop-filter. Every user-facing
// string comes in through the `copy` argument (controller.html owns the COPY table); the defaults below only keep the
// module usable on its own (dev/phone-extras/demo.html).

const STYLE_ID = "pe-styles";
const HEAD_FONT = 'var(--f-head,"Barlow Condensed","Avenir Next Condensed","Arial Narrow",Impact,system-ui,sans-serif)';
const BODY_FONT = 'var(--f-body,"Barlow",-apple-system,"SF Pro Text",system-ui,sans-serif)';
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

.pe-cd{position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6vmin;
  overflow:hidden;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .15s,visibility 0s linear .15s;
  font-family:${HEAD_FONT};text-align:center}
.pe-cd.pe-on{opacity:1;visibility:visible;transition:opacity .1s}
.pe-cd-n{display:block;font-weight:900;font-style:italic;font-size:58vmin;line-height:.8;white-space:nowrap;color:#fff;
  -webkit-text-stroke:.075em #120a2e;paint-order:stroke fill;text-shadow:0 .045em 0 #ffb000,0 .09em 0 #0a0830;
  will-change:transform,opacity;animation:pe-cd-pop 1s ease-out both}
.pe-cd-n.pe-cd-go{font-size:64vmin;color:#ffcb3d;text-shadow:0 .07em 0 #0a0830;animation:pe-cd-go 1.1s cubic-bezier(.2,.9,.3,1.2) both}
.pe-cd-sub{position:relative;z-index:0;isolation:isolate;display:block;padding:5px 18px 7px;font-weight:900;font-style:italic;
  font-size:clamp(17px,5.4vmin,30px);line-height:1;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap;${OUTLINE}}
.pe-cd-sub::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-9deg);border-radius:5px;${PLATE}}
.pe-cd-sub:empty,.pe-cd-going .pe-cd-sub{display:none}
@keyframes pe-cd-pop{0%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1.15)}35%{opacity:1;transform:scale(1)}
  72%{opacity:1;transform:scale(.96);animation-timing-function:ease-in}100%{opacity:.35;transform:scale(.8)}}
@keyframes pe-cd-go{0%{opacity:0;transform:scale(.4) rotate(-6deg)}20%{opacity:1;transform:scale(1.14) rotate(-6deg)}
  34%{opacity:1;transform:scale(1) rotate(-6deg)}76%{opacity:1;transform:scale(1.04) rotate(-6deg)}
  100%{opacity:0;transform:scale(1.45) rotate(-6deg)}}

.pe-late{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;box-sizing:border-box;pointer-events:none;
  padding:calc(env(safe-area-inset-top,0px) + 10px) calc(env(safe-area-inset-right,0px) + 10px)
    calc(env(safe-area-inset-bottom,0px) + 12px) calc(env(safe-area-inset-left,0px) + 10px)}
.pe-late.pe-on{display:flex}
.pe-late-card{position:relative;z-index:0;isolation:isolate;box-sizing:border-box;width:min(520px,92vw);max-height:100%;display:grid;
  grid-template-columns:minmax(0,1fr);grid-template-areas:"t" "p" "s" "g" "l";justify-items:center;align-items:center;gap:10px;
  padding:18px 20px 10px;text-align:center;pointer-events:auto;font-family:${HEAD_FONT};
  animation:pe-pop .32s cubic-bezier(.2,.9,.3,1.4) both}
.pe-late-card::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-3deg);border-radius:8px;border:4px solid #120a2e;
  background:linear-gradient(160deg,rgb(52 38 150 / .95),rgb(16 12 58 / .95));box-shadow:0 7px 0 #0a0830,inset 0 0 0 3px #ffcb3d}
.pe-late-t{grid-area:t;max-width:100%;font-weight:900;font-style:italic;font-size:clamp(28px,8.8vw,42px);line-height:.95;
  letter-spacing:.02em;text-transform:uppercase;overflow-wrap:break-word;text-wrap:balance;color:#ffcb3d;
  -webkit-text-stroke:3.4px #120a2e;paint-order:stroke fill;text-shadow:0 3px 0 rgb(10 6 30 / .55);transform:rotate(-2deg)}
.pe-late-p{grid-area:p;box-sizing:border-box;width:min(46vw,190px);height:min(46vw,190px);padding:8px;background:#fffdf5;
  border:3px solid #120a2e;border-radius:12px;box-shadow:0 5px 0 #0a0830;transform:rotate(-3deg)}
.pe-late-p svg{width:100%;height:100%;display:block}
.pe-late-p.pe-two{display:flex;gap:4px;width:min(78vw,330px)}
.pe-late-p.pe-two svg{flex:1 1 0;min-width:0}
.pe-late-s{grid-area:s;margin:0;max-width:100%;font-weight:800;font-style:italic;font-size:18px;line-height:1.12;letter-spacing:.03em;
  text-transform:uppercase;text-wrap:balance;${OUTLINE}}
.pe-late-t:empty,.pe-late-s:empty,.pe-late-p:empty{display:none}
.pe-late-go,.pe-late-later,.pe-inst-x{-webkit-appearance:none;appearance:none;box-sizing:border-box;margin:0;border:0;background:none;
  font:inherit;color:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;
  user-select:none}
.pe-late-go{grid-area:g;justify-self:stretch;position:relative;z-index:0;isolation:isolate;display:flex;align-items:center;
  justify-content:center;gap:.35em;min-height:58px;padding:6px 22px;font-family:${HEAD_FONT};font-weight:900;font-style:italic;
  font-size:26px;line-height:1;letter-spacing:.03em;text-transform:uppercase;text-align:center;color:#120a2e;transition:transform .08s}
.pe-late-go::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-9deg);border:3px solid #120a2e;border-radius:5px;
  background:linear-gradient(#ffe58a,#ffcb3d 45%,#ffb000);box-shadow:0 6px 0 #0a0830,inset 0 3px 0 rgb(255 255 255 / .45);
  transition:box-shadow .08s}
.pe-late-go:active{transform:scale(.94)}
.pe-late-go:active::before{box-shadow:0 2px 0 #0a0830,inset 0 3px 0 rgb(255 255 255 / .45)}
.pe-late-ico{flex:none;width:1em;height:1em}
.pe-late-ico svg{width:100%;height:100%;display:block;fill:#fff;stroke:#120a2e;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pe-late-later{grid-area:l;min-height:48px;padding:0 18px;font-family:${HEAD_FONT};font-weight:800;font-style:italic;font-size:18px;
  line-height:1;letter-spacing:.1em;text-transform:uppercase;color:#fff;text-shadow:0 2px 0 rgb(10 6 30 / .7);text-decoration:underline;
  text-decoration-thickness:2px;text-underline-offset:4px;text-decoration-color:rgb(255 255 255 / .5)}
.pe-late-later:active{opacity:.6}
@keyframes pe-pop{0%{opacity:0;transform:scale(.6)}62%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@media (orientation:landscape){
  .pe-late-card{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"p t t" "p s s" "p g l";justify-items:start;
    column-gap:16px;row-gap:8px;padding:14px 16px 16px;text-align:left}
  .pe-late-p{width:min(150px,38vh);height:min(150px,38vh);padding:6px;transform:rotate(-2.5deg)}
  .pe-late-p.pe-two{width:min(250px,64vh)}
  .pe-late-t{font-size:clamp(24px,8vh,34px);transform:rotate(-1.5deg);transform-origin:0 50%}
  .pe-late-s{font-size:16px}
  .pe-late-go{font-size:23px;min-height:54px;padding:6px 16px}
  .pe-late-later{justify-self:center;padding:0 12px}
}

.pe-inst{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:35;display:none;align-items:center;gap:4px;
  box-sizing:border-box;width:max-content;max-width:min(520px,calc(100vw - 20px));max-height:72px;padding:4px 4px 4px 16px;
  pointer-events:auto;isolation:isolate;transform:translateX(-50%);font-family:${BODY_FONT};
  animation:pe-inst-in .4s cubic-bezier(.2,.9,.3,1.3) both}
.pe-inst.pe-on{display:flex}
.pe-inst::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-6deg);border-radius:8px;border:3px solid #120a2e;
  background:linear-gradient(100deg,#2b7bff,#8a3dff);box-shadow:0 4px 0 #0a0830}
.pe-inst-txt{flex:1 1 auto;min-width:0;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;
  font-weight:700;font-size:15px;line-height:1.2;color:#fff;text-shadow:0 2px 0 rgb(10 6 30 / .6)}
.pe-inst-share{display:inline-block;width:1.1em;height:1.1em;margin:0 .12em;vertical-align:-.22em}
.pe-inst-share svg{width:100%;height:100%;display:block;overflow:visible;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;
  stroke-linejoin:round}
.pe-inst-x{flex:none;display:grid;place-items:center;width:44px;height:44px;padding:0;border-radius:50%}
.pe-inst-xi{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#120a2e;transition:transform .08s}
.pe-inst-xi svg{width:11px;height:11px;display:block;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round}
.pe-inst-x:active .pe-inst-xi{transform:scale(.88)}
@keyframes pe-inst-in{0%{opacity:0;transform:translate(-50%,130%)}62%{opacity:1;transform:translate(-50%,-8%)}
  100%{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion:reduce){
  .pe-cd-n,.pe-cd-n.pe-cd-go,.pe-late-card,.pe-inst{animation:none}
  .pe-cd-n.pe-cd-go{transform:rotate(-6deg)}
}
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

const partCache = {};

// The hint sketch of one part (drill | landing | shovel | gun) at FULL ink, for a paper card: dark graphite pencil lines on
// transparent, the same viewBox and the very same drawing as the faint hint (same seed, same wobble). Inline attributes, so
// it needs no CSS (also usable as an <img> data URL). "" for unknown names.
export function partSketchSvg(name, { stroke = "#2a2a34", width = 4 } = {}) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(STROKES, name)) return "";
  const w = Number(width) > 0 ? Number(width) : 4;
  const ink = stroke ? String(stroke) : "#2a2a34";
  const key = name + "|" + ink + "|" + w;
  if (partCache[key]) return partCache[key];
  const rnd = rng(name.length * 977 + name.charCodeAt(0) * 31); // sketchSvg's seed
  let main = "";
  let ghost = "";
  for (const pts of STROKES[name]) {
    main += '<path d="' + wobble(pts, rnd, 1.6) + '"/>';
    ghost += '<path d="' + wobble(pts, rnd, 2.4) + '"/>';
  }
  return (partCache[key] =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 108 108" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<g fill="none" stroke="' + esc(ink) + '" stroke-linecap="round" stroke-linejoin="round">' +
    '<g stroke-width="' + f1(w) + '">' + main + "</g>" +
    '<g stroke-width="' + f1(w * 0.45) + '" opacity=".5">' + ghost + "</g></g></svg>");
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

// ---------------------------------------------------------------- countdown

// copy: { go: "GO!", sub: "" } (sub: an optional small line over the number, e.g. "GET READY")
// The start countdown: a full-screen, click-through overlay (z-index 30: over the HUD layers 4-9, under the page notice at
// 40) with a huge outlined number (~42vmin, reads in portrait and landscape). show(n) is idempotent for the same n (call it
// on every tick); a new n pops in (0.4 → 1.15 → 1 in ~350 ms), then slowly shrinks and fades until the next one. go() pops a
// bigger gold GO! that fades out by itself after ~1.1 s; hide() fades out at once (the phase jumped) and cancels a GO!.
// Reduced motion: no scaling, just show / hide.
export function createCountdown(container, copy = {}) {
  injectStyles();
  const T = { go: "GO!", sub: "", ...copy };
  const root = el("div", "pe-cd", container || document.body);
  root.setAttribute("aria-hidden", "true");
  el("span", "pe-cd-sub", root, T.sub || "");
  let num = el("b", "pe-cd-n", root);
  let state = 0; // 0 hidden, 1 a number, 2 GO!
  let cur = "";
  let timer = 0;

  // a fresh node per number: a new element starts its pop from the first frame (no reflow needed to replay it)
  function put(text, cls) {
    const b = el("b", cls, null, text);
    root.replaceChild(b, num);
    num = b;
  }

  function show(n) {
    if (n == null || n === "" || (typeof n === "number" && !Number.isFinite(n))) return hide();
    const text = typeof n === "number" ? String(Math.max(0, Math.ceil(n))) : String(n);
    if (state === 1 && text === cur) return;
    clearTimeout(timer);
    state = 1;
    cur = text;
    put(text, "pe-cd-n");
    root.classList.remove("pe-cd-going");
    root.classList.add("pe-on");
  }

  function go() {
    if (state === 2) return; // already popping
    clearTimeout(timer);
    state = 2;
    cur = "";
    put(T.go, "pe-cd-n pe-cd-go");
    root.classList.add("pe-on", "pe-cd-going");
    timer = setTimeout(hide, 1100);
  }

  function hide() {
    if (!state) return;
    clearTimeout(timer);
    state = 0;
    cur = "";
    root.classList.remove("pe-on");
  }

  return { show, go, hide, destroy: () => (clearTimeout(timer), (state = 0), root.remove()) };
}

// ---------------------------------------------------------------- late hint

let lateSeq = 0;
const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.3 3.7a2.6 2.6 0 0 1 3.9 3.6L8.1 19.4 3 21l1.6-5.1z"/><path d="M14.2 5.8l4 4"/></svg>';
const str = (v) => (v == null ? "" : String(v));

// copy: { go: "DRAW IT NOW", later: "LATER" }
// The owner's rule: no free skills at 3:00. A player missing a gate skill gets this big, friendly card: a gold title
// ("DRAW A SHOVEL"), the part's example sketch on a white paper card, one line ("ON YOUR EXPLORER, THEN TAP DIG"), ONE big gold
// button that opens the drawing step, and a small LATER. Centred, at most min(520px, 92vw) wide: a column in portrait, the
// sketch beside the text in landscape (about 190 px tall at 844x390). z-index 20; only the card takes taps. Both buttons close
// the card first, then call onAction(action) / onLater(). show() while open updates the content in place (no second pop).
export function createLateHint(container, { copy = {}, onAction, onLater } = {}) {
  injectStyles();
  const T = { go: "DRAW IT NOW", later: "LATER", ...copy };
  const root = el("div", "pe-late", container || document.body);
  const card = el("div", "pe-late-card", root);
  const titleEl = el("div", "pe-late-t", card);
  titleEl.id = "pe-late-t" + ++lateSeq;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", titleEl.id);
  const paper = el("div", "pe-late-p", card);
  const subEl = el("p", "pe-late-s", card);
  const goBtn = el("button", "pe-late-go", card);
  goBtn.type = "button";
  el("span", "pe-late-ico", goBtn).innerHTML = PENCIL_SVG;
  const goTxt = el("span", "pe-late-gt", goBtn, T.go);
  const laterBtn = el("button", "pe-late-later", card, T.later);
  laterBtn.type = "button";
  let open = false;
  let action;
  let lastTitle = "";
  let lastSub = "";
  let lastSketch = "";
  let lastCta = str(T.go);

  goBtn.addEventListener("click", () => {
    if (!open) return;
    const a = action;
    hide();
    if (typeof onAction === "function") onAction(a);
  });
  laterBtn.addEventListener("click", () => {
    if (!open) return;
    hide();
    if (typeof onLater === "function") onLater();
  });

  // o: { title, sub, sketch: "drill" | "landing" | "shovel" | "gun", sketches (several parts at once, e.g. ["shovel", "drill"]:
  // drawn side by side; wins over sketch), action (handed back to onAction), cta (button text) }
  function show(o) {
    const { title, sub, sketch, sketches, action: a, cta } = o || {};
    action = a;
    const t = str(title);
    const s = str(sub);
    const list = (Array.isArray(sketches) && sketches.length ? sketches : [sketch]).map(str).filter((x) => STROKES[x]).slice(0, 2);
    const k = list.join(",");
    const c = str(cta) || str(T.go);
    if (t !== lastTitle) titleEl.textContent = lastTitle = t;
    if (s !== lastSub) subEl.textContent = lastSub = s;
    if (k !== lastSketch) {
      lastSketch = k;
      paper.innerHTML = list.map((x) => partSketchSvg(x)).join("");
      paper.classList.toggle("pe-two", list.length > 1);
    }
    if (c !== lastCta) goTxt.textContent = lastCta = c;
    if (open) return;
    open = true;
    root.classList.add("pe-on"); // display none → flex: the card's pop-in replays on every open
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove("pe-on");
  }

  return { show, hide, isOpen: () => open, destroy: () => ((open = false), root.remove()) };
}

// ---------------------------------------------------------------- install hint

// the iOS share icon: a rounded square open at the top, an arrow out of it
const SHARE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 9H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5"/>' +
  '<path d="M12 15V2.8M8.4 6.2L12 2.6l3.6 3.6"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>';

// copy: { text: "For full screen: tap {share} Share, then Add to Home Screen", close: "Close" } ({share}: the share icon;
// close: the ✕ button's label for screen readers)
// A one-time bottom card for iPhone Safari outside a home-screen app (see Fullscreen.iosSafari()). The caller decides when to
// show it and stores the "seen" flag; ✕ (a 44 px target) hides it and calls onClose(). z-index 35; only the card takes taps.
export function createInstallHint(container, { copy = {}, onClose } = {}) {
  injectStyles();
  const T = { text: "For full screen: tap {share} Share, then Add to Home Screen", close: "Close", ...copy };
  const root = el("div", "pe-inst", container || document.body);
  const txt = el("div", "pe-inst-txt", root);
  str(T.text)
    .split("{share}")
    .forEach((part, i) => {
      if (i) el("span", "pe-inst-share", txt).innerHTML = SHARE_SVG;
      if (part) txt.appendChild(document.createTextNode(part));
    });
  const x = el("button", "pe-inst-x", root);
  x.type = "button";
  x.setAttribute("aria-label", str(T.close));
  el("i", "pe-inst-xi", x).innerHTML = CLOSE_SVG;
  let open = false;

  x.addEventListener("click", () => {
    hide();
    if (typeof onClose === "function") onClose();
  });

  function show() {
    if (open) return;
    open = true;
    root.classList.add("pe-on"); // display none → flex: the slide-in replays
  }

  function hide() {
    if (!open) return;
    open = false;
    root.classList.remove("pe-on");
  }

  return { show, hide, destroy: () => ((open = false), root.remove()) };
}

// ---------------------------------------------------------------- fullscreen

const hasDoc = () => typeof document !== "undefined";
const fsActive = () => hasDoc() && !!(document.fullscreenElement || document.webkitFullscreenElement);
const uaString = () => (typeof navigator !== "undefined" && navigator.userAgent) || "";

function fsSupported() {
  if (!hasDoc() || /iPhone|iPod/.test(uaString())) return false; // iPhone browsers (all WebKit) have no element fullscreen
  const d = document;
  const e = d.documentElement;
  if (!e || !(e.requestFullscreen || e.webkitRequestFullscreen)) return false;
  if (typeof d.fullscreenEnabled === "boolean") return d.fullscreenEnabled;
  if (typeof d.webkitFullscreenEnabled === "boolean") return d.webkitFullscreenEnabled;
  return true;
}

// cb(active) runs when fullscreen turns on or off (a browser firing both the prefixed and the plain event calls it once)
function fsOnChange(cb) {
  if (!hasDoc() || typeof cb !== "function") return () => {};
  let last = fsActive();
  const h = () => {
    const a = fsActive();
    if (a === last) return;
    last = a;
    cb(a);
  };
  document.addEventListener("fullscreenchange", h);
  document.addEventListener("webkitfullscreenchange", h);
  return () => {
    document.removeEventListener("fullscreenchange", h);
    document.removeEventListener("webkitfullscreenchange", h);
  };
}

// a prefixed request returns nothing: wait for the change (or error) event, at most `ms`
function fsWhenActive(ms) {
  return new Promise((resolve) => {
    if (fsActive()) return resolve(true);
    let done = false;
    let timer = 0;
    let off = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (off) off();
      document.removeEventListener("fullscreenerror", finish);
      document.removeEventListener("webkitfullscreenerror", finish);
      resolve(fsActive());
    };
    off = fsOnChange(finish);
    document.addEventListener("fullscreenerror", finish);
    document.addEventListener("webkitfullscreenerror", finish);
    timer = setTimeout(finish, ms);
  });
}

// → Promise<boolean> (true when locked); never rejects (Android Chrome locks in fullscreen; Safari and desktops refuse)
function lockLandscape() {
  try {
    const o = typeof screen !== "undefined" ? screen.orientation : null;
    if (o && typeof o.lock === "function") return Promise.resolve(o.lock("landscape")).then(() => true, () => false);
  } catch {
    // lock() may throw synchronously
  }
  return Promise.resolve(false);
}

// → Promise<boolean> (true when fullscreen is on); never throws or rejects. The request runs synchronously, so call this
// straight from the tap handler (nothing awaited before it, or the browser refuses). Then it tries the landscape lock.
function fsRequest(target) {
  if (!hasDoc()) return Promise.resolve(false);
  const t = target && (target.requestFullscreen || target.webkitRequestFullscreen) ? target : document.documentElement;
  let ret;
  try {
    if (t && typeof t.requestFullscreen === "function") ret = t.requestFullscreen({ navigationUI: "hide" });
    else if (t && typeof t.webkitRequestFullscreen === "function") ret = t.webkitRequestFullscreen();
    else return Promise.resolve(false);
  } catch {
    return Promise.resolve(false);
  }
  const entered = ret && typeof ret.then === "function" ? ret.then(() => true, () => false) : fsWhenActive(1500);
  return entered.then(
    (ok) => {
      const on = ok || fsActive();
      if (on) lockLandscape(); // fire and forget, it never rejects
      return on;
    },
    () => false,
  );
}

// → Promise<void>; never throws or rejects (a no-op when not in fullscreen)
function fsExit() {
  try {
    if (!fsActive()) return Promise.resolve();
    const d = document;
    const r =
      typeof d.exitFullscreen === "function" ? d.exitFullscreen() : typeof d.webkitExitFullscreen === "function" ? d.webkitExitFullscreen() : null;
    return Promise.resolve(r).then(() => {}, () => {});
  } catch {
    return Promise.resolve();
  }
}

// a home-screen web app (or an installed PWA)
function isStandalone() {
  try {
    if (typeof matchMedia === "function" && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches)) {
      return true;
    }
  } catch {
    // no matchMedia
  }
  return typeof navigator !== "undefined" && navigator.standalone === true;
}

// iPhone / iPod / iPad (iPadOS says MacIntel, with touch points) in Safari itself, not in a home-screen app
function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = uaString();
  const ios = /iPhone|iPod|iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !isStandalone();
}

export const Fullscreen = Object.freeze({
  supported: fsSupported,
  active: () => fsActive(),
  request: (target) => fsRequest(target),
  exit: fsExit,
  standalone: isStandalone,
  iosSafari: isIosSafari,
  lockLandscape,
  onChange: fsOnChange,
});

// ================================================================ v1.5 (v15-phone): haptics, confetti, coach marks
// Own style block (pe15-styles) so the v1.3 / v1.4 CSS above stays untouched. Same rules: transform / opacity only in
// animations, no backdrop-filter, every string through `copy`.

const STYLE15_ID = "pe15-styles";
const CSS15 = `
.pe-confetti{position:fixed;left:0;top:0;width:100%;height:100%;z-index:12;pointer-events:none}
.pe-coach{position:fixed;inset:0;z-index:25;pointer-events:none;display:none}
.pe-coach.pe-on{display:block}
.pe-coach-ring{position:fixed;box-sizing:border-box;border:4px solid #ffcb3d;border-radius:18px;pointer-events:none;
  box-shadow:0 0 0 3px #120a2e,0 0 22px rgb(255 203 61 / .7);animation:pe-ring 1.1s ease-in-out infinite}
.pe-coach-ring.pe-round{border-radius:50%}
.pe-coach-ring.pe-none{display:none}
@keyframes pe-ring{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.07);opacity:.75}}
.pe-coach-bub{position:fixed;box-sizing:border-box;width:max-content;max-width:min(300px,72vw);padding:10px 14px 12px;pointer-events:auto;
  display:flex;flex-direction:column;gap:5px;text-align:left;font-family:${BODY_FONT};color:#fff;
  background:linear-gradient(160deg,#4a33c9,#22146e);border:4px solid #ffcb3d;border-radius:12px;box-shadow:0 6px 0 #0a0830,0 0 0 3px #120a2e;
  animation:pe-coach-pop .32s cubic-bezier(.2,.9,.3,1.5) both}
@keyframes pe-coach-pop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
.pe-coach-bub::after{content:"";position:absolute;width:16px;height:16px;background:#2f1f97;border:4px solid #ffcb3d;border-radius:3px;
  transform:rotate(45deg);left:var(--ax,50%);margin-left:-12px;display:none}
.pe-coach-bub.pe-a-down::after{display:block;bottom:-12px;border-top:0;border-left:0}
.pe-coach-bub.pe-a-up::after{display:block;top:-12px;border-bottom:0;border-right:0;background:#4733c4}
.pe-coach-dots{font:900 italic 13px/1 ${HEAD_FONT};letter-spacing:.08em;color:#ffcb3d}
.pe-coach-t{font:900 italic 23px/1 ${HEAD_FONT};letter-spacing:.03em;text-transform:uppercase;${OUTLINE}}
.pe-coach-s{font-weight:700;font-size:15px;line-height:1.2;text-shadow:0 2px 0 rgb(10 6 30 / .6)}
.pe-coach-s:empty{display:none}
.pe-coach-row{display:flex;gap:8px;justify-content:flex-end;margin-top:3px}
.pe-coach-row button{font:900 italic 17px/1 ${HEAD_FONT};letter-spacing:.05em;text-transform:uppercase;color:#fff;border:3px solid #120a2e;
  border-radius:8px;min-height:40px;padding:0 14px;cursor:pointer;touch-action:manipulation;transition:transform .08s}
.pe-coach-row button:active{transform:scale(.92)}
.pe-coach-skip{background:rgb(13 11 46 / .7)}
.pe-coach-next{background:linear-gradient(180deg,#ffe36e,#ffb000 55%,#d26a06);-webkit-text-stroke:2.4px #120a2e;paint-order:stroke fill;box-shadow:0 3px 0 #0a0830}
@media (prefers-reduced-motion:reduce){.pe-coach-ring,.pe-coach-bub{animation:none}}
`;

function injectStyles15() {
  if (typeof document === "undefined" || document.getElementById(STYLE15_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE15_ID;
  s.textContent = CSS15;
  document.head.appendChild(s);
}

function reducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// any iOS device (Safari or not, home-screen app included): navigator.vibrate does nothing there, so we never call it
function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPod|iPad/.test(uaString()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Haptics (v1.5): Android Chrome and friends. supported() is false on iOS and wherever navigator.vibrate is missing;
// buzz(pattern) never throws and returns true when the browser took the pattern (a number of ms or [on, off, on...]).
// The caller owns the on/off setting (controller.html keeps it in localStorage).
export const Haptics = Object.freeze({
  supported: () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function" && !isIos(),
  buzz(pattern) {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function" || isIos()) return false;
    try {
      return navigator.vibrate(pattern) !== false;
    } catch {
      return false;
    }
  },
});

// confetti(container, { colors, count, ms }) → { stop() }
// Two confetti cannons from the bottom corners plus a short rain from the top, on one full-screen canvas (z 12, no
// pointer events) that removes itself after `ms`. Reduced motion: nothing. At most one canvas per container at a time.
export function confetti(container, { colors = ["#ffcb3d", "#19d3ff", "#b45cff", "#ff3b5c", "#4ade5a", "#ffffff"], count = 140, ms = 3400 } = {}) {
  if (typeof document === "undefined" || reducedMotion()) return { stop() {} };
  injectStyles15();
  const host = container || document.body;
  const old = host.querySelector(":scope > .pe-confetti");
  if (old) old.remove();
  const cv = el("canvas", "pe-confetti", host);
  const ctx = cv.getContext("2d");
  if (!ctx) {
    cv.remove();
    return { stop() {} };
  }
  const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  ctx.scale(dpr, dpr);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const parts = [];
  const n = Math.max(10, Math.min(260, count | 0));
  for (let i = 0; i < n; i++) {
    const kind = i % 3; // 0 left cannon, 1 right cannon, 2 rain
    const s = Math.min(W, H) / 390;
    const p = {
      x: kind === 0 ? -10 : kind === 1 ? W + 10 : rnd(0, W),
      y: kind === 2 ? rnd(-H * 0.5, -10) : H * rnd(0.75, 1),
      vx: kind === 0 ? rnd(4, 12) * s : kind === 1 ? -rnd(4, 12) * s : rnd(-1, 1),
      vy: kind === 2 ? rnd(1, 3) : -rnd(11, 19) * s,
      w: rnd(6, 11),
      h: rnd(9, 16),
      r: rnd(0, Math.PI * 2),
      vr: rnd(-0.25, 0.25),
      wob: rnd(0, Math.PI * 2),
      c: colors[i % colors.length],
      delay: kind === 2 ? rnd(0, 700) : rnd(0, 250),
    };
    parts.push(p);
  }
  const t0 = performance.now();
  let last = t0, raf = 0, done = false;
  function frame(now) {
    if (done) return;
    const k = Math.min(3, (now - last) / 16.7);
    last = now;
    const age = now - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = age > ms - 600 ? Math.max(0, (ms - age) / 600) : 1;
    for (const p of parts) {
      if (age < p.delay) continue;
      p.vy += 0.32 * k;
      p.vx *= Math.pow(0.985, k);
      p.vy = Math.min(p.vy, 5.5);
      p.wob += 0.12 * k;
      p.x += (p.vx + Math.sin(p.wob) * 0.8) * k;
      p.y += p.vy * k;
      p.r += p.vr * k;
      if (p.y > H + 30) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.cos(p.wob)); // the flutter: a strip turning over
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age >= ms) return stop();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    cv.remove();
  }
  raf = requestAnimationFrame(frame);
  return { stop };
}

// createCoach(container, { copy: { skip, next, done }, onDone(how), stepMs }) → { show(steps, from), hide(), isOpen(), index(), destroy() }
// First-time coach marks: one bubble at a time with a pulsing gold ring around what it is about. steps: [{ title, text,
// rect: DOMRect-like | () => DOMRect-like | null (null: centred, no ring), round }]. Each step moves on by itself after
// stepMs, or on NEXT; SKIP ends them all. Only the bubble takes taps (the controls under the ring keep working).
// onDone("done" | "skip") runs once when the last step ends or SKIP is tapped; hide() (the caller pausing it, e.g. a fight
// started) does not call it, and show(steps, index()) resumes where it stopped.
export function createCoach(container, { copy = {}, onDone, stepMs = 4500 } = {}) {
  injectStyles15();
  const T = { skip: "SKIP", next: "NEXT ▶", done: "GOT IT ▶", ...copy };
  const root = el("div", "pe-coach", container || document.body);
  const ring = el("div", "pe-coach-ring pe-none", root);
  let bub = null;
  let steps = [], i = 0, open = false, timer = 0;

  function build() {
    const b = el("div", "pe-coach-bub", null);
    b.setAttribute("role", "dialog");
    const dots = el("div", "pe-coach-dots", b);
    const title = el("b", "pe-coach-t", b);
    const text = el("span", "pe-coach-s", b);
    const row = el("div", "pe-coach-row", b);
    const skip = el("button", "pe-coach-skip", row, T.skip);
    const next = el("button", "pe-coach-next", row, i >= steps.length - 1 ? T.done : T.next);
    skip.type = next.type = "button";
    skip.addEventListener("click", (e) => (e.stopPropagation(), finish("skip")));
    next.addEventListener("click", (e) => (e.stopPropagation(), advance()));
    b.addEventListener("click", advance);
    return { b, dots, title, text };
  }

  function rectOf(s) {
    let r = null;
    try {
      r = typeof s.rect === "function" ? s.rect() : s.rect;
    } catch {
      r = null;
    }
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
  }

  function render() {
    const s = steps[i];
    const parts = build(); // a fresh node per step: its pop plays from the first frame
    parts.dots.textContent = i + 1 + " / " + steps.length;
    parts.title.textContent = str(s.title);
    parts.text.textContent = str(s.text);
    if (bub) bub.replaceWith(parts.b);
    else root.appendChild(parts.b);
    bub = parts.b;
    const r = rectOf(s);
    const VW = innerWidth, VH = innerHeight, M = 8, GAP = 18;
    if (r) {
      const pad = 6;
      Object.assign(ring.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
      ring.classList.toggle("pe-round", !!s.round);
      ring.classList.remove("pe-none");
    } else ring.classList.add("pe-none");
    const bw = bub.offsetWidth, bh = bub.offsetHeight;
    let left, top, arrow = "";
    if (!r) {
      left = (VW - bw) / 2;
      top = (VH - bh) / 2;
    } else if (r.top - GAP - bh >= M) {
      top = r.top - GAP - bh;
      arrow = "pe-a-down";
    } else if (r.bottom + GAP + bh <= VH - M) {
      top = r.bottom + GAP;
      arrow = "pe-a-up";
    } else {
      // a tall control (a big stick zone): beside it, on the side with more room
      top = Math.max(M, Math.min(VH - bh - M, r.top + r.height / 2 - bh / 2));
      left = r.left + r.width / 2 < VW / 2 ? r.right + GAP : r.left - GAP - bw;
    }
    if (left == null) left = r.left + r.width / 2 - bw / 2;
    left = Math.max(M, Math.min(VW - bw - M, left));
    top = Math.max(M, Math.min(VH - bh - M, top));
    bub.style.left = Math.round(left) + "px";
    bub.style.top = Math.round(top) + "px";
    if (arrow) {
      bub.classList.add(arrow);
      const ax = Math.max(18, Math.min(bw - 18, r.left + r.width / 2 - left));
      bub.style.setProperty("--ax", Math.round(ax) + "px");
    }
    clearTimeout(timer);
    timer = setTimeout(advance, Math.max(1500, s.ms || stepMs));
  }

  function advance() {
    if (!open) return;
    if (i >= steps.length - 1) return finish("done");
    i++;
    render();
  }

  function finish(how) {
    if (!open) return;
    hide();
    if (typeof onDone === "function") {
      try {
        onDone(how);
      } catch {
        // the caller's problem
      }
    }
  }

  function show(list, from = 0) {
    steps = (Array.isArray(list) ? list : []).filter(Boolean);
    if (!steps.length) return false;
    i = Math.max(0, Math.min(steps.length - 1, from | 0));
    open = true;
    root.classList.add("pe-on");
    render();
    return true;
  }

  function hide() {
    clearTimeout(timer);
    if (!open) return;
    open = false;
    root.classList.remove("pe-on");
    ring.classList.add("pe-none");
    if (bub) {
      bub.remove();
      bub = null;
    }
  }

  return { show, hide, isOpen: () => open, index: () => i, destroy: () => (hide(), root.remove()) };
}
