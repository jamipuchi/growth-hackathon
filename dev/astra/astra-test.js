// astra.js tests with an injected fake fetch. No network, no real key. Run: node dev/astra/astra-test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

process.env.OPENAI_API_KEY = "sk-test-not-a-real-key"; // set first so astra.js never looks for a .env
for (const k of ["OPENAI_MODEL", "OPENAI_SERVICE_TIER", "OPENAI_REASONING_EFFORT", "ASTRA_MOCK"]) delete process.env[k];

const Contract = require("../../contract.js");
const Astra = require("../../astra.js");
const { _internals } = Astra;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "astra-test-"));
_internals.setDir(tmp);

// Capture astra's log lines so we can check they never carry the key or the image.
const logLines = [];
const realLog = console.log;
console.log = (...args) => logLines.push(args.join(" "));

let n = 0;
const image = (tag) => "data:image/png;base64," + Buffer.from(`fake-png-${tag}-${n++}`).toString("base64");

// Fake fetch: `script(req, call)` returns { status, body | text, delay }.
let calls = [];
function fakeFetch(script) {
  calls = [];
  _internals.setFetch((url, opts) => {
    const req = JSON.parse(opts.body);
    const call = { url, opts, req, aborted: false };
    calls.push(call);
    const { status = 200, body, text, delay = 5 } = script(req, calls.length) || {};
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => (body !== undefined ? body : JSON.parse(text)),
        text: async () => (text !== undefined ? text : JSON.stringify(body)),
      }), delay);
      opts.signal.addEventListener("abort", () => {
        call.aborted = true;
        clearTimeout(timer);
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    });
  });
}
const answer = (obj) => ({ body: { id: "resp_x", status: "completed", output: [{ type: "reasoning", content: [] }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] } });

const results = [];
async function test(name, fn) {
  _internals.reset();
  _internals.setDir(tmp);
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err });
  }
}

const valid = (layout) => assert.deepStrictEqual(Contract.CHECKS.layout(layout), []);
const byAction = (layout, action) => layout.buttons.find((b) => b.action === action);

