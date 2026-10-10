// Big-screen extras: join QR, kill feed (icon chips, KO lines), player name tags (declutter, status chips), the live map and (v1.5)
// the lobby hangar (a card per player with their ship drawing). Fortnite-like (chunky, slanted, outlined). No dependencies.
// Sizes are in em: the host page sets --bse-fs (space.html: 1rem, which scales with the screen); default 10px (the phone).
// The look does not read any generic page variable (a page's own --ink or --shadow means something else); the only page input
// is --bse-fs. controller.html also uses createNameTags({ max: 25 }) (play mode, update(list) with no options).

const STYLE_ID = "bse-styles";

// Icon art shared by the kill feed chips and the status chips over the ships (inline SVG: identical on every platform, chunky,
// dark outline). Keys: emp, ink, pull, mine, decoy, steal, stun, ko.
export const ICON_SVG = {
  emp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.8 1.8 4.4 13.6h6.4L9.4 22.4l10.2-12.8h-6.6z" fill="#fff36a" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  ink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.6 4.7 6.6 7.9 6.6 11.7a6.6 6.6 0 0 1-13.2 0C5.4 10.1 8.4 6.9 12 2.2z" fill="#1d0f3f" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="9.6" cy="14.4" r="1.7" fill="#fff" opacity=".55"/></svg>',
  pull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 2.8h5.2v9.4a2.2 2.2 0 0 0 4.4 0V2.8h5.2v9.4a7.4 7.4 0 0 1-14.8 0z" fill="#ff3b5c" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/><path d="M4.6 2.8h5.2v4.4H4.6zM14.2 2.8h5.2v4.4h-5.2z" fill="#fff" stroke="#120a2e" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="14" r="7.4" fill="#2c2c45" stroke="#120a2e" stroke-width="2.2"/><path d="M16.2 8.6l2.4-2.4" stroke="#120a2e" stroke-width="3.4" stroke-linecap="round"/><path d="M18.6 6.2l2.4-2.4M18.6 6.2l3 .4M18.6 6.2l-.4-3" stroke="#ffd23d" stroke-width="2" stroke-linecap="round"/><circle cx="8.4" cy="11.4" r="1.9" fill="#fff" opacity=".6"/></svg>',
  decoy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 4.6h17.6v7.4a8.8 8.8 0 0 1-17.6 0z" fill="#fff" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/><path d="M6.8 10.2c1.2-1.6 3.2-1.6 4.4 0M12.8 10.2c1.2-1.6 3.2-1.6 4.4 0M8 14.6c1.3 2.6 6.7 2.6 8 0" fill="none" stroke="#120a2e" stroke-width="2.2" stroke-linecap="round"/></svg>',
  steal: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="#ffcb3d" stroke="#120a2e" stroke-width="2.2"/><circle cx="12" cy="12" r="5.9" fill="none" stroke="#b86a00" stroke-width="1.6"/><path d="M12 7v10M14.7 9.4c-.5-1.2-4.2-1.6-4.7.3-.5 2 4.8 1 4.7 3.4-.1 1.8-4 1.8-4.8.2" fill="none" stroke="#8a4a0a" stroke-width="1.8" stroke-linecap="round"/></svg>',
  stun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.6 6.3 20l1.5-6.5-5-4.4 6.6-.6z" fill="#fff36a" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/></svg>',
  ko: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#120a2e" stroke-width="7.4" stroke-linecap="round"/><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
  // v1.3: the big moments of a round (wrecked parked ship, chest, boss down, landing, round won)
  wreck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 3.2a5 5 0 0 0-5.5 6.6L3.4 15.5a2.3 2.3 0 0 0 3.2 3.2l5.7-5.7a5 5 0 0 0 6.6-5.5l-3 3-2.8-.6-.6-2.8z" fill="#e8ecff" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/></svg>',
  chest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5h18v8.6a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 19.1z" fill="#c9791a" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/><path d="M3 10.5C3 6.3 6 3.6 12 3.6s9 2.7 9 6.9z" fill="#ffb92e" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/><rect x="9.8" y="9.2" width="4.4" height="5.4" rx="1" fill="#fff36a" stroke="#120a2e" stroke-width="1.6"/></svg>',
  boss: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6c5 0 8.6 3.4 8.6 7.8 0 2.7-1.3 4.4-3 5.4v3.4c0 .9-.7 1.6-1.6 1.6H8c-.9 0-1.6-.7-1.6-1.6v-3.4c-1.7-1-3-2.7-3-5.4C3.4 6 7 2.6 12 2.6z" fill="#fff" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/><circle cx="8.6" cy="11" r="2.2" fill="#e0183f"/><circle cx="15.4" cy="11" r="2.2" fill="#e0183f"/><path d="M10.4 17.4v2.4M13.6 17.4v2.4" stroke="#120a2e" stroke-width="1.6"/></svg>',
  planet: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.6" fill="#19d3ff" stroke="#120a2e" stroke-width="2"/><ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="#fff" stroke-width="2.2" transform="rotate(-20 12 12)"/></svg>',
  win: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 19.2L2.4 7.4l5.8 4.8L12 4.4l3.8 7.8 5.8-4.8-1 11.8z" fill="#ffcb3d" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/></svg>',
};
// Words on the chips. The page passes its own (COPY table) through opts.labels; these defaults only keep old callers working.
const DEFAULT_LABELS = { emp: "EMP", ink: "INK", pull: "PULL", mine: "MINE", decoy: "DECOY", steal: "STEAL", stun: "STUN", ko: "KO",
  wreck: "WRECK", chest: "CHEST", boss: "BOSS", planet: "LAND", win: "WIN" };
