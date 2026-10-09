// POST /generate end to end through the real server.js, with the model answered from recorded corpus answers
// (dev/astra/fake-openai.cjs preload: no key, no network). Checks what the phone gets: looksLike on every answer, a
// wrong-kind drawing refused without costing a drawing, "use it anyway" spending one, the generated / entity broadcasts.
//   node dev/astra/server-generate-test.js          (port GEN_PORT, default 8182; HTTPS off)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const assert = require("assert");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const CORPUS = path.join(ROOT, "dev/gen-corpus");
const PORT = Number(process.env.GEN_PORT) || 8182;
const BASE = `http://localhost:${PORT}`;
const png = (file) => "data:image/png;base64," + fs.readFileSync(path.join(CORPUS, file)).toString("base64");

const post = (route, body) => fetch(BASE + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

function events() {
  const seen = [];
  const req = http.get(`${BASE}/events`, (res) => {
    let buf = "";
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data:")) { try { const m = JSON.parse(line.slice(5)); if (m.type !== "tick") seen.push(m); } catch {} }
      }
    });
  });
  return { seen, close: () => req.destroy() };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gen-server-"));
  const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", OPENAI_API_KEY: "sk-test-not-a-real-key", PERF_LOG: path.join(tmp, "perf.log") };
  delete env.ASTRA_MOCK; delete env.OPENAI_REASONING_EFFORT;
  const server = spawn(process.execPath, ["-r", path.join(__dirname, "fake-openai.cjs"), "server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  const results = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); }
    catch (err) { results.push({ name, ok: false, ms: Date.now() - t0, err }); }
  };
  try {
    for (let i = 0; i < 100 && !/Space Party on/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(/Space Party on/.test(out), "server did not start:\n" + out);
    const ev = events();
    await new Promise((r) => setTimeout(r, 300));
    const player = "genqa";
    await post("/join", { player });
    let left;

    await step("a ship drawn in the controller step (the owner's real drawing) → refused, looksLike entity, no drawing spent", async () => {
      const r = await post("/generate", { player, kind: "controller", image: png("real/jaume-ship-drawn-in-controller-step.png"), source: "draw" });
      assert.deepStrictEqual([r.ok, r.error, r.looksLike, r.thing], [false, "looks like a ship", "entity", "ship"]);
      assert.strictEqual(r.drawingsLeft.space, 5);
      left = r.drawingsLeft.space;
    });
    await step("same drawing with anyway:true → a layout, one drawing spent, generated broadcast", async () => {
      const r = await post("/generate", { player, kind: "controller", image: png("real/jaume-ship-drawn-in-controller-step.png"), source: "draw", anyway: true });
      assert.ok(r.ok && r.layout && r.layout.buttons.length > 0, r.error);
      assert.strictEqual(r.looksLike, "entity");
      assert.strictEqual(r.drawingsLeft.space, left - 1);
      left = r.drawingsLeft.space;
    });
    await step("a real controller (C01) → ok, looksLike controller, stick + FIRE + BOOST bound", async () => {
      const r = await post("/generate", { player, kind: "controller", image: png("controller/C01.png"), source: "draw" });
      assert.ok(r.ok, r.error);
      assert.strictEqual(r.looksLike, "controller");
      assert.deepStrictEqual(r.layout.buttons.map((b) => b.action).sort(), ["boost", "shoot", "steer"]);
      assert.strictEqual(r.drawingsLeft.space, left - 1);
      left = r.drawingsLeft.space;
      await new Promise((res) => setTimeout(res, 200));
      assert.ok(ev.seen.some((m) => m.type === "generated" && m.player === player && m.layout.buttons.some((b) => b.action === "shoot")), "generated broadcast");
    });
    await step("an added LAND button (B01) → one control at the region", async () => {
      const region = { x: 0.62, y: 0.08, w: 0.2, h: 0.28 };
      const r = await post("/generate", { player, kind: "button", image: png("button/B01.png"), source: "draw", region });
      assert.ok(r.ok, r.error);
      assert.deepStrictEqual([r.layout.buttons.length, r.layout.buttons[0].action, r.layout.buttons[0].x, r.layout.buttons[0].w], [1, "land", 0.62, 0.2]);
      left = r.drawingsLeft.space;
    });
    await step("the owner's real figure drawn as a button → refused, looksLike entity, nothing spent", async () => {
      const r = await post("/generate", { player, kind: "button", image: png("real/jaume-figure-drawn-as-button.png"), source: "draw", region: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 } });
      assert.deepStrictEqual([r.ok, r.looksLike], [false, "entity"]);
      assert.ok(/^looks like a/.test(r.error), r.error);
      assert.strictEqual(r.drawingsLeft.space, left);
    });
    await step("a controller drawn in the ship step (W09) → refused, looksLike controller, nothing spent", async () => {
      const r = await post("/generate", { player, kind: "ship", image: png("wrong/W09.png"), source: "draw" });
      assert.deepStrictEqual([r.ok, r.error, r.looksLike], [false, "looks like a controller", "controller"]);
      assert.strictEqual(r.drawingsLeft.space, left);
    });
    await step("a ship with a cannon and flames (E04) → entity shoot + boost, entity broadcast", async () => {
      const r = await post("/generate", { player, kind: "ship", image: png("entity/E04.png"), source: "draw" });
      assert.ok(r.ok, r.error);
      assert.strictEqual(r.looksLike, "entity");
      assert.deepStrictEqual(r.entity.unlocked.map((u) => u.verb).sort(), ["boost", "shoot"]);
      assert.strictEqual(r.drawingsLeft.space, left - 1);
      await new Promise((res) => setTimeout(res, 200));
      assert.ok(ev.seen.some((m) => m.type === "entity" && m.player === player && m.entity.verbs.includes("shoot")), "entity broadcast");
    });
    ev.close();
  } finally {
    server.kill();
    await new Promise((r) => server.once("exit", r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms} ms)${r.ok ? "" : "\n     " + (r.err && r.err.stack || r.err)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed (port ${PORT}, model answers replayed from fixtures; astra log lines: ${out.split("\n").filter((l) => l.startsWith("astra")).length})`);
  process.exit(failed ? 1 : 0);
})();