(async () => {
  await test("good answer → valid layout, labels mapped (FIRE→shoot, LAND→land, arrows→stick)", async () => {
    fakeFetch(() => answer({ buttons: [
      { type: "stick", label: "", action: "none", x: 0.05, y: 0.4, w: 0.3, h: 0.45 },
      { type: "button", label: "Fire", action: "none", x: 0.75, y: 0.55, w: 0.18, h: 0.3 },
      { type: "button", label: "LAND", action: "boost", x: 0.6, y: 0.1, w: 0.15, h: 0.2 },
      { type: "button", label: "ARROWS", action: "none", x: 0.55, y: 0.5, w: 0.15, h: 0.3 },
      { type: "button", label: "pew!", action: "shoot", x: 0.4, y: 0.1, w: 0.1, h: 0.15 },
      { type: "button", label: "◀", action: "none", x: 0.36, y: 0.6, w: 0.08, h: 0.12 },
    ] }));
    const r = await Astra.generate({ player: "Ana!", kind: "controller", image: image("good"), speculative: false, requestId: "1" });
    assert.ok(r.ok, r.error);
    valid(r.layout);
    assert.strictEqual(r.layout.source, "model");
    assert.strictEqual(r.layout.buttons.length, 6);
    const [stick, fire, land, arrows, pew, left] = r.layout.buttons;
    assert.deepStrictEqual([stick.type, stick.action], ["stick", "steer"]);
    assert.deepStrictEqual([fire.action, fire.label], ["shoot", "FIRE"]);
    assert.strictEqual(land.action, "land"); // the label wins over the model's action
    assert.deepStrictEqual([arrows.type, arrows.action], ["stick", "steer"]);
    assert.strictEqual(pew.action, "shoot");
    assert.deepStrictEqual([left.type, left.action], ["button", "left"]);
    // The request itself.
    const { req, url, opts } = calls[0];
    assert.strictEqual(url, "https://api.openai.com/v1/responses");
    assert.strictEqual(opts.headers.Authorization, "Bearer sk-test-not-a-real-key");
    assert.strictEqual(req.model, "gpt-6.1-sol");
    assert.strictEqual(req.service_tier, "ultrafast");
    assert.strictEqual(req.reasoning, undefined);
    assert.ok(req.max_output_tokens <= 1000);
    const [text, img] = req.input[0].content;
    assert.strictEqual(text.type, "input_text");
    assert.ok(/PHOTO of a notebook page/.test(text.text) && /paper lines/.test(text.text) && /fractions/.test(text.text));
    assert.deepStrictEqual([img.type, img.detail], ["input_image", "low"]);
    assert.ok(img.image_url.startsWith("data:image/png;base64,"));
    assert.deepStrictEqual([req.text.format.type, req.text.format.strict, req.text.format.name], ["json_schema", true, "layout"]);
  });

  await test("stick on the right half with no label → move", async () => {
    fakeFetch(() => answer({ buttons: [{ type: "stick", label: "", action: "shoot", x: 0.65, y: 0.4, w: 0.3, h: 0.5 }] }));
    const r = await Astra.generate({ player: "ana", kind: "controller", image: image("right") });
    assert.ok(r.ok, r.error);
    assert.deepStrictEqual([r.layout.buttons[0].type, r.layout.buttons[0].action], ["stick", "move"]);
  });

  await test("source 'draw' changes the prompt to a finger drawing", async () => {
    fakeFetch(() => answer({ buttons: [{ type: "button", label: "DIG", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }));
    const r = await Astra.generate({ player: "ana", kind: "controller", image: image("draw"), source: "draw" });
    assert.ok(r.ok && r.layout.buttons[0].action === "dig");
    assert.ok(/finger drawing/.test(calls[0].req.input[0].content[0].text));
  });

  await test("junk → rejected cleanly", async () => {
    fakeFetch(() => ({ body: { output: [{ type: "message", content: [{ type: "output_text", text: "lol I see a controller" }] }] } }));
    let r = await Astra.generate({ player: "ana", kind: "controller", image: image("junk1") });
    assert.deepStrictEqual(r, { ok: false, error: "bad model output: not JSON" });
    fakeFetch(() => answer({ foo: 1 }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("junk2") });
    assert.deepStrictEqual(r, { ok: false, error: "bad model output: no buttons" });
    fakeFetch(() => ({ body: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] } }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("junk3") });
    assert.deepStrictEqual(r, { ok: false, error: "incomplete: max_output_tokens" });
    fakeFetch(() => ({ status: 500, text: "server exploded" }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("junk4") });
    assert.deepStrictEqual(r, { ok: false, error: "OpenAI HTTP 500" });
    fakeFetch(() => ({ text: "<html>not json</html>" }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("junk5") });
    assert.deepStrictEqual(r, { ok: false, error: "bad response: not JSON" });
    r = await Astra.generate({ player: "ana", kind: "controller", image: "not a data url" });
    assert.strictEqual(r.ok, false);
    r = await Astra.generate({ player: "", kind: "controller", image: image("noplayer") });
    assert.deepStrictEqual(r, { ok: false, error: "player required" });
    assert.strictEqual(_internals.state().cache, 0, "failures are not cached");
  });

  await test("unknown action dropped; clamp to 0..1; cap 16", async () => {
    fakeFetch(() => answer({ buttons: [
      { type: "button", label: "BANANA", action: "banana", x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      { type: "button", label: "", action: "none", x: 0.3, y: 0.1, w: 0.1, h: 0.1 },
      { type: "button", label: "SCAN", action: "none", x: 0.9, y: -0.2, w: 0.5, h: 0.4 },
      { type: "toggle", label: "", action: "flare", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
    ] }));
    let r = await Astra.generate({ player: "ana", kind: "controller", image: image("unknown") });
    assert.ok(r.ok, r.error);
    valid(r.layout);
    assert.deepStrictEqual(r.layout.buttons.map((b) => b.action), ["scan", "flare"]);
    assert.deepStrictEqual(r.layout.buttons[0], { type: "button", action: "scan", label: "SCAN", x: 0.9, y: 0, w: 0.1, h: 0.4 });
    fakeFetch(() => answer({ buttons: Array.from({ length: 20 }, (_, i) => ({ type: "button", label: "FIRE", action: "none", x: (i % 5) * 0.2, y: Math.floor(i / 5) * 0.25, w: 0.15, h: 0.2 })) }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("many") });
    assert.ok(r.ok && r.layout.buttons.length === 16);
    fakeFetch(() => answer({ buttons: [{ type: "button", label: "BANANA", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }));
    r = await Astra.generate({ player: "ana", kind: "controller", image: image("none") });
    assert.deepStrictEqual(r, { ok: false, error: "no controls found" });
  });

  let cacheMs;
  await test("cache hit is instant; the same image in flight is awaited, not re-requested", async () => {
    fakeFetch(() => ({ ...answer({ buttons: [{ type: "button", label: "FIRE", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }), delay: 150 }));
    const img = image("cache");
    const [a, b] = await Promise.all([
      Astra.generate({ player: "ana", kind: "controller", image: img }),
      Astra.generate({ player: "ben", kind: "controller", image: img }),
    ]);
    assert.ok(a.ok && b.ok);
    assert.strictEqual(calls.length, 1, "joined the in-flight request");
    const t0 = process.hrtime.bigint();
    const c = await Astra.generate({ player: "cat", kind: "controller", image: img });
    cacheMs = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(c.ok && calls.length === 1, "no new request");
    assert.ok(cacheMs < 20, `cache hit took ${cacheMs} ms`);
    assert.deepStrictEqual(c.layout, a.layout);
    c.layout.buttons.length = 0; // callers get copies
    const d = await Astra.generate({ player: "cat", kind: "controller", image: img });
    assert.strictEqual(d.layout.buttons.length, 1);
    assert.ok(logLines.some((l) => /astra controller cat hit/.test(l)));
  });

  await test("a newer request supersedes an older one (abort)", async () => {
    fakeFetch((req, i) => ({ ...answer({ buttons: [{ type: "button", label: i === 1 ? "FIRE" : "LAND", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }), delay: 400 }));
    const t0 = Date.now();
    const older = Astra.generate({ player: "ana", kind: "controller", image: image("old"), speculative: true });
    await new Promise((r) => setTimeout(r, 50));
    const newer = Astra.generate({ player: "ana", kind: "controller", image: image("new") });
    const o = await older;
    const oMs = Date.now() - t0;
    assert.deepStrictEqual(o, { ok: false, error: "superseded" });
    assert.ok(oMs < 150, `older resolved after ${oMs} ms`);
    assert.strictEqual(calls[0].aborted, true, "older request aborted");
    const nw = await newer;
    assert.ok(nw.ok && nw.layout.buttons[0].action === "land");
    // Another player's request is not superseded.
    fakeFetch(() => ({ ...answer({ type: "button", label: "DIG", action: "none" }), delay: 100 }));
    const [x, y] = await Promise.all([
      Astra.generate({ player: "ana", kind: "button", image: image("p1"), region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }),
      Astra.generate({ player: "ben", kind: "button", image: image("p2"), region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }),
    ]);
    assert.ok(x.ok && y.ok, x.error || y.error);
    assert.strictEqual(calls.length, 2);
  });

  let timeoutMs;
  await test("4 s timeout → default layout (controller), timeout error (button)", async () => {
    assert.strictEqual(_internals.TIMEOUT_MS, 4000);
    fakeFetch(() => ({ ...answer({ buttons: [] }), delay: 60000 }));
    const t0 = Date.now();
    const [c, b] = await Promise.all([
      Astra.generate({ player: "ana", kind: "controller", image: image("slow") }),
      Astra.generate({ player: "ana", kind: "button", image: image("slowb"), region: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } }),
    ]);
    timeoutMs = Date.now() - t0;
    assert.ok(timeoutMs >= 3990 && timeoutMs < 4300, `took ${timeoutMs} ms`);
    assert.ok(c.ok);
    assert.deepStrictEqual(c.layout, Astra.defaultLayout());
    assert.strictEqual(c.layout.source, "default");
    assert.deepStrictEqual(b, { ok: false, error: "timeout" });
    assert.ok(calls.every((call) => call.aborted));
    assert.strictEqual(_internals.state().cache, 0, "timeouts are not cached");
  });

  await test("button kind → exactly one button, rectangle = region", async () => {
    fakeFetch(() => answer({ type: "button", label: "land", action: "none" }));
    const region = { x: 0.62, y: 0.08, w: 0.2, h: 0.22 };
    const r = await Astra.generate({ player: "ana", kind: "button", image: image("btn"), region });
    assert.ok(r.ok, r.error);
    valid(r.layout);
    assert.deepStrictEqual(r.layout.buttons, [{ type: "button", action: "land", label: "LAND", ...region }]);
    const prompt = calls[0].req.input[0].content[0].text;
    assert.ok(/x=0.62, y=0.08, w=0.2, h=0.22/.test(prompt) && /ONE new control/.test(prompt));
    assert.deepStrictEqual(calls[0].req.text.format.schema.required, ["type", "label", "action"]);
    fakeFetch(() => answer({ type: "button", label: "???", action: "none" }));
    const bad = await Astra.generate({ player: "ana", kind: "button", image: image("btn2"), region });
    assert.deepStrictEqual(bad, { ok: false, error: "unreadable button" });
  });

  await test("tier fallback: a 4xx naming service_tier retries once on the default tier and remembers it", async () => {
    fakeFetch((req) => req.service_tier ? { status: 400, text: JSON.stringify({ error: { message: "Image inputs are not supported with service_tier 'ultrafast'" } }) } : answer({ buttons: [{ type: "button", label: "FLARE", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }));
    const r = await Astra.generate({ player: "ana", kind: "controller", image: image("tier") });
    assert.ok(r.ok, r.error);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].req.service_tier, undefined);
    assert.strictEqual(_internals.state().defaultTierOnly, true);
    const r2 = await Astra.generate({ player: "ana", kind: "controller", image: image("tier2") });
    assert.ok(r2.ok && calls.length === 3 && calls[2].req.service_tier === undefined);
    fakeFetch(() => ({ status: 401, text: "bad key" }));
    _internals.reset();
    const r3 = await Astra.generate({ player: "ana", kind: "controller", image: image("tier3") });
    assert.deepStrictEqual(r3, { ok: false, error: "OpenAI HTTP 401" });
    assert.strictEqual(calls.length, 1, "unrelated 4xx is not retried");
  });

  await test("env overrides: OPENAI_MODEL, OPENAI_SERVICE_TIER, OPENAI_REASONING_EFFORT", async () => {
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.OPENAI_SERVICE_TIER = "none";
    process.env.OPENAI_REASONING_EFFORT = "minimal";
    try {
      const req = _internals.buildRequest("controller", image("env"), null, "photo");
      assert.deepStrictEqual([req.model, req.service_tier, req.reasoning], ["gpt-test", undefined, { effort: "minimal" }]);
    } finally {
      delete process.env.OPENAI_MODEL;
      delete process.env.OPENAI_SERVICE_TIER;
      delete process.env.OPENAI_REASONING_EFFORT;
    }
  });

  let mockMs;
  await test("ASTRA_MOCK=1: no network, deterministic layout after 300 ms", async () => {
    _internals.setFetch(() => { throw new Error("network used in mock mode"); });
    process.env.ASTRA_MOCK = "1";
    try {
      const img = image("mock");
      const t0 = Date.now();
      const a = await Astra.generate({ player: "ana", kind: "controller", image: img });
      mockMs = Date.now() - t0;
      assert.ok(a.ok, a.error);
      valid(a.layout);
      assert.ok(mockMs >= 295 && mockMs < 400, `mock took ${mockMs} ms`);
      assert.deepStrictEqual(a.layout.buttons.map((b) => [b.type, b.action]), [["stick", "steer"], ["button", "shoot"], ["button", "boost"]]);
      _internals.reset();
      const b = await Astra.generate({ player: "ana", kind: "controller", image: img });
      assert.deepStrictEqual(b.layout, a.layout, "same image → same layout");
      const region = { x: 0.6, y: 0.1, w: 0.2, h: 0.2 };
      const c = await Astra.generate({ player: "ana", kind: "button", image: img, region });
      assert.deepStrictEqual(c.layout.buttons, [{ type: "button", action: "land", label: "LAND", ...region }]);
    } finally {
      delete process.env.ASTRA_MOCK;
    }
  });

  await test("ship and explorer: one strict-JSON vision call → type, parts, verbs from drawn parts only", async () => {
    fakeFetch((req) => {
      const text = req.input[0].content[0].text;
      if (text.includes("SPACESHIP")) return answer({ type: "ship", parts: [{ name: "Cannon", x: 0.8, y: 0.4 }, { name: "flames", x: 0.1, y: 0.5 }], verbs: ["shoot", "boost", "dig"], unlocked: [{ verb: "shoot", part: "cannon" }, { verb: "boost", part: "flames" }] });
      return answer({ type: "bike", parts: [{ name: "shovel", x: 0.5, y: 0.2 }], verbs: ["dig"], unlocked: [{ verb: "dig", part: "shovel" }] });
    });
    const ship = await Astra.generate({ player: "ana", kind: "ship", image: image("ship") });
    assert.strictEqual(calls.length, 1);
    const req = calls[0].req;
    assert.strictEqual(req.model, "gpt-6.1-sol"); assert.strictEqual(req.service_tier, "ultrafast");
    assert.strictEqual(req.text.format.strict, true); assert.strictEqual(req.text.format.name, "entity");
    assert.deepStrictEqual(req.text.format.schema.required, ["type", "parts", "verbs", "unlocked"]);
    assert.strictEqual(req.input[0].content[1].detail, "low");
    assert.strictEqual(ship.ok, true);
    assert.strictEqual(ship.entity.type, "ship"); assert.strictEqual(ship.entity.rig, "ship"); assert.strictEqual(ship.entity.source, "model");
    assert.deepStrictEqual(ship.entity.verbs, ["shoot", "boost"], "dig is not a ship skill");
    assert.deepStrictEqual(ship.entity.unlocked, [{ verb: "shoot", part: "cannon" }, { verb: "boost", part: "flames" }]);
    assert.deepStrictEqual(ship.entity.parts[0], { name: "cannon", x: 0.8, y: 0.4 });
    assert.ok(ship.entity.anims && ship.entity.anims.primary, "animations wired for its verbs");
    const ex = await Astra.generate({ player: "ana", kind: "explorer", image: image("explorer") });
    assert.strictEqual(ex.entity.type, "bike"); assert.strictEqual(ex.entity.rig, "car");
    assert.deepStrictEqual(ex.entity.verbs, ["dig", "drive", "takeoff"], "bike: innate drive + take-off, no jump");
  });

  await test("a plain drawing unlocks nothing; junk types fall back to blob", async () => {
    fakeFetch(() => answer({ type: "dragon", parts: [], verbs: [], unlocked: [] }));
    const ex = await Astra.generate({ player: "bo", kind: "explorer", image: image("plain") });
    assert.strictEqual(ex.entity.type, "blob");
    assert.deepStrictEqual(ex.entity.verbs, ["jump", "takeoff"]);
    fakeFetch(() => answer({ type: "ship", parts: [], verbs: [], unlocked: [] }));
    const sh = await Astra.generate({ player: "bo", kind: "ship", image: image("plain-ship") });
    assert.deepStrictEqual(sh.entity.verbs, [], "a plain ship only flies");
  });

  await test("dev kit: ASTRA_MOCK=1, no key, a failed call → every gate skill", async () => {
    _internals.setFetch(() => { throw new Error("network used"); });
    process.env.ASTRA_MOCK = "1";
    try {
      const r = await Astra.generate({ player: "cy", kind: "ship", image: image("mock-ship") });
      assert.strictEqual(r.entity.source, "devkit");
      for (const v of ["shoot", "land", "drill"]) assert.ok(r.entity.verbs.includes(v));
      const e = await Astra.generate({ player: "cy", kind: "explorer", image: image("mock-ex") });
      for (const v of ["dig", "drill", "jump", "takeoff"]) assert.ok(e.entity.verbs.includes(v));
    } finally { delete process.env.ASTRA_MOCK; }
    fakeFetch(() => ({ status: 500, text: "boom" }));
    const f = await Astra.generate({ player: "cy", kind: "ship", image: image("fail") });
    assert.strictEqual(f.ok, true); assert.strictEqual(f.entity.source, "devkit");
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    _internals.setFetch(() => { throw new Error("network used"); });
    try {
      // apiKey() may still find a .env: only assert when it really has none.
      const r = await Astra.generate({ player: "cy", kind: "explorer", image: image("nokey") });
      assert.strictEqual(r.ok, true); assert.strictEqual(r.entity.source, "devkit");
    } finally { process.env.OPENAI_API_KEY = key; }
  });

  await test("saves controllers/<player>-<kind>.png/.json; defaultLayout is valid; logs carry no key or image", async () => {
    fakeFetch(() => answer({ buttons: [{ type: "button", label: "DRILL", action: "none", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }));
    const img = image("save");
    const r = await Astra.generate({ player: "Dee", kind: "controller", image: img });
    await new Promise((res) => setTimeout(res, 50));
    const png = fs.readFileSync(path.join(tmp, "dee-controller.png"));
    assert.ok(png.toString().startsWith("fake-png-save"));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmp, "dee-controller.json"), "utf8")), r.layout);
    valid(Astra.defaultLayout());
    assert.strictEqual(Astra.defaultLayout().source, "default");
    assert.ok(logLines.length > 10);
    assert.ok(logLines.every((l) => !l.includes("sk-test") && !l.includes("base64") && !l.includes("ZmFrZS")), "a log line leaked the key or image");
  });

  console.log = realLog;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms} ms)${r.ok ? "" : "\n     " + (r.err && r.err.stack || r.err)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. cache hit ${cacheMs && cacheMs.toFixed(2)} ms, mock ${mockMs} ms, timeout ${timeoutMs} ms`);
  console.log("sample log lines:\n  " + logLines.slice(0, 4).join("\n  "));
  process.exit(failed ? 1 : 0);
})();
