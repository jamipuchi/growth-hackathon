// Mischief effects: what rivals do to your phone (EMP, ink bomb, tractor beam, mines, decoys) and the HUD toast that
// announces them. No dependencies. Nothing touches `document` at import time. One style tag ("mfx-styles", class
// prefix "mfx-"). Every effect returns { done, cancel() } (+ extras), removes everything it made (elements, timers,
// listeners, animations) when it ends or is cancelled, and never throws. Overlays carry data-mfx="<kind>" so tests
// can count them. Only transform / opacity / filter animate, on small layers, in CSS or the Web Animations API;
// the one rAF loop (shared, only while an effect needs it) feeds the mine's TV static. prefers-reduced-motion: no
// shake, no screen flashing, a shorter and calmer EMP.
//
//   emp(controllerEl, seconds = 5, { seed, onSwap })  → { done, cancel, until, permutation }
//     The controls swap places for `seconds`. controllerEl is either the sandbox container / iframe (found through
//     el.ctrlSandbox, set by ctrl-sandbox.js: the frame's own kit swaps its controls through handle.fx("emp", ...)) or
//     plain DOM controls ([data-action], [data-stick], .hit), moved here with the CSS `translate` property.
//     Both sides use empPermutation(), so `permutation` is what the kit does: { place's action: action now there }.
//     onSwap(permutation) at the start, onSwap(null) at the restore, so a page that hit-tests by layout can remap.
//     A second emp() on the same element restarts the timer. `until` is a Date.now() timestamp.
//     Parent-side overlay on top (the frame cannot block it): scanlines, RGB tears, arcs, a countdown label.
//   inkBomb(screenEl, { seconds = 10, seed, splats = 3, onClear, hint = true })  → { done, cancel, coverage() }
//     Opaque glossy ink that stays until the player wipes it off with a finger (PLAN.md section 0); `seconds` is only
//     the safety net (the server sends 10): over its last 1.5 s (at most 30 % of it) the ink dries out, then it is
//     gone. A grid of transparent blocker cells ([data-ink-cell]) catches the touches (the controller below may be a
//     cross-origin frame), a cell stops blocking once it is wiped (coverage < 0.18). Gone when coverage < 0.12 (a
//     0.38 s fade) or after `seconds`: onClear({ wiped, ms }).
//     hint: the "WIPE IT!" cue in the middle of the ink ([data-ink-cue], click-through): an "INK!" kicker, the label
//     on a slanted violet plate, a finger swiping left-right over a double arrow (still under reduced motion). While
//     a finger is on the ink the hand rests and the label shrinks (the hand is back after 1.8 s without one); the cue
//     goes once coverage is under 60 % of the start, or when the ink dries or fades.
//   tractorHit(screenEl, { by, dir = 0, seconds = 1.6 })   dir in radians, 0 = right, PI / 2 = down
//   mineHit(screenEl, { by, points = -30, stunSeconds = 1.5, shakeEl })
//   decoyFooled(screenEl, { by, mine = false, victim })    mine: true is the positive "your decoy worked"
//   toast(text, { sub, tone = "cyan", seconds = 2.2, screenEl })   tone: cyan | red | violet | gold; max 3, newest on top
//   hitMarker(screenEl, { angle = null, strength = 1, seconds = 0.9 })  → { done, cancel, el }
//     Where my ship was hit from: a red crescent on the ellipse inscribed in the safe area (8 % in from its edges),
//     turned to point at the attacker, with a faint red glow toward that edge. angle in radians, heading-up compass:
//     0 = ahead (top edge), PI / 2 = right, ±PI = behind, -PI / 2 = left; null / not finite = unknown: a red vignette
//     on every edge instead. strength 0..1 scales size and opacity. Pops in (120 ms), fades over `seconds`. At most 4
//     at once (the oldest goes); a hit within 25° of a live one (or a second unknown one) restarts it and returns its
//     handle. All in one fixed full-screen layer per host, z-index 8500 (made once, left empty between hits).
//   shieldAura(screenEl, { on = true, label = "" })  → { done, cancel, el }   one per host, idempotent
//     The spawn shield: a pulsing cyan frame with a faint hex band on the screen edges, fixed, z-index 8400, plus a
//     slanted cyan chip at the bottom centre when `label` is set. on: true while shown only updates the label
//     (omitted: kept, "": no chip); on: false fades everything out in 0.3 s, then removes it (el: null if none).
//   empPermutation(items, seed)  the exact scramble rule (kept self-contained so a frame kit can embed it)

const STYLE_ID = "mfx-styles";
const SVG_NS = "http://www.w3.org/2000/svg";
const TAU = Math.PI * 2;
// PLAN.md section 0, "Style like Fortnite": heavy condensed capitals, white with a dark outline, on chunky slanted tiles
// in rarity colours. A page that loads Barlow Condensed or Bebas Neue gets those; every iPhone has the Futura and
// Avenir Next condensed faces behind them.
const FONT = '"Barlow Condensed","Bebas Neue","Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Arial Narrow",Impact,system-ui,sans-serif';
const DISPLAY = FONT;
const OUTLINE = "#0b1033";
// Text outline = the phone's own heading look (controller.html .hd, #chipTitle): a real stroke painted under the
// fill plus a hard drop, so the words read on the brightest sky.
const INK = "#120a2e";
const HARD = "#0a0830";
const STROKE = (w) => `-webkit-text-stroke:${w}px ${INK};paint-order:stroke fill;text-shadow:0 2px 0 rgb(10 6 30 / .5)`;
// The shield's hex band: one 15 × 26 honeycomb tile (pointy-top cells), stroked in the cyan accent.
const HEX_TILE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='26' viewBox='0 0 15 26'%3E%3Cpath d='M7.5 0v4.33M0 8.67l7.5-4.34L15 8.67M0 8.67v8.66M15 8.67v8.66M0 17.33l7.5 4.34 7.5-4.34M7.5 21.67V26' fill='none' stroke='%2319d3ff' stroke-width='1.2'/%3E%3C/svg%3E")`;
const EDGE_BAND = "linear-gradient(90deg,#000,transparent 46px,transparent calc(100% - 46px),#000),linear-gradient(180deg,#000,transparent 46px,transparent calc(100% - 46px),#000)";

