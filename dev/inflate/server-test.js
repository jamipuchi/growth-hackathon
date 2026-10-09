// server.js drawn ship / explorer: POST /generate kind ship|explorer → entity broadcast with an image URL, the PNG at
// GET /drawings/<player>-<kind>.png (only those names), late joiners get it in world.entities, the drawing budget.
// Starts server.js on port 8131 (HTTPS off, ASTRA_MOCK=1, no network). Run: node dev/inflate/server-test.js
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const PORT = 8131;
const ROOT = path.join(__dirname, "..", "..");
const BASE = `http://127.0.0.1:${PORT}`;
const P = "inflatetest";   // test player; its controllers/ files are removed at the end
const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", PERF_LOG: path.join(__dirname, "perf-test.log") };
delete env.OPENAI_API_KEY;
const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

// A real PNG (w × h, RGBA, a diagonal stroke) so the server's PNG check is exercised.
function png(w, h, seed) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x - y - seed) < 3) raw.fill(255, y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrl = (buf) => "data:image/png;base64," + buf.toString("base64");

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(BASE + url, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks), get json() { return JSON.parse(this.buf.toString()); } }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
// An /events reader: collects every message; close() ends it.
function events() {
  const msgs = [];
  let buf = "";
  const req = http.get(BASE + "/events", (res) => res.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of block.split("\n")) if (line.startsWith("data: ")) msgs.push(JSON.parse(line.slice(6)));
    }
  }));
  req.on("error", () => {});
  return { msgs, close: () => req.destroy() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20); } return fn(); }

const results = [];
async function test(name, fn) {
  const t0 = performance.now();
  try { await fn(); results.push({ name, ok: true, ms: performance.now() - t0 }); }
  catch (err) { results.push({ name, ok: false, err, ms: performance.now() - t0 }); }
}

