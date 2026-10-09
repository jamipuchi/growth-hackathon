// int-client input check against the real server: the keyboard player on the big screen (Chromium 1440x900) and
// the phone's default controller (WebKit, iPhone 13 landscape 844x390 @3, touch) both reach world.js.
//   node dev/int-client/inputs.mjs [--port 8121]
// Checks, from the server's own ticks: keyboard joins, readies and shoots (space); the phone readies with a tap,
// steers with the stick (yaw changes), shoots (held SHOOT), and boosts (flags.boost). Exit 0 when all pass.
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const PORT = Number(argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : 8121);
const BASE = `http://127.0.0.1:${PORT}`;
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = (prefix) => fs.readdirSync(CACHE).filter((d) => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest("chromium"), "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const WEBKIT = path.join(CACHE, newest("webkit"), "pw_run.sh");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`); };

let tick = null;
const seen = { keyboardBullets: 0, phoneBullets: 0, phoneBoost: false };
function events() {
  return http.get(`${BASE}/events`, (res) => {
    let buf = "";
    res.setEncoding("utf8");
    res.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data:")) {
          let m; try { m = JSON.parse(line.slice(5)); } catch { continue; }
          if (m.type !== "tick") continue;
          tick = m;
          const kb = m.players.find((p) => p.name === "keyboard"), ph = m.players.find((p) => p.name === "e2e");
          for (const b of m.bullets) { if (kb && b[4] === kb.color) seen.keyboardBullets++; if (ph && b[4] === ph.color) seen.phoneBullets++; }
          if (ph && ph.flags.boost) seen.phoneBoost = true;
        }
      }
    });
  });
}