const CSS = `
.mfx{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:8800;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font-family:${FONT}}
.mfx-fixed{position:fixed}
.mfx-fill{position:absolute;left:0;top:0;right:0;bottom:0}

.mfx-emp{z-index:60}
.mfx-emp-tint{background:rgba(94,231,255,.11);opacity:0;animation:mfx-eburst .7s steps(1,end) both,mfx-eflick .9s steps(1,end) .7s infinite}
.mfx-emp-hue{background:rgba(255,40,120,.2);opacity:0;animation:mfx-ehue .7s steps(1,end) both}
.mfx-emp-scan{opacity:.5;background:repeating-linear-gradient(0deg,rgba(0,0,0,.34) 0,rgba(0,0,0,.34) 1px,transparent 1px,transparent 3px)}
.mfx-emp-sweep{position:absolute;left:0;right:0;top:0;height:34%;background:linear-gradient(to bottom,rgba(94,231,255,0),rgba(94,231,255,.14) 62%,rgba(200,250,255,.4) 97%,rgba(94,231,255,0));animation:mfx-esweep 1.1s linear infinite}
.mfx-emp-tear{position:absolute;left:0;right:0;top:var(--y,50%);height:var(--h,9px);opacity:0;background:linear-gradient(90deg,rgba(255,50,120,0),rgba(255,50,120,.5) 22%,rgba(0,235,255,.46) 78%,rgba(0,235,255,0));animation:mfx-etear var(--d,1.3s) steps(1,end) var(--w,0s) infinite}
.mfx-emp-arcs{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.mfx-arc{opacity:0;animation:mfx-blip var(--l,.08s) steps(1,end) var(--w,0s) 1}
.mfx-arc polyline{fill:none;stroke-linecap:round;stroke-linejoin:round}
.mfx-arc .g{stroke:rgba(94,231,255,.4);stroke-width:5}
.mfx-arc .c{stroke:#effdff;stroke-width:1.4}
.mfx-emp-chip{position:absolute;left:50%;top:8px;display:flex;align-items:center;gap:10px;padding:6px 18px 6px 8px;white-space:nowrap;isolation:isolate;
  color:#fff;font:italic 900 20px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;${STROKE(3)};transform:translateX(-50%);animation:mfx-chipin .3s cubic-bezier(.26,1.5,.48,1) both}
.mfx-emp-chip::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:12px;transform:skewX(-9deg);border:3px solid #fff;
  background:linear-gradient(180deg,#ff8a8a 0%,#ff3048 50%,#a50d2c 100%);box-shadow:0 5px 0 ${OUTLINE},0 9px 16px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.35)}
.mfx-emp-chip i{position:relative;display:block;width:28px;height:28px;border-radius:50%;background:${OUTLINE}}
.mfx-emp-chip svg{position:absolute;left:0;top:0;width:28px;height:28px;transform:rotate(-90deg)}
.mfx-emp-chip circle{fill:none;stroke-width:2.4}
.mfx-emp-chip .t{stroke:rgba(255,255,255,.22)}
.mfx-emp-chip .p{stroke:#fff;stroke-linecap:round;stroke-dasharray:50.27;stroke-dashoffset:0;animation:mfx-ering var(--s,5s) linear both}
.mfx-emp-chip b{position:absolute;left:0;top:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:16px;font-style:normal;letter-spacing:0;color:#fff;-webkit-text-stroke:0;text-shadow:none}
@keyframes mfx-eburst{0%{opacity:.85}9%{opacity:.1}18%{opacity:.7}27%{opacity:0}40%{opacity:.55}49%{opacity:.05}62%{opacity:.4}72%,100%{opacity:0}}
@keyframes mfx-eflick{0%{opacity:0}5%{opacity:.5}8%{opacity:0}33%{opacity:.3}35%{opacity:0}61%{opacity:.45}63%{opacity:0}84%{opacity:.25}86%,100%{opacity:0}}
@keyframes mfx-ehue{0%{opacity:.8}12%{opacity:0}22%{opacity:.5}34%{opacity:0}52%{opacity:.35}62%,100%{opacity:0}}
@keyframes mfx-esweep{0%{transform:translateY(-110%)}100%{transform:translateY(310%)}}
@keyframes mfx-etear{0%{opacity:0}6%{opacity:1;transform:translateX(var(--dx,24px))}12%{opacity:1;transform:translateX(calc(var(--dx,24px) * -1.3))}18%{opacity:0;transform:none}100%{opacity:0}}
@keyframes mfx-blip{0%,100%{opacity:1}}
@keyframes mfx-chipin{from{opacity:0;transform:translateX(-50%) scale(.7)}to{opacity:1;transform:translateX(-50%) scale(1)}}
@keyframes mfx-ering{to{stroke-dashoffset:50.27}}

.mfx-ink{z-index:9000}
.mfx-ink-cv{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;transform-origin:50% 50%}
.mfx-ink-grid{position:absolute;left:0;top:0;right:0;bottom:0;display:grid}
.mfx-ink-cell{pointer-events:auto;touch-action:none;background:transparent}
.mfx-off .mfx-ink-cell{pointer-events:none!important}
.mfx-ink-flash{background:radial-gradient(ellipse at 50% 50%,rgba(200,160,255,.5),rgba(60,20,140,0) 72%);opacity:0;animation:mfx-iflash .24s ease-out both}
@keyframes mfx-iflash{0%{opacity:1}100%{opacity:0}}
.mfx-ink-cue{display:flex;align-items:center;justify-content:center;pointer-events:none!important;font-size:clamp(34px,11.5vmin,68px);
  font-family:var(--f-head,${FONT});font-weight:900;font-style:italic;line-height:1;text-transform:uppercase;white-space:nowrap;color:#fff}
.mfx-ink-cue *{pointer-events:none!important}
.mfx-ink-cue-s{transition:transform .25s cubic-bezier(.2,.8,.3,1),opacity .22s ease-out}
.mfx-ink-cue-pop{display:flex;flex-direction:column;align-items:center;padding-bottom:1.6em;animation:mfx-ink-pop .42s cubic-bezier(.26,1.5,.48,1) .15s both}
.mfx-ink-cue-k{position:relative;z-index:1;isolation:isolate;margin-bottom:-.12em;padding:.16em .55em .12em;font-size:.4em;letter-spacing:.08em;${STROKE(4)};transform:rotate(-4deg)}
.mfx-ink-cue-k::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:.22em;transform:skewX(-9deg);border:3px solid ${INK};
  background:linear-gradient(180deg,#ffe58a 0%,#ffcb3d 45%,#ffb000 100%);box-shadow:0 3px 0 ${HARD}}
.mfx-ink-cue-p{position:relative;isolation:isolate;padding:.14em .5em .1em;letter-spacing:.04em;-webkit-text-stroke:.13em ${INK};paint-order:stroke fill;
  text-shadow:0 .06em 0 rgb(10 6 30 / .55);animation:mfx-ink-pulse .8s ease-in-out .6s infinite alternate}
.mfx-ink-cue-p::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:.16em;transform:skewX(-9deg);border:4px solid #ffcb3d;
  background:linear-gradient(180deg,#d49bff 0%,#9d4dff 48%,#5a1bc4 100%);box-shadow:0 0 0 3px ${INK},0 7px 0 ${HARD},0 12px 24px rgba(0,0,0,.5),inset 0 4px 0 rgba(255,255,255,.3)}
.mfx-ink-trail{position:absolute;left:50%;top:100%;width:3.6em;height:.6em;margin:-.3em 0 0 -1.8em;opacity:.3;animation:mfx-ink-trail 1.1s ease-in-out infinite}
.mfx-ink-hand{position:absolute;left:50%;top:100%;width:1.2em;height:1.63em;margin-left:-.46em;transform-origin:38% 4%;transition:opacity .2s;
  animation:mfx-ink-swipe 1.1s ease-in-out infinite alternate}
.mfx-ink-trail svg,.mfx-ink-hand svg{display:block;width:100%;height:100%;overflow:visible}
.mfx-ink-hand svg{filter:drop-shadow(0 3px 0 rgb(10 6 30 / .45))}
.mfx-rm .mfx-ink-cue-pop{animation:mfx-ink-in .25s ease-out .1s both}
.mfx-rm .mfx-ink-cue-p,.mfx-rm .mfx-ink-trail,.mfx-rm .mfx-ink-hand{animation:none}
.mfx-rm .mfx-ink-trail{opacity:.9}
.mfx-rm .mfx-ink-cue-s{transition:opacity .22s ease-out}
.mfx-ink-wiping .mfx-ink-cue-s{transform:scale(.72)}
.mfx-ink-wiping .mfx-ink-hand{opacity:0;animation-play-state:paused}
.mfx-ink-wiping .mfx-ink-trail{animation:none;opacity:0}
.mfx-ink-wiping .mfx-ink-cue-p{animation-play-state:paused}
.mfx-ink-cue-out .mfx-ink-cue-s{opacity:0;transform:scale(.5)}
@keyframes mfx-ink-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
@keyframes mfx-ink-in{from{opacity:0}to{opacity:1}}
@keyframes mfx-ink-pulse{from{transform:scale(1)}to{transform:scale(1.05)}}
@keyframes mfx-ink-trail{0%,100%{opacity:.25}50%{opacity:.9}}
@keyframes mfx-ink-swipe{from{transform:translateX(-1.45em) rotate(-12deg)}to{transform:translateX(1.45em) rotate(12deg)}}

.mfx-tr{animation:mfx-env var(--s,1.6s) linear both}
.mfx-tr-stage{position:absolute;left:50%;top:50%}
.mfx-tr-tint,.mfx-tr-glow,.mfx-tr-flare,.mfx-tr-s,.mfx-tr-r{position:absolute}
.mfx-tr-tint{left:0;top:0;right:0;bottom:0;background:linear-gradient(90deg,rgba(255,60,150,0) 25%,rgba(255,60,150,.07) 60%,rgba(0,220,255,.12) 100%)}
.mfx-tr-glow{left:50%;top:50%;width:var(--gw);height:var(--gh);margin-top:calc(var(--gh) / -2);transform:translateX(calc(var(--e) - var(--gw)));
  background:radial-gradient(ellipse 100% 55% at 100% 50%,rgba(160,238,255,.55),rgba(90,150,255,.17) 46%,rgba(90,150,255,0) 74%)}
.mfx-tr-flare{left:50%;top:50%;width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;transform:translateX(var(--e));
  background:radial-gradient(circle,rgba(255,255,255,.9),rgba(150,240,255,.35) 40%,rgba(150,240,255,0) 70%);animation:mfx-trf .3s steps(2,end) infinite}
.mfx-tr-s{left:50%;top:50%;width:var(--w);height:var(--t);margin-top:calc(var(--t) / -2);border-radius:2px;opacity:0;
  background:linear-gradient(90deg,rgba(150,240,255,0),rgba(200,252,255,.95));
  box-shadow:0 0 6px rgba(120,230,255,.7),0 1.6px 0 rgba(255,60,140,.38),0 -1.6px 0 rgba(0,200,255,.38);
  animation:mfx-trs var(--d) cubic-bezier(.45,.05,.9,.55) var(--l) infinite}
.mfx-tr-r{left:50%;top:50%;width:var(--rw);height:var(--rh);margin:calc(var(--rh) / -2) 0 0 calc(var(--rw) / -2);border-right:2.5px solid rgba(190,248,255,.9);border-radius:50%;opacity:0;
  animation:mfx-trr .86s cubic-bezier(.4,.05,.85,.5) var(--l) infinite}
@keyframes mfx-env{0%{opacity:0}9%{opacity:1}76%{opacity:1}100%{opacity:0}}
@keyframes mfx-trf{0%{opacity:.9}50%{opacity:.45}100%{opacity:.9}}
@keyframes mfx-trs{0%{opacity:0;transform:translate(calc(var(--e) * -.85),var(--y)) scaleX(1.5)}14%{opacity:1}82%{opacity:.9}100%{opacity:0;transform:translate(calc(var(--e) * 1.03),calc(var(--y) * .12)) scaleX(.55)}}
@keyframes mfx-trr{0%{opacity:0;transform:translateX(calc(var(--e) * -.75)) scale(1.5)}20%{opacity:.95}100%{opacity:0;transform:translateX(calc(var(--e) * .98)) scale(.55)}}

.mfx-mine-dim{background:rgba(30,0,8,.3)}
.mfx-mine-flash{background:rgba(255,236,226,.95);opacity:0;animation:mfx-mflash .17s ease-out both}
.mfx-mine-vig{background:radial-gradient(ellipse at 50% 50%,rgba(255,40,60,0) 26%,rgba(255,30,50,.3) 62%,rgba(190,0,25,.74) 100%);opacity:0;animation:mfx-mvig var(--s,1.5s) ease-out both}
.mfx-mine-cracks{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 50%;animation:mfx-mcrack 1.15s ease-out both}
.mfx-mine-cracks polyline{fill:none;stroke-linecap:round;stroke-linejoin:round}
.mfx-mine-cracks .g{stroke:rgba(255,40,70,.55);stroke-width:5}
.mfx-mine-cracks .c{stroke:#fff3ee;stroke-width:1.6}
.mfx-mine-tv{position:absolute;left:0;top:0;width:100%;height:100%;opacity:.24;image-rendering:-webkit-optimize-contrast;image-rendering:pixelated}
.mfx-mine-roll{position:absolute;left:0;right:0;top:0;height:24%;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.1),rgba(255,255,255,0));animation:mfx-mroll .55s linear infinite}
@keyframes mfx-mflash{0%{opacity:1}100%{opacity:0}}
@keyframes mfx-mvig{0%{opacity:0}6%{opacity:1}40%{opacity:.7}55%{opacity:.95}78%{opacity:.6}100%{opacity:.4}}
@keyframes mfx-mcrack{0%{opacity:1;transform:scale(.6)}16%{transform:scale(1)}55%{opacity:1}100%{opacity:0;transform:scale(1.03)}}
@keyframes mfx-mroll{0%{transform:translateY(-110%)}100%{transform:translateY(420%)}}

.mfx-dc-tint{background:rgba(150,90,255,.17);opacity:0;animation:mfx-dtint 1.7s steps(1,end) both}
.mfx-dc-scan{background:repeating-linear-gradient(0deg,rgba(176,124,255,.3) 0,rgba(176,124,255,.3) 1px,transparent 1px,transparent 3px);opacity:0;animation:mfx-dscan 1.7s linear both}
.mfx-dc-sweep{position:absolute;left:0;right:0;top:0;height:30%;background:linear-gradient(to bottom,rgba(176,124,255,0),rgba(176,124,255,.4) 70%,rgba(236,222,255,.85) 94%,rgba(176,124,255,0));animation:mfx-dsweep .95s cubic-bezier(.4,0,.2,1) both}
.mfx-dc-stamp{position:absolute;left:50%;top:46%;padding:6px 20px 2px;border:3px solid currentColor;border-radius:8px;white-space:nowrap;color:#f1e6ff;background:rgba(120,70,255,.2);
  font:italic 900 62px/1 ${DISPLAY};letter-spacing:.06em;-webkit-text-stroke:5px ${INK};paint-order:stroke fill;text-shadow:-3px 0 rgba(0,240,255,.9),3px 0 rgba(255,40,200,.9),0 0 18px rgba(176,124,255,.95);
  box-shadow:0 0 16px rgba(176,124,255,.6),inset 0 0 12px rgba(176,124,255,.35);transform:translate(-50%,-50%) rotate(-7deg);animation:mfx-dstamp 1.6s both}
.mfx-dc-mine .mfx-dc-tint{background:rgba(60,220,255,.15)}
.mfx-dc-mine .mfx-dc-scan{background:repeating-linear-gradient(0deg,rgba(94,231,255,.3) 0,rgba(94,231,255,.3) 1px,transparent 1px,transparent 3px)}
.mfx-dc-mine .mfx-dc-sweep{background:linear-gradient(to bottom,rgba(94,231,255,0),rgba(94,231,255,.38) 70%,rgba(220,250,255,.85) 94%,rgba(94,231,255,0))}
.mfx-dc-mine .mfx-dc-stamp{color:#d8fbff;background:rgba(40,200,255,.16);text-shadow:-3px 0 rgba(0,160,255,.9),3px 0 rgba(120,255,230,.9),0 0 18px rgba(94,231,255,.95);box-shadow:0 0 16px rgba(94,231,255,.6),inset 0 0 12px rgba(94,231,255,.3)}
@keyframes mfx-dtint{0%{opacity:.9}8%{opacity:.2}16%{opacity:.8}30%{opacity:.25}50%{opacity:.5}64%{opacity:.15}80%,100%{opacity:0}}
@keyframes mfx-dscan{0%{opacity:0}10%{opacity:.8}80%{opacity:.6}100%{opacity:0}}
@keyframes mfx-dsweep{0%{transform:translateY(-110%)}100%{transform:translateY(340%)}}
@keyframes mfx-dstamp{
0%{opacity:0;transform:translate(-50%,-50%) rotate(-7deg) scale(2.6)}
9%{opacity:1;transform:translate(-50%,-50%) rotate(-7deg) scale(.92)}
14%{transform:translate(-50%,-50%) rotate(-7deg) scale(1.04)}
19%{transform:translate(-50%,-50%) rotate(-7deg) scale(1)}
31%{transform:translate(calc(-50% + 6px),-50%) rotate(-7deg)}
33%{transform:translate(calc(-50% - 5px),-50%) rotate(-7deg)}
35%{transform:translate(-50%,-50%) rotate(-7deg)}
55%{transform:translate(calc(-50% - 4px),-50%) rotate(-7deg)}
57%{transform:translate(-50%,-50%) rotate(-7deg)}
78%{opacity:1}
100%{opacity:0;transform:translate(-50%,-50%) rotate(-7deg) scale(1.06)}}
@keyframes mfx-dstamp-rm{0%{opacity:0}12%,78%{opacity:1}100%{opacity:0}}

.mfx-toasts{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 70px);height:0;pointer-events:none;z-index:9100;font-family:${FONT}}
.mfx-toasts.mfx-fixed{position:fixed}
.mfx-t{position:absolute;left:50%;top:0;width:max-content;max-width:90%;transform:translate(-50%,calc(var(--i,0) * 64px));transition:transform .24s cubic-bezier(.2,.8,.2,1);pointer-events:none}
.mfx-tp{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 24px 8px;text-align:center;max-width:min(86vw,560px);box-sizing:border-box;color:#fff}
.mfx-tp::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:12px;transform:skewX(-9deg);border:3px solid #fff;
  background:linear-gradient(180deg,var(--t1) 0%,var(--t2) 50%,var(--t3) 100%);box-shadow:0 5px 0 ${OUTLINE},0 9px 16px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.35)}
.mfx-tt{font:italic 900 24px/1 ${FONT};letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;${STROKE(3)}}
.mfx-ts{font:italic 800 14px/1.05 ${FONT};letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;${STROKE(2.4)}}
.mfx-tone-cyan{--t1:#86dcff;--t2:#2f8bff;--t3:#1647c8}
.mfx-tone-red{--t1:#ff8a8a;--t2:#ff3048;--t3:#a50d2c}
.mfx-tone-violet{--t1:#d49bff;--t2:#9d4dff;--t3:#5a1bc4}
.mfx-tone-gold{--t1:#ffe36e;--t2:#ffb21f;--t3:#d26a06}

.mfx-hl{z-index:8500}
.mfx-hm-o{position:absolute;left:calc(env(safe-area-inset-left,0px) + 8%);right:calc(env(safe-area-inset-right,0px) + 8%);top:calc(env(safe-area-inset-top,0px) + 8%);bottom:calc(env(safe-area-inset-bottom,0px) + 8%)}
.mfx-hm{position:absolute;left:50%;top:50%;width:0;height:0}
.mfx-hm.mfx-hm-vg{left:0;top:0;width:100%;height:100%}
.mfx-hm-f,.mfx-hm-p{position:absolute;left:0;top:0;width:100%;height:100%}
.mfx-hm-f{animation:mfx-hm-fade var(--s,.9s) ease-in both}
.mfx-hm-p{animation:mfx-hm-pop .12s ease-out both}
.mfx-hm-r1 .mfx-hm-f{animation-name:mfx-hm-fade2}
.mfx-hm-r1 .mfx-hm-p{animation-name:mfx-hm-bump}
.mfx-hm-r2 .mfx-hm-p{animation-name:mfx-hm-bump2}
.mfx-hm-g{position:absolute;left:-120px;top:-96px;width:240px;height:132px;background:radial-gradient(closest-side,rgba(255,59,92,.36),rgba(255,59,92,.13) 55%,rgba(255,59,92,0))}
.mfx-hm-c{position:absolute;left:-48px;top:-16px;width:96px;height:32px;overflow:visible}
.mfx-hm-v{box-shadow:inset 0 0 0 3px rgba(255,59,92,.75),inset 0 0 64px 10px rgba(255,59,92,.5)}
@keyframes mfx-hm-pop{0%{opacity:0;transform:scale(.7)}55%{opacity:1;transform:scale(1.05)}100%{opacity:1;transform:scale(1)}}
@keyframes mfx-hm-bump{0%{transform:scale(1.16)}100%{transform:scale(1)}}
@keyframes mfx-hm-bump2{0%{transform:scale(1.16)}100%{transform:scale(1)}}
@keyframes mfx-hm-fade{0%,22%{opacity:1}100%{opacity:0}}
@keyframes mfx-hm-fade2{0%,22%{opacity:1}100%{opacity:0}}

.mfx-sh{z-index:8400;animation:mfx-sh-in .25s ease-out both}
.mfx-sh.mfx-back{animation:none}
.mfx-sh.mfx-out{animation:mfx-sh-out .3s ease-in both}
.mfx-sh-frame{box-shadow:inset 0 0 0 4px rgb(25 211 255 / .85),inset 0 0 38px rgb(25 211 255 / .55);animation:mfx-sh-pulse 1.3s ease-in-out infinite alternate}
.mfx-sh-hex{opacity:.3;background:${HEX_TILE} 0 0/24px 41.6px;-webkit-mask-image:${EDGE_BAND};mask-image:${EDGE_BAND};animation:mfx-sh-hexp 1.9s ease-in-out infinite alternate}
.mfx-sh-chip{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);padding:5px 18px 6px;white-space:nowrap;isolation:isolate;color:#fff;
  font:italic 900 18px/1 ${FONT};letter-spacing:.05em;text-transform:uppercase;${STROKE(3)};transform:translateX(-50%);animation:mfx-chipin .3s cubic-bezier(.26,1.5,.48,1) both}
.mfx-sh-chip::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:6px;transform:skewX(-9deg);border:3px solid ${INK};
  background:linear-gradient(180deg,#7aeaff 0%,#19d3ff 55%,#0aa7d6 100%);box-shadow:0 4px 0 ${HARD}}
@keyframes mfx-sh-in{from{opacity:0}to{opacity:1}}
@keyframes mfx-sh-out{from{opacity:1}to{opacity:0}}
@keyframes mfx-sh-pulse{from{opacity:1}to{opacity:.62}}
@keyframes mfx-sh-hexp{from{opacity:.34}to{opacity:.1}}

.mfx-rm .mfx-hm-p,.mfx-rm .mfx-sh-frame,.mfx-rm .mfx-sh-hex{animation:none}
.mfx-rm .mfx-hm-v{opacity:.6}
.mfx-rm .mfx-emp-tear,.mfx-rm .mfx-emp-sweep,.mfx-rm .mfx-emp-hue,.mfx-rm .mfx-tr-s,.mfx-rm .mfx-tr-r,.mfx-rm .mfx-tr-flare,.mfx-rm .mfx-mine-roll,.mfx-rm .mfx-dc-sweep{display:none}
.mfx-rm .mfx-emp-tint{animation:none;opacity:.1}
.mfx-rm .mfx-mine-cracks{animation:none;opacity:.7}
.mfx-rm .mfx-dc-stamp{animation-name:mfx-dstamp-rm}
`;