(async () => {
  for (let i = 0; i < 50; i++) { try { await request("GET", "/contract.js"); break; } catch { await wait(100); } }
  const screen = events();
  const shipPng = png(64, 40, 0), expPng = png(30, 60, 5);
  let shipUrl;

  await test("join, then POST /generate kind ship → ok, entity with image URL, budget spent (space 5 → 4)", async () => {
    assert.strictEqual((await request("POST", "/join", { player: P })).status, 200);
    const t0 = performance.now();
    const r = await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(shipPng), source: "draw" });
    const ms = performance.now() - t0;
    const j = r.json;
    assert.strictEqual(j.ok, true, JSON.stringify(j));
    assert.strictEqual(j.entity.type, "ship");
    assert.match(j.entity.image, new RegExp(`^/drawings/${P}-ship\\.png\\?v=[0-9a-f]{10}$`));
    assert.strictEqual(j.drawingsLeft.space, 4);
    shipUrl = j.entity.image;
    console.log(`    /generate ship answered in ${ms.toFixed(1)} ms`);
  });

  await test("every screen gets {type:'entity', player, entity:{type:'ship', verbs, anims, image}}", async () => {
    const m = await until(() => screen.msgs.find((x) => x.type === "entity" && x.player === P && x.entity.image));
    assert.ok(m, "no entity message with an image");
    assert.strictEqual(m.entity.type, "ship");
    assert.strictEqual(m.entity.image, shipUrl);
    assert.ok(Array.isArray(m.entity.verbs) && m.entity.verbs.includes("drill"));
    assert.ok(m.entity.anims && m.entity.anims.idle);
  });

  await test("GET the image URL → 200 image/png, the exact bytes", async () => {
    const r = await request("GET", shipUrl);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers["content-type"], "image/png");
    assert.ok(r.buf.equals(shipPng));
    const h = await request("HEAD", `/drawings/${P}-ship.png`);
    assert.strictEqual(h.status, 200);
  });

  await test("/drawings serves only <player>-ship|explorer.png: everything else 404", async () => {
    const bad = [`/drawings/${P}-explorer.png`, `/drawings/${P}-ship.jpg`, `/drawings/${P}-controller.png`, `/drawings/${P}-controller.json`,
      "/drawings/jaume-controller.png", "/drawings/", "/drawings", "/drawings/x", `/drawings/${P.toUpperCase()}-ship.png`,
      "/drawings/%2e%2e%2fserver.js", "/drawings/..%2fserver.js", `/drawings/${P}-ship.png/x`, "/drawings/../controllers/jaume-controller.png",
      `/controllers/${P}-ship.png`];
    for (const url of bad) assert.strictEqual((await request("GET", url)).status, 404, url);
  });

  await test("a late joiner's world message has entities[player].image", async () => {
    const late = events();
    const w = await until(() => late.msgs.find((x) => x.type === "world"));
    late.close();
    assert.ok(w && w.entities && w.entities[P], "no entities in the world message");
    assert.strictEqual(w.entities[P].image, shipUrl);
  });

  await test("explorer drawn while in space: ok (type person), kept, no person entity broadcast yet; budget 4 → 3", async () => {
    const before = screen.msgs.length;
    const j = (await request("POST", "/generate", { player: P, kind: "explorer", image: dataUrl(expPng) })).json;
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.entity.type, "person");
    assert.match(j.entity.image, new RegExp(`^/drawings/${P}-explorer\\.png\\?v=`));
    assert.strictEqual(j.drawingsLeft.space, 3);
    await wait(150);
    assert.ok(!screen.msgs.slice(before).some((x) => x.type === "entity" && x.player === P && x.entity.type === "person"));
    const r = await request("GET", j.entity.image);
    assert.ok(r.status === 200 && r.buf.equals(expPng));
  });

  await test("speculative ship: no budget spent, no broadcast, the kept drawing unchanged", async () => {
    const before = screen.msgs.length;
    const j = (await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(png(20, 20, 1)), speculative: true })).json;
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.drawingsLeft.space, 3);
    await wait(150);
    assert.ok(!screen.msgs.slice(before).some((x) => x.type === "entity" && x.player === P));
    assert.ok((await request("GET", shipUrl)).buf.equals(shipPng));
  });

  await test("a new ship drawing replaces the image (new ?v=), and the budget runs out at 0", async () => {
    const j = (await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(png(50, 50, 9)) })).json;
    assert.strictEqual(j.ok, true);
    assert.notStrictEqual(j.entity.image, shipUrl);
    const m = await until(() => screen.msgs.find((x) => x.type === "entity" && x.player === P && x.entity.image === j.entity.image));
    assert.ok(m, "no broadcast of the new image");
    await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(png(50, 50, 11)) });
    await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(png(50, 50, 13)) });
    const last = (await request("POST", "/generate", { player: P, kind: "ship", image: dataUrl(png(50, 50, 15)) })).json;
    assert.deepStrictEqual([last.ok, last.error, last.drawingsLeft.space], [false, "no drawings left", 0]);
  });

  await test("a non-PNG image (JPEG data URL) is accepted by Astra but gets no /drawings image", async () => {
    const j = (await request("POST", "/generate", { player: "inflatetest2", kind: "ship", image: "data:image/jpeg;base64,/9j/4AAQ" })).json;
    assert.strictEqual(j.ok, true);
    assert.strictEqual(j.entity.image, undefined);
    assert.strictEqual((await request("GET", "/drawings/inflatetest2-ship.png")).status, 404);
  });

  screen.close();
  server.kill();
  await wait(100);
  for (const f of [`${P}-ship`, `${P}-explorer`, "inflatetest2-ship"]) for (const ext of [".png", ".json"]) fs.rmSync(path.join(ROOT, "controllers", f + ext), { force: true });
  fs.rmSync(env.PERF_LOG, { force: true });
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms.toFixed(0)} ms)${r.ok ? "" : "\n     " + (r.err && r.err.stack)}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) console.log("server output:\n" + serverOut.slice(-2000));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); server.kill(); process.exit(1); });
