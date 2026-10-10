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
};
// Words on the chips. The page passes its own (COPY table) through opts.labels; these defaults only keep old callers working.
const DEFAULT_LABELS = { emp: "EMP", ink: "INK", pull: "PULL", mine: "MINE", decoy: "DECOY", steal: "STEAL", stun: "STUN", ko: "KO" };
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
.bse-qr,.bse-feed,.bse-tags{--bse-fh:"Barlow Condensed",Impact,"Arial Narrow",system-ui,sans-serif;
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
.bse-tag-st .bse-chip{display:none;font-size:.8em}
.bse-tag-st .bse-chip.on{display:inline-flex}
.bse-tag-dot{display:none;position:absolute;left:0;bottom:0;width:.95em;height:.95em;margin-left:-.475em;border-radius:50%;background:currentColor;
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
@keyframes bse-pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@keyframes bse-flash{0%{filter:brightness(2.2) saturate(1.7)}100%{filter:none}}
@media (prefers-reduced-motion:reduce){.bse-tag-card.bse-pop,.bse-feed-item.ko.in::before,.bse-feed-item.ko.in .bse-chip.ko{animation:none}.bse-feed-item.in,.bse-feed-item.out{transition:opacity .2s}}
`;
  document.head.appendChild(s);
}