export function injectStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ---------------------------------------------------------------- helpers

function div(cls, parent) {
  const e = document.createElement("div");
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function svgEl(tag, cls, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  if (cls) e.setAttribute("class", cls);
  if (parent) parent.appendChild(e);
  return e;
}

const clampN = (v, lo, hi, d) => ((v = +v), v === v ? (v < lo ? lo : v > hi ? hi : v) : d); // NaN → d
const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
const randSeed = () => (Math.random() * 4294967296) >>> 0 || 1;
const reducedMotion = () => {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
};

// mulberry32, the same generator the frame kit uses. Numbers and strings both make a seed.
function rng(seed) {
  let a = typeof seed === "string" ? hashStr(seed) : seed >>> 0;
  a = a || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h;
}

function setVars(node, vars) {
  for (const k in vars) node.style.setProperty(k, vars[k]);
}

// The one rAF loop: runs only while some effect has a ticker.
const tickers = [];
let rafId = 0;
function loop(t) {
  rafId = 0;
  for (let i = tickers.length - 1; i >= 0; i--) {
    try {
      tickers[i](t);
    } catch (e) {
      tickers.splice(i, 1);
    }
  }
  if (tickers.length) rafId = requestAnimationFrame(loop);
}
function addTicker(fn) {
  tickers.push(fn);
  if (!rafId) rafId = requestAnimationFrame(loop);
  return () => {
    const i = tickers.indexOf(fn);
    if (i >= 0) tickers.splice(i, 1);
  };
}

// One effect: everything it creates registers an undo, and end() runs them all (newest first), once.
function newFx(extra) {
  const undo = [];
  let ended = false;
  let finish;
  const done = new Promise((r) => (finish = r));
  const fx = {
    done,
    get ended() {
      return ended;
    },
    on(fn) {
      undo.push(fn);
      return fn;
    },
    add(node, parent) {
      parent.appendChild(node);
      undo.push(() => node.remove());
      return node;
    },
    timeout(fn, ms) {
      const id = setTimeout(() => {
        if (!ended) {
          try {
            fn();
          } catch (e) {}
        }
      }, ms);
      undo.push(() => clearTimeout(id));
      return id;
    },
    every(fn, ms) {
      const id = setInterval(() => {
        if (!ended) {
          try {
            fn();
          } catch (e) {}
        }
      }, ms);
      undo.push(() => clearInterval(id));
      return id;
    },
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      undo.push(() => target.removeEventListener(type, fn, opts));
    },
    anim(node, keyframes, opts) {
      if (!node || !node.animate) return null;
      try {
        const a = node.animate(keyframes, opts);
        undo.push(() => {
          try {
            a.cancel();
          } catch (e) {}
        });
        return a;
      } catch (e) {
        return null;
      }
    },
    end(info) {
      if (ended) return;
      ended = true;
      for (let i = undo.length - 1; i >= 0; i--) {
        try {
          undo[i]();
        } catch (e) {}
      }
      undo.length = 0;
      finish(info || {});
    },
  };
  fx.handle = Object.assign({ done, cancel: () => fx.end({ cancelled: true }) }, extra);
  return fx;
}

// Runs build(fx); whatever it threw, the caller still gets a valid handle and nothing is left behind.
function run(extra, build) {
  const fx = newFx(extra);
  try {
    if (typeof document === "undefined" || !document.body) throw new Error("no document");
    injectStyles();
    build(fx);
  } catch (e) {
    fx.end({ error: String((e && e.message) || e) });
  }
  return fx.handle;
}

// Elements that cannot hold children (iframe, canvas…) are covered through their parent.
const CHILDLESS = /^(IFRAME|CANVAS|IMG|VIDEO|INPUT|TEXTAREA|SELECT|BR|HR)$/;
function hostOf(el) {
  let h = el && el.nodeType === 1 ? el : document.body;
  if (CHILDLESS.test(h.tagName)) h = h.parentElement || document.body;
  if (h === document.documentElement) h = document.body;
  return h;
}