// The punchlines of the fun kill-feed lines (parseFeedLine → fun). The page passes its own through opts.lines (its COPY table).
export const DEFAULT_LINES = {
  emp: "BUTTONS SCRAMBLED!", ink: "SPLAT!", pull: "YOINK!", hit: "HIT", s: "'S", mine: "BOOM! {n}", fellFor: "FELL FOR",
  stole: "+{n} STOLEN!", lastHit: "LAST HIT! BOSS DOWN!", lastHitStolen: "STOLE THE LAST HIT FROM", swarm: "BOSS DOWN!",
  topDamage: "DID THE MOST DAMAGE", wreck: "SHIP WRECKED!", chest: "OPENED A CHEST!", landed: "LANDED ON THE PLANET",
  rebuilt: "REBUILT THEIR SHIP", wins: "WINS THE ROUND!",
};
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// v1.6: a player's colour as TEXT. Dark colours (dark blue, purple) are hard to read from the sofa on the navy panels, so a name
// is painted in a lighter tint of its colour (same hue, mixed with white up to a minimum brightness; light colours are unchanged).
// Swatches, stripes, dots and rings keep the true colour. c = "#rgb" | "#rrggbb" | 0xrrggbb; anything else comes back as it is.
const readCache = new Map();
export function readableColour(c, minLum = 0.42) {
  if (Number.isFinite(c)) c = "#" + (c >>> 0).toString(16).padStart(6, "0").slice(-6);
  if (typeof c !== "string") return c;
  const key = c + "|" + minLum;
  const hit = readCache.get(key);
  if (hit) return hit;
  let out = c;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const s = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    const n = parseInt(s, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (t) => { const f = (v) => v + (255 - v) * t; return 0.2126 * lin(f(r)) + 0.7152 * lin(f(g)) + 0.0722 * lin(f(b)); };
    if (lum(0) < minLum) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) { const t = (lo + hi) / 2; if (lum(t) < minLum) lo = t; else hi = t; }
      const f = (v) => Math.round(v + (255 - v) * hi);
      out = "#" + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
    }
  }
  if (readCache.size > 256) readCache.clear();
  readCache.set(key, out);
  return out;
}
function chipEl(key, label) {
  const c = document.createElement("span");
  c.className = "bse-chip " + key;
  c.innerHTML = (ICON_SVG[key] || "") + (label ? `<span>${escHtml(label)}</span>` : "");
  return c;
}

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.bse-qr,.bse-feed,.bse-tags,.bse-hangar{--bse-fh:"Barlow Condensed",Impact,"Arial Narrow",system-ui,sans-serif;
  --bse-fb:Barlow,system-ui,-apple-system,"Segoe UI",sans-serif;--bse-ink:#120a2e;
  --bse-shadow:#0a0830;--bse-ok:#4ade5a;font-size:var(--bse-fs,10px)}

.bse-qr{display:flex;flex-direction:column;align-items:center;gap:.8em;width:100%;color:#fff;font-family:var(--bse-fb)}
.bse-qr-title{font:italic 900 1.9em/1 var(--bse-fh);text-transform:uppercase;letter-spacing:.03em;
  -webkit-text-stroke:.1em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .1em 0 rgb(10 6 30/.55)}
.bse-qr-tile{box-sizing:border-box;width:100%;background:#fff;border:.3em solid #fff;border-radius:.9em;
  box-shadow:0 0 0 .18em var(--bse-ink),0 .55em 0 .18em var(--bse-shadow)}
.bse-qr-tile canvas{display:block;width:100%;height:auto;aspect-ratio:1/1;image-rendering:pixelated;border-radius:.4em}
.bse-qr-url{font:800 1.15em/1.2 var(--bse-fb);letter-spacing:.02em;color:#ffe9a3;background:rgb(10 6 30/.55);
  padding:.35em .9em;border-radius:.6em;text-align:center;overflow-wrap:anywhere;max-width:100%}

/* chips: chunky coloured icon plates (kill feed lines and the status chips over the ships) */
.bse-chip{--ca:#8ff3ff;--cb:#1aa7ff;position:relative;isolation:isolate;display:inline-flex;align-items:center;gap:.3em;vertical-align:middle;
  padding:.1em .62em .18em .46em;margin:0 .2em;font:italic 900 .86em/1.1 var(--bse-fh);letter-spacing:.05em;text-transform:uppercase;
  color:#fff;-webkit-text-stroke:.16em var(--bse-ink);paint-order:stroke fill;white-space:nowrap;text-shadow:0 .1em 0 rgb(10 6 30/.5)}
.bse-chip::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;
  background:linear-gradient(180deg,var(--ca),var(--cb));border:.12em solid #fff;box-shadow:0 .16em 0 var(--bse-shadow)}
.bse-chip svg{width:1.3em;height:1.3em;flex:none;display:block;margin:-.1em 0}
.bse-chip.emp{--ca:#8ff3ff;--cb:#1aa7ff}
.bse-chip.ink{--ca:#c99bff;--cb:#7a35e8}
.bse-chip.pull{--ca:#9af59a;--cb:#2fb84a}
.bse-chip.mine{--ca:#ffbf73;--cb:#ff7a1a}
.bse-chip.decoy{--ca:#ffa5ee;--cb:#e03fc4}
.bse-chip.steal,.bse-chip.stun{--ca:#ffe27a;--cb:#ffb000;color:#241400;-webkit-text-stroke:0;text-shadow:0 .1em 0 rgb(255 255 255/.5)}
.bse-chip.ko{--ca:#ff8aa0;--cb:#e0183f}
.bse-chip.wreck{--ca:#b9c2e8;--cb:#5d6aa8}
.bse-chip.chest,.bse-chip.win{--ca:#ffe27a;--cb:#ffb000;color:#241400;-webkit-text-stroke:0;text-shadow:0 .1em 0 rgb(255 255 255/.5)}
.bse-chip.boss{--ca:#ff6f8b;--cb:#c0102f}
.bse-chip.planet{--ca:#7fe3ff;--cb:#1f7dff}

/* fun lines: player names are their colour, the punchline is gold */
.bse-feed-item .bse-nm{white-space:nowrap}
.bse-feed-item .bse-punch{color:#ffe27a;white-space:nowrap}
.bse-feed-item.ko .bse-punch{color:#ffb3c0}
/* opts.side "left": the feed hangs from the bottom-left corner (the TV), newest line at the bottom */
.bse-feed.bse-left{align-items:flex-start}
.bse-feed.bse-left .bse-feed-item{text-align:left;transform:translateX(-2.4em) scale(.92);padding:.32em 1.15em .44em 1.05em}
.bse-feed.bse-left .bse-feed-item::before{border-right:.1em solid rgb(255 255 255/.6);border-left:.42em solid var(--c,#9fd8ff)}
.bse-feed.bse-left .bse-feed-item.in{transform:none}
.bse-feed.bse-left .bse-feed-item.out{transform:translateX(-1em)}

/* live map (createMiniMap): chunky slanted header plates over rounded map tiles */
.bse-map{--bse-fh:"Barlow Condensed",Impact,"Arial Narrow",system-ui,sans-serif;--bse-ink:#120a2e;--bse-shadow:#0a0830;
  font-size:var(--bse-fs,10px);display:flex;flex-direction:column;gap:.7em;pointer-events:none}
.bse-map-panel{position:relative}
.bse-map-panel.planet{display:none}
.bse-map-panel.planet.on{display:block;animation:bse-pop .45s cubic-bezier(.34,1.56,.64,1) both}
.bse-map-hd{position:absolute;left:.6em;top:-.9em;z-index:2;display:flex;align-items:center;gap:.5em;padding:.18em .9em .26em .7em;isolation:isolate;
  font:italic 900 1.35em/1 var(--bse-fh);text-transform:uppercase;letter-spacing:.06em;color:#fff;-webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill}
.bse-map-hd::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;background:linear-gradient(180deg,#b45cff,#8a3dff);
  border:.13em solid #fff;box-shadow:0 .2em 0 var(--bse-shadow)}
.bse-map-panel.planet .bse-map-hd::before{background:linear-gradient(180deg,#4fd1ff,#1f7dff)}
.bse-map-hd b{font-weight:900;color:#ffe27a}
.bse-map-hd b:empty{display:none}
.bse-map-cv{position:relative;width:100%;aspect-ratio:1/1;border-radius:1em;overflow:hidden;border:.22em solid #fff;
  box-shadow:0 0 0 .16em var(--bse-ink),0 .4em 0 .16em var(--bse-shadow);
  background:radial-gradient(circle at 50% 40%,rgb(64 40 170/.92),rgb(16 12 60/.94) 75%)}
.bse-map-panel.planet .bse-map-cv{aspect-ratio:4/3;background:radial-gradient(circle at 50% 45%,rgb(70 150 96/.94),rgb(22 70 60/.95) 80%)}
.bse-map-cv canvas{position:absolute;inset:0;width:100%;height:100%;display:block}

.bse-feed{position:absolute;top:1.8em;right:2.2em;display:flex;flex-direction:column;align-items:flex-end;gap:.5em;
  pointer-events:none;z-index:25;font-family:var(--bse-fb)}
.bse-feed-item{position:relative;isolation:isolate;max-width:27em;padding:.32em 1.05em .44em 1.15em;
  font:italic 800 1.6em/1.16 var(--bse-fh);text-transform:uppercase;letter-spacing:.02em;color:#fff;text-align:right;
  -webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .1em 0 rgb(10 6 30/.55);
  opacity:0;transform:translateX(2.4em) scale(.92)}
.bse-feed-item::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;
  background:linear-gradient(180deg,rgb(40 29 128/.95),rgb(20 13 66/.95));border:.1em solid rgb(255 255 255/.6);
  border-right:.42em solid var(--c,#9fd8ff);box-shadow:0 .22em 0 var(--bse-shadow)}
.bse-feed-item.ko::before{background:linear-gradient(180deg,rgb(86 22 66/.96),rgb(40 12 48/.96))}
.bse-feed-item.hint{font-size:1.25em;font-weight:700}
.bse-feed-item.hint::before{background:linear-gradient(180deg,rgb(120 60 220/.95),rgb(76 34 160/.95))}
.bse-feed-item.quiet{font-size:1.2em;font-weight:700}
.bse-feed-item.quiet::before{background:linear-gradient(180deg,rgb(34 26 100/.8),rgb(18 12 56/.8))}
.bse-feed-item.in{opacity:1;transform:none;transition:opacity .2s ease-out,transform .34s cubic-bezier(.34,1.56,.64,1)}
.bse-feed-item.quiet.in{opacity:.82}
.bse-feed-item.loot{font-size:1.02em;font-weight:600;padding-top:.18em;padding-bottom:.22em}
.bse-feed-item.loot::before{background:linear-gradient(180deg,rgb(28 22 80/.62),rgb(14 10 44/.62))}
.bse-feed-item.loot.in{opacity:.66}
.bse-feed-item.out{opacity:0;transform:translateX(1em);transition:opacity .5s ease-in,transform .5s ease-in}
.bse-feed-item.ko.in::before{animation:bse-flash .9s ease-out both}
.bse-feed-item.ko.in .bse-chip.ko{animation:bse-pop .4s cubic-bezier(.34,1.56,.64,1) both}

.bse-tags{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10;font-family:var(--bse-fb)}
.bse-tags.n-md{font-size:calc(var(--bse-fs,10px)*.86)}
.bse-tags.n-sm{font-size:calc(var(--bse-fs,10px)*.72)}
.bse-tag{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;transform-origin:0 0}
.bse-tag-in{position:absolute;left:0;bottom:0;transform:translateX(-50%)}
.bse-tag-card{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:.28em;transform-origin:50% 100%}
.bse-tag-card.bse-pop{animation:bse-pop .34s cubic-bezier(.34,1.56,.64,1) both}
.bse-tag-top{display:flex;align-items:center;gap:.4em;white-space:nowrap}
.bse-tag-name{font:italic 800 1.35em/1.05 var(--bse-fh);text-transform:uppercase;letter-spacing:.03em;
  -webkit-text-stroke:.16em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .12em 0 rgb(10 6 30/.6)}
.bse-tag-mark,.bse-tag-badge,.bse-tag-sub{display:none}
.bse-tag-bar{width:4.8em;height:.72em;transform:skewX(-14deg);background:rgb(10 6 30/.8);border:.15em solid #fff;
  border-radius:.25em;box-shadow:0 .16em 0 var(--bse-shadow);overflow:hidden}
.bse-tag-fill{width:100%;height:100%;background:linear-gradient(180deg,#9bf7a6,var(--bse-ok));transform-origin:left center}
.bse-tag-fill.mid{background:linear-gradient(180deg,#ffe27a,#ffb000)}
.bse-tag-fill.low{background:linear-gradient(180deg,#ff8aa0,#ff3b5c)}
.bse-tag-st{display:flex;gap:.1em;justify-content:center;white-space:nowrap}
.bse-tag-st:empty{display:none}
.bse-tag-st .bse-chip{display:none;font-size:1.02em}
.bse-tag-st .bse-chip.on{display:inline-flex}
.bse-tag-dot{display:none;position:absolute;left:0;bottom:0;width:.95em;height:.95em;margin-left:-.475em;border-radius:50%;background:var(--pc,currentColor);
  border:.17em solid #fff;box-shadow:0 0 0 .13em var(--bse-ink),0 .2em 0 .13em var(--bse-shadow)}
.bse-tag.m1 .bse-tag-bar{display:none}
.bse-tag.m1 .bse-tag-name{font-size:1.12em}
.bse-tag.m2 .bse-tag-card{display:none}
.bse-tag.m2 .bse-tag-dot{display:block}
.bse-tag.bot .bse-tag-bar{width:3.6em}
.bse-tags.bse-m-lobby .bse-tag-st,.bse-tags.bse-m-lobby .bse-tag-dot{display:none!important}
.bse-tags.bse-m-lobby .bse-tag-bar{display:none}
.bse-tags.bse-m-lobby .bse-tag-card{flex-direction:row;padding:.34em .85em .42em;gap:.45em}
.bse-tags.bse-m-lobby .bse-tag-card::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-8deg);border-radius:.45em;
  background:linear-gradient(180deg,rgb(40 30 130/.93),rgb(18 12 62/.93));border:.14em solid rgb(255 255 255/.7);
  box-shadow:0 .26em 0 var(--bse-shadow)}
.bse-tags.bse-m-lobby .bse-tag-badge.on{display:inline-block;font:italic 900 1.05em/1 var(--bse-fh);color:#ffcb3d;
  -webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill}
.bse-tags.bse-m-lobby .bse-tag-sub.on{display:inline-block;font:800 .74em/1 var(--bse-fb);letter-spacing:.07em;text-transform:uppercase;
  padding:.3em .7em;border-radius:.7em}
.bse-tag-sub.ok{background:var(--bse-ok);color:#08260f}
.bse-tag-sub.wait{background:rgb(255 255 255/.18);color:#ddd8ff}
.bse-tag-sub.bot{background:rgb(255 255 255/.12);color:#aeb0d4}
.bse-tags.bse-m-lobby.n-sm .bse-tag-sub.on,.bse-tags.bse-m-lobby.n-md .bse-tag-sub.on{display:none}
.bse-tags.bse-m-lobby.n-sm .bse-tag-card,.bse-tags.bse-m-lobby.n-md .bse-tag-card{padding:.3em .75em .38em}
.bse-tags.bse-m-lobby.n-sm .bse-tag-mark.on,.bse-tags.bse-m-lobby.n-md .bse-tag-mark.on{display:inline-block;font:900 1em/1 var(--bse-fb)}
.bse-tag-mark.ok{color:var(--bse-ok)}
.bse-tag-mark.wait{color:#c8c2ff}
.bse-tag-mark.bot{color:#aeb0d4}
/* lobby hangar (createHangar): one card per player, their ship drawing on a paper tile; every size is in em of the card
   (font-size = a tenth of its width), so the same card works from 2 big ones to 25 small ones */
.bse-hangar{display:grid;grid-template-columns:repeat(var(--hc,4),var(--hw,10em));gap:var(--hg,1em);justify-content:center;align-content:center;
  flex:1 1 auto;width:100%;min-height:0;pointer-events:none}
.bse-hangar:empty{display:none}
.bse-hc{--pc:#fff;position:relative;isolation:isolate;width:var(--hw,10em);font-size:calc(var(--hw,10em)*.1);padding:.45em .45em .4em;
  display:flex;flex-direction:column;gap:.3em}
.bse-hc::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-6deg);border-radius:.7em;
  background:linear-gradient(180deg,rgb(46 34 150/.95),rgb(22 14 78/.95));border:.2em solid rgb(255 255 255/.7);
  box-shadow:inset 0 -.42em 0 var(--pc),0 .4em 0 var(--bse-shadow)}
.bse-hc.ok::before{border-color:var(--bse-ok);box-shadow:inset 0 -.42em 0 var(--pc),0 .4em 0 var(--bse-shadow),0 0 1.1em rgb(74 222 90/.55)}
.bse-hc-pic{position:relative;aspect-ratio:1/1;border-radius:.45em;overflow:hidden;transform:rotate(-2deg);border:.2em solid #fff;
  background:repeating-linear-gradient(180deg,#fffdf4 0 1.15em,#dfe8ff 1.15em 1.22em);box-shadow:0 0 0 .13em var(--bse-ink),0 .28em 0 .13em var(--bse-shadow)}
.bse-hc:nth-child(even) .bse-hc-pic{transform:rotate(2deg)}
.bse-hc-pic img{position:absolute;left:6%;top:6%;width:88%;height:88%;object-fit:contain;opacity:0}
.bse-hc.drawn .bse-hc-pic img{opacity:1}
.bse-hc-wait{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.35em;color:#5a4cb0;
  font:italic 900 1.25em/1 var(--bse-fh);letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.bse-hc.drawn .bse-hc-wait{display:none}
.bse-hc-wait svg{width:3.6em;height:3.6em;display:block;animation:bse-scribble 1.1s ease-in-out infinite}
.bse-hc-nm{font:italic 900 1.55em/1.12 var(--bse-fh);text-transform:uppercase;letter-spacing:.02em;text-align:center;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;color:var(--pt,var(--pc));-webkit-text-stroke:.15em var(--bse-ink);paint-order:stroke fill;
  text-shadow:0 .12em 0 rgb(10 6 30/.6);padding:0 .15em .12em}
.bse-hc-st,.bse-hc-ok{position:absolute;top:-.55em;z-index:2;display:none;padding:.18em .55em .26em;border-radius:.6em;white-space:nowrap;
  font:italic 900 1.15em/1 var(--bse-fh);letter-spacing:.04em;text-transform:uppercase;box-shadow:0 0 0 .12em var(--bse-ink),0 .2em 0 .12em var(--bse-shadow)}
.bse-hc-st{left:-.5em;background:linear-gradient(180deg,#ffe27a,#ffb000);color:#241400;transform:rotate(-6deg)}
.bse-hc-st:not(:empty){display:block}
.bse-hc-ok{right:-.5em;background:var(--bse-ok);color:#08260f;transform:rotate(5deg)}
.bse-hc.ok .bse-hc-ok{display:block;animation:bse-pop .4s cubic-bezier(.34,1.56,.64,1) both}
.bse-hc-ok .s,.bse-hangar.compact .bse-hc-ok .l{display:none}
.bse-hc.wt{opacity:.72}.bse-hc.wt .bse-hc-ok{display:block;background:#ffc93c;color:#3a2400}
.bse-hc.pr .bse-hc-ok{display:block;background:linear-gradient(180deg,#b45cff,#8a3dff);color:#fff}
.bse-hangar.compact .bse-hc-ok .s{display:inline}
.bse-hangar.compact .bse-hc-nm{font-size:2em}
.bse-hangar.compact .bse-hc-st,.bse-hangar.compact .bse-hc-ok{font-size:1.7em}
.bse-hangar.compact .bse-hc-wait span{display:none}
.bse-hc.in{animation:bse-hc-in .6s cubic-bezier(.34,1.56,.64,1) both}
.bse-hc.in.quiet{animation-duration:.4s}
.bse-hc.in::after{content:"";position:absolute;inset:-.5em;border-radius:1em;border:.35em solid var(--pc);pointer-events:none;animation:bse-ring .7s ease-out both}
.bse-hc.in.quiet::after{display:none}
.bse-hc.fresh .bse-hc-pic{animation:bse-pic .55s cubic-bezier(.34,1.56,.64,1) both}
@keyframes bse-hc-in{0%{opacity:0;transform:translateY(-1.6em) scale(.35) rotate(-8deg)}55%{opacity:1;transform:translateY(.25em) scale(1.12) rotate(2deg)}
  100%{opacity:1;transform:none}}
@keyframes bse-ring{0%{opacity:.95;transform:scale(.85)}100%{opacity:0;transform:scale(1.3)}}
@keyframes bse-pic{0%{transform:scale(1.35) rotate(-8deg);filter:brightness(1.8)}100%{filter:none}}
@keyframes bse-scribble{0%,100%{transform:translate(-.3em,.15em) rotate(-10deg)}50%{transform:translate(.3em,-.15em) rotate(8deg)}}
@keyframes bse-pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@keyframes bse-flash{0%{filter:brightness(2.2) saturate(1.7)}100%{filter:none}}
@media (prefers-reduced-motion:reduce){.bse-tag-card.bse-pop,.bse-feed-item.ko.in::before,.bse-feed-item.ko.in .bse-chip.ko,.bse-hc.in,.bse-hc.in::after,.bse-hc.fresh .bse-hc-pic,.bse-hc-wait svg,.bse-hc.ok .bse-hc-ok{animation:none}.bse-feed-item.in,.bse-feed-item.out{transition:opacity .2s}}
`;
  document.head.appendChild(s);
}

/* ---------- QR encoder: byte mode, EC level M, versions 1-6 ---------- */

// [total codewords, ec codewords per block, blocks] per version, level M
const QR_M = { 1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1], 4: [100, 18, 2], 5: [134, 24, 2], 6: [172, 16, 4] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gmul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gmul(gen[i + 1], f);
  }
  return rem;
}

function formatBits(mask) {
  const data = (0 << 3) | mask; // EC level M = 00
  let r = data;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((data << 10) | r) ^ 0x5412;
}

/** Returns { size, modules: Uint8Array(size*size) } for the text, or throws if it does not fit in version 6. */
export function encodeQR(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    const [total, ec, blocks] = QR_M[v];
    if (bytes.length <= total - ec * blocks - 2) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR text too long for version 6-M");
  const [total, ecLen, blocks] = QR_M[version];
  const dataCap = total - ecLen * blocks;

  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

  const per = dataCap / blocks;
  const dBlocks = [];
  const eBlocks = [];
  for (let i = 0; i < blocks; i++) {
    const d = data.slice(i * per, (i + 1) * per);
    dBlocks.push(d);
    eBlocks.push(rsRemainder(d, ecLen));
  }
  const codewords = [];
  for (let i = 0; i < per; i++) dBlocks.forEach((d) => codewords.push(d[i]));
  for (let i = 0; i < ecLen; i++) eBlocks.forEach((e) => codewords.push(e[i]));
  const stream = [];
  codewords.forEach((c) => put2(stream, c));
  function put2(arr, c) {
    for (let i = 7; i >= 0; i--) arr.push((c >>> i) & 1);
  }

  const size = 17 + 4 * version;
  const base = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size); // function-module mask
  const set = (x, y, v) => {
    base[y * size + x] = v ? 1 : 0;
    fn[y * size + x] = 1;
  };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  const al = ALIGN[version];
  for (const cy of al)
    for (const cx of al) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const f = formatBits(mask);
    const bit = (i) => (f >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, 1);
  };
  drawFormat(0);

  // zigzag data placement
  const place = (mask) => {
    const m = base.slice();
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - v : v;
          if (fn[y * size + x]) continue;
          let bit = k < stream.length ? stream[k] : 0;
          k++;
          const hit = [
            (x + y) % 2 === 0,
            y % 2 === 0,
            x % 3 === 0,
            (x + y) % 3 === 0,
            (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
            ((x * y) % 2) + ((x * y) % 3) === 0,
            (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
            (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
          ][mask];
          if (hit) bit ^= 1;
          m[y * size + x] = bit;
        }
    }
    return m;
  };

  const penalty = (m) => {
    let p = 0;
    const at = (x, y) => m[y * size + x];
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        const line = [];
        for (let b = 0; b < size; b++) {
          const c = pass ? at(a, b) : at(b, a);
          line.push(c);
          if (b > 0 && c === (pass ? at(a, b - 1) : at(b - 1, a))) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else run = 1;
        }
        const s = line.join("");
        for (const pat of ["10111010000", "00001011101"]) {
          let i = -1;
          while ((i = s.indexOf(pat, i + 1)) >= 0) p += 40;
        }
      }
    }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
      }
    let dark = 0;
    for (const v of m) dark += v;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };

  let best = null;
  let bestMask = 0;
  let bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = place(mask);
    // temporarily write format so penalty sees it
    const saved = base.slice();
    base.set(m);
    drawFormat(mask);
    const withFmt = base.slice();
    base.set(saved);
    const p = penalty(withFmt);
    if (p < bestP) {
      bestP = p;
      best = withFmt;
      bestMask = mask;
    }
  }
  return { size, version, mask: bestMask, modules: best };
}

/* ---------- join QR ---------- */

// opts.size: CSS px of the code (default 220), or "fit" = as wide as its container, redrawn when that changes.
// opts.title: string for the title above the code (default "SCAN TO JOIN"), false = no title. opts.showUrl: default true.
// The page that owns the copy passes its own strings; the defaults only keep old callers working.
export function createJoinQR(container, url, opts = {}) {
  injectStyles();
  const fit = opts.size === "fit";
  const quiet = 4;
  const wrap = document.createElement("div");
  wrap.className = "bse-qr";
  let title = null;
  if (opts.title !== false) {
    title = document.createElement("div");
    title.className = "bse-qr-title";
    title.textContent = opts.title || "SCAN TO JOIN";
  }
  const tile = document.createElement("div");
  tile.className = "bse-qr-tile";
  const canvas = document.createElement("canvas");
  tile.appendChild(canvas);
  let urlEl = null;
  if (opts.showUrl !== false) {
    urlEl = document.createElement("div");
    urlEl.className = "bse-qr-url";
  }
  for (const n of [title, tile, urlEl]) if (n) wrap.appendChild(n);
  if (!fit) {
    wrap.style.cssText = "width:auto;display:inline-flex";
    tile.style.width = "auto";
  }
  container.appendChild(wrap);

  let text = url;
  function draw(next) {
    if (typeof next === "string") text = next;
    if (urlEl) urlEl.textContent = text.replace(/^https?:\/\//, "");
    let qr;
    try {
      qr = encodeQR(text);
    } catch (e) {
      tile.style.display = "none";
      return;
    }
    tile.style.display = "";
    const dpr = window.devicePixelRatio || 1;
    const css = fit ? canvas.clientWidth || tile.clientWidth || 260 : opts.size || 220;
    const cells = qr.size + quiet * 2;
    // Exact device pixels, module edges rounded to whole pixels: crisp at any size, no blur from scaling.
    const px = Math.max(cells, Math.round(css * dpr));
    canvas.width = canvas.height = px;
    if (!fit) canvas.style.width = canvas.style.height = `${css}px`;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, px, px);
    g.fillStyle = "#0d0a26";
    const s = px / cells;
    for (let y = 0; y < qr.size; y++) {
      const y0 = Math.round((y + quiet) * s);
      const y1 = Math.round((y + 1 + quiet) * s);
      for (let x = 0; x < qr.size; ) {
        if (!qr.modules[y * qr.size + x]) {
          x++;
          continue;
        }
        let x2 = x;
        while (x2 < qr.size && qr.modules[y * qr.size + x2]) x2++;
        const a = Math.round((x + quiet) * s);
        g.fillRect(a, y0, Math.round((x2 + quiet) * s) - a, y1 - y0);
        x = x2;
      }
    }
  }
  draw(url);
  let ro = null;
  if (fit && typeof ResizeObserver === "function") {
    let lastW = canvas.clientWidth;
    ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      if (w && w !== lastW) {
        lastW = w;
        draw();
      }
    });
    ro.observe(tile);
  }
  return { el: wrap, canvas, setUrl: draw, destroy: () => { if (ro) ro.disconnect(); wrap.remove(); } };
}

/* ---------- kill feed ---------- */

const isWordChar = (ch) => !!ch && /[a-z0-9]/i.test(ch);

// Splits text into [piece, colour|null] so every player name in it can be painted in that player's colour.
function colourSegments(text, names) {
  const low = text.toLowerCase();
  const hits = [];
  for (const [name, col] of names) {
    const n = String(name).toLowerCase();
    if (!n) continue;
    let i = -1;
    while ((i = low.indexOf(n, i + 1)) >= 0) {
      if (isWordChar(low[i - 1]) || isWordChar(low[i + n.length])) continue;
      hits.push({ i, e: i + n.length, col });
    }
  }
  hits.sort((a, b) => a.i - b.i || b.e - a.e);
  const out = [];
  let pos = 0;
  for (const h of hits) {
    if (h.i < pos) continue;
    if (h.i > pos) out.push([text.slice(pos, h.i), null]);
    out.push([text.slice(h.i, h.e), h.col]);
    pos = h.e;
  }
  if (pos < text.length) out.push([text.slice(pos), null]);
  return out;
}

// The server's announce lines carry one emoji per mischief (⚡ emp, 🦑 inkbomb, 🧲 tractor, 💣 mine, 🎭 decoy, 💰 steal): they become
// coloured icon chips. "bob ✕ ana" (+ " 💣" / " 🧲" for a mischief kill) becomes name · KO chip · name (· chip). Every other emoji is dropped.
// v1.3 adds 🔧 wreck, 💎 chest, 💥 boss down, 🏆 round won.
const ICON_OF = { "⚡": "emp", "\u{1F991}": "ink", "\u{1F9F2}": "pull", "\u{1F4A3}": "mine", "\u{1F3AD}": "decoy", "\u{1F4B0}": "steal",
  "\u{1F527}": "wreck", "\u{1F48E}": "chest", "\u{1F4A5}": "boss", "\u{1F3C6}": "win" };
const ICON_RE = /(⚡|\u{1F991}|\u{1F9F2}|\u{1F4A3}|\u{1F3AD}|\u{1F4B0}|\u{1F527}|\u{1F48E}|\u{1F4A5}|\u{1F3C6})️?/gu;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2693}\u{2695}-\u{26FF}]️?/gu;

// Fun lines: the server's plain sentences ("ana scrambled bob's buttons") become "ANA [EMP] BOB  BUTTONS SCRAMBLED!": names in
// their colours, an icon chip for the trick, a gold punchline. Segments: { n: name } | { c: chip key } | { t: text, g?: glued to
// the previous piece } | { p: punchline }. A line the patterns do not know falls back to the plain text (plus its emoji chips),
// so a reworded server line still reads fine.
const NM = "([a-z0-9]{1,20})";
const fill = (tpl, n) => String(tpl).replace("{n}", n == null ? "" : n).replace(/\s+/g, " ").trim();
// world.js says "💥 Someone destroyed the boss!" when it knows no killer: never a player name (names are lowercase), so no name
// piece for it, just the boss chip and BOSS DOWN!.
const NOBODY = "Someone";
const bossLine = (m, L) => (m[1] === NOBODY ? [{ c: "boss" }, { p: L.swarm }] : [{ n: m[1] }, { c: "boss" }, { p: L.lastHit }]);
const FUN = [
  [new RegExp(`^${NM} scrambled ${NM}'s buttons`, "i"), (m, L) => [{ n: m[1] }, { c: "emp" }, { n: m[2] }, { p: L.emp }]],
  [new RegExp(`^${NM} inked ${NM}'s screen`, "i"), (m, L) => [{ n: m[1] }, { c: "ink" }, { n: m[2] }, { p: L.ink }]],
  [new RegExp(`^${NM} pulled ${NM}\\b`, "i"), (m, L) => [{ n: m[1] }, { c: "pull" }, { n: m[2] }, { p: L.pull }]],
  [new RegExp(`^${NM} hit ${NM}'s mine(?: \\((-?\\d+)\\))?`, "i"), (m, L) => [{ n: m[1] }, { t: L.hit }, { n: m[2] }, { t: L.s, g: true }, { c: "mine" }, { p: fill(L.mine, m[3] ? m[3].replace("-", "−") : "") }]],
  [new RegExp(`^${NM} shot ${NM}'s decoy`, "i"), (m, L) => [{ n: m[1] }, { t: L.fellFor }, { n: m[2] }, { t: L.s, g: true }, { c: "decoy" }]],
  [new RegExp(`^${NM} stole (\\d+) points from ${NM}`, "i"), (m, L) => [{ n: m[1] }, { c: "steal" }, { n: m[3] }, { p: fill(L.stole, m[2]) }]],
  // the boss (world.js v1.3): "ana destroyed the boss! +1000. …", "ana stole the boss from bob! +1000. …", "The swarm brought the
  // boss down! ana did the most damage: +1000. …"; the v1.2 "ana landed the last hit on the boss (stolen from bob)" reads the same
  [new RegExp(`^${NM} stole the boss from ${NM}`, "i"), (m, L) => [{ n: m[1] }, { c: "boss" }, { p: L.lastHitStolen }, { n: m[2] }]],
  [new RegExp(`^${NM} destroyed the boss`, "i"), bossLine],
  [new RegExp(`^${NM} landed the last hit on the boss \\(stolen from ${NM}\\)`, "i"), (m, L) => [{ n: m[1] }, { c: "boss" }, { p: L.lastHitStolen }, { n: m[2] }]],
  [new RegExp(`^${NM} landed the last hit on the boss`, "i"), bossLine],
  [/^the swarm brought the boss down!?(?: ([a-z0-9]{1,20}) did the most damage)?/i, (m, L) => [{ c: "boss" }, { p: L.swarm }].concat(m[1] ? [{ n: m[1] }, { t: L.topDamage }] : [])],
  [new RegExp(`^${NM} wrecked ${NM}'s ship(?: \\(\\+?(\\d+)\\))?`, "i"), (m, L) => [{ n: m[1] }, { c: "wreck" }, { n: m[2] }, { p: L.wreck + (m[3] ? ` +${m[3]}` : "") }]],
  [new RegExp(`^${NM}'s ship was wrecked`, "i"), (m, L) => [{ c: "wreck" }, { n: m[1] }, { p: L.wreck }]],
  [new RegExp(`^${NM} opened a chest(?: \\(\\+?(\\d+)\\))?`, "i"), (m, L) => [{ c: "chest" }, { n: m[1] }, { p: L.chest + (m[2] ? ` +${m[2]}` : "") }]],
  [new RegExp(`^${NM} landed on the planet`, "i"), (m, L) => [{ c: "planet" }, { n: m[1] }, { t: L.landed }]],
  [new RegExp(`^${NM} rebuilt their ship`, "i"), (m, L) => [{ c: "wreck" }, { n: m[1] }, { t: L.rebuilt }]],
  [new RegExp(`\\b${NM} wins round \\d+`, "i"), (m, L) => [{ c: "win" }, { n: m[1] }, { p: L.wins }]],
];
// → { lead: [chip keys before the words], tail: [chip keys after them], text, kill: [killer, victim] | null, ko: bool,
//     fun: [segments] | null }. lines = the punchline words (DEFAULT_LINES or the page's own).
export function parseFeedLine(raw, lines) {
  const out = parseFeedBase(raw);
  out.fun = null;
  if (!out.kill && !out.ko) {
    const L = lines || DEFAULT_LINES;
    for (const [re, build] of FUN) {
      const m = re.exec(out.text);
      if (m) { out.fun = build(m, L); break; }
    }
  }
  return out;
}
function parseFeedBase(raw) {
  const lead = [], tail = [];
  const src = String(raw).replace(/⚔️?/g, "✕");
  let text = src.replace(ICON_RE, (m, ch, at) => {
    (/[a-z0-9]/i.test(src.slice(0, at)) ? tail : lead).push(ICON_OF[ch]);
    return " ";
  });
  text = text.replace(EMOJI_RE, "").replace(/\uFE0F/g, "").replace(/\s+/g, " ").trim();
  let kill = null;
  const m = /^(.+?)\s*✕\s*(.+)$/.exec(text);
  if (m) kill = [m[1].trim(), m[2].trim()];
  const ko = !!kill || /\bwas destroyed$/i.test(text);
  if (ko && !kill) lead.unshift("ko");
  return { lead, tail, text, kill, ko };
}

// push(text, colour, names?, kind?): colour = the line's accent (the lead player's colour); names = [[name, colour], …] (or a Map)
// paints every player name in the text in its own colour; kind "hint" = a smaller purple line, "quiet" = a small dim line that
// is dropped first (a kill between two bots), "loot" (v1.8: a pickup line, "✨ ana · 🔥 RAPID FIRE") = an even smaller, dimmer line
// with its emoji kept as they are (no chips: 💎 GEMS is not a chest), dropped first, and not shown at all while the feed is busy
// (opts.busy lines or more on screen, default max - 2) or within opts.lootGap ms (default 700) of the last one.
// opts.labels = the words on the chips ({ emp, ink, pull, mine, decoy, steal, ko }).
// opts.side "left" = hang from the bottom-left corner (the page places it), newest line at the bottom; opts.lines = punchline words.
export function createKillFeed(container, opts = {}) {
  injectStyles();
  const max = opts.max || 5;
  const life = opts.life || 6000;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  const lines = Object.assign({}, DEFAULT_LINES, opts.lines || {});
  const el = document.createElement("div");
  el.className = "bse-feed" + (opts.side === "left" ? " bse-left" : "");
  container.appendChild(el);
  // name (any case) → colour, from the names the page passes ([[name, colour]] or a Map)
  function colourOf(name, names) {
    if (!names) return null;
    const low = String(name).toLowerCase();
    for (const [n, col] of names) if (String(n).toLowerCase() === low) return col;
    return null;
  }
  // One fun line: names in their colours, chips, plain words, the gold punchline; a space between pieces except around chips.
  function addSegments(parent, segs, names) {
    let afterChip = true;
    for (const s of segs) {
      if (s.c) { parent.appendChild(chipEl(s.c, labels[s.c])); afterChip = true; continue; }
      const piece = s.n != null ? s.n : s.p != null ? s.p : s.t;
      if (!piece) continue;
      if (!afterChip && !s.g) parent.appendChild(document.createTextNode(" "));
      afterChip = false;
      if (s.t != null) { parent.appendChild(document.createTextNode(s.t)); continue; }
      const sp = document.createElement("span");
      sp.className = s.n != null ? "bse-nm" : "bse-punch";
      if (s.n != null) { const col = colourOf(s.n, names); if (col) sp.style.color = readableColour(col); } // the line's stripe (--c) keeps the true colour
      sp.textContent = piece;
      parent.appendChild(sp);
    }
  }
  const items = [];
  let lastSig = "", lastAt = 0, lootAt = 0;
  const busy = opts.busy || Math.max(2, max - 2), lootGap = opts.lootGap == null ? 700 : opts.lootGap;

  function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    clearTimeout(item.t1);
    clearTimeout(item.t2);
    item.el.remove();
  }
  function addText(parent, text, names) {
    if (!names) { parent.appendChild(document.createTextNode(text)); return; }
    for (const [piece, col] of colourSegments(text, names)) {
      if (col) {
        const sp = document.createElement("span");
        sp.style.color = readableColour(col);
        sp.textContent = piece;
        parent.appendChild(sp);
      } else parent.appendChild(document.createTextNode(piece));
    }
  }
  function push(text, colour = "#9fd8ff", names, kind) {
    const now = Date.now();
    if (kind === "loot") return pushLoot(String(text), colour, names, now);
    const line = parseFeedLine(text, lines);
    const sig = line.lead.join() + "|" + line.text + "|" + line.tail.join();
    if (!line.text && !line.lead.length && !line.tail.length) return;
    if (sig === lastSig && now - lastAt < 1200) return; // the same line twice in a row is one event
    lastSig = sig;
    lastAt = now;
    const quiet = kind === "quiet";
    const d = document.createElement("div");
    d.className = "bse-feed-item" + (kind ? ` ${kind}` : "") + (line.ko ? " ko" : "");
    d.style.setProperty("--c", colour);
    d.dataset.line = String(text); // the server's line as sent (tests and tours read it; the screen shows chips instead of the emoji)
    if (line.fun) addSegments(d, line.fun, names); // a known trick or moment: the fun version
    else {
      for (const k of line.lead) d.appendChild(chipEl(k, labels[k]));
      if (line.kill) {
        addText(d, line.kill[0], names);
        d.appendChild(chipEl("ko", labels.ko));
        addText(d, line.kill[1], names);
      } else if (line.text) addText(d, line.text, names);
      for (const k of line.tail) d.appendChild(chipEl(k, labels[k]));
    }
    show(d, quiet);
  }
  // v1.8 loot: a small dim line, or nothing when the feed is busy or another loot line just came
  function pushLoot(text, colour, names, now) {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t || items.length >= busy || now - lootAt < lootGap) return false;
    lootAt = now;
    const d = document.createElement("div");
    d.className = "bse-feed-item quiet loot";
    d.style.setProperty("--c", colour);
    d.dataset.line = text;
    addText(d, t, names);
    show(d, true);
    return true;
  }
  function show(d, quiet) {
    el.appendChild(d);
    const item = { el: d, quiet };
    items.push(item);
    while (items.length > max) remove(items.find((it) => it.quiet && it !== item) || items[0]); // bot-only lines go first
    requestAnimationFrame(() => d.classList.add("in"));
    const ttl = quiet ? Math.round(life * 0.55) : life;
    item.t1 = setTimeout(() => {
      d.classList.remove("in");
      d.classList.add("out");
    }, ttl - 600);
    item.t2 = setTimeout(() => remove(item), ttl);
  }
  return { el, push, clear: () => items.slice().forEach(remove), destroy: () => { items.slice().forEach(remove); el.remove(); } };
}

/* ---------- lobby hangar ---------- */

// createHangar(container, opts) → { el, update(list), fit(), clear(), resetImages(), destroy() }: the lobby's cards, one per player.
// list = the humans in the lobby in join order: [{ name, color, image, ready, stars }] (image = their ship drawing's URL, the
// entity message's `image`, or null while they draw). A card pops in when someone joins (the cards of the first fill come in
// quietly: a page opened mid-lobby makes no noise), shows the drawing on a paper tile (a scribbling pencil and "DRAWING…" until
// it exists; a new drawing pops in once it has loaded, so a broken one never shows), the name in the player's colour, ✔ READY
// and the session stars. The grid fits the container (the column count that makes the cards biggest, up to 25 cards, at most
// opts.maxCard em wide). opts: { labels: { ready, readyShort, drawing, stars: "★ {n}" }, maxCard: 15, onPop(kind, name) } with
// kind "join" | "drawing" (the page plays its pop sound there). update() only touches what changed: call it at the hud rate.
const PENCIL_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 40l3.2-10.4L33.4 7.4a4.2 4.2 0 0 1 6 0l1.2 1.2a4.2 4.2 0 0 1 0 6L18.4 36.8z" fill="#ffcb3d" stroke="#120a2e" stroke-width="3" stroke-linejoin="round"/><path d="M8 40l3.2-10.4 7.2 7.2z" fill="#ffe9c4" stroke="#120a2e" stroke-width="3" stroke-linejoin="round"/><path d="M8 40l1.4-4.4 3 3z" fill="#120a2e"/><path d="M29.4 11.4l7.2 7.2" stroke="#120a2e" stroke-width="3"/></svg>';
export function createHangar(container, opts = {}) {
  injectStyles();
  // v1.7: an entry's optional state "in" | "waiting" (who plays this round, who waits for the next) swaps the READY badge;
  // v1.9: an entry's practicing: true (in the practice world while the TV waits) swaps it for 🎮 PRACTICING
  const L = Object.assign({ ready: "✔ READY", readyShort: "✔", drawing: "DRAWING…", stars: "★ {n}", inRound: "✔ IN", waiting: "⏳ NEXT ROUND", waitingShort: "⏳", practicing: "🎮 PRACTICING", practicingShort: "🎮" }, opts.labels || {});
  const maxCard = opts.maxCard || 15;
  const el = document.createElement("div");
  el.className = "bse-hangar";
  container.appendChild(el);
  const cards = new Map(); // name → card
  let primed = false, layoutKey = "", count = 0;

  function makeCard(name, quiet, i) {
    const d = document.createElement("div");
    d.className = "bse-hc in" + (quiet ? " quiet" : "");
    const delay = quiet ? Math.min(i, 24) * 28 : 0; // the first fill cascades in
    if (delay) d.style.animationDelay = delay + "ms";
    d.innerHTML = `<div class="bse-hc-pic"><div class="bse-hc-wait">${PENCIL_SVG}<span></span></div><img alt="" draggable="false"></div>` +
      '<div class="bse-hc-nm"></div><span class="bse-hc-st"></span><span class="bse-hc-ok"><span class="l"></span><span class="s"></span></span>';
    d.querySelector(".bse-hc-wait span").textContent = L.drawing;
    d.querySelector(".bse-hc-nm").textContent = name;
    d.querySelector(".bse-hc-ok .l").textContent = L.ready;
    d.querySelector(".bse-hc-ok .s").textContent = L.readyShort;
    setTimeout(() => { d.classList.remove("in", "quiet"); d.style.animationDelay = ""; }, 900 + delay);
    return { el: d, img: d.querySelector("img"), st: d.querySelector(".bse-hc-st"), name, url: "", shown: "", sig: "", quiet, born: performance.now() };
  }
  // A new drawing is loaded off screen first; it replaces the old one (or the pencil) only once it has arrived.
  function setImage(c, url) {
    if (!url || url === c.url) return; // no URL (yet): keep what is there
    c.url = url;
    const pre = new Image();
    pre.onerror = () => setTimeout(() => { if (c.url === url) c.url = c.shown; }, 4000); // a failed load is tried again (next update) after 4 s
    pre.onload = () => {
      if (c.url !== url || cards.get(c.name) !== c) return;
      const first = !c.shown;
      c.shown = url;
      c.img.src = url;
      c.el.classList.add("drawn");
      if (first && c.quiet && performance.now() - c.born < 2500) return; // the first fill: no fanfare for drawings that were already there
      c.el.classList.remove("fresh");
      void c.el.offsetWidth; // restart the pop for a redraw
      c.el.classList.add("fresh");
      setTimeout(() => { if (c.shown === url) c.el.classList.remove("fresh"); }, 700);
      // a player who joins with a drawing already made (a rejoin) gets one pop, the join's
      if (opts.onPop && !(first && performance.now() - c.born < 1500)) opts.onPop("drawing", c.name);
    };
    pre.src = url;
  }
  function update(list) {
    const seen = new Set();
    let i = 0;
    for (const p of list || []) {
      if (!p || !p.name || seen.has(p.name)) continue;
      seen.add(p.name);
      let c = cards.get(p.name);
      if (!c) {
        c = makeCard(p.name, !primed, i);
        cards.set(p.name, c);
        if (primed && opts.onPop) opts.onPop("join", p.name);
      }
      if (el.children[i] !== c.el) el.insertBefore(c.el, el.children[i] || null); // join order; moves only what is out of place
      i++;
      const stars = p.stars || 0;
      const pr = !p.state && !!p.practicing; // v1.9 PRACTICE (the 3-2-1's IN / NEXT ROUND win over it)
      const sig = `${p.color}|${p.ready ? 1 : 0}|${stars}|${p.state || ""}|${pr ? 1 : 0}`;
      if (sig !== c.sig) {
        c.sig = sig;
        c.el.classList.toggle("pr", pr);
        c.el.style.setProperty("--pc", p.color || "#ffffff"); // the stripe and the join ring: the true colour
        c.el.style.setProperty("--pt", readableColour(p.color || "#ffffff")); // the name: a readable tint of it
        c.el.classList.toggle("ok", p.state ? p.state === "in" : !!p.ready);
        c.el.classList.toggle("wt", p.state === "waiting"); // v1.7
        c.el.querySelector(".bse-hc-ok .l").textContent = p.state === "in" ? L.inRound : p.state === "waiting" ? L.waiting : pr ? L.practicing : L.ready;
        c.el.querySelector(".bse-hc-ok .s").textContent = p.state === "waiting" ? L.waitingShort : pr ? L.practicingShort : L.readyShort;
        c.st.textContent = stars ? fill(L.stars, stars) : "";
      }
      setImage(c, p.image);
    }
    for (const [name, c] of cards) if (!seen.has(name)) { c.el.remove(); cards.delete(name); }
    primed = true;
    if (cards.size !== count) { count = cards.size; fit(); }
  }
  // The column count that gives the biggest cards in the container's box (a card is about 1.26 times as tall as it is wide).
  function fit() {
    const n = cards.size;
    if (!n) return;
    const r = container.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) { layoutKey = ""; return; } // hidden: the ResizeObserver fits it when it shows again
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    const gap = (n > 12 ? 0.75 : 1.1) * fs;
    let best = 0, cols = 1;
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      const w = Math.min((r.width - (c - 1) * gap) / c, (r.height - (rows - 1) * gap) / rows / 1.26, maxCard * fs);
      if (w > best + 0.5) { best = w; cols = c; }
    }
    const w = Math.max(24, Math.floor(best));
    const key = `${cols}|${w}|${gap}`;
    if (key === layoutKey) return;
    layoutKey = key;
    el.style.setProperty("--hc", String(cols));
    el.style.setProperty("--hw", w + "px");
    el.style.setProperty("--hg", gap.toFixed(1) + "px");
    el.classList.toggle("compact", w < 8.5 * fs);
  }
  let ro = null;
  if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => { layoutKey = ""; fit(); }); ro.observe(container); }
  const clear = () => { for (const c of cards.values()) c.el.remove(); cards.clear(); count = 0; primed = false; layoutKey = ""; };
  // v1.5 (every round starts from scratch): every card forgets its drawing and shows the pencil and DRAWING… again (the cards,
  // names, READY and stars stay); the next drawing that arrives pops in as a new one.
  const resetImages = () => {
    for (const c of cards.values()) {
      c.url = ""; c.shown = "";
      c.img.removeAttribute("src");
      c.el.classList.remove("drawn", "fresh");
    }
  };
  return { el, update, fit: () => { layoutKey = ""; fit(); }, clear, resetImages, destroy: () => { clear(); if (ro) ro.disconnect(); el.remove(); }, get size() { return cards.size; } };
}

/* ---------- name tags ---------- */

// update(list, { limit, focus }): list = game.projectPlayers() (nearest first) → at most `limit` tags; a player keeps the same tag
// while they stay in view (no flicker when two ships swap distance order). Positions use transforms only.
// "play" tags: name + health bar, status chips (items with `flags`: emp / inked / tractored / stun) and a declutter: tags are
// placed humans first (items with `bot` come after), `focus` (the followed player) first of all, then nearest; a tag that
// would overlap a placed one shrinks to its name, and when even that overlaps it becomes a coloured dot. Far ships get a
// smaller tag. Everything is arithmetic on a few numbers per tag (no layout reads, no allocation per frame).
// "lobby" cards (setMode("lobby")): name, star badge and a status pill from
// setInfo({ [name]: { sub, short, tone: "ok"|"wait"|"bot", badge } }); the size steps down with the number of cards.
// opts: { max, offset, labels: { emp, ink, pull, stun } (words on the status chips) }.
const FLAG_BITS = [["emp", "emp"], ["inked", "ink"], ["tractored", "pull"], ["stun", "stun"]];

export function createNameTags(container, opts = {}) {
  injectStyles();
  const max = opts.max || 8;
  const offset = opts.offset || 0;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  const layer = document.createElement("div");
  layer.className = "bse-tags bse-m-play n-lg";
  container.appendChild(layer);
  const tags = [];
  const byName = new Map();
  const picked = [];
  const ord = new Array(max).fill(null);
  const RX0 = new Float32Array(max), RX1 = new Float32Array(max), RY0 = new Float32Array(max), RY1 = new Float32Array(max);
  let frameId = 0, mode = "play", density = "lg", infos = {}, fs = 10, nPlaced = 0;

  for (let i = 0; i < max; i++) {
    const root = document.createElement("div");
    root.className = "bse-tag m0";
    root.style.display = "none";
    root.innerHTML = '<div class="bse-tag-in"><div class="bse-tag-card"><div class="bse-tag-st"></div><div class="bse-tag-top"><span class="bse-tag-mark"></span><span class="bse-tag-name"></span><span class="bse-tag-badge"></span></div><div class="bse-tag-sub"></div><div class="bse-tag-bar"><div class="bse-tag-fill"></div></div></div><div class="bse-tag-dot"></div></div>';
    layer.appendChild(root);
    const q = (c) => root.querySelector("." + c);
    tags.push({
      root, card: q("bse-tag-card"), name: q("bse-tag-name"), mark: q("bse-tag-mark"), badge: q("bse-tag-badge"), sub: q("bse-tag-sub"), fill: q("bse-tag-fill"), stRow: q("bse-tag-st"),
      used: false, key: null, seen: -1, shown: false, text: null, color: null, x: NaN, y: NaN, s: NaN, hp: NaN, hpClass: "", z: -1,
      subText: null, subTone: null, markText: null, badgeText: null,
      m: 0, bot: false, st: 0, stEls: null, p: null, pri: 0,
    });
  }

  // The size of 1em in px (the page sets --bse-fs, 1rem on the TV: it changes with the window), for the declutter.
  const measure = () => { try { fs = parseFloat(getComputedStyle(layer).fontSize) || fs; } catch (e) { /* keep the last size */ } };
  measure();
  const onResize = () => measure();
  addEventListener("resize", onResize);

  // Width of a name in em (italic 800 caps + the outline), measured once per name on a canvas (no DOM layout).
  const widths = new Map();
  let mctx = null;
  const onFonts = () => widths.clear();
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", onFonts);
  function nameEm(name) {
    let w = widths.get(name);
    if (w !== undefined) return w;
    try {
      mctx = mctx || document.createElement("canvas").getContext("2d");
      mctx.font = 'italic 800 100px "Barlow Condensed", Impact, "Arial Narrow", sans-serif';
      w = mctx.measureText(name.toUpperCase()).width / 100 + name.length * 0.03 + 0.2;
    } catch (e) { w = name.length * 0.55 + 0.2; }
    if (widths.size > 400) widths.clear();
    widths.set(name, w);
    return w;
  }

  const applyClasses = () => { layer.className = `bse-tags bse-m-${mode} n-${density}`; measure(); };
  function claim(name) {
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      if (t.used) continue;
      t.used = true;
      t.key = name;
      byName.set(name, t);
      // Forget what this tag showed before: it is somebody else now (and pops in when it is shown).
      t.text = t.color = t.subText = t.subTone = t.markText = t.badgeText = null;
      t.hp = NaN;
      t.x = t.y = t.s = NaN;
      t.card.classList.add("bse-pop");
      return t;
    }
    return null;
  }
  function release(t) {
    t.used = false;
    byName.delete(t.key);
    t.key = null;
    t.p = null;
    if (t.shown) {
      t.root.style.display = "none";
      t.shown = false;
    }
    if (t.m || t.bot) { t.m = 0; t.bot = false; t.root.className = "bse-tag m0"; }
    t.card.classList.remove("bse-pop");
  }
  const toggle = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };

  // Status chips over the name: built the first time a flag is seen, then only their `on` class changes.
  function setChips(t, st) {
    t.st = st;
    if (!t.stEls) {
      if (!st) return;
      t.stEls = FLAG_BITS.map(([, key]) => chipEl(key, labels[key]));
      for (const c of t.stEls) t.stRow.appendChild(c);
    }
    for (let b = 0; b < t.stEls.length; b++) toggle(t.stEls[b], "on", ((st >> b) & 1) === 1);
  }

  // Does the rect overlap one already placed? (a small gap counts as overlap)
  function hits(x0, y0, x1, y1, gap) {
    for (let i = 0; i < nPlaced; i++) if (x0 < RX1[i] + gap && x1 > RX0[i] - gap && y0 < RY1[i] + gap && y1 > RY0[i] - gap) return true;
    return false;
  }

  function update(list, o) {
    frameId++;
    const limit = Math.min(max, o && o.limit != null ? o.limit : max);
    const focus = o && o.focus ? o.focus : null;
    let n = 0;
    for (let i = 0; i < list.length && n < limit; i++) {
      const p = list[i];
      if (p.visible === false) continue;
      picked[n++] = p;
      const t = byName.get(p.name);
      if (t) t.seen = frameId;
    }
    for (let i = 0; i < tags.length; i++) if (tags[i].used && tags[i].seen !== frameId) release(tags[i]);
    const d = mode === "lobby" ? (n > 16 ? "sm" : n > 8 ? "md" : "lg") : "lg";
    if (d !== density) {
      density = d;
      applyClasses();
    }
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = picked[i];
      let t = byName.get(p.name);
      if (!t) {
        t = claim(p.name);
        if (!t) continue;
        t.seen = frameId;
      }
      if (!t.shown) {
        t.root.style.display = "";
        t.shown = true;
      }
      if (p.name !== t.text) t.name.textContent = t.text = p.name;
      if (p.color !== t.color) { t.color = p.color; t.root.style.color = readableColour(p.color); t.root.style.setProperty("--pc", p.color || ""); } // name: light tint; dot: true colour
      t.p = p;
      // order: the followed player, then humans, then bots; nearest first inside each group (insertion sort, n <= 25)
      t.pri = (focus && p.name === focus ? -1e9 : 0) + (p.bot === true ? 1e6 : 0) + (p.dist || 0);
      let j = k++;
      while (j > 0 && ord[j - 1].pri > t.pri) { ord[j] = ord[j - 1]; j--; }
      ord[j] = t;
    }
    n = k;
    nPlaced = 0;
    for (let i = 0; i < n; i++) {
      const t = ord[i], p = t.p;
      if (t.z !== i) {
        t.root.style.zIndex = String(max + 1 - i);
        t.z = i;
      }
      if (mode === "lobby") {
        if (t.m || t.bot) { t.m = 0; t.bot = false; t.root.className = "bse-tag m0"; }
        if (p.x !== t.x || p.y !== t.y) {
          t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - offset).toFixed(1)}px,0)`;
          t.x = p.x;
          t.y = p.y;
        }
        const f = infos[p.name];
        const sub = f && f.sub ? f.sub : "";
        const tone = f && f.tone ? f.tone : "wait";
        const mark = f && f.short ? f.short : "";
        const badge = f && f.badge ? f.badge : "";
        if (sub !== t.subText || tone !== t.subTone) {
          t.sub.textContent = t.subText = sub;
          t.subTone = tone;
          t.sub.className = `bse-tag-sub ${tone}${sub ? " on" : ""}`;
          t.mark.className = `bse-tag-mark ${tone}${mark ? " on" : ""}`;
        }
        if (mark !== t.markText) {
          t.mark.textContent = t.markText = mark;
          t.mark.className = `bse-tag-mark ${tone}${mark ? " on" : ""}`;
        }
        if (badge !== t.badgeText) {
          t.badge.textContent = t.badgeText = badge;
          toggle(t.badge, "on", !!badge);
        }
        continue;
      }
      // ---- play: status chips, size by distance, declutter ----
      const f = p.flags;
      const st = f ? (f.emp ? 1 : 0) | (f.inked ? 2 : 0) | (f.tractored ? 4 : 0) | (f.stun ? 8 : 0) : 0;
      if (st !== t.st) setChips(t, st);
      const chips = (st & 1) + ((st >> 1) & 1) + ((st >> 2) & 1) + ((st >> 3) & 1);
      const bot = p.bot === true;
      const isFocus = !!focus && p.name === focus;
      let s = 1.25 - (p.dist || 0) * 0.0021;
      s = s > 1 ? 1 : s < 0.7 ? 0.7 : s;
      if (bot) s *= 0.85;
      if (isFocus) s = 1;
      s = Math.round(s * 100) / 100;
      const ax = p.x, ay = p.y - offset; // the anchor: bottom centre of the card
      const E = fs * s;
      const nw = nameEm(p.name);
      const chipW = chips * 4.2 + 0.4, chipH = chips ? 1.9 : 0;
      let m = 0;
      if (!isFocus) {
        // hysteresis: a tag that was shrunk needs extra room before it grows again (no flicker as ships drift)
        const grow = t.m > 0 ? 0.7 * E : 0;
        const w0 = Math.max(nw * 1.35, bot ? 4.1 : 5.3, chipW) * E, h0 = (2.75 + chipH) * E;
        if (hits(ax - w0 / 2 - grow, ay - h0 - grow, ax + w0 / 2 + grow, ay + grow, 0.25 * E)) {
          m = 1;
          const grow2 = t.m > 1 ? 0.7 * E : 0;
          const w1 = Math.max(nw * 1.12, chipW) * E, h1 = (1.6 + chipH) * E;
          if (hits(ax - w1 / 2 - grow2, ay - h1 - grow2, ax + w1 / 2 + grow2, ay + grow2, 0.25 * E)) m = 2;
        }
      }
      if (m === 0) {
        const w = Math.max(nw * 1.35, bot ? 4.1 : 5.3, chipW) * E, h = (2.75 + chipH) * E;
        RX0[nPlaced] = ax - w / 2; RX1[nPlaced] = ax + w / 2; RY0[nPlaced] = ay - h; RY1[nPlaced] = ay; nPlaced++;
      } else if (m === 1) {
        const w = Math.max(nw * 1.12, chipW) * E, h = (1.6 + chipH) * E;
        RX0[nPlaced] = ax - w / 2; RX1[nPlaced] = ax + w / 2; RY0[nPlaced] = ay - h; RY1[nPlaced] = ay; nPlaced++;
      }
      if (m !== t.m || bot !== t.bot) {
        t.m = m;
        t.bot = bot;
        t.root.className = "bse-tag m" + m + (bot ? " bot" : "");
      }
      if (p.x !== t.x || p.y !== t.y || s !== t.s) {
        t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - offset).toFixed(1)}px,0) scale(${s})`;
        t.x = p.x;
        t.y = p.y;
        t.s = s;
      }
      if (m < 2) {
        const h = Math.max(0, Math.min(1, p.hp / (p.maxHp || 1)));
        if (h !== t.hp) {
          t.fill.style.transform = `scaleX(${h})`;
          t.hp = h;
          const c = h < 0.3 ? "low" : h < 0.6 ? "mid" : "";
          if (c !== t.hpClass) {
            t.fill.className = "bse-tag-fill" + (c ? ` ${c}` : "");
            t.hpClass = c;
          }
        }
      }
    }
    picked.length = 0;
  }
  function setMode(m) {
    m = m === "lobby" ? "lobby" : "play";
    if (m === mode) return;
    mode = m;
    density = "lg";
    applyClasses();
  }
  function setInfo(map) {
    infos = map || {};
  }
  return {
    el: layer, update, setMode, setInfo,
    destroy: () => { removeEventListener("resize", onResize); if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener("loadingdone", onFonts); layer.remove(); },
  };
}

/* ---------- live map (the TV) ---------- */

// createMiniMap(container, { labels: { space, planet } }) → { el, draw(state), destroy }. Two tiles:
//   SPACE: the route laid out bottom → top (spawn, the boss, the planet beyond it; the planet is dim and shielded until the boss is
//          down), every ship in space as a dot in its colour (humans big with a white rim, bots small), the followed one ringed and named.
//   PLANET (shown once the planet is open or someone is on it): the landing pad, parked ships (a wrecked one is a red cross), every
//          chest (closed: a glowing gold X for a buried one, a rock with a gold heart for a locked one, a ring for the dig progress;
//          open: dim with a tick in the opener's colour) and the explorers.
// state = { world (the world message), players: [{ name, color, x, z, mode, bot, dead, invisible }], followed, colours (Map
// name → colour), t (seconds, for the pulses), chests: "2/7" (the header count) }. Pure 2D canvas, a few hundred draw ops.
export function createMiniMap(container, opts = {}) {
  injectStyles();
  const labels = Object.assign({ space: "SPACE", planet: "PLANET" }, opts.labels || {});
  const root = document.createElement("div");
  root.className = "bse-map";
  function panel(kind, title) {
    const el = document.createElement("div");
    el.className = "bse-map-panel " + kind;
    el.innerHTML = '<div class="bse-map-hd"><span></span><b></b></div><div class="bse-map-cv"><canvas></canvas></div>';
    el.querySelector(".bse-map-hd span").textContent = title;
    root.appendChild(el);
    return { el, count: el.querySelector(".bse-map-hd b"), countText: "", canvas: el.querySelector("canvas"), g: null, w: 0, h: 0 };
  }
  const SP = panel("space", labels.space), PL = panel("planet", labels.planet);
  container.appendChild(root);
  let sized = false, planetOn = false;
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { sized = false; }) : null;
  if (ro) { ro.observe(SP.canvas); ro.observe(PL.canvas); }
  const onResize = () => { sized = false; };
  addEventListener("resize", onResize);
  function fit(P) {
    const r = P.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w !== P.w || h !== P.h) { P.w = P.canvas.width = w; P.h = P.canvas.height = h; }
    if (!P.g && w && h) P.g = P.canvas.getContext("2d");
  }
  const TAU = Math.PI * 2;
  const FONT = '"Barlow Condensed", Impact, "Arial Narrow", sans-serif';
  // a chunky dot: dark outline, white rim (humans), colour fill
  function dot(g, x, y, r, col, k, human, alpha) {
    g.globalAlpha = alpha;
    g.beginPath(); g.arc(x, y, r, 0, TAU);
    g.lineWidth = (human ? 5 : 3) * k; g.strokeStyle = "#120a2e"; g.stroke();
    if (human) { g.lineWidth = 2.4 * k; g.strokeStyle = "#fff"; g.stroke(); }
    g.fillStyle = col; g.fill();
    g.globalAlpha = 1;
  }
  function cross(g, x, y, r, col, k, w) {
    g.lineCap = "round";
    g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
    g.lineWidth = (w + 3.5) * k; g.strokeStyle = "#120a2e"; g.stroke();
    g.lineWidth = w * k; g.strokeStyle = col; g.stroke();
  }
  function label(g, text, x, y, k, col) {
    g.font = `italic 900 ${Math.round(17 * k)}px ${FONT}`;
    g.textAlign = "center"; g.textBaseline = "bottom";
    g.lineJoin = "round"; g.lineWidth = 5 * k; g.strokeStyle = "#120a2e";
    const t = String(text).toUpperCase();
    g.strokeText(t, x, y); g.fillStyle = col ? readableColour(col) : "#fff"; g.fillText(t, x, y);
  }
  function ring(g, x, y, r, k, t) { // the followed player's pulsing ring
    g.beginPath(); g.arc(x, y, r * (1 + 0.12 * Math.sin(t * 6)), 0, TAU);
    g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke();
    g.lineWidth = 3 * k; g.strokeStyle = "#fff"; g.stroke();
  }
  const inBox = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function drawSpace(s) {
    const P = SP, g = P.g, W = P.w, H = P.h;
    if (!g || !W || !H) return;
    g.clearRect(0, 0, W, H);
    const world = s.world;
    if (!world) return;
    const k = W / 300, t = s.t || 0;
    const boss = Array.isArray(world.targets) ? world.targets.find((x) => x.kind === "boss") : null;
    // The route points up: along = the spawn → boss direction (the planet lies beyond the boss on the same line).
    let ux = 0, uz = -1;
    if (boss) { const l = Math.hypot(boss.x, boss.z); if (l > 1) { ux = boss.x / l; uz = boss.z / l; } }
    const vx = -uz, vz = ux;
    const C = globalThis.Contract;
    const offset = (opts.planetOffset) || (C && C.TUNING && C.TUNING.planet && C.TUNING.planet.offset) || 600;
    let pl = world.planet || null, locked = false;
    if (!pl && boss) { const l3 = Math.hypot(boss.x, boss.y || 0, boss.z) || 1; pl = { x: boss.x + (boss.x / l3) * offset, z: boss.z + (boss.z / l3) * offset, radius: 40 }; locked = true; }
    const along = (x, z) => x * ux + z * uz, across = (x, z) => x * vx + z * vz;
    const top = pl ? along(pl.x, pl.z) : boss ? along(boss.x, boss.z) + 300 : 1200;
    const a0 = -200, a1 = Math.max(600, top + 200), span = a1 - a0;
    const pad = 16 * k, sc = (Math.min(W, H) - 2 * pad) / span;
    const X = (x, z) => W / 2 + across(x, z) * sc, Y = (x, z) => H - pad - (along(x, z) - a0) * sc;
    // faint grid rings around the spawn, the dashed route
    g.lineWidth = 1.5 * k; g.strokeStyle = "rgba(180,200,255,.16)";
    for (let r = 400; r < span * 1.3; r += 400) { g.beginPath(); g.arc(X(0, 0), Y(0, 0), r * sc, 0, TAU); g.stroke(); }
    g.setLineDash([9 * k, 9 * k]); g.lineDashOffset = -t * 18 * k;
    g.lineWidth = 3.5 * k; g.strokeStyle = "rgba(255,255,255,.42)";
    g.beginPath(); g.moveTo(X(0, 0), Y(0, 0));
    if (boss) g.lineTo(X(boss.x, boss.z), Y(boss.x, boss.z));
    if (pl) g.lineTo(X(pl.x, pl.z), Y(pl.x, pl.z));
    g.stroke(); g.setLineDash([]);
    // spawn pad
    g.beginPath(); g.arc(X(0, 0), Y(0, 0), 9 * k, 0, TAU); g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = "#19d3ff"; g.stroke();
    // nebula glow around the boss
    const neb = world.nebula;
    if (neb) {
      const nx = X(neb.x, neb.z), ny = Y(neb.x, neb.z), nr = Math.max(26 * k, (neb.radius || 200) * sc);
      const gr = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      gr.addColorStop(0, "rgba(220,90,255,.42)"); gr.addColorStop(1, "rgba(120,60,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(nx, ny, nr, 0, TAU); g.fill();
    }
    // the planet: dim + dashed shield while locked, bright with a pulsing landing ring once open
    let onPlanet = 0;
    for (const p of s.players || []) if (p.mode === "planet") onPlanet++;
    if (pl) {
      const px = X(pl.x, pl.z), py = inBox(Y(pl.x, pl.z), pad, H - pad), pr = Math.max(15 * k, (pl.radius || 40) * sc * 1.6);
      g.globalAlpha = locked ? 0.5 : 1;
      const gr = g.createRadialGradient(px - pr * 0.35, py - pr * 0.35, pr * 0.1, px, py, pr);
      gr.addColorStop(0, "#9ff0ff"); gr.addColorStop(0.55, "#2b9bff"); gr.addColorStop(1, "#1a3fb0");
      g.beginPath(); g.arc(px, py, pr, 0, TAU); g.lineWidth = 5 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.fillStyle = gr; g.fill();
      g.globalAlpha = 1;
      if (locked) {
        g.setLineDash([5 * k, 6 * k]); g.lineWidth = 2.5 * k; g.strokeStyle = "rgba(160,220,255,.8)";
        g.beginPath(); g.arc(px, py, pr + 5 * k, 0, TAU); g.stroke(); g.setLineDash([]);
      } else {
        const q = (t * 0.8) % 1;
        g.globalAlpha = 1 - q; g.lineWidth = 4 * k; g.strokeStyle = "#7dffb0";
        g.beginPath(); g.arc(px, py, pr + (4 + 16 * q) * k, 0, TAU); g.stroke(); g.globalAlpha = 1;
      }
      if (onPlanet) label(g, "×" + onPlanet, px + pr + 8 * k, py + 9 * k, k, "#7dffb0");
    }
    // the boss: a red skull plate with its health as a gold arc; a grey cross once it is down
    if (boss) {
      const bx = X(boss.x, boss.z), by = Y(boss.x, boss.z), br = Math.max(13 * k, (boss.radius || 20) * sc * 1.8);
      if (boss.dead) {
        g.globalAlpha = 0.6; g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fillStyle = "#4a4560"; g.fill(); g.globalAlpha = 1;
        cross(g, bx, by, br * 0.55, "#c9c4dc", k, 4);
      } else {
        const pulse = 1 + 0.07 * Math.sin(t * 5);
        g.beginPath(); g.arc(bx, by, br * pulse, 0, TAU);
        g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = "#fff"; g.stroke();
        g.fillStyle = "#ff3b5c"; g.fill();
        g.fillStyle = "#120a2e"; g.beginPath(); g.arc(bx - br * 0.32, by - br * 0.08, br * 0.22, 0, TAU); g.arc(bx + br * 0.32, by - br * 0.08, br * 0.22, 0, TAU); g.fill();
        const hp = Math.max(0, Math.min(1, (boss.hp || 0) / (boss.maxHp || 1)));
        g.lineCap = "round";
        g.beginPath(); g.arc(bx, by, br * pulse + 7 * k, -Math.PI / 2, -Math.PI / 2 + TAU * hp);
        g.lineWidth = 7 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 4 * k; g.strokeStyle = "#ffcb3d"; g.stroke();
      }
    }
    // ships in space: bots first (small), then humans (big), the followed one last with its ring and name
    let fol = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const p of s.players || []) {
        if (p.mode !== "space" || p.invisible || (pass === 0) !== !!p.bot) continue;
        const x = inBox(X(p.x, p.z), 6 * k, W - 6 * k), y = inBox(Y(p.x, p.z), 6 * k, H - 6 * k);
        if (p.name === s.followed) { fol = { p, x, y }; continue; }
        if (p.dead) { cross(g, x, y, (p.bot ? 3.5 : 5.5) * k, p.color, k, p.bot ? 2 : 3); continue; }
        dot(g, x, y, (p.bot ? 4.2 : 8) * k, p.color, k, !p.bot, p.bot ? 0.8 : 1);
      }
    }
    if (fol) {
      const { p, x, y } = fol;
      ring(g, x, y, 15 * k, k, t);
      if (p.dead) cross(g, x, y, 6 * k, p.color, k, 3.5); else dot(g, x, y, 9 * k, p.color, k, true, 1);
      label(g, p.name, inBox(x, 40 * k, W - 40 * k), y < 50 * k ? y + 42 * k : y - 19 * k, k, p.color);
    }
  }

  function drawPlanet(s) {
    const P = PL, g = P.g, W = P.w, H = P.h;
    if (!g || !W || !H) return;
    g.clearRect(0, 0, W, H);
    const world = s.world;
    if (!world) return;
    const k = W / 300, t = s.t || 0;
    const chests = Array.isArray(world.chests) ? world.chests : [];
    const isl = world.island || {};
    const land = isl.landing || null;
    // Frame: the landing pad and every chest (fixed for the round), at least 90 m across; explorers outside are kept on the edge.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
    if (land) grow(land.x, land.z);
    for (const c of chests) grow(c.x, c.z);
    if (!Number.isFinite(x0)) { x0 = z0 = -45; x1 = z1 = 45; }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const pad = 22 * k;
    const sc = Math.min((W - 2 * pad) / Math.max(90, x1 - x0 + 24), (H - 2 * pad) / Math.max(68, z1 - z0 + 24));
    const X = (x) => W / 2 + (x - cx) * sc, Y = (z) => H / 2 + (z - cz) * sc;
    g.lineWidth = 1.5 * k; g.strokeStyle = "rgba(255,255,255,.12)";
    const step = 20 * sc;
    if (step > 8 * k) {
      for (let x = (W / 2) % step; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = (H / 2) % step; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    }
    // landing pad
    if (land) {
      const lx = X(land.x), ly = Y(land.z);
      g.beginPath(); g.arc(lx, ly, 13 * k, 0, TAU); g.fillStyle = "rgba(10,6,30,.45)"; g.fill();
      g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = "#19d3ff"; g.stroke();
    }
    // parked ships: a small plate in the owner's colour; wrecked = a red cross
    for (const v of Array.isArray(isl.parked) ? isl.parked : []) {
      const vx = inBox(X(v.x), 8 * k, W - 8 * k), vy = inBox(Y(v.z), 8 * k, H - 8 * k);
      if (v.wrecked) { cross(g, vx, vy, 6 * k, "#ff3b5c", k, 4); continue; }
      const col = (s.colours && s.colours.get(v.player)) || "#c8c2ff";
      g.save(); g.translate(vx, vy); g.rotate(Math.PI / 4);
      g.fillStyle = col; g.lineWidth = 3 * k; g.strokeStyle = "#120a2e";
      g.fillRect(-5 * k, -5 * k, 10 * k, 10 * k); g.strokeRect(-5 * k, -5 * k, 10 * k, 10 * k); g.restore();
    }
    // chests
    const glow = 1 + (world.assists ? 0.22 : 0.1) * Math.sin(t * 4);
    for (const c of chests) {
      const x = X(c.x), y = Y(c.z);
      if (c.open) {
        g.globalAlpha = 0.55;
        g.beginPath(); g.arc(x, y, 9 * k, 0, TAU); g.fillStyle = "#3d3a58"; g.fill(); g.lineWidth = 3 * k; g.strokeStyle = "#120a2e"; g.stroke();
        g.globalAlpha = 1;
        const col = (c.by && s.colours && s.colours.get(c.by)) || "#ffffff";
        g.lineCap = "round"; g.lineJoin = "round";
        g.beginPath(); g.moveTo(x - 4.5 * k, y); g.lineTo(x - 1 * k, y + 3.8 * k); g.lineTo(x + 5 * k, y - 4 * k);
        g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 3 * k; g.strokeStyle = col; g.stroke();
        continue;
      }
      const r = 11 * k * glow;
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 2);
      gr.addColorStop(0, "rgba(255,214,90,.55)"); gr.addColorStop(1, "rgba(255,214,90,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2, 0, TAU); g.fill();
      if (c.kind === "rock") {
        g.beginPath();
        for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = r * (0.82 + 0.18 * ((i * 37) % 5) / 4); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.closePath(); g.lineWidth = 4 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.fillStyle = "#8d86a3"; g.fill();
        g.beginPath(); g.arc(x, y, r * 0.38, 0, TAU); g.fillStyle = "#ffcb3d"; g.fill(); g.lineWidth = 2 * k; g.stroke();
      } else cross(g, x, y, r * 0.62, "#ffcb3d", k, 5);
      if (c.dug > 0) {
        g.lineCap = "round";
        g.beginPath(); g.arc(x, y, r + 5 * k, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, c.dug));
        g.lineWidth = 6 * k; g.strokeStyle = "#120a2e"; g.stroke(); g.lineWidth = 3.5 * k; g.strokeStyle = "#7dffb0"; g.stroke();
      }
    }
    // explorers
    let fol = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const p of s.players || []) {
        if (p.mode !== "planet" || p.invisible || (pass === 0) !== !!p.bot) continue;
        const x = inBox(X(p.x), 6 * k, W - 6 * k), y = inBox(Y(p.z), 6 * k, H - 6 * k);
        if (p.name === s.followed) { fol = { p, x, y }; continue; }
        if (p.dead) { cross(g, x, y, (p.bot ? 3.5 : 5.5) * k, p.color, k, p.bot ? 2 : 3); continue; }
        dot(g, x, y, (p.bot ? 4.2 : 8) * k, p.color, k, !p.bot, p.bot ? 0.8 : 1);
      }
    }
    if (fol) {
      const { p, x, y } = fol;
      ring(g, x, y, 15 * k, k, t);
      if (p.dead) cross(g, x, y, 6 * k, p.color, k, 3.5); else dot(g, x, y, 9 * k, p.color, k, true, 1);
      label(g, p.name, inBox(x, 40 * k, W - 40 * k), y < 50 * k ? y + 42 * k : y - 19 * k, k, p.color);
    }
  }

  function draw(s) {
    if (!s || !s.world) return;
    let any = !!s.world.planet;
    if (!any) for (const p of s.players || []) if (p.mode === "planet") { any = true; break; }
    if (any !== planetOn) { planetOn = any; PL.el.classList.toggle("on", any); sized = false; }
    const ct = s.chests || "";
    if (ct !== PL.countText) { PL.countText = ct; PL.count.textContent = ct; }
    if (!sized) { fit(SP); if (planetOn) fit(PL); sized = true; }
    drawSpace(s);
    if (planetOn) drawPlanet(s);
  }
  return {
    el: root, draw,
    destroy: () => { if (ro) ro.disconnect(); removeEventListener("resize", onResize); root.remove(); },
  };
}
