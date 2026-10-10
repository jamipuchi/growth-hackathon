// Offline tests for astra-html.js: the Fortnite template and style gate, the validator (hostile and benign fixtures),
// and generateControllerHtml with a fake fetch (request shape, fallback on every failure, style gate, tier retry,
// blank key, pinned model, cache, dedupe, abort, mock mode). No network, and the real key is never read
// (OPENAI_API_KEY is set to a dummy first; the .env rule is tested on a temp copy with a fake .env).
//   node dev/v12-modules/test-astra-html.js
process.env.OPENAI_API_KEY = "sk-test-dummy";
delete process.env.ASTRA_MOCK;
delete process.env.ASTRA_HTML_CALL_LOG;
delete process.env.OPENAI_MODEL;
delete process.env.OPENAI_SERVICE_TIER;
delete process.env.ASTRA_HTML_EFFORT;
const fs = require("fs");
const os = require("os");
const path = require("path");
const A = require("../../astra-html.js");
const { _internals: I } = A;

const results = [];
const check = (name, ok, data) => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${data !== undefined ? " " + JSON.stringify(data) : ""}`); };
const HERE = __dirname;
const ROOT = path.join(HERE, "../..");
const corpus = fs.existsSync(path.join(HERE, "corpus/corpus.json")) ? JSON.parse(fs.readFileSync(path.join(HERE, "corpus/corpus.json"), "utf8")) : [];
const BASIC = { buttons: [
  { type: "stick", action: "steer", label: "", x: 0.04, y: 0.35, w: 0.3, h: 0.55 },
  { type: "button", action: "shoot", label: "FIRE", x: 0.74, y: 0.5, w: 0.22, h: 0.36 },
  { type: "button", action: "boost", label: "BOOST", x: 0.5, y: 0.6, w: 0.2, h: 0.3 },
] };
// The same three controls somewhere else: another drawing as far as the cache is concerned.
const BASIC2 = { buttons: BASIC.buttons.map((b) => ({ ...b, x: b.x * 0.9 })) };
const ALLOWED = ["steer", "shoot", "boost"];
const IMAGE = "data:image/png;base64,iVBORw0KGgo=";
const STACK = '"Futura-CondensedExtraBold","Futura Condensed ExtraBold","AvenirNextCondensed-Heavy","Avenir Next Condensed","Arial Narrow",Impact,sans-serif';

// A benign Sol-style document in the Fortnite look (slanted tiles with thick white borders, rarity gradients, hard
// drop shadows, heavy condensed italic capitals with a dark outline, pop-in) that still exercises the validator's
// edge cases: SVG namespace URL, url(#id) fills, a .top class, a cosmetic script touching rect.top, a data: background.
const GOOD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{color-scheme:dark;font-family:${STACK}}.top.left{opacity:.9}
.btn{position:absolute;left:84vw;top:65vh;width:max(64px,20vw);height:max(64px,34vh);margin:-17vh 0 0 -10vw;box-sizing:border-box;border:3px solid #fff;border-radius:10px;transform:skewX(-9deg);background:linear-gradient(#ffe36e,#ffb21f 52%,#d26a06);box-shadow:0 5px 0 #0b1033,inset 0 3px 0 #ffffff80;opacity:.92;animation:pop .45s cubic-bezier(.2,1.5,.4,1) both}
.btn.is-down{translate:0 4px;scale:.95;filter:brightness(1.2)}.btn.is-on{background:linear-gradient(#ffe36e,#ffb21f 52%,#d26a06)}
.face{display:flex;align-items:center;justify-content:center;gap:6px;height:100%;transform:skewX(9deg)}
.label{font-style:italic;font-weight:900;font-size:clamp(16px,3vw,26px);letter-spacing:.04em;color:#fff;text-shadow:-1.5px 0 #0b1033,1.5px 0 #0b1033,0 -1.5px #0b1033,0 1.5px #0b1033,0 3px 2px #0b1033}
.stick{position:absolute;left:18vw;top:60vh;width:200px;height:200px;margin:-100px 0 0 -100px;border:4px solid #fff;border-radius:50%;background:radial-gradient(circle,#284b797d,#111b3eb5 72%);box-shadow:0 5px 0 #0b1033}
.knob{position:absolute;left:30%;top:30%;width:40%;height:40%;border:3px solid #fff;border-radius:50%;background:linear-gradient(#86dcff,#2f8bff 55%,#1647c8);box-shadow:0 5px 0 #0b1033}
@keyframes pop{0%{opacity:0;scale:.35}75%{opacity:.92;scale:1.07}100%{opacity:.92;scale:1}}
</style></head><body>
<div class="stick top left" data-stick="steer"><div class="knob" data-knob></div></div>
<div class="btn" data-action="shoot" data-label="FIRE"><div class="face"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><circle cx="12" cy="12" r="6" fill="url(#g)" stroke="#fff" stroke-width="3"/><use href="#g"/></svg><span class="label">FIRE</span></div></div>
<div class="btn" data-action="boost" data-label="BOOST" style="left:57vw;background:url(data:image/png;base64,AAAA)"><div class="face"><span class="label">BOOST</span></div></div>
<script>const r = document.querySelector(".btn").getBoundingClientRect(); document.querySelector(".btn").style.top = (r.top + 0) + "px"; const parentEl = document.body.parentElement;</script>
</body></html>`;