// Absolute layers need a positioned host; a static one is made relative while any effect needs it.
const posHold = new WeakMap();
function holdPosition(fx, host) {
  if (host === document.body) return;
  let h = posHold.get(host);
  if (!h) {
    if (getComputedStyle(host).position !== "static") return;
    h = { n: 0, prev: host.style.position };
    posHold.set(host, h);
    host.style.position = "relative";
  }
  h.n++;
  fx.on(() => {
    if (--h.n <= 0) {
      host.style.position = h.prev;
      posHold.delete(host);
    }
  });
}

// A full-cover, click-through layer (fixed on <body>, absolute inside any other host).
function layer(fx, host, cls, kind) {
  const e = div("mfx " + cls + (host === document.body ? " mfx-fixed" : "") + (reducedMotion() ? " mfx-rm" : ""));
  e.setAttribute("data-mfx", kind);
  e.setAttribute("aria-hidden", "true");
  holdPosition(fx, host);
  fx.add(e, host);
  return e;
}

const sizeOf = (e) => ({ w: e.clientWidth || window.innerWidth || 844, h: e.clientHeight || window.innerHeight || 390 });

// A jagged line from (x0, y0) to (x1, y1): points along the way pushed sideways, most in the middle.
function bolt(rnd, x0, y0, x1, y1, segs, amp) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let s = x0.toFixed(1) + "," + y0.toFixed(1);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const off = i === segs ? 0 : (rnd() * 2 - 1) * amp * (0.35 + 0.65 * Math.sin(Math.PI * t));
    s += " " + (x0 + dx * t + nx * off).toFixed(1) + "," + (y0 + dy * t + ny * off).toFixed(1);
  }
  return s;
}

// A jagged ray: from (x0, y0) at angle `ang`, `len` long, steps of about `step`, sideways jitter up to `amp`.
function ray(rnd, x0, y0, ang, len, step, amp) {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  let d = 0;
  let s = x0.toFixed(1) + "," + y0.toFixed(1);
  while (d < len) {
    d += step * (0.6 + rnd() * 0.8);
    const j = (rnd() * 2 - 1) * amp;
    s += " " + (x0 + ca * d - sa * j).toFixed(1) + "," + (y0 + sa * d + ca * j).toFixed(1);
  }
  return s;
}

// Two strokes (soft glow + bright core) for one polyline.
function stroke2(parent, pts) {
  svgEl("polyline", "g", parent).setAttribute("points", pts);
  svgEl("polyline", "c", parent).setAttribute("points", pts);
}

// ---------------------------------------------------------------- EMP

// The scramble, identical to the one inside the controller frame's kit (Sattolo cycles on a mulberry32 stream).
// items: [{ key, kind }] in the frame's order (kind "stick" or anything else = a button). Returns
//   target[i]  index whose place item i takes (-1: nothing to swap with, it mirrors to the other side)
//   map        { key of the place: key of the control now standing there }
// Buttons cycle among themselves (2+), exactly two sticks swap, one button with one stick swap.
// Self-contained on purpose: no module scope is used, so a kit can embed it with Function.prototype.toString.
export function empPermutation(items, seed) {
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list = Array.isArray(items) ? items : [];
  const buttons = [];
  const sticks = [];
  list.forEach((it, i) => (it && it.kind === "stick" ? sticks : buttons).push(i));
  const target = list.map(() => -1);
  const cycle = (ids) => {
    const idx = ids.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * i);
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    ids.forEach((id, i) => {
      target[id] = ids[idx[i]];
    });
  };
  if (buttons.length >= 2) cycle(buttons);
  if (sticks.length === 2) cycle(sticks);
  if (buttons.length === 1 && sticks.length === 1) cycle([buttons[0], sticks[0]]);
  const map = {};
  list.forEach((it, i) => {
    if (target[i] >= 0) map[list[target[i]].key] = it.key;
  });
  return { target, map };
}

const CTL_SEL = "[data-action],[data-stick],.hit";
const empRuns = new WeakMap(); // controller element → the EMP running on it

// The controls inside a plain DOM controller (legacy .hit boxes included), with where they are right now.
function gatherControls(root) {
  const out = [];
  for (const el of root.querySelectorAll(CTL_SEL)) {
    const anc = el.parentElement && el.parentElement.closest(CTL_SEL);
    if (anc && anc !== root && root.contains(anc)) continue; // nested in another control: it moves with it
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const stick = el.hasAttribute("data-stick") || el.classList.contains("stick");
    const key = (el.getAttribute("data-action") || el.getAttribute("data-stick") || (el.textContent || "").trim() || "control")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 32);
    out.push({ el, key, kind: stick ? "stick" : "button", cx: r.left + r.width / 2, cy: r.top + r.height / 2, base: parseTranslate(getComputedStyle(el).translate, r.width, r.height) });
  }
  return out;
}

// An existing CSS `translate` (px or %) as [x, y] px, so the scramble adds to it instead of replacing it.
function parseTranslate(v, w, h) {
  if (!v || v === "none") return [0, 0];
  const p = String(v).trim().split(/\s+/);
  const n = (s, ref) => {
    const x = parseFloat(s);
    return x === x ? (/%$/.test(s) ? (x * ref) / 100 : x) : 0;
  };
  return [n(p[0], w), p[1] ? n(p[1], h) : 0];
}

// Where the overlay goes when the target cannot hold children: its own box, in the host's coordinates.
function boxIn(target, host) {
  const r = target.getBoundingClientRect();
  if (host === document.body) return { l: r.left, t: r.top, w: r.width, h: r.height };
  const hr = host.getBoundingClientRect();
  return { l: r.left - hr.left - host.clientLeft + host.scrollLeft, t: r.top - hr.top - host.clientTop + host.scrollTop, w: r.width, h: r.height };
}

// Electric arcs, drawn up front: a handful of frames that flash in turn through a CSS steps() animation (no JS per
// frame). A tight burst for the first ~0.7 s, then single sparks now and then.
function buildArcs(root, W, H, anchors, rnd, reduced, sec) {
  const svg = svgEl("svg", "mfx-emp-arcs");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("preserveAspectRatio", "none");
  const burst = reduced ? 3 : 10;
  const sparks = reduced ? 0 : Math.max(0, Math.min(8, Math.floor((sec - 0.8) / 0.55)));
  const amp = Math.max(6, Math.min(W, H) * 0.045);
  const point = () => (anchors.length ? anchors[(rnd() * anchors.length) | 0] : { x: rnd() * W, y: rnd() * H });
  for (let i = 0; i < burst + sparks; i++) {
    const g = svgEl("g", "mfx-arc", svg);
    const inBurst = i < burst;
    setVars(g, {
      "--w": (inBurst ? i * 0.07 + rnd() * 0.03 : 0.85 + (i - burst) * 0.55 + rnd() * 0.3).toFixed(3) + "s",
      "--l": (inBurst ? 0.06 + rnd() * 0.05 : 0.09 + rnd() * 0.08).toFixed(3) + "s",
    });
    const n = inBurst ? 2 + ((rnd() * 2) | 0) : 1;
    for (let k = 0; k < n; k++) {
      const a = point();
      let b = point();
      if (b === a || (Math.abs(a.x - b.x) < 8 && Math.abs(a.y - b.y) < 8) || rnd() < 0.3) {
        b = rnd() < 0.5 ? { x: rnd() < 0.5 ? 0 : W, y: rnd() * H } : { x: rnd() * W, y: rnd() < 0.5 ? 0 : H };
      }
      stroke2(g, bolt(rnd, a.x, a.y, b.x, b.y, 8 + ((rnd() * 6) | 0), amp));
      if (rnd() < 0.55) {
        // a short fork off the middle of the bolt
        const t = 0.3 + rnd() * 0.4;
        const fx0 = a.x + (b.x - a.x) * t;
        const fy0 = a.y + (b.y - a.y) * t;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6);
        const len = Math.min(W, H) * (0.12 + rnd() * 0.18);
        stroke2(g, bolt(rnd, fx0, fy0, fx0 + Math.cos(ang) * len, fy0 + Math.sin(ang) * len, 4, amp * 0.6));
      }
    }
  }
  root.appendChild(svg);
  return svg;
}

// The label: "EMP! BUTTONS SWAPPED" with a ring that drains over `sec` and the seconds left inside it.
function buildChip(root, sec, top) {
  const chip = div("mfx-emp-chip", root);
  chip.style.top = top + "px";
  chip.style.setProperty("--s", sec + "s");
  const ring = document.createElement("i");
  ring.innerHTML = '<svg viewBox="0 0 20 20"><circle class="t" cx="10" cy="10" r="8"/><circle class="p" cx="10" cy="10" r="8"/></svg>';
  const num = document.createElement("b");
  num.textContent = String(Math.max(1, Math.ceil(sec)));
  ring.appendChild(num);
  chip.appendChild(ring);
  const label = document.createElement("span");
  label.textContent = "EMP! BUTTONS SWAPPED";
  chip.appendChild(label);
  return { el: chip, num };
}

// A short colour and position jitter on the controller frame itself (the first half second).
function frameJitter(fx, frame, rnd) {
  const kf = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    kf.push({
      filter: last ? "none" : "hue-rotate(" + ((rnd() * 360) | 0) + "deg) saturate(" + (1 + rnd() * 2.2).toFixed(2) + ") contrast(" + (1 + rnd() * 0.7).toFixed(2) + ")",
      translate: last ? "0px 0px" : ((rnd() - 0.5) * 6).toFixed(1) + "px " + ((rnd() - 0.5) * 6).toFixed(1) + "px",
      easing: "steps(1,end)",
    });
  }
  fx.anim(frame, kf, { duration: 500, easing: "linear" });
}

function findHandle(el) {
  try {
    const f = el.querySelector && el.querySelector("iframe");
    const h = el.ctrlSandbox || (f && f.ctrlSandbox) || null;
    return h && typeof h === "object" ? h : null;
  } catch (e) {
    return null;
  }
}

export function emp(controllerEl, seconds = 5, opts) {
  const o = opts || {};
  try {
    const live = controllerEl && empRuns.get(controllerEl);
    if (live && !live.fx.ended) {
      if (!live.finishing) return live.restart(seconds, o);
      live.fx.end({ superseded: true }); // it was already sliding back: start a clean one
    }
  } catch (e) {}
  return run({ until: 0, permutation: {} }, (fx) => buildEmp(fx, controllerEl, seconds, o));
}

