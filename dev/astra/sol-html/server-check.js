// Live check of v1.2 "Sol writes the controller" through the real server.js (real Astra + real Sol, no mock):
//   1. a speculative controller drawing → the template at once; Sol's call starts in the background;
//   2. the finished drawing (the same image) a few seconds later → Sol's own HTML straight away (cache hit);
//   3. an added LAND button → the template for the new pad at once, then Sol's HTML pushed as generated kind "html";
//   4. POST /controller-html → Sol's HTML for the whole pad.
// Every Sol HTTP call is appended to dev/astra/sol-html/calls.log (shared with record.js; this lane's cap is 40).
// Astra's own calls (reading the drawing) are counted from the server log. The key is read by the server only.
//   node dev/astra/sol-html/server-check.js            (port SOL_CHECK_PORT, default 8254; HTTPS off)
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "../../..");
const Contract = require(path.join(ROOT, "contract.js"));
const AstraHtml = require(path.join(ROOT, "astra-html.js"));

const PORT = Number(process.env.SOL_CHECK_PORT) || 8254;
const CALL_LOG = path.join(__dirname, "calls.log");
const CAP = 40;
const calls = () => (fs.existsSync(CALL_LOG) ? fs.readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean).length : 0);
if (calls() > CAP - 6) { console.log(`call cap: ${calls()} of ${CAP} used, not enough left`); process.exit(2); }

const env = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_HTML_CALL_LOG: CALL_LOG, PERF_LOG: path.join(__dirname, "server-check-perf.log") };
delete env.ASTRA_MOCK;
const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`http://127.0.0.1:${PORT}${url}`, { method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
// The player's own event stream: every generated message, with its arrival time.
function listen(player, into) {
  let buf = "";
  const req = http.get(`http://127.0.0.1:${PORT}/events?player=${player}`, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data: ")) { const m = JSON.parse(line.slice(6)); if (m.type === "generated") into.push({ at: Date.now(), m }); }
      }
    });
  });
  req.on("error", () => {});
  return req;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(100); } return cond(); };
const png = (file) => "data:image/png;base64," + fs.readFileSync(file).toString("base64");
const styleOf = (html, layout) => AstraHtml.validateHtml(html, { layout }).style;

async function main() {
  for (let i = 0; i < 50; i++) { try { await request("GET", "/contract.js"); break; } catch { await sleep(100); } }
  const callsBefore = calls();
  const report = {};
  const P = "solcheck";
  await request("POST", "/join", { player: P, device: "sol-check-device-1" });
  const seen = [];
  const stream = listen(P, seen);
  await sleep(300);

  // 1. Speculative: the template at once.
  const ctrlImg = png(path.join(ROOT, "dev/v12-modules/corpus/c01-basic.png"));
  let t = Date.now();
  const spec = JSON.parse((await request("POST", "/generate", { player: P, kind: "controller", image: ctrlImg, source: "photo", speculative: true, requestId: "s1" })).body);
  report.speculative = { ms: Date.now() - t, ok: spec.ok, htmlSource: spec.htmlSource, controls: (spec.controls || []).map((c) => c.action), drawingsLeft: spec.drawingsLeft };
  if (!spec.ok) throw new Error(`speculative failed: ${JSON.stringify(spec).slice(0, 200)}`);
  // Sol works in the background (about 5 s): the server logs "astra-html solcheck model ...".
  const solDone = await until(() => /astra-html solcheck (model|template)/.test(out), 25000);
  report.solBackground = { done: solDone, line: (out.match(/astra-html solcheck [^\n]*/) || [""])[0] };

  // 2. Finished: Sol's HTML at once from the cache.
  t = Date.now();
  const fin = JSON.parse((await request("POST", "/generate", { player: P, kind: "controller", image: ctrlImg, source: "photo", speculative: false, requestId: "f1" })).body);
  const finMs = Date.now() - t;
  await sleep(300);
  const g1 = seen.find((x) => x.m.kind === "controller");
  report.finished = { ms: finMs, ok: fin.ok, htmlSource: fin.htmlSource, bytes: fin.html && Buffer.byteLength(fin.html), style: fin.html && styleOf(fin.html, fin.padLayout), controls: (fin.controls || []).map((c) => c.action),
    generated: g1 && { htmlSource: g1.m.htmlSource, sameHtml: g1.m.html === fin.html, checks: Contract.CHECKS.generated(g1.m) } };

  // 3. An added LAND button: the template for the new pad now, then Sol's HTML as kind "html".
  const btnImg = png(path.join(ROOT, "dev/gen-corpus/button/B01.png"));
  t = Date.now();
  const btn = JSON.parse((await request("POST", "/generate", { player: P, kind: "button", image: btnImg, source: "draw", region: { x: 0.62, y: 0.08, w: 0.2, h: 0.28 }, expect: "land", speculative: false, requestId: "b1" })).body);
  report.button = { ms: Date.now() - t, ok: btn.ok, action: btn.layout && btn.layout.buttons[0].action, htmlSource: btn.htmlSource, pad: btn.padLayout && btn.padLayout.buttons.map((b) => b.action) };
  const upgraded = await until(() => seen.some((x) => x.m.kind === "html"), 25000);
  const up = seen.find((x) => x.m.kind === "html");
  report.upgrade = { arrived: upgraded, afterMs: up ? up.at - t : null, htmlSource: up && up.m.htmlSource, controls: up && up.m.controls.map((c) => c.action), style: up && styleOf(up.m.html, up.m.padLayout), checks: up && Contract.CHECKS.generated(up.m) };

  // 4. A reloaded phone asks for its controller.
  const cur = JSON.parse((await request("POST", "/controller-html", { player: P, wait: true })).body);
  report.controllerHtml = { ok: cur.ok, htmlSource: cur.htmlSource, pending: cur.pending, sameAsUpgrade: !!up && cur.html === up.m.html };
  stream.destroy();

  report.solCalls = calls() - callsBefore;
  report.astraLines = (out.match(/^astra (controller|button) solcheck[^\n]*/gm) || []);
  report.callsTotalLog = calls();
  report.at = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "server-check.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const pass = report.finished.htmlSource === "model" && report.upgrade.arrived && report.upgrade.htmlSource === "model" && report.controllerHtml.htmlSource === "model" &&
    report.finished.style && report.finished.style.score === report.finished.style.of && report.upgrade.style && report.upgrade.style.score === report.upgrade.style.of;
  console.log(pass ? "PASS sol server check" : "FAIL sol server check");
  return pass;
}

main().then((pass) => { server.kill(); fs.rmSync(env.PERF_LOG, { force: true }); process.exit(pass ? 0 : 1); })
  .catch((err) => { console.log("FAIL", err.message, "\n--- server ---\n" + out.split("\n").filter((l) => !/perf /.test(l)).slice(-30).join("\n")); server.kill(); process.exit(1); });