const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", PERF_LOG: path.join(HERE, "inputs-perf.log"), OPENAI_API_KEY: "" }, stdio: "ignore" });
const browsers = [];
async function main() {
  for (let k = 0; k < 50; k++) { const up = await new Promise((r) => http.get(`${BASE}/space.html`, (res) => { res.resume(); r(res.statusCode === 200); }).on("error", () => r(false))); if (up) break; await sleep(200); }
  const es = events();
  const { chromium, webkit } = require(PW_CORE);
  const chrome = await chromium.launch({ executablePath: CHROME, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  browsers.push(chrome);
  const big = await (await chrome.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const wk = await webkit.launch({ executablePath: WEBKIT });
  browsers.push(wk);
  const phone = await (await wk.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA })).newPage();
  const errors = [];
  for (const [n, p] of [["big", big], ["phone", phone]]) { p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errors.push(`${n}: ${m.text()}`)); }
  await Promise.all([big.goto(`${BASE}/space.html`), phone.goto(`${BASE}/controller.html`)]);
  await phone.evaluate(() => localStorage.clear()); await phone.reload();

  // Phone: join, default controller, Ready (a real touch tap).
  await phone.waitForFunction(() => window.__sp && document.readyState === "complete");
  await phone.fill("#name", "e2e");
  await phone.locator("#joinForm button").tap();
  await phone.waitForFunction(() => window.__sp.screen === "draw");
  await phone.locator("#useDefault").tap();
  await phone.waitForFunction(() => window.__sp.screen === "play");
  await phone.locator("#readyBtn").tap();
  // Keyboard: the first key joins the "keyboard" player; Enter is ready.
  await big.click("body");
  await big.keyboard.press("Enter");
  await sleep(1500);
  const kb0 = tick.players.find((p) => p.name === "keyboard");
  ok("keyboard player joined from the big screen", !!kb0);
  ok("phone player joined (default controller)", !!tick.players.find((p) => p.name === "e2e"));
  for (let k = 0; k < 60 && tick.phase === "lobby"; k++) await sleep(250);
  ok("both ready → round starts", tick.phase === "playing", tick.phase);
  await sleep(500);

  // Keyboard: hold space (shoot) and the right arrow (turn).
  const kbYaw0 = tick.players.find((p) => p.name === "keyboard").yaw;
  await big.keyboard.down(" "); await big.keyboard.down("ArrowRight");
  await sleep(1200);
  await big.keyboard.up(" "); await big.keyboard.up("ArrowRight");
  const kbYaw1 = tick.players.find((p) => p.name === "keyboard").yaw;
  ok("keyboard space shoots", seen.keyboardBullets > 0, `${seen.keyboardBullets} bullet sightings`);
  ok("keyboard arrow turns", Math.abs(kbYaw1 - kbYaw0) > 0.3, `yaw ${kbYaw0.toFixed(2)} → ${kbYaw1.toFixed(2)}`);

  // Phone: real touchscreen holds via synthetic touch pointers on the hit layer (the stick + SHOOT), and a tap on BOOST.
  const yaw0 = tick.players.find((p) => p.name === "e2e").yaw;
  await phone.evaluate(async () => {
    const hits = document.getElementById("hits"), r = hits.getBoundingClientRect();
    const L = window.__sp.layout.buttons;
    const stick = L.find((b) => b.type === "stick"), fire = L.find((b) => b.action === "shoot");
    const at = (b, fx = 0.5, fy = 0.5) => ({ clientX: r.left + (b.x + b.w * fx) * r.width, clientY: r.top + (b.y + b.h * fy) * r.height });
    const ev = (type, id, p) => hits.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 31, bubbles: true, cancelable: true, ...p }));
    ev("pointerdown", 31, at(stick));
    ev("pointerdown", 32, at(fire));
    const t = performance.now();
    while (performance.now() - t < 1500) { ev("pointermove", 31, at(stick, 0.95, 0.5)); await new Promise((res) => setTimeout(res, 30)); }
    ev("pointerup", 32, at(fire)); ev("pointerup", 31, at(stick));
  });
  await sleep(300);
  const yaw1 = tick.players.find((p) => p.name === "e2e").yaw;
  ok("phone stick steers", Math.abs(yaw1 - yaw0) > 0.3, `yaw ${yaw0.toFixed(2)} → ${yaw1.toFixed(2)}`);
  ok("phone SHOOT (held) shoots", seen.phoneBullets > 0, `${seen.phoneBullets} bullet sightings`);
  const boost = await phone.evaluate(() => { const r = document.getElementById("hits").getBoundingClientRect(); const b = window.__sp.layout.buttons.find((b) => b.action === "boost"); return { x: r.left + (b.x + b.w / 2) * r.width, y: r.top + (b.y + b.h / 2) * r.height }; });
  await phone.touchscreen.tap(boost.x, boost.y);
  // A tap is short: hold it through a real down/up pair as well.
  await phone.evaluate(async () => {
    const hits = document.getElementById("hits"), r = hits.getBoundingClientRect(), b = window.__sp.layout.buttons.find((x) => x.action === "boost");
    const p = { pointerId: 41, pointerType: "touch", bubbles: true, cancelable: true, clientX: r.left + (b.x + b.w / 2) * r.width, clientY: r.top + (b.y + b.h / 2) * r.height };
    hits.dispatchEvent(new PointerEvent("pointerdown", p)); await new Promise((res) => setTimeout(res, 600)); hits.dispatchEvent(new PointerEvent("pointerup", p));
  });
  await sleep(300);
  ok("phone BOOST boosts", seen.phoneBoost);
  // Phone HUD extras are live: vitals (health/shield/boost) and name tags over other ships.
  const hud = await phone.evaluate(() => ({ vitals: document.querySelectorAll("#vitals .pe-row").length, tags: document.querySelectorAll(".bse-tag").length }));
  ok("phone vitals: health, shield, boost", hud.vitals === 3, JSON.stringify(hud));
  const bigHud = await big.evaluate(() => ({ tags: document.querySelectorAll(".bse-tag").length, feed: !!document.querySelector(".bse-feed"), proj: window.__game.projectPlayers().length }));
  ok("big screen: name tags + kill feed + projectPlayers()", bigHud.tags > 0 && bigHud.feed && bigHud.proj > 0, JSON.stringify(bigHud));
  ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  es.destroy();
}
main().catch((e) => ok("run", false, e.message)).finally(async () => {
  for (const b of browsers) await b.close().catch(() => {});
  server.kill("SIGTERM");
  const pass = results.every((r) => r.pass);
  fs.writeFileSync(path.join(HERE, "inputs-report.json"), JSON.stringify({ measuredAt: new Date().toISOString(), pass, results }, null, 2));
  console.log(pass ? "ALL PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
});