function buildEmp(fx, target, seconds, o) {
  if (!target || target.nodeType !== 1) throw new Error("emp: controllerEl must be an element");
  const reduced = reducedMotion();
  const sec = clampN(seconds, 0.2, 30, 5);
  const seed = ((o.seed == null ? 0 : +o.seed) >>> 0) || randSeed();
  const rnd = rng(seed ^ 0x9e3779b9); // looks only: the scramble has its own stream
  const sh = findHandle(target);
  const frame = sh ? sh.iframe || (target.tagName === "IFRAME" ? target : target.querySelector("iframe")) : null;
  const st = { fx, sec, seed, until: Date.now() + sec * 1000, timer: 0, shown: Math.ceil(sec), finishing: false, applied: false, permutation: {}, saved: [], onSwap: typeof o.onSwap === "function" ? o.onSwap : null };
  const tell = (v) => {
    if (st.onSwap) {
      try {
        st.onSwap(v);
      } catch (e) {}
    }
  };

  // reads first (control boxes, host box), writes after
  const host = hostOf(target);
  const box = host !== target ? boxIn(target, host) : null;
  const hostRect = box ? target.getBoundingClientRect() : host.getBoundingClientRect();
  const W = box ? box.w : hostRect.width || sizeOf(host).w;
  const H = box ? box.h : hostRect.height || sizeOf(host).h;
  let items = null;
  let plan = null;
  let anchors = [];
  if (sh) {
    const list = (typeof sh.controls === "function" && sh.controls()) || [];
    plan = empPermutation(list.map((c) => ({ key: c.action, kind: c.kind })), seed);
    st.permutation = plan.map;
    anchors = list.map((c) => ({ x: (c.x + c.w / 2) * W, y: (c.y + c.h / 2) * H }));
  } else {
    items = gatherControls(target);
    plan = empPermutation(items, seed);
    st.permutation = plan.map;
    anchors = items.map((it) => ({ x: it.cx - hostRect.left, y: it.cy - hostRect.top }));
  }

  // the overlay
  const root = layer(fx, host, "mfx-emp", "emp");
  if (box) setVars(root, { right: "auto", bottom: "auto", left: box.l + "px", top: box.t + "px", width: box.w + "px", height: box.h + "px" });
  div("mfx-fill mfx-emp-tint", root);
  div("mfx-fill mfx-emp-hue", root);
  div("mfx-fill mfx-emp-scan", root);
  div("mfx-emp-sweep", root);
  for (let i = 0; i < 4; i++) {
    setVars(div("mfx-emp-tear", root), {
      "--y": (8 + rnd() * 80).toFixed(1) + "%",
      "--h": (4 + rnd() * 10).toFixed(1) + "px",
      "--dx": (rnd() < 0.5 ? -1 : 1) * (14 + ((rnd() * 34) | 0)) + "px",
      "--d": (0.9 + rnd() * 0.9).toFixed(2) + "s",
      "--w": (rnd() * 0.5).toFixed(2) + "s",
    });
  }
  const chipTop = Math.max(8, 46 - hostRect.top); // under the HUD band when the overlay reaches the top of the screen
  let arcs = null;
  let chip = null;
  const renew = (secNow) => {
    if (arcs) arcs.remove();
    if (chip) chip.el.remove();
    arcs = buildArcs(root, W, H, anchors, rnd, reduced, secNow);
    chip = buildChip(root, secNow, chipTop);
    st.shown = Math.ceil(secNow);
  };
  renew(sec);
  fx.every(() => {
    const n = Math.max(1, Math.ceil((st.until - Date.now()) / 1000));
    if (chip && n !== st.shown) {
      st.shown = n;
      chip.num.textContent = String(n);
    }
  }, 200);

  // the controls
  if (sh) {
    const send = (s) => {
      try {
        Promise.resolve(sh.fx("emp", { seconds: s, seed })).catch(() => {});
      } catch (e) {}
    };
    st.sendFx = send;
    send(sec);
    if (frame && !reduced) frameJitter(fx, frame, rnd);
  } else {
    const T = reduced ? "none" : "translate .24s steps(4,end)";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const t = plan.target[i];
      const bx = t >= 0 ? items[t].cx : hostRect.left + hostRect.right - it.cx; // alone: mirror to the other side
      const by = t >= 0 ? items[t].cy : it.cy;
      const s = it.el.style;
      st.saved.push({ el: it.el, tr: s.getPropertyValue("translate"), trp: s.getPropertyPriority("translate"), ts: s.getPropertyValue("transition"), tsp: s.getPropertyPriority("transition"), base: it.base });
      s.setProperty("transition", T, "important");
      s.setProperty("translate", (it.base[0] + bx - it.cx).toFixed(1) + "px " + (it.base[1] + by - it.cy).toFixed(1) + "px", "important");
    }
    if (items.length && !target.classList.contains("is-emp")) {
      target.classList.add("is-emp");
      fx.on(() => target.classList.remove("is-emp"));
    }
  }
  st.applied = true;
  tell(st.permutation);

  // put every control's own inline styles back (no animation)
  const putBack = () => {
    for (const s of st.saved) {
      const sty = s.el.style;
      sty.removeProperty("translate");
      if (s.tr) sty.setProperty("translate", s.tr, s.trp);
      sty.removeProperty("transition");
      if (s.ts) sty.setProperty("transition", s.ts, s.tsp);
    }
    st.saved.length = 0;
  };
  fx.on(() => {
    putBack();
    if (st.applied && !st.finishing) tell(null);
  });

  const finish = () => {
    if (fx.ended || st.finishing) return;
    st.finishing = true;
    tell(null);
    const T = reduced ? "none" : "translate .24s steps(4,end)";
    for (const s of st.saved) {
      if (!s.el.isConnected) continue;
      s.el.style.setProperty("transition", T, "important");
      s.el.style.setProperty("translate", s.base[0].toFixed(1) + "px " + s.base[1].toFixed(1) + "px", "important");
    }
    fx.anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" });
    fx.timeout(() => fx.end({ ok: true }), 290);
  };
  st.timer = setTimeout(finish, sec * 1000);
  fx.on(() => clearTimeout(st.timer));

  st.restart = (secNew, o2) => {
    const s2 = clampN(secNew, 0.2, 30, 5);
    st.sec = s2;
    st.until = Date.now() + s2 * 1000;
    clearTimeout(st.timer);
    st.timer = setTimeout(finish, s2 * 1000);
    renew(s2);
    if (typeof o2.onSwap === "function") {
      st.onSwap = o2.onSwap;
      tell(st.permutation);
    }
    if (st.sendFx) st.sendFx(s2);
    return fx.handle;
  };

  empRuns.set(target, st);
  fx.on(() => {
    if (empRuns.get(target) === st) empRuns.delete(target);
  });
  Object.defineProperty(fx.handle, "until", { get: () => st.until, enumerable: true, configurable: true });
  fx.handle.permutation = st.permutation;
}

// ---------------------------------------------------------------- ink bomb

const BRUSH = { r: 0.07, a: 0.28, space: 0.22 }; // radius (of the shorter side), peak strength per stamp, stamp spacing (of the radius)
const GRID = { cols: 48, rows: 24, bx: 12, by: 6 }; // coverage samples, blocker cells
const OPEN_BELOW = 0.18; // a blocker cell lets touches through when its coverage average is under this
const CLEAR_BELOW = 0.12; // the whole bomb ends when total coverage is under this
const CUE_BELOW = 0.6; // the "WIPE IT!" cue goes once the coverage is under this share of what the bomb started with
const CUE_IDLE_MS = 1800; // no finger on the ink for this long: the swiping hand comes back
const DRY_MS = 1500; // the safety fade: the ink dries out over the last 1.5 s of `seconds` (at most 30 % of it)

// brush falloff 0..1 from the centre to the edge (the canvas brush sprite uses the same stops)
const brushAt = (u) => (u >= 1 ? 0 : u <= 0.55 ? 1 - 0.2 * (u / 0.55) : 0.8 * (1 - (u - 0.55) / 0.45));

// Splat shapes: overlapping circles (the lobes, plus bead chains for the splash tendrils) = everything that counts as
// ink for coverage; satellite droplets, drips and highlight spots are only drawn.
function makeSplats(W, H, rnd, n) {
  const short = Math.min(W, H);
  const out = [];
  for (let i = 0; i < n; i++) {
    // spread across the width, in the band where thumbs and controls usually are
    const cx = (W * (i + 0.2 + rnd() * 0.6)) / n;
    const cy = H * (0.36 + rnd() * 0.3);
    const R = short * (0.26 + rnd() * 0.08);
    const circles = [[cx, cy, R * (0.8 + rnd() * 0.12)]];
    const K = 10 + ((rnd() * 5) | 0);
    for (let k = 0; k < K; k++) {
      const a = ((k + rnd() * 0.8) / K) * TAU;
      const d = R * (0.5 + rnd() * 0.5);
      circles.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.3 + rnd() * 0.32)]);
    }
    const T = 3 + ((rnd() * 3) | 0);
    for (let t = 0; t < T; t++) {
      const a = rnd() * TAU;
      const beads = 4 + ((rnd() * 3) | 0);
      let r = R * (0.24 + rnd() * 0.08);
      let d = R * 0.95;
      for (let j = 0; j < beads; j++) {
        circles.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, r]);
        d += r * 1.25;
        r *= 0.72;
      }
    }
    const drops = [];
    const S = 7 + ((rnd() * 6) | 0);
    for (let k = 0; k < S; k++) {
      const a = rnd() * TAU;
      const d = R * (1.45 + rnd() * 0.9);
      drops.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.018 + rnd() * rnd() * 0.08)]);
    }
    const drips = [];
    const D = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < D; k++) {
      const a = (0.2 + rnd() * 0.6) * Math.PI; // pointing down (canvas y grows downward)
      const d = R * (0.35 + rnd() * 0.35);
      const x0 = cx + Math.cos(a) * d;
      const y0 = cy + Math.sin(a) * d;
      const len = R * (0.45 + rnd() * 0.75);
      const w = R * (0.035 + rnd() * 0.03);
      drips.push({ x0, y0, x1: x0 + (rnd() - 0.5) * w * 3, y1: y0 + len, qx: x0 + (rnd() - 0.5) * w * 4, qy: y0 + len * 0.55, w });
    }
    const spots = [[cx - R * 0.36, cy - R * 0.4, R * 0.36, R * 0.2, -0.5, 0.42], [cx - R * 0.52, cy - R * 0.5, R * 0.08, R * 0.05, -0.5, 0.95]];
    for (let k = 0; k < 3; k++) {
      const c = circles[1 + ((rnd() * K) | 0)];
      spots.push([c[0] - c[2] * 0.35, c[1] - c[2] * 0.4, c[2] * 0.42, c[2] * 0.24, -0.5 + (rnd() - 0.5) * 0.6, 0.55]);
    }
    out.push({ cx, cy, R, circles, drops, drips, spots });
  }
  return out;
}

// The ink model, with no DOM: what is covered (a 48 × 24 sample grid computed from the splat circles, no pixel
// readbacks), what a wipe stamp takes away, and per blocker cell the coverage average.
function inkField(W, H, rnd, n) {
  const splats = makeSplats(W, H, rnd, n);
  const { cols, rows, bx, by } = GRID;
  const N = cols * rows;
  const cw = W / cols;
  const ch = H / rows;
  const cov = new Float32Array(N);
  const inside = (x, y) => {
    for (let s = 0; s < splats.length; s++) {
      const cs = splats[s].circles;
      for (let c = 0; c < cs.length; c++) {
        const dx = x - cs[c][0];
        const dy = y - cs[c][1];
        if (dx * dx + dy * dy <= cs[c][2] * cs[c][2]) return true;
      }
    }
    return false;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let hit = 0;
      for (let q = 0; q < 4; q++) if (inside((i + 0.25 + (q & 1) * 0.5) * cw, (j + 0.25 + (q >> 1) * 0.5) * ch)) hit++;
      cov[j * cols + i] = hit / 4;
    }
  }
  const rx = cols / bx;
  const ry = rows / by;
  const cellN = rx * ry;
  const cellSum = new Float32Array(bx * by);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cellSum[((j / ry) | 0) * bx + ((i / rx) | 0)] += cov[j * cols + i];
  const R = Math.min(W, H) * BRUSH.r;
  // a round soft stamp at (x, y): every sample under it keeps (1 - strength × falloff) of what it had
  function stamp(x, y) {
    const i0 = Math.max(0, Math.floor((x - R) / cw));
    const i1 = Math.min(cols - 1, Math.floor((x + R) / cw));
    const j0 = Math.max(0, Math.floor((y - R) / ch));
    const j1 = Math.min(rows - 1, Math.floor((y + R) / ch));
    for (let j = j0; j <= j1; j++) {
      const dy = (j + 0.5) * ch - y;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cw - x;
        const u = Math.sqrt(dx * dx + dy * dy) / R;
        if (u >= 1) continue;
        const k = j * cols + i;
        const old = cov[k];
        if (old <= 0.0005) continue;
        const nv = old * (1 - BRUSH.a * brushAt(u));
        cov[k] = nv;
        cellSum[((j / ry) | 0) * bx + ((i / rx) | 0)] += nv - old;
      }
    }
  }
  return {
    splats, cov, cellSum, cellN, N, R, bx, by, stamp,
    cells: bx * by,
    cellAvg: (c) => cellSum[c] / cellN,
    total() {
      let t = 0;
      for (let c = 0; c < cellSum.length; c++) t += cellSum[c];
      return t / N;
    },
  };
}

