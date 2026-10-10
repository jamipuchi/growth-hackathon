// v18-restart proof (node only, no browser): the big screen's RESTART on the main line (v1.8), end to end on the server.
//   A  self-respawn (KEEPALIVE=0): session ids, the restart message before the streams close, exit 0, a new pid and session,
//      an empty world and Hall of Fame, a second restart from the respawned copy.
//   B  under a supervisor (KEEPALIVE=1): exit 0 at once; this script plays the keep-alive loop.
//   C  a copy that cannot start (crash) or never loads (hang): 500 "restart failed", nothing heard, the old server goes on.
// One run on its own port (V18R_PORT, default 8561, spare range 8560-8569), HTTPS off, ASTRA_MOCK=1 and no OpenAI key, the
// Hall of Fame and the perf log in a temp dir (hall.init() empties its directory at every start: never the repo's hall/).
// Every server it starts is stopped by PID (the respawned copies: by this port, checked to be `node … server.js`).
// Usage: node dev/v18-restart/restart-proof.mjs    → PASS / FAIL lines, the timings, dev/v18-restart/results.json; exit 1 on a FAIL
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PORT = Number(process.env.V18R_PORT) || 8561;
if (PORT < 8560 || PORT > 8569) { console.error("V18R_PORT must be in 8560-8569"); process.exit(2); }
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "v18-restart-"));
const LOGS = path.join(HERE, "logs");
fs.mkdirSync(LOGS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : v);

const results = [], timings = {};
let failed = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
}

// ---- processes: only ours ----
function listeners() {
  try { return execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split(/\s+/).filter(Boolean).map(Number); } catch { return []; }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
async function stop(pid) {
  if (!pid || !alive(pid)) return;
  try { process.kill(pid, "SIGTERM"); } catch {}
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
  if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
}
async function stopPort() {   // whatever listens on OUR port and is a node server.js (a respawned copy has no other handle)
  for (const pid of listeners()) {
    let cmd = "";
    try { cmd = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }); } catch {}
    if (/\bserver\.js\b/.test(cmd)) await stop(pid);
  }
}
const started = [];
function startServer(label, env = {}, execArgv = []) {
  const log = path.join(LOGS, `${label}.log`);
  const fd = fs.openSync(log, "w");
  const full = { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", HALL_MOCK: "1", OPENAI_API_KEY: "",
    HALL_DIR: path.join(TMP, "hall"), PERF_LOG: path.join(TMP, "perf.log"), ...env };
  delete full.SPACE_RESPAWN_OF;
  if (!env.V18R_COPY) delete full.V18R_COPY;
  const child = spawn(process.execPath, [...execArgv, "server.js"], { cwd: ROOT, stdio: ["ignore", fd, fd], env: full });
  fs.closeSync(fd);
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal, at: now() })));
  started.push(child.pid);
  return { child, pid: child.pid, exited, log };
}