// What the old thin-line HUD direction looked like: 1-1.5 px neon cyan outlines, glow, light mono type, see-through.
const SCIFI = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--c:#5ee7ff;font-family:"SF Mono",Menlo,monospace;color:var(--c)}
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.hud{position:absolute;box-sizing:border-box;border:1px solid var(--c);background:rgba(94,231,255,.05);box-shadow:0 0 12px rgba(94,231,255,.45),inset 0 0 8px rgba(94,231,255,.2);display:flex;align-items:center;justify-content:center}
.hud.is-down{background:rgba(94,231,255,.28)}
.tag{font-weight:300;font-size:11px;letter-spacing:.3em;text-transform:uppercase;text-shadow:0 0 6px var(--c)}
.ring{position:absolute;left:4vw;top:35vh;width:200px;height:200px;border:1.5px solid var(--c);border-radius:50%;box-shadow:0 0 14px rgba(94,231,255,.4)}
.dot{position:absolute;left:30%;top:30%;width:40%;height:40%;border:1px solid var(--c);border-radius:50%;background:rgba(94,231,255,.15)}
</style></head><body>
<div class="ring" data-stick="steer"><div class="dot" data-knob></div></div>
<div class="hud" data-action="shoot" data-label="FIRE" style="left:74vw;top:50vh;width:22vw;height:36vh"><span class="tag">FIRE</span></div>
<div class="hud" data-action="boost" data-label="BOOST" style="left:50vw;top:60vh;width:20vw;height:30vh"><span class="tag">BOOST</span></div>
</body></html>`;
// The hard case: bold italic condensed type, a dark text outline, blue and gold, a slant, and still hairline outlines
// on see-through panels. It misses only the 3 px border and the thin-line check, so it is refused by the "thin line
// plus any other miss" rule, not by the count.
const SCIFI_BOLD = SCIFI
  .replace(':root{--c:#5ee7ff;font-family:"SF Mono",Menlo,monospace;color:var(--c)}', ":root{--c:#2f8bff;font-family:Impact,'Arial Narrow',sans-serif;color:#fff}")
  .replace("border:1px solid var(--c);background:rgba(94,231,255,.05);box-shadow:0 0 12px rgba(94,231,255,.45),inset 0 0 8px rgba(94,231,255,.2);", "border:1.5px solid var(--c);background:rgba(47,139,255,.08);transform:skewX(-9deg);box-shadow:0 0 10px rgba(255,178,31,.4);")
  .replace(".tag{font-weight:300;font-size:11px;letter-spacing:.3em;text-transform:uppercase;text-shadow:0 0 6px var(--c)}", ".tag{font-style:italic;font-weight:900;font-size:20px;color:#fff;text-shadow:0 2px 0 #0b1033}")
  .replace("border:1.5px solid var(--c);border-radius:50%;box-shadow:0 0 14px rgba(94,231,255,.4)", "border:2px solid var(--c);border-radius:50%");

const bad = (snippet, where = "script") => where === "script"
  ? GOOD.replace("</body>", `<script>${snippet}</script></body>`)
  : GOOD.replace("</body>", `${snippet}</body>`);
const HOSTILE = [
  ["<script src>", bad('<script src="https://evil.example/x.js"></script>', "markup"), "<script src>"],
  ["fetch", bad("fetch('/x')"), "fetch"],
  ["fetch by reference", bad("const f = fetch; f('/x')"), "fetch"],
  ["Reflect", bad("Reflect.get(window, 'x')"), "Reflect"],
  ["defaultView", bad("document.defaultView.parent.postMessage({}, '*')"), "defaultView"],
  ["svg script", bad('<svg><script>fetch("/x")</script></svg>', "markup"), "fetch"],
  ["img onerror", bad('<img src="data:image/png;base64,AA" onerror="x()">', "markup"), "inline event handler"],
  ["svg image href", bad('<svg><image href="//evil.example/p.png"/></svg>', "markup"), 'href="//evil'],
  ["base tag", bad('<base href="https://evil.example/">', "markup"), "<base>"],
  ["XMLHttpRequest", bad("new XMLHttpRequest()"), "XMLHttpRequest"],
  ["WebSocket", bad("new WebSocket('ws://x')"), "WebSocket"],
  ["import()", bad("import('./x.js')"), "import()"],
  ["localStorage", bad("localStorage.x = 1"), "localStorage"],
  ["document.cookie", bad("document.cookie = 'a=b'"), "cookie"],
  ["top.", bad("top.location = '#'"), "top."],
  ["parent.", bad("parent.postMessage({}, '*')"), "parent."],
  ["window.parent", bad("window.parent.x = 1"), "window escape"],
  ["eval", bad("eval('1')"), "eval"],
  ["location", bad("location.href = 'https://x'"), "location"],
  ["sendBeacon", bad("navigator.sendBeacon('/x')"), "navigator"],
  ["dynamic global", bad("window['fe' + 'tch']('/x')"), "dynamic global"],
  ["fromCharCode", bad("String.fromCharCode(102)"), "obfuscation"],
  ["input handler", bad("document.body.addEventListener('pointerdown', () => {})"), "input handler"],
  ["script creates controls", bad("document.body.insertAdjacentHTML('beforeend', '<div data-action=\"nuke\"></div>')"), "script creates controls"],
  ["game.press dynamic", bad("const a = 'shoot'; game.press(a)"), "computed action"],
  ["game.press nuke", bad("game.press('nuke')"), "not allowed"],
  ["onclick attribute", GOOD.replace('data-label="FIRE"', 'data-label="FIRE" onclick="x()"'), "inline event handler"],
  ["<iframe>", bad('<iframe src="about:blank"></iframe>', "markup"), "<iframe>"],
  ["<link>", bad('<link rel="stylesheet" href="https://x/y.css">', "markup"), "<link>"],
  ["<form>", bad('<form><input name="a"></form>', "markup"), "<form>"],
  ["meta refresh", GOOD.replace("<meta charset", '<meta http-equiv="refresh" content="0;url=https://x"><meta charset'), "http-equiv"],
  ["img http", bad('<img src="https://evil.example/p.png">', "markup"), 'src="https'],
  ["css url", GOOD.replace(".top.left{opacity:.9}", ".top.left{background:url(https://evil.example/b.png)}"), "css url"],
  ["css @import", GOOD.replace(":root{", "@import 'x.css';:root{"), "@import"],
  ["javascript: url", bad('<a href="javascript:alert(1)">x</a>', "markup"), "script URL"],
  ["network URL text", bad("<p>see http://evil.example</p>", "markup"), "network URL"],
  ["unknown action", GOOD.replace('data-action="boost"', 'data-action="nuke"'), "not allowed"],
  ["stick as data-action", GOOD.replace('data-stick="steer"', 'data-action="steer"'), "must be a data-stick"],
  ["missing control", GOOD.replace('data-action="boost" data-label="BOOST"', 'data-label="BOOST"'), "missing control: boost"],
  ["unclosed script", GOOD.replace("</body>", "<script>let a = 1;</body>"), "unclosed <script>"],
  ["too large", GOOD.replace("</body>", `<!-- pad --><p>${"x".repeat(61 * 1024)}</p></body>`), "too large"],
];

async function main() {
  // ---- Template ----
  const layouts = [BASIC, ...corpus.map((d) => d.layout)];
  let allOk = true, maxBytes = 0, fullMarks = true;
  const notFull = [];
  for (const layout of layouts) {
    const html = A.templateHtml(layout);
    const v = A.validateHtml(html, { layout });
    allOk = allOk && v.ok && html === A.templateHtml(layout) && v.controls.length === layout.buttons.length;
    maxBytes = Math.max(maxBytes, v.bytes);
    if (v.style.score !== v.style.of || v.style.missing.length) { fullMarks = false; notFull.push(v.style.missing); }
    if (!v.ok) console.log("  template errors:", v.errors);
  }
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) A.templateHtml(layouts[i % layouts.length]);
  const avgMs = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  check("template: valid, deterministic, one control per drawn control, for every corpus layout", allOk, { layouts: layouts.length, maxBytes, avgMs: +avgMs.toFixed(3) });
  check("template: full Fortnite style marks (7/7) for every corpus layout", fullMarks, { layouts: layouts.length, notFull });
  const sub = A.templateHtml(BASIC, { allowedActions: ["steer", "shoot"] });
  check("template: controls whose action is not allowed are left out", !/data-action="boost"/.test(sub) && /data-action="shoot"/.test(sub));
  check("template: accent colour applied, bad colours ignored", /--k:#ff00aa/.test(A.templateHtml(BASIC, { style: { accent: "#FF00AA" } })) && /--k:#2f8bff/.test(A.templateHtml(BASIC, { style: { accent: "red;}</style><script>" } })));
  const pink = A.validateHtml(A.templateHtml(BASIC, { style: { accent: "#ff00aa" } }), { layout: BASIC });
  check("template: still full style marks with another knob colour", pink.ok && pink.style.score === pink.style.of, pink.style);
  const tpl = A.templateHtml(BASIC);
  check("template: italic heavy labels, tile skew cancelled on the contents (no doubled slant), 64 px visual minimum", /\.lab\{[^}]*font-style:italic/.test(tpl) && /\.btn>\.lab,[^{]*\{transform:skewX\(9deg\)\}/.test(tpl) && /\.btn\{transform:skewX\(-9deg\)/.test(tpl) &&
    /width:max\(64px,/.test(tpl) && !/max\(56px/.test(tpl) && I.MIN_TOUCH_PX === 56 && I.MIN_VISUAL_PX === 64);
  check("template: mischief powers are purple, mines gold (rarity map)", ["emp", "inkbomb", "tractor", "decoy"].every((a) => I.tierOf(a) === "purple") && I.tierOf("mine") === "gold" && I.tierOf("shoot") === "gold" && I.tierOf("boost") === "blue");

  // ---- Prompt ----
  const P = I.INSTRUCTIONS;
  check("prompt: asks for Fortnite, slanted tiles, 3-4 px white borders, heavy condensed ITALIC capitals with a dark outline, rarity colours", /FORTNITE/.test(P) && /skewX\(-9deg\)/.test(P) && /3-4 px WHITE border/.test(P) && /ITALIC/.test(P) && /font-style: italic/.test(P) &&
    /font-weight: 900/.test(P) && /#0b1033 outline/.test(P) && /#ffb21f/.test(P) && /#9d4dff/.test(P) && /#2f8bff/.test(P) && /Futura-CondensedExtraBold/.test(P) && /pops in/.test(P) && /64 x 64/.test(P));
  check("prompt: forbids thin sci-fi lines (under 3 px, neon outlines, wireframe/HUD, glow-only, hairlines)", /NOT thin sci-fi lines/.test(P) && /under 3 px/.test(P) && /neon/.test(P) && /wireframe/.test(P) && /glow-only/.test(P) && /hairline/.test(P) && !/clean sci-fi/i.test(P));
  check("prompt: every safety and markup rule is still there", /TRANSPARENT/.test(P) && /vw \/ vh/.test(P) && /no <script src>/.test(P) && /Never mention parent, top, opener, postMessage, fetch/.test(P) && /data-action=/.test(P) && /data-toggle/.test(P) &&
    /data-knob/.test(P) && /never with translate/.test(P) && /EXACTLY the action ids/.test(P) && /clamp\(\)/.test(P) && /under 10 KB/.test(P) && /backdrop-filter/.test(P) && /110 px/.test(P) && /Do NOT write pointer, touch, mouse, click or key handlers/.test(P), { chars: P.length });

  // ---- Validator ----
  const good = A.validateHtml(GOOD, { allowedActions: ALLOWED, layout: BASIC });
  check("validator: benign Sol-style Fortnite document accepted (svg namespace, url(#id), .top class, rect.top, data: background)", good.ok, good.errors);
  check("style gate: the benign Fortnite document scores 7/7", good.style.score === 7 && good.style.of === 7 && !good.style.missing.length && good.style.italic, good.style);
  let hostileOk = 0;
  for (const [name, html, expect] of HOSTILE) {
    const v = A.validateHtml(html, { allowedActions: ALLOWED, layout: BASIC });
    const hit = !v.ok && v.errors.some((e) => e.includes(expect));
    if (hit) hostileOk++;
    else console.log(`  MISSED ${name}: ok=${v.ok} errors=${JSON.stringify(v.errors)}`);
  }
  check(`validator: ${HOSTILE.length} hostile fixtures rejected with the right reason`, hostileOk === HOSTILE.length, { rejected: hostileOk, of: HOSTILE.length });

  // Recorded real Sol answers: the old ones (corpus/out, recorded with the previous prompt) and the Fortnite ones
  // (dev/astra/sol-html/out, recorded with the current prompt): validator accepts them all, the style gate refuses none.
  for (const [label, dir] of [["corpus/out", path.join(HERE, "corpus/out")], ["sol-html/out", path.join(ROOT, "dev/astra/sol-html/out")]]) {
    const accepted = [], rejected = [], gated = [];
    let italics = 0, full = 0;
    for (const d of corpus) {
      const file = path.join(dir, `${d.name}.html`);
      if (!fs.existsSync(file)) continue;
      const v = A.validateHtml(fs.readFileSync(file, "utf8"), { layout: d.layout });
      (v.ok ? accepted : rejected).push(v.ok ? d.name : `${d.name}: ${v.errors.join("; ")}`);
      if (I.styleRejects(v.style)) gated.push(`${d.name}: ${v.style.missing.join(", ")}`);
      if (v.style.italic) italics++;
      if (v.style.score === v.style.of) full++;
    }
    if (!accepted.length && !rejected.length) continue;
    check(`validator: every real Sol answer in ${label} accepted (no false positives)`, !rejected.length, { accepted: accepted.length, rejected });
    check(`style gate: no real Sol answer in ${label} is refused (calibration)`, !gated.length, { checked: accepted.length, fullMarks: full, italicLabels: italics, refused: gated });
  }

  // ---- Style gate ----
  const hud = A.validateHtml(SCIFI, { allowedActions: ALLOWED, layout: BASIC });
  check("style gate: the thin-line sci-fi HUD is a valid document (ok untouched) but scores 0/7 and is refused", hud.ok && hud.style.score === 0 && hud.style.missing.includes("thin lines") && I.styleRejects(hud.style), hud.style);
  const hard = A.validateHtml(SCIFI_BOLD, { allowedActions: ALLOWED, layout: BASIC });
  check("style gate: bold italic condensed type on hairline outlines misses only 3px borders + thin lines, and is refused (thin plus another)", hard.ok && hard.style.score === 5 && hard.style.missing.join("|") === "no 3px border|thin lines" && I.styleRejects(hard.style), hard.style);
  const patch = (fn) => A.validateHtml(fn(GOOD), { allowedActions: ALLOWED, layout: BASIC });
  const noFont = patch((h) => h.replace(STACK, "system-ui,sans-serif")), noOutline = patch((h) => h.replace(/text-shadow:[^;}]*/, "")), noWeight = patch((h) => h.replace("font-weight:900", "font-weight:400"));
  const noItalic = patch((h) => h.replace("font-style:italic;", ""));
  check("style gate: one or two mild misses are not refused (warnings only); three are refused", !I.styleRejects(noFont.style) && noFont.style.missing.join() === "no condensed font" &&
    !I.styleRejects(patch((h) => h.replace(STACK, "system-ui,sans-serif").replace(/text-shadow:[^;}]*/, "")).style) && I.styleRejects(patch((h) => h.replace(STACK, "system-ui,sans-serif").replace(/text-shadow:[^;}]*/, "").replace("font-weight:900", "font-weight:400")).style) &&
    noOutline.style.missing.join() === "no dark text outline" && noWeight.style.missing.join() === "no heavy weight" && noItalic.style.score === 7 && noItalic.style.italic === false, { noFont: noFont.style.missing, noOutline: noOutline.style.missing, noWeight: noWeight.style.missing, noItalic: noItalic.style });
  const css = (decl) => I.styleGate(`.x{${decl}}`);
  const cases = [
    ["border 3px chunky", css("border:3px solid #fff").missing.includes("no 3px border") === false],
    ["border 2px is thin", css("border:2px solid #fff").missing.includes("thin lines")],
    ["border keyword thick", !css("border:thick solid #fff").missing.includes("no 3px border")],
    ["border via var()", !I.styleGate(":root{--bw:4px}.x{border:var(--bw) solid #fff}").missing.includes("no 3px border")],
    ["box-shadow ring counts as a border", !css("box-shadow:0 0 0 4px #fff").missing.includes("no 3px border")],
    ["no borders and no strokes is not thin", !css("background:#fff").missing.includes("thin lines")],
    ["thin svg strokes without fills are thin", I.styleGate(".x{color:#fff}", '<svg><rect stroke="#5ee7ff" stroke-width="1" fill="none"/></svg>').missing.includes("thin lines")],
    ["thin svg icon strokes on gradient tiles are not", !I.styleGate(".x{background:linear-gradient(#ffe36e,#d26a06)}", '<path stroke-width="2"/>').missing.includes("thin lines")],
    ["skewX(-9deg) slants", !css("transform:skewX(-9deg) translateY(1px)").missing.includes("no slant")],
    ["skewX(0deg) does not", css("transform:skewX(0deg)").missing.includes("no slant")],
    ["font-style italic slants", !css("font-style:italic").missing.includes("no slant")],
    ["font shorthand: italic 900", !css("font:italic 900 24px/1 Impact").missing.includes("no slant") && !css("font:italic 900 24px/1 Impact").missing.includes("no heavy weight")],
    ["weight 800, bold", !css("font-weight:800").missing.includes("no heavy weight") && !css("font-weight:bold").missing.includes("no heavy weight")],
    ["weight 300, normal", css("font-weight:300").missing.includes("no heavy weight") && css("font-weight:normal").missing.includes("no heavy weight")],
    ["dark text-shadow outline", !css("text-shadow:-1px 0 #0b1033,1px 0 #0b1033").missing.includes("no dark text outline") && !css("text-shadow:0 2px 0 rgba(0,0,0,.6)").missing.includes("no dark text outline")],
    ["cyan glow is not an outline", css("text-shadow:0 0 8px #5ee7ff").missing.includes("no dark text outline")],
    ["text-stroke counts", !css("-webkit-text-stroke:2px #0b1033").missing.includes("no dark text outline")],
    ["gold + blue = 2 families", !I.styleGate(".x{background:#ffb21f;color:#2f8bff}").missing.includes("under 2 rarity colours")],
    ["near shades and rgb() count", !I.styleGate(".x{background:rgb(255,200,60);border-color:hsl(268,100%,65%)}").missing.includes("under 2 rarity colours")],
    ["cyan alone is not a rarity", I.styleGate(".x{color:#5ee7ff;border-color:#5ee7ff}").missing.includes("under 2 rarity colours")],
    ["one family is not enough", I.styleGate(".x{background:#2f8bff;color:#1647c8}").missing.includes("under 2 rarity colours")],
    ["condensed stacks", ["Impact,sans-serif", '"Avenir Next Condensed",sans-serif', '"Futura-CondensedExtraBold"', '"Barlow Condensed"'].every((f) => !css(`font-family:${f}`).missing.includes("no condensed font"))],
    ["plain stacks are not", ["system-ui,sans-serif", '"SF Mono",monospace', "Helvetica,Arial"].every((f) => css(`font-family:${f}`).missing.includes("no condensed font"))],
  ];
  const failedCases = cases.filter(([, ok]) => !ok).map(([n]) => n);
  check(`style gate: ${cases.length} unit cases (borders, strokes, skew, italic, weight, text outline, rarity families, fonts)`, !failedCases.length, { failed: failedCases });
  const spiteful = GOOD.replace("</style>", `.z{border:${"1".repeat(20000)}px solid}.y{${"a".repeat(30000)}}${"rgb(".repeat(3000)}${"var(--a,".repeat(2000)}</style>`);
  const ts = Date.now();
  const spiteV = A.validateHtml(spiteful, { allowedActions: ALLOWED, layout: BASIC });
  check("style gate: pathological CSS (20k-digit width, 30 KB of letters, 3000 unclosed rgb(, 2000 var() ) is scanned in well under a second", Date.now() - ts < 800 && typeof spiteV.style.score === "number", { ms: Date.now() - ts });
  check("style gate: empty input gets a 0/7 style and ok:false", (() => { const v = A.validateHtml(""); return !v.ok && v.style.score === 0 && v.style.of === 7; })());

  // ---- generateControllerHtml with a fake fetch ----
  const requests = [];
  const answer = (text, extra = {}) => ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, output_tokens: 1500 }, ...extra }), text: async () => "" });
  const httpError = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }), json: async () => ({}) });
  let reply = () => answer(GOOD);
  I.setFetch(async (url, init) => { requests.push({ url, body: JSON.parse(init.body), headers: init.headers, signal: init.signal }); return reply(init); });
  const gen = (o = {}) => A.generateControllerHtml({ image: IMAGE, layout: BASIC, allowedActions: ALLOWED, ...o });

  I.reset(); requests.length = 0;
  let r = await gen();
  const body = requests[0] && requests[0].body;
  check("model: valid answer used (source model), controls listed, style score returned", r.ok && r.source === "model" && r.controls.length === 3 && r.html === GOOD && r.style.score === 7 && !r.warnings, { source: r.source, controls: r.controls.length, style: r.style });
  check("request: gpt-6.1-sol, ultrafast, effort medium, image detail low, instructions, store false, layout centres and rarities", body && body.model === "gpt-6.1-sol" && body.service_tier === "ultrafast" && body.reasoning.effort === "medium" && body.store === false &&
    body.input[0].content.some((c) => c.type === "input_image" && c.detail === "low") && /SPACE PARTY/.test(body.instructions) && /centre 19vw 62.5vh/.test(body.input[0].content[0].text) &&
    /action "shoot", label "FIRE", rarity gold/.test(body.input[0].content[0].text) && /action "boost", label "BOOST", rarity blue/.test(body.input[0].content[0].text) && /NOT thin sci-fi lines/.test(body.input[0].content[0].text), { max_output_tokens: body && body.max_output_tokens });
  requests.length = 0;
  r = await gen();
  check("cache: the same drawing and layout answer at once without a call", r.source === "model" && requests.length === 0 && r.ms < 20, { ms: r.ms });

  const fallbackCase = async (name, fn, expect, o = {}) => {
    I.reset(); requests.length = 0; reply = fn;
    const res = await gen(o);
    const v = A.validateHtml(res.html, { layout: BASIC });
    const ok = res.ok && res.source === "template" && String(res.error).includes(expect) && v.ok && v.style.score === v.style.of && res.style.score === res.style.of;
    check(`fallback: ${name} → template (${expect})`, ok, { error: res.error, calls: requests.length });
  };
  await fallbackCase("hostile answer", () => answer(bad("fetch('/x')")), "rejected: script uses fetch");
  await fallbackCase("answer missing a drawn control", () => answer(GOOD.replace('data-action="boost" ', "")), "missing control: boost");
  await fallbackCase("HTTP 500", () => httpError(500, "boom"), "OpenAI HTTP 500");
  await fallbackCase("incomplete (max tokens)", () => answer(GOOD.slice(0, 500), { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "incomplete");
  await fallbackCase("refusal", () => ({ ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: "refusal", refusal: "no" }] }] }), text: async () => "" }), "model refused");
  await fallbackCase("not HTML", () => answer("Sure! Here is your controller."), "no HTML document");
  await fallbackCase("valid but a thin-line sci-fi HUD (style gate)", () => answer(SCIFI), "rejected: style (no slant, no 3px border, no heavy weight");
  await fallbackCase("valid but bold-italic on hairline outlines (thin plus one more miss)", () => answer(SCIFI_BOLD), "rejected: style (no 3px border, thin lines)");
  await fallbackCase("valid but three mild misses (no outline, no condensed font, light weight)", () => answer(GOOD.replace(STACK, "system-ui,sans-serif").replace(/text-shadow:[^;}]*/, "").replace("font-weight:900", "font-weight:400")), "rejected: style (no heavy weight, no dark text outline, no condensed font)");
  I.reset(); I.setTimeoutMs(60); requests.length = 0;
  reply = (init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  r = await gen();
  check("fallback: no answer within the timeout → template (timeout)", r.source === "template" && r.error === "timeout" && r.ms < 400, { ms: r.ms });

  I.reset(); requests.length = 0;
  reply = () => answer(SCIFI);
  r = await gen();
  check("style gate in generateControllerHtml: the refused HUD is not cached (the next call asks the model again)", r.source === "template" && requests.length === 1 && (await gen()).source === "template" && requests.length === 2);

  I.reset(); requests.length = 0;
  reply = () => answer(GOOD.replace(STACK, "system-ui,sans-serif").replace("font-style:italic;", ""));
  r = await gen();
  check("mild misses only warn: accepted as model, style 6/7, warnings name the misses", r.source === "model" && r.style.score === 6 && r.warnings && r.warnings.includes("style: no condensed font") && r.warnings.includes("style: no italic labels") && !r.error, { warnings: r.warnings, style: r.style });

  I.reset(); requests.length = 0;
  reply = () => answer("```html\n" + GOOD + "\n```\nEnjoy!");
  r = await gen();
  check("markdown fences around the document are stripped", r.source === "model" && r.html === GOOD);

  // Tier handling: only an error that names the tier switches it off, and only when the retry without it works.
  I.reset(); requests.length = 0;
  let n = 0;
  reply = () => (++n === 1 ? httpError(400, "Unsupported service_tier for image input") : answer(GOOD));
  r = await gen();
  check("tier named in a 400 → retried once on the default tier, remembered because that worked", r.source === "model" && requests.length === 2 && requests[0].body.service_tier === "ultrafast" && !("service_tier" in requests[1].body) && I.state().defaultTierOnly, { calls: requests.length });
  requests.length = 0; reply = () => answer(GOOD);
  r = await gen({ layout: BASIC2 });
  check("tier remembered: the next request goes out on the default tier at once", r.source === "model" && requests.length === 1 && !("service_tier" in requests[0].body));

  for (const message of ["Invalid image: could not decode the picture", "Unsupported image format", "Unsupported value: 'reasoning.effort' is not supported with this model", "Invalid format in the request"]) {
    I.reset(); requests.length = 0; reply = () => httpError(400, message);
    r = await gen();
    const first = requests.length === 1 && r.source === "template" && r.error === "OpenAI HTTP 400" && !I.state().defaultTierOnly;
    requests.length = 0; reply = () => answer(GOOD);
    await gen({ layout: BASIC2 });
    check(`tier untouched: a 400 that does not name the tier ("${message.slice(0, 28)}…") makes one request, no retry, and the next one still asks for ultrafast`, first && requests.length === 1 && requests[0].body.service_tier === "ultrafast", { calls: requests.length });
  }

  I.reset(); requests.length = 0;
  n = 0;
  reply = () => (++n === 1 ? httpError(400, "Unsupported service_tier: ultrafast") : httpError(400, "Invalid image: could not decode the picture"));
  r = await gen();
  const afterFail = { calls: requests.length, remembered: I.state().defaultTierOnly };
  requests.length = 0; reply = () => answer(GOOD);
  await gen({ layout: BASIC2 });
  check("tier not remembered when the retry without it fails too: 2 requests, template, and the next request tries ultrafast again", afterFail.calls === 2 && !afterFail.remembered && r.source === "template" && r.error === "OpenAI HTTP 400" && requests[0].body.service_tier === "ultrafast", afterFail);

  I.reset(); requests.length = 0; reply = () => httpError(429, "Rate limit reached for service tier ultrafast");
  r = await gen();
  check("tier named in a 429 is retried once too (and not remembered: the retry fails)", requests.length === 2 && !("service_tier" in requests[1].body) && !I.state().defaultTierOnly && r.source === "template");

  I.reset(); requests.length = 0; reply = () => httpError(500, "service tier unavailable");
  r = await gen();
  check("a 5xx is never a tier problem: one request, no retry", requests.length === 1 && r.error === "OpenAI HTTP 500" && !I.state().defaultTierOnly);

  I.reset(); requests.length = 0;
  let release;
  reply = () => new Promise((resolve) => (release = () => resolve(answer(GOOD))));
  const p1 = gen(), p2 = gen();
  await new Promise((res) => setTimeout(res, 20));
  release();
  const [a, b] = await Promise.all([p1, p2]);
  check("in-flight dedupe: two identical calls share one request", requests.length === 1 && a.source === "model" && b.source === "model");

  I.reset(); requests.length = 0;
  reply = (init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const ac = new AbortController();
  const pa = gen({ signal: ac.signal });
  await new Promise((res) => setTimeout(res, 20));
  ac.abort();
  r = await pa;
  await new Promise((res) => setTimeout(res, 20));
  check("abort: the caller gets the template at once and the request is cancelled", r.source === "template" && r.error === "aborted" && requests[0].signal.aborted);

  I.reset(); requests.length = 0;
  process.env.ASTRA_MOCK = "1";
  r = await gen();
  delete process.env.ASTRA_MOCK;
  check("ASTRA_MOCK=1: template, no network", r.source === "template" && r.error === "mock" && requests.length === 0 && r.style.score === 7);

  r = await A.generateControllerHtml({ layout: { buttons: [] } });
  const r2 = await A.generateControllerHtml({ layout: BASIC, allowedActions: ["dig"] });
  check("no usable control → ok:false with a reason", !r.ok && !r2.ok && /no allowed controls/.test(r2.error), { error: r.error, error2: r2.error });

  I.reset(); requests.length = 0; reply = () => answer(GOOD);
  r = await A.generateControllerHtml({ layout: BASIC, allowedActions: ALLOWED });
  check("no image: still one call, layout only", r.source === "model" && !requests[0].body.input[0].content.some((c) => c.type === "input_image"));

  // ---- Blank key means no key ----
  I.reset(); requests.length = 0; reply = () => answer(GOOD);
  const outcomes = [];
  for (const blank of ["", "   "]) {
    process.env.OPENAI_API_KEY = blank;
    outcomes.push(await gen());
  }
  process.env.OPENAI_API_KEY = "sk-test-dummy";
  check("blank key: OPENAI_API_KEY present but empty (or spaces) means no key: no network call, template answer, error names the missing key", requests.length === 0 && outcomes.every((o) => o.ok && o.source === "template" && /OPENAI_API_KEY/.test(o.error) && o.style.score === 7), { errors: outcomes.map((o) => o.error) });
  // The .env fallback itself, on a temp copy with a FAKE .env (the real one is never read here): a blank key must not reach it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astra-html-test-"));
  try {
    // The module source with its relative requires pointed back at the real files; only its __dirname (and so its .env) moves.
    const source = fs.readFileSync(path.join(ROOT, "astra-html.js"), "utf8").replace(/require\("\.\/([\w.-]+)"\)/g, (m, f) => `require(${JSON.stringify(path.join(ROOT, f))})`);
    fs.writeFileSync(path.join(tmp, "astra-html.js"), source);
    fs.writeFileSync(path.join(tmp, ".env"), "OPENAI_API_KEY=sk-from-fake-dotenv\n");
    const iso = require(path.join(tmp, "astra-html.js"));
    const seen = [];
    iso._internals.setFetch(async (url, init) => { seen.push(init.headers.Authorization); return answer(GOOD); });
    const run = (extra) => iso.generateControllerHtml({ layout: { buttons: BASIC.buttons.map((b) => ({ ...b, x: b.x + extra })) }, allowedActions: ALLOWED });
    process.env.OPENAI_API_KEY = "";
    const blank = await run(0);
    delete process.env.OPENAI_API_KEY;
    const fromEnvFile = await run(0.01);
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    const fromEnvVar = await run(0.02);
    check("key rules on a temp copy with a fake .env: blank → no key and no fallback; absent → .env; set → the env var wins", blank.source === "template" && /OPENAI_API_KEY/.test(blank.error) && fromEnvFile.source === "model" && fromEnvVar.source === "model" &&
      seen.length === 2 && seen[0] === "Bearer sk-from-fake-dotenv" && seen[1] === "Bearer sk-test-dummy", { calls: seen.length });
  } finally {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---- The model is pinned ----
  const warned = [], realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  const modelsSeen = {};
  try {
    for (const want of ["gpt-6-astra", "gpt-5", "gpt-6.1-sol/../x", "GPT-6.1-SOL", "gpt-6.1", "gpt-6.1-solar", "gpt-6.1-sol-2026-10-01", "gpt-6.1-sol-mini", "gpt-6.1-sol"]) {
      process.env.OPENAI_MODEL = want;
      I.reset(); requests.length = 0; reply = () => answer(GOOD);
      const before = warned.length;
      await gen(); await gen({ layout: BASIC2 });
      modelsSeen[want] = { models: [...new Set(requests.map((q) => q.body.model))], warnings: warned.length - before };
    }
  } finally { console.warn = realWarn; delete process.env.OPENAI_MODEL; }
  const ignored = ["gpt-6-astra", "gpt-5", "gpt-6.1-sol/../x", "GPT-6.1-SOL", "gpt-6.1", "gpt-6.1-solar"];
  check("model pinned: anything but gpt-6.1-sol… is ignored with exactly ONE warning and the default is sent (never gpt-6-astra)",
    ignored.every((w) => modelsSeen[w].models.join() === "gpt-6.1-sol" && modelsSeen[w].warnings === 1) && warned.every((w) => /pinned to gpt-6\.1-sol/.test(w)), modelsSeen);
  check("model pinned: a name that starts with gpt-6.1-sol (a dated snapshot) is used as given, no warning", ["gpt-6.1-sol-2026-10-01", "gpt-6.1-sol-mini", "gpt-6.1-sol"].every((w) => modelsSeen[w].models.join() === w && modelsSeen[w].warnings === 0));

  const pass = results.every((x) => x.ok);
  console.log(`\n${pass ? "ALL PASS" : "FAILED"}: ${results.filter((x) => x.ok).length}/${results.length}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