// Walk a finger from p to (x, y), calling paint(x, y) every `step` px of path, so how much a wipe takes away depends
// on the distance travelled, not on how many pointer events the browser happened to send.
function inkWalk(p, x, y, step, paint) {
  const dx = x - p.x;
  const dy = y - p.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 0) {
    let next = step - p.carry;
    while (next <= dist) {
      const t = next / dist;
      paint(p.x + dx * t, p.y + dy * t);
      next += step;
    }
    p.carry = dist - (next - step);
  }
  p.x = x;
  p.y = y;
}

function spot(ctx, x, y, rx, ry, rot, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, "rgba(255,255,255," + a + ")");
  g.addColorStop(0.4, "rgba(255,255,255," + (a * 0.4).toFixed(3) + ")");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Drawn once. Deep blue-black ink with a purple sheen, glossy highlights, drips and droplets. Leaves the context in
// "destination-out" mode, ready for the wipe stamps.
function paintSplats(ctx, splats, W, H, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  for (const s of splats) {
    const { cx, cy, R } = s;
    ctx.beginPath(); // one silhouette path: overlaps merge, no seams, no double alpha
    for (const c of s.circles) {
      ctx.moveTo(c[0] + c[2], c[1]);
      ctx.arc(c[0], c[1], c[2], 0, TAU);
    }
    for (const c of s.drops) {
      ctx.moveTo(c[0] + c[2], c[1]);
      ctx.arc(c[0], c[1], c[2], 0, TAU);
    }
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.8);
    g.addColorStop(0, "#1b1035");
    g.addColorStop(0.5, "#110a25");
    g.addColorStop(1, "#07060f");
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, R * 0.035);
    ctx.strokeStyle = "rgba(125,92,235,.45)";
    ctx.stroke(); // a faint violet rim: only its outer half survives the fill, so the blob reads against a dark sky
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#0b0818";
    ctx.fillStyle = "#0b0818";
    ctx.lineCap = "round";
    for (const d of s.drips) {
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(d.x0, d.y0);
      ctx.quadraticCurveTo(d.qx, d.qy, d.x1, d.y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(d.x1, d.y1, d.w * 0.95, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-atop"; // sheen and highlights only land on ink
  for (const s of splats) {
    const { cx, cy, R } = s;
    let g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, 0, cx - R * 0.3, cy - R * 0.35, R);
    g.addColorStop(0, "rgba(150,110,255,.40)");
    g.addColorStop(0.55, "rgba(100,64,210,.16)");
    g.addColorStop(1, "rgba(70,40,160,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4);
    g = ctx.createRadialGradient(cx + R * 0.45, cy + R * 0.5, 0, cx + R * 0.45, cy + R * 0.5, R * 0.8);
    g.addColorStop(0, "rgba(60,110,255,.16)");
    g.addColorStop(1, "rgba(60,110,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - R * 1.7, cy - R * 1.7, R * 3.4, R * 3.4);
    ctx.strokeStyle = "rgba(220,205,255,.32)";
    ctx.lineWidth = Math.max(1.4, R * 0.016);
    ctx.beginPath();
    ctx.arc(cx, cy, s.circles[0][2] * 0.86, Math.PI * 1.08, Math.PI * 1.46);
    ctx.stroke();
    for (const p of s.spots) spot(ctx, p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  ctx.globalCompositeOperation = "destination-out";
}

function makeBrush(R, dpr) {
  const size = Math.max(2, Math.ceil(R * 2 * dpr));
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0," + BRUSH.a + ")");
  grad.addColorStop(0.55, "rgba(0,0,0," + (BRUSH.a * 0.8).toFixed(3) + ")");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// The "WIPE IT!" cue (PLAN.md section 0: every screen answers "what do I do now?"), drawn on the ink itself: an
// "INK!" kicker, the label on a slanted violet plate and, along its bottom edge, a double arrow with a pointing hand
// (fingertip on the arrow) that swipes left-right. Constant markup only; it never takes a touch.
const HAND_SVG =
  '<svg viewBox="0 0 56 76" aria-hidden="true"><g fill="#fff" stroke="' + INK + '" stroke-width="3.6" stroke-linejoin="round">' +
  '<rect x="13" y="60" width="32" height="13" rx="3" fill="#ffcb3d"/><rect x="9" y="30" width="40" height="36" rx="13"/>' +
  '<rect x="42" y="32" width="9" height="15" rx="4.5"/><rect x="35" y="28" width="10" height="17" rx="5"/><rect x="26" y="25" width="11" height="19" rx="5.5"/>' +
  '<rect x="3" y="38" width="13" height="22" rx="6.5" transform="rotate(24 9.5 49)"/><rect x="15" y="3" width="13" height="42" rx="6.5"/></g></svg>';
const ARROW_D = "M10 10H110M22 2.5 10 10l12 7.5M98 2.5l12 7.5-12 7.5";
const ARROW_SVG =
  '<svg viewBox="0 0 120 20" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="' + ARROW_D + '" stroke="' + INK + '" stroke-width="7"/><path d="' + ARROW_D + '" stroke="#fff" stroke-width="3.4"/></svg>';

function buildCue(root) {
  const cue = div("mfx-fill mfx-ink-cue", root);
  cue.setAttribute("data-ink-cue", "");
  const pop = div("mfx-ink-cue-pop", div("mfx-ink-cue-s", cue));
  div("mfx-ink-cue-k", pop).textContent = "INK!";
  const plate = div("mfx-ink-cue-p", pop);
  plate.textContent = "WIPE IT!";
  div("mfx-ink-trail", plate).innerHTML = ARROW_SVG;
  div("mfx-ink-hand", plate).innerHTML = HAND_SVG;
  return cue;
}

const inkRuns = new WeakMap(); // host → the bomb on it (a new one replaces the old)

export function inkBomb(screenEl, opts) {
  const o = opts || {};
  return run({ coverage: () => 0 }, (fx) => {
    const host = hostOf(screenEl);
    const prev = inkRuns.get(host);
    if (prev && !prev.ended) prev.end({ superseded: true });
    inkRuns.set(host, fx);
    fx.on(() => {
      if (inkRuns.get(host) === fx) inkRuns.delete(host);
    });
    const seconds = clampN(o.seconds, 0.3, 30, 10); // the safety net: the ink stays until wiped, at most this long
    const rnd = rng(o.seed == null ? randSeed() : o.seed);
    const root = layer(fx, host, "mfx-ink", "ink");
    const { w: W, h: H } = sizeOf(root);
    const field = inkField(W, H, rnd, Math.round(clampN(o.splats, 1, 6, 3)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const cv = document.createElement("canvas");
    cv.className = "mfx-ink-cv";
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    root.appendChild(cv);
    const ctx = cv.getContext("2d");
    paintSplats(ctx, field.splats, W, H, dpr);
    const brush = makeBrush(field.R, dpr);
    const paint = (x, y) => {
      ctx.drawImage(brush, x - field.R, y - field.R, field.R * 2, field.R * 2);
      field.stamp(x, y);
    };

    // transparent blockers: they catch the touches (the canvas and the controller below get none)
    const grid = div("mfx-ink-grid", root);
    grid.style.gridTemplateColumns = "repeat(" + field.bx + ",1fr)";
    grid.style.gridTemplateRows = "repeat(" + field.by + ",1fr)";
    const cells = [];
    const open = new Uint8Array(field.cells);
    for (let c = 0; c < field.cells; c++) {
      const d = div("mfx-ink-cell", grid);
      d.setAttribute("data-ink-cell", String(c));
      if (field.cellAvg(c) < OPEN_BELOW) {
        open[c] = 1;
        d.style.pointerEvents = "none";
      }
      cells.push(d);
    }
    div("mfx-fill mfx-ink-flash", root);
    fx.anim(cv, [{ transform: "scale(.85)" }, { transform: "scale(1.05)", offset: 0.55 }, { transform: "scale(1)" }], { duration: 190, easing: "cubic-bezier(.2,.8,.3,1)" });

    const t0 = performance.now();
    let fading = false;
    let total = field.total();
    fx.handle.coverage = () => total;

    // Say what to do, on the ink, until a good part of it is gone (it replaces the old "INK!" toast: one text only).
    const cueAt = total * CUE_BELOW;
    let cue = o.hint === false ? null : buildCue(root);
    let idle = 0;
    fx.on(() => clearTimeout(idle));
    const dropCue = () => {
      if (!cue) return;
      const c = cue;
      cue = null;
      clearTimeout(idle);
      c.classList.add("mfx-ink-cue-out");
      fx.timeout(() => c.remove(), 260);
    };

    let dry = null; // the drying animation, once the safety fade has begun
    const fade = (wiped) => {
      if (fading) return;
      fading = true;
      const ms = Math.round(performance.now() - t0);
      root.classList.add("mfx-off"); // touches reach the controls again at once
      dropCue();
      const dried = !wiped && !!dry; // the timer ran out: the drying has already taken the ink away
      if (!dried) {
        const now = dry ? parseFloat(getComputedStyle(root).opacity) : 1; // wiped while drying: fade on from there
        fx.anim(root, [{ opacity: now >= 0 && now <= 1 ? now : 1 }, { opacity: 0 }], { duration: 380, easing: "ease-out", fill: "forwards" });
      }
      if (typeof o.onClear === "function") {
        try {
          o.onClear({ wiped, ms });
        } catch (e) {}
      }
      fx.timeout(() => fx.end({ wiped, ms }), dried ? 40 : 390);
    };
    // the safety net: nobody wiped it, so the ink dries out (slowly, still wipeable) and is gone at `seconds`
    const dryMs = Math.round(Math.min(DRY_MS, seconds * 300));
    fx.timeout(() => {
      if (fading) return;
      dropCue();
      dry = fx.anim(root, [{ opacity: 1 }, { opacity: 0 }], { duration: dryMs, easing: "cubic-bezier(.45,0,.75,1)", fill: "forwards" });
    }, seconds * 1000 - dryMs);
    fx.timeout(() => fade(false), seconds * 1000);

    // after every wipe event: open the cells that are clean enough, then check the total
    const settle = () => {
      for (let c = 0; c < field.cells; c++) {
        if (!open[c] && field.cellAvg(c) < OPEN_BELOW) {
          open[c] = 1;
          cells[c].style.pointerEvents = "none";
        }
      }
      total = field.total();
      if (cue && total < cueAt) dropCue();
      if (total < CLEAR_BELOW) fade(true);
    };

    const step = Math.max(1, field.R * BRUSH.space);
    const wipes = new Map(); // pointerId → { x, y, carry }: several fingers wipe at once
    const toLocal = (e, rect, p) => {
      p.x = ((e.clientX - rect.left) / (rect.width || W)) * W;
      p.y = ((e.clientY - rect.top) / (rect.height || H)) * H;
      return p;
    };
    let rect = root.getBoundingClientRect();
    const tmp = { x: 0, y: 0 };
    fx.listen(root, "pointerdown", (e) => {
      const t = e.target;
      if (fading || !t || !t.hasAttribute || !t.hasAttribute("data-ink-cell")) return;
      e.preventDefault();
      rect = root.getBoundingClientRect();
      toLocal(e, rect, tmp);
      wipes.set(e.pointerId, { x: tmp.x, y: tmp.y, carry: 0 });
      try {
        t.setPointerCapture(e.pointerId); // a mouse or pen keeps wiping across cells (touch is captured already)
      } catch (err) {}
      if (cue) {
        clearTimeout(idle); // wiping: the hand rests, the label shrinks
        cue.classList.add("mfx-ink-wiping");
      }
      paint(tmp.x, tmp.y);
      settle();
    });
    // move / up on window: they reach us even after the cell under the finger stopped blocking
    fx.listen(
      window,
      "pointermove",
      (e) => {
        const p = wipes.get(e.pointerId);
        if (!p || fading) return;
        toLocal(e, rect, tmp);
        inkWalk(p, tmp.x, tmp.y, step, paint);
        settle();
      },
      { passive: true }
    );
    const lift = (e) => {
      if (!wipes.delete(e.pointerId) || wipes.size || !cue) return;
      clearTimeout(idle); // the last finger left the ink: if nobody goes on wiping, show the swipe again
      idle = setTimeout(() => cue && cue.classList.remove("mfx-ink-wiping"), CUE_IDLE_MS);
    };
    fx.listen(window, "pointerup", lift);
    fx.listen(window, "pointercancel", lift);
  });
}

// ---------------------------------------------------------------- tractor beam

export function tractorHit(screenEl, opts) {
  const o = opts || {};
  return run({}, (fx) => {
    const host = hostOf(screenEl);
    const sec = clampN(o.seconds, 0.4, 10, 1.6);
    const dir = Number.isFinite(+o.dir) ? +o.dir : 0;
    const by = o.by == null ? "" : clip(o.by, 24);
    const rnd = rng(o.seed == null ? randSeed() : o.seed);
    const root = layer(fx, host, "mfx-tr", "tractor");
    if (by) root.setAttribute("data-by", by);
    root.style.setProperty("--s", sec + "s");
    const { w: W, h: H } = sizeOf(root);
    const c = Math.abs(Math.cos(dir));
    const s = Math.abs(Math.sin(dir));
    const e = Math.min(c < 1e-3 ? 1e9 : W / 2 / c, s < 1e-3 ? 1e9 : H / 2 / s); // centre → the edge the beam pulls toward
    const cross = s * W + c * H; // the screen's width across the beam
    const D = Math.ceil(Math.hypot(W, H) * 1.06);
    // a square stage turned so that its +x axis points where the beam pulls; everything inside is drawn "to the right"
    const stage = div("mfx-tr-stage", root);
    stage.style.cssText =
      "width:" + D + "px;height:" + D + "px;margin:" + -D / 2 + "px 0 0 " + -D / 2 + "px;transform:rotate(" + dir + "rad);--e:" + e.toFixed(1) + "px;--gw:" + Math.round(e * 1.15) + "px;--gh:" + Math.round(cross * 0.95) + "px";
    div("mfx-tr-tint", stage);
    div("mfx-tr-glow", stage);
    div("mfx-tr-flare", stage);
    for (let i = 0; i < 12; i++) {
      setVars(div("mfx-tr-s", stage), {
        "--y": ((rnd() - 0.5) * cross * 0.9).toFixed(0) + "px",
        "--w": (50 + rnd() * 110).toFixed(0) + "px",
        "--t": (1 + rnd() * 1.4).toFixed(1) + "px",
        "--d": (0.42 + rnd() * 0.36).toFixed(2) + "s",
        "--l": (-rnd() * 0.8).toFixed(2) + "s",
      });
    }
    for (let i = 0; i < 3; i++) {
      setVars(div("mfx-tr-r", stage), {
        "--rh": Math.round(cross * (0.5 + i * 0.08)) + "px",
        "--rw": Math.round(cross * 0.18) + "px",
        "--l": (-i * 0.29).toFixed(2) + "s",
      });
    }
    const t = toast("TRACTOR BEAM!", { sub: by ? "PULLED BY " + by : undefined, tone: "cyan", seconds: sec, screenEl: host });
    fx.on(() => t.cancel());
    fx.timeout(() => fx.end({ ok: true }), (sec + 0.3) * 1000);
  });
}

// ---------------------------------------------------------------- mine

// A little shake of shakeEl, using the individual `translate` property so its own transform survives.
function shake(fx, el) {
  const mags = [0, 9, -8, 7, -5, 4, -2, 0];
  const modern = !!(window.CSS && CSS.supports && CSS.supports("translate", "1px 1px"));
  const kf = mags.map((m, i) => {
    const y = ((i % 2 ? -m : m) * 0.45).toFixed(1);
    return modern ? { translate: m + "px " + y + "px" } : { transform: "translate(" + m + "px," + y + "px)" };
  });
  fx.anim(el, kf, { duration: 350, easing: "linear" });
}

export function mineHit(screenEl, opts) {
  const o = opts || {};
  return run({}, (fx) => {
    const host = hostOf(screenEl);
    const stun = clampN(o.stunSeconds, 0.2, 10, 1.5);
    const pts = Number.isFinite(+o.points) ? Math.round(+o.points) : -30;
    const by = o.by == null ? "" : clip(o.by, 24);
    const rnd = rng(o.seed == null ? randSeed() : o.seed);
    const root = layer(fx, host, "mfx-mine", "mine");
    const reduced = root.classList.contains("mfx-rm");
    if (by) root.setAttribute("data-by", by);
    root.style.setProperty("--s", stun + "s");
    const { w: W, h: H } = sizeOf(root);
    div("mfx-fill mfx-mine-dim", root);
    div("mfx-fill mfx-mine-vig", root);
    if (!reduced) div("mfx-fill mfx-mine-flash", root);

    // cracks run out from the middle of the screen; they spread, hold, fade
    const svg = svgEl("svg", "mfx-mine-cracks", root);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    const n = 8 + ((rnd() * 3) | 0);
    const reach = Math.hypot(W, H) * 0.62;
    for (let i = 0; i < n; i++) {
      const ang = ((i + (rnd() - 0.5) * 0.6) / n) * TAU;
      const len = reach * (0.6 + rnd() * 0.4);
      stroke2(svg, ray(rnd, W / 2, H / 2, ang, len, 30, 7));
      if (rnd() < 0.7) {
        const t = 0.35 + rnd() * 0.3;
        stroke2(svg, ray(rnd, W / 2 + Math.cos(ang) * len * t, H / 2 + Math.sin(ang) * len * t, ang + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len * 0.3, 22, 5));
      }
    }

    // TV static while stunned: a 64 x 36 noise canvas scaled up, refreshed ~12 times a second (no allocation per frame)
    if (!reduced) {
      try {
        const tv = document.createElement("canvas");
        tv.className = "mfx-mine-tv";
        tv.width = 64;
        tv.height = 36;
        const tctx = tv.getContext("2d");
        const img = tctx.createImageData(64, 36);
        const px = new Uint32Array(img.data.buffer);
        let x = (randSeed() | 1) || 1;
        const fill = () => {
          for (let i = 0; i < px.length; i++) {
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            const g = (x >>> 8) & 255;
            px[i] = 0xff000000 | (g << 16) | (g << 8) | g;
          }
          tctx.putImageData(img, 0, 0);
        };
        fill();
        root.appendChild(tv);
        let last = 0;
        fx.on(
          addTicker((t) => {
            if (t - last >= 83) {
              last = t;
              fill();
            }
          })
        );
      } catch (e) {} // no canvas: the rest of the effect still plays
      div("mfx-mine-roll", root);
      if (o.shakeEl && o.shakeEl.nodeType === 1) shake(fx, o.shakeEl);
    }

    const t = toast("MINE!", { sub: (pts > 0 ? "+" : pts < 0 ? "−" : "") + Math.abs(pts) + " POINTS · STUNNED", tone: "red", seconds: stun, screenEl: host });
    fx.on(() => t.cancel());
    fx.anim(root, [{ opacity: 1 }, { opacity: 1, offset: stun / (stun + 0.25) }, { opacity: 0 }], { duration: (stun + 0.25) * 1000, easing: "linear", fill: "forwards" });
    fx.timeout(() => fx.end({ ok: true }), (stun + 0.28) * 1000);
  });
}

// ---------------------------------------------------------------- decoy

const DECOY_SECONDS = 1.7;

export function decoyFooled(screenEl, opts) {
  const o = opts || {};
  return run({}, (fx) => {
    const host = hostOf(screenEl);
    const mine = !!o.mine;
    const by = o.by == null ? "" : clip(o.by, 24);
    const victim = o.victim == null ? "" : clip(o.victim, 24);
    const root = layer(fx, host, "mfx-dc" + (mine ? " mfx-dc-mine" : ""), "decoy");
    if (by) root.setAttribute("data-by", by);
    div("mfx-fill mfx-dc-tint", root);
    div("mfx-fill mfx-dc-scan", root);
    div("mfx-dc-sweep", root);
    const stamp = div("mfx-dc-stamp", root);
    stamp.textContent = "DECOY!";
    const t = mine
      ? toast("YOUR DECOY WORKED!", { sub: victim ? victim + " SHOT IT" : undefined, tone: "cyan", seconds: DECOY_SECONDS, screenEl: host })
      : toast("THAT WAS A DECOY!", { sub: by ? by + " FOOLED YOU" : undefined, tone: "violet", seconds: DECOY_SECONDS, screenEl: host });
    fx.on(() => t.cancel());
    fx.timeout(() => fx.end({ ok: true }), (DECOY_SECONDS + 0.3) * 1000);
  });
}

// ---------------------------------------------------------------- toast

const TONES = ["cyan", "red", "violet", "gold"];
const MAX_TOASTS = 3;
const stacks = new WeakMap(); // host → { el, list } (list: newest first)

function stackOf(host) {
  let st = stacks.get(host);
  if (st && st.el.parentNode === host) return st;
  const el = div("mfx-toasts" + (host === document.body ? " mfx-fixed" : ""));
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  host.appendChild(el);
  st = { el, list: [] };
  stacks.set(host, st);
  return st;
}

const layoutStack = (st) => st.list.forEach((it, i) => it.wrap.style.setProperty("--i", String(i)));

// slide one toast out (it leaves the stack at once so the others close the gap), then remove it
function leave(st, item, ms, reduced) {
  if (item.leaving) return;
  item.leaving = true;
  const i = st.list.indexOf(item);
  if (i >= 0) st.list.splice(i, 1);
  layoutStack(st);
  item.fx.anim(item.pill, reduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-8px) scale(.96)" }], { duration: ms, easing: "ease-in", fill: "forwards" });
  item.fx.timeout(() => item.fx.end({ ok: true }), ms + 20);
}

export function toast(text, opts) {
  const o = opts || {};
  return run({}, (fx) => {
    const host = hostOf(o.screenEl);
    const reduced = reducedMotion();
    const tone = TONES.indexOf(o.tone) >= 0 ? o.tone : "cyan";
    const sec = clampN(o.seconds, 0.5, 30, 2.2);
    holdPosition(fx, host);
    const st = stackOf(host);
    const wrap = div("mfx-t");
    wrap.setAttribute("data-mfx", "toast");
    const pill = div("mfx-tp mfx-tone-" + tone, wrap);
    div("mfx-tt", pill).textContent = clip(text, 60);
    if (o.sub) div("mfx-ts", pill).textContent = clip(o.sub, 60);
    const item = { wrap, pill, fx, leaving: false };
    st.el.appendChild(wrap);
    st.list.unshift(item);
    layoutStack(st);
    fx.on(() => {
      const i = st.list.indexOf(item);
      if (i >= 0) {
        st.list.splice(i, 1);
        layoutStack(st);
      }
      wrap.remove();
      if (!st.el.firstChild) {
        st.el.remove();
        if (stacks.get(host) === st) stacks.delete(host);
      }
    });
    fx.anim(pill, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateY(-14px) scale(.94)" }, { opacity: 1, transform: "translateY(0) scale(1)" }], { duration: 240, easing: "cubic-bezier(.2,.9,.3,1.15)" });
    while (st.list.length > MAX_TOASTS) leave(st, st.list[st.list.length - 1], 140, reduced); // the oldest makes room
    fx.timeout(() => leave(st, item, 240, reduced), sec * 1000);
  });
}

// ---------------------------------------------------------------- hit marker

// Damage direction. One fixed full-screen layer per host, made on the first hit and kept for the next ones (empty it
// paints nothing; it has no data-mfx, so tests that count effects never see it): an orbit box (the safe area, 8 % in)
// that holds up to MAX_HITS crescents, plus at most one edge vignette for a hit from an unknown direction. Each
// crescent or vignette is an effect of its own. A new hit close to a live one restarts it instead: swapping between
// two identical keyframe names restarts a CSS animation without a reflow.
const MAX_HITS = 4;
const HIT_SAME = (25 * Math.PI) / 180;
const hitLayers = new WeakMap(); // host → { el, orbit, list (crescents, least recently hit first), vig }
let hitUid = 0; // every crescent's SVG carries its own gradient id

const angDiff = (a, b) => Math.abs(((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI);

// Where the ray from the centre at compass angle a (0 = up, clockwise) meets an ellipse whose radii ratio is
// q = rx / ry, in units of the radii (u, v in -1..1, v down): the crescent sits right where the attacker is.
function hitSpot(a, q) {
  const s = Math.sin(a);
  const c = Math.cos(a);
  const n = Math.sqrt(s * s + c * c * q * q) || 1;
  return { u: s / n, v: (-c * q) / n };
}

function hitLayerOf(host) {
  let L = hitLayers.get(host);
  if (L && L.el.parentNode === host) return L;
  const el = div("mfx mfx-fixed mfx-hl");
  el.setAttribute("aria-hidden", "true");
  L = { el, orbit: div("mfx-hm-o", el), list: [], vig: null };
  host.appendChild(el);
  hitLayers.set(host, L);
  return L;
}

// The orbit's radii ratio (its box honours the safe areas); the window's while the host is not laid out.
function orbitRatio(L) {
  const w = L.orbit.clientWidth || window.innerWidth || 844;
  const h = L.orbit.clientHeight || window.innerHeight || 390;
  return w / h;
}

// Drawn pointing up (outward): a crescent 84 px across and 16 px thick in the middle, light toward the attacker, a
// dark outline under the fill (paint-order) and a gloss line along the outer edge. "@" is the gradient id.
const CRESCENT =
  '<svg class="mfx-hm-c" viewBox="-48 -20 96 32"><defs><linearGradient id="@" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8095"/><stop offset="1" stop-color="#ff3b5c"/></linearGradient></defs>' +
  '<path d="M-42 8A54.1 54.1 0 0 1 42 8A222.5 222.5 0 0 0-42 8Z" fill="url(#@)" stroke="' + INK + '" stroke-width="6" stroke-linejoin="round" paint-order="stroke"/>' +
  '<path d="M-30 2A50.1 50.1 0 0 1 30 2" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"/></svg>';

export function hitMarker(screenEl, opts) {
  const o = opts || {};
  const raw = o.angle == null || o.angle === "" ? NaN : +o.angle;
  const ang = Number.isFinite(raw) ? Math.atan2(Math.sin(raw), Math.cos(raw)) : null; // -PI..PI, or null: unknown
  const k = clampN(o.strength, 0, 1, 1);
  const sec = clampN(o.seconds, 0.2, 10, 0.9);
  try {
    if (typeof document !== "undefined" && document.body) {
      const host = hostOf(screenEl);
      const L = hitLayers.get(host);
      let near = null;
      if (L && L.el.parentNode === host) {
        if (ang == null) near = L.vig;
        else {
          let best = HIT_SAME;
          for (const m of L.list) {
            const d = angDiff(m.ang, ang);
            if (d <= best) {
              best = d;
              near = m;
            }
          }
        }
      }
      if (near && !near.fx.ended) {
        near.again(ang, k, sec);
        return near.fx.handle;
      }
    }
  } catch (e) {}
  return run({ el: null }, (fx) => buildHit(fx, hostOf(screenEl), ang, k, sec));
}

function buildHit(fx, host, ang, k, sec) {
  const L = hitLayerOf(host);
  L.el.classList.toggle("mfx-rm", reducedMotion());
  const q = ang == null ? 1 : orbitRatio(L); // the one layout read, before anything new is added
  const root = div("mfx-hm" + (ang == null ? " mfx-hm-vg" : ""));
  root.setAttribute("data-mfx", "hit");
  const fade = div("mfx-hm-f", root);
  if (ang == null) div("mfx-fill mfx-hm-v", fade);
  else {
    const pop = div("mfx-hm-p", fade);
    div("mfx-hm-g", pop);
    pop.insertAdjacentHTML("beforeend", CRESCENT.replace(/@/g, "mfx-hmg" + ++hitUid));
  }
  const m = { fx, ang, k: 0, n: 0, at: performance.now(), timer: 0 };
  const set = (a, s, secs, ratio) => {
    m.ang = a;
    m.k = s;
    const st = root.style;
    st.setProperty("--s", secs + "s");
    st.opacity = (0.55 + 0.45 * s).toFixed(3);
    if (a == null) return;
    const p = hitSpot(a, ratio);
    st.left = (50 + 50 * p.u).toFixed(2) + "%";
    st.top = (50 + 50 * p.v).toFixed(2) + "%";
    st.transform = "rotate(" + a.toFixed(4) + "rad) scale(" + (0.75 + 0.25 * s).toFixed(3) + ")";
  };
  const arm = (secs) => {
    clearTimeout(m.timer);
    m.timer = setTimeout(() => fx.end({ ok: true }), secs * 1000 + 40);
  };
  fx.on(() => clearTimeout(m.timer));
  // another hit close by: its angle, the stronger of the two strengths, a bump instead of the pop, the fade anew
  m.again = (a, s, secs) => {
    L.el.classList.toggle("mfx-rm", reducedMotion());
    set(a, Math.max(m.k, s), secs, a == null ? 1 : orbitRatio(L));
    const now = performance.now();
    if (now - m.at > 20) {
      // one swap per frame or so: two in the same style pass would cancel out and restart nothing
      m.at = now;
      m.n++;
      root.classList.remove(m.n % 2 ? "mfx-hm-r2" : "mfx-hm-r1");
      root.classList.add(m.n % 2 ? "mfx-hm-r1" : "mfx-hm-r2");
    }
    arm(secs);
    const i = L.list.indexOf(m);
    if (i >= 0) {
      L.list.splice(i, 1);
      L.list.push(m);
    }
  };
  set(ang, k, sec, q);
  if (ang == null) {
    if (L.vig && !L.vig.fx.ended) L.vig.fx.end({ superseded: true });
    L.vig = m;
    fx.on(() => {
      if (L.vig === m) L.vig = null;
    });
    fx.add(root, L.el);
  } else {
    while (L.list.length >= MAX_HITS) L.list.shift().fx.end({ superseded: true }); // the least recently hit makes room
    L.list.push(m);
    fx.on(() => {
      const i = L.list.indexOf(m);
      if (i >= 0) L.list.splice(i, 1);
    });
    fx.add(root, L.orbit);
  }
  arm(sec);
  fx.handle.el = root;
}

// ---------------------------------------------------------------- spawn shield

const shields = new WeakMap(); // host → the shield on it

export function shieldAura(screenEl, opts) {
  const o = opts || {};
  const on = o.on === undefined ? true : !!o.on;
  let st = null;
  try {
    if (typeof document !== "undefined" && document.body) {
      const host = hostOf(screenEl);
      st = shields.get(host) || null;
      if (st && (st.fx.ended || st.root.parentNode !== host)) {
        st.fx.end({ gone: true }); // someone emptied the host: start over
        st = null;
      }
    }
  } catch (e) {
    st = null;
  }
  if (st) {
    try {
      if (on) st.show(o.label);
      else st.hide();
    } catch (e) {}
    return st.fx.handle;
  }
  if (!on) return { done: Promise.resolve({ off: true }), cancel() {}, el: null };
  return run({ el: null }, (fx) => buildShield(fx, hostOf(screenEl), o.label));
}

function buildShield(fx, host, label) {
  const root = div("mfx mfx-fixed mfx-sh" + (reducedMotion() ? " mfx-rm" : ""));
  root.setAttribute("data-mfx", "shield");
  root.setAttribute("aria-hidden", "true");
  div("mfx-fill mfx-sh-hex", root);
  div("mfx-fill mfx-sh-frame", root);
  const st = { fx, root, chip: null, text: "", leaving: false, timer: 0 };
  st.setLabel = (v) => {
    const t = clip(v, 32).trim();
    if (t === st.text) return;
    st.text = t;
    if (!t) {
      if (st.chip) st.chip.remove();
      st.chip = null;
    } else (st.chip || (st.chip = div("mfx-sh-chip", root))).textContent = t;
  };
  st.show = (v) => {
    if (st.leaving) {
      // back on while fading out: straight to full again, no second fade-in
      st.leaving = false;
      clearTimeout(st.timer);
      root.classList.remove("mfx-out");
      root.classList.add("mfx-back");
    }
    if (v !== undefined) st.setLabel(v);
  };
  st.hide = () => {
    if (st.leaving) return;
    st.leaving = true;
    root.classList.remove("mfx-back");
    root.classList.add("mfx-out");
    st.timer = setTimeout(() => fx.end({ off: true }), 320);
  };
  fx.on(() => clearTimeout(st.timer));
  st.setLabel(label);
  fx.add(root, host);
  shields.set(host, st);
  fx.on(() => {
    if (shields.get(host) === st) shields.delete(host);
  });
  fx.handle.el = root;
}

// for tests and tuning; not part of the API
export const __test = { inkField, inkWalk, makeSplats, BRUSH, GRID, OPEN_BELOW, CLEAR_BELOW, CUE_BELOW, DRY_MS, rng, hitSpot, angDiff, MAX_HITS, HIT_SAME };