// ---- HTTP and the event stream ----
async function info(timeoutMs = 800) {
  try {
    const r = await fetch(`${BASE}/info`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function get(pathname) {
  try { const r = await fetch(`${BASE}${pathname}`, { signal: AbortSignal.timeout(3000) }); return { status: r.status, json: await r.json().catch(() => null) }; }
  catch (e) { return { status: 0, json: null, error: e.message }; }
}
async function post(pathname, body) {
  const t0 = now();
  try {
    const r = await fetch(`${BASE}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, ms: now() - t0 };
  } catch (e) { return { status: 0, json: null, ms: now() - t0, error: e.message }; }
}
async function waitFor(fn, timeoutMs, stepMs = 50) {
  const t0 = now();
  while (now() - t0 < timeoutMs) { const v = await fn(); if (v) return v; await sleep(stepMs); }
  return null;
}
function stream(pathname) {
  const s = { msgs: [], ended: null, endedAt: 0 };
  s.req = http.get(`${BASE}${pathname}`, (res) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data: ")) { try { s.msgs.push({ m: JSON.parse(line.slice(6)), at: now() }); } catch {} }
      }
    });
    res.on("end", () => { if (!s.ended) { s.ended = "end"; s.endedAt = now(); } });
    res.on("close", () => { if (!s.ended) { s.ended = "close"; s.endedAt = now(); } });
  });
  s.req.on("error", () => { if (!s.ended) { s.ended = "error"; s.endedAt = now(); } });
  s.find = (type) => s.msgs.find((x) => x.m && x.m.type === type) || null;
  s.first = (type) => (s.find(type) || {}).m || null;
  s.close = () => { try { s.req.destroy(); } catch {} };
  return s;
}
const inTick = (t, name) => !!t && [...(t.players || []), ...(t.waiting || [])].some((p) => p && p.name === name);

// One restart: POST /restart (twice at once: one 200, one 409), then the restart message on both streams before they close,
// the old process's exit, and the first /info answer from a server with another session id. Returns the new session.
async function restartOnce(tag, s1, { oldExit, how }) {
  const big = stream("/events?screen=big"), phone = stream("/events?player=ana");
  await waitFor(() => big.first("world") && phone.first("world"), 3000);
  check(`${tag} world messages carry the session (big screen and phone)`, big.first("world")?.session === s1 && phone.first("world")?.session === s1,
    `${big.first("world")?.session} / ${phone.first("world")?.session}`);
  let lastOld = 0, firstNew = 0, s2 = null;
  const T0 = now();
  const poller = (async () => {
    while (now() - T0 < 40000) {
      const j = await info(500);
      if (j && j.session === s1) lastOld = now();
      else if (j && j.session && j.session !== s1) { firstNew = now(); s2 = j.session; return; }
      await sleep(40);
    }
  })();
  const [a, b] = await Promise.all([post("/restart", { confirm: true }), sleep(30).then(() => post("/restart", { confirm: true }))]);
  const ok = [a, b].find((r) => r.status === 200), other = [a, b].find((r) => r !== ok);
  check(`${tag} POST /restart {confirm:true} → 200 how:"${how}" with the old session`, !!ok && ok.json && ok.json.ok === true && ok.json.how === how && ok.json.session === s1,
    `statuses ${a.status}/${b.status}, how ${ok && ok.json && ok.json.how}`);
  check(`${tag} a second POST while restarting → 409 "already restarting"`, !!other && other.status === 409 && other.json && other.json.error === "already restarting", `status ${other && other.status}`);
  timings[`${tag}.answerMs`] = r0(ok ? ok.ms : NaN);
  await waitFor(() => big.ended && phone.ended, 5000);
  const rb = big.find("restart"), rp = phone.find("restart");
  check(`${tag} both streams hear {type:"restart", session} before they close`, !!rb && !!rp && rb.m.session === s1 && rp.m.session === s1 && rb.at <= big.endedAt && rp.at <= phone.endedAt,
    `big ${rb ? r0(rb.at - T0) : "-"} ms → closed ${big.ended} ${r0(big.endedAt - T0)} ms; phone ${rp ? r0(rp.at - T0) : "-"} ms → ${phone.ended} ${r0(phone.endedAt - T0)} ms`);
  timings[`${tag}.restartMsgMs`] = r0(rb ? rb.at - T0 : NaN);
  timings[`${tag}.streamsClosedMs`] = r0(Math.max(big.endedAt, phone.endedAt) - T0);
  if (oldExit) {
    const ex = await Promise.race([oldExit, sleep(5000).then(() => null)]);
    check(`${tag} the old process exits with code 0`, ex && ex.code === 0, ex ? `code ${ex.code} after ${r0(ex.at - T0)} ms` : "still running after 5 s");
    timings[`${tag}.oldExitMs`] = r0(ex ? ex.at - T0 : NaN);
  }
  return { big, phone, T0, poller, get s2() { return s2; }, get firstNew() { return firstNew; }, get lastOld() { return lastOld; } };
}

async function scenarioRespawn() {
  console.log("\n== A: self-respawn (KEEPALIVE=0) ==");
  const srv = startServer("A-respawn", { KEEPALIVE: "0" });
  const tUp = now();
  const up = await waitFor(() => info(), 15000, 100);
  check("A1 GET /info answers with a session id", up && typeof up.session === "string" && up.session.length >= 10, up ? `${up.session}, up in ${r0(now() - tUp)} ms` : "no answer");
  if (!up) return;
  const s1 = up.session;
  check("A2 our server holds the port", listeners().includes(srv.pid), `pid ${srv.pid}, listeners ${listeners().join(",")}`);
  const join = await post("/join", { player: "ana", device: "v18restartdevice01" });
  check("A3 ana joins", join.status === 200 && join.json && join.json.player === "ana", `status ${join.status}`);
  const bad1 = await post("/restart", {}), bad2 = await post("/restart", { confirm: "yes" });
  check("A4 POST /restart without confirm:true → 400, nothing happens", bad1.status === 400 && bad2.status === 400 && (await info())?.session === s1, `${bad1.status}/${bad2.status}`);
  const pre = stream("/events?screen=big");
  await waitFor(() => pre.first("tick"), 3000);
  check("A5 the tick lists ana before the restart", inTick(pre.first("tick"), "ana"), `${(pre.first("tick")?.players || []).length} player(s)`);
  pre.close();

  const r = await restartOnce("A6", s1, { oldExit: srv.exited, how: "respawn" });
  await r.poller;
  check("A7 a new server answers /info with another session id", !!r.s2 && r.s2 !== s1, `${s1} → ${r.s2}`);
  timings["A.newSessionMs"] = r0(r.firstNew - r.T0);
  timings["A.downtimeMs"] = r0(r.firstNew - r.lastOld);
  const pids = listeners();
  const logged = /RESTART: new server pid (\d+)/.exec(fs.readFileSync(srv.log, "utf8"));
  check("A8 the port is held by the respawned copy (another pid, the one the old server logged)", pids.length === 1 && pids[0] !== srv.pid && logged && Number(logged[1]) === pids[0],
    `old ${srv.pid}, now ${pids.join(",")}, logged ${logged && logged[1]}`);
  const post1 = stream("/events?screen=big");
  await waitFor(() => post1.first("world") && post1.first("tick"), 3000);
  check("A9 the new world has the new session and nobody in it", post1.first("world")?.session === r.s2 && !inTick(post1.first("tick"), "ana"),
    `world.session ${post1.first("world")?.session}, tick players ${(post1.first("tick")?.players || []).length}`);
  post1.close();
  const input = await post("/input", { type: "input", player: "ana", action: "boost", down: true });
  check("A10 ana is gone: her input is a 409 \"join first\"", input.status === 409 && input.json && input.json.error === "join first", `status ${input.status}`);
  const hall = await get("/hall");
  check("A11 the Hall of Fame is a new, empty session", hall.status === 200 && hall.json && Array.isArray(hall.json.entries) && hall.json.entries.length === 0, `status ${hall.status}, ${hall.json && hall.json.entries && hall.json.entries.length} entries`);
  const copyLog = fs.readFileSync(srv.log, "utf8");
  check("A12 the copy logged its start on the same output", /\(restarted, session /.test(copyLog), "");

  // the respawned copy restarts too (its parent is gone: it respawns again)
  await post("/join", { player: "ana", device: "v18restartdevice01" });
  const r2 = await restartOnce("A13", r.s2, { oldExit: null, how: "respawn" });
  await r2.poller;
  const pids2 = listeners();
  check("A14 a second restart from the respawned copy: another session and pid", !!r2.s2 && r2.s2 !== r.s2 && pids2.length === 1 && pids2[0] !== pids[0], `${r.s2} → ${r2.s2}, pid ${pids[0]} → ${pids2.join(",")}`);
  timings["A13.newSessionMs"] = r0(r2.firstNew - r2.T0);
  timings["A13.downtimeMs"] = r0(r2.firstNew - r2.lastOld);
  check("A15 the first respawned copy exited", !alive(pids[0]), `pid ${pids[0]}`);
  await stopPort();
  check("A16 the port is free after stopping it by PID", listeners().length === 0, listeners().join(","));
}

async function scenarioSupervisor() {
  console.log("\n== B: under a supervisor (KEEPALIVE=1) ==");
  const srv = startServer("B-supervisor", { KEEPALIVE: "1" });
  const up = await waitFor(() => info(), 15000, 100);
  check("B1 up", !!up, up && up.session);
  if (!up) return;
  const s1 = up.session;
  await post("/join", { player: "ana", device: "v18restartdevice01" });
  const r = await restartOnce("B2", s1, { oldExit: srv.exited, how: "supervisor" });
  check("B3 nothing took the port after the exit (the supervisor does)", listeners().length === 0, listeners().join(","));
  const tLoop = now();
  const again = startServer("B-supervisor-2", { KEEPALIVE: "1" });   // the keep-alive loop runs node server.js again
  await r.poller;
  check("B4 the supervisor's fresh server has another session id", !!r.s2 && r.s2 !== s1, `${s1} → ${r.s2} (${r0(r.firstNew - tLoop)} ms after the loop started it)`);
  timings["B.answerMs"] = timings["B2.answerMs"];
  timings["B.freshServerUpMs"] = r0(r.firstNew - tLoop);
  await stop(again.pid);
  await stopPort();
  check("B5 the port is free after stopping it by PID", listeners().length === 0, listeners().join(","));
}

async function scenarioFailedCopy(mode) {
  const tag = mode === "hang" ? "D" : "C";
  console.log(`\n== ${tag}: the respawned copy ${mode === "hang" ? "never says it loaded" : "crashes at start"} ==`);
  const srv = startServer(`${tag}-copy-${mode}`, { KEEPALIVE: "0", V18R_COPY: mode }, ["--require", "./dev/v18-restart/copy-fails.cjs"]);
  const up = await waitFor(() => info(), 15000, 100);
  check(`${tag}1 up (the preload leaves the first server alone)`, !!up, up && up.session);
  if (!up) return;
  const s1 = up.session;
  const big = stream("/events?screen=big");
  await waitFor(() => big.first("world"), 3000);
  const res = await post("/restart", { confirm: true });
  check(`${tag}2 POST /restart → 500 "restart failed"`, res.status === 500 && res.json && res.json.error === "restart failed", `status ${res.status} after ${r0(res.ms)} ms`);
  timings[`${tag}.failMs`] = r0(res.ms);
  await sleep(500);
  const j = await info();
  check(`${tag}3 the old server goes on: same session, same pid, the stream still open, no restart message`,
    j && j.session === s1 && listeners().includes(srv.pid) && !big.ended && !big.find("restart"), `session ${j && j.session}, stream ${big.ended || "open"}`);
  const log = fs.readFileSync(srv.log, "utf8");
  const why = /RESTART: the new server \(pid (\d+)\) did not start \((.+?)\)/.exec(log);
  check(`${tag}4 the server logged why`, !!why, why ? `pid ${why[1]}: ${why[2]}` : "no log line");
  const strays = listeners().filter((p) => p !== srv.pid);
  const copyPid = why ? Number(why[1]) : 0;
  await waitFor(() => !alive(copyPid), 3000);
  check(`${tag}5 no copy left behind (not listening, not running)`, strays.length === 0 && copyPid > 0 && !alive(copyPid), `strays ${strays.join(",") || "none"}, copy ${copyPid} ${alive(copyPid) ? "ALIVE" : "gone"}`);
  const again = await post("/restart", {});
  check(`${tag}6 the server takes the next request (not stuck "restarting")`, again.status === 400, `status ${again.status}`);
  big.close();
  await stop(srv.pid);
  await stopPort();
  check(`${tag}7 the port is free after stopping it by PID`, listeners().length === 0, listeners().join(","));
}

const tStart = Date.now();
if (listeners().length) { console.error(`port ${PORT} is in use (pids ${listeners().join(",")}): not ours, giving up`); process.exit(2); }
try {
  await scenarioRespawn();
  await scenarioSupervisor();
  await scenarioFailedCopy("crash");
  await scenarioFailedCopy("hang");
} catch (e) {
  check("no exception in the proof itself", false, e && e.stack);
} finally {
  for (const pid of started) await stop(pid);
  await stopPort();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}
const out = { at: new Date(tStart).toISOString(), port: PORT, node: process.version, passed: results.length - failed, failed, timings, results };
fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\n${results.length - failed}/${results.length} passed in ${((Date.now() - tStart) / 1000).toFixed(1)} s · timings (ms): ${JSON.stringify(timings)}`);
console.log(`left on port ${PORT}: ${listeners().length ? listeners().join(",") : "nothing"}`);
process.exit(failed ? 1 : 0);
