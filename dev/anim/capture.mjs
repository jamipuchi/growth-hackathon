// Records frame strips of every animation at 844x390 (iPhone landscape), DPR 2, chromium (swiftshader) or webkit.
// Usage: node dev/anim/capture.mjs [scenarioIds comma separated | all] [chromium|webkit]
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const pw = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const only = (process.argv[2] || "all").split(",");
const engine = process.argv[3] || "chromium";
const shots = path.join(here, "shots");
fs.mkdirSync(shots, { recursive: true });

// frames: seconds at which to grab a frame. steps: [{ at, state?, trig? }]
const S = (id, ent, frames, steps) => ({ id, ent, frames, steps });
const lin = (a, b, n) => Array.from({ length: n }, (_, i) => +(a + ((b - a) * i) / (n - 1)).toFixed(3));
const scenarios = [
  S("ship-idle", "ship", lin(0, 1.8, 8), []),
  S("ship-bank", "ship", lin(0, 1.4, 8), [{ at: 0, state: { speed: 0.6 } }, { at: 0.2, state: { turn: 1 } }, { at: 0.9, state: { turn: -1 } }]),
  S("ship-boost", "ship", lin(0, 1.4, 8), [{ at: 0, state: { speed: 0.5 } }, { at: 0.1, state: { boost: true, speed: 1 } }, { at: 1.0, state: { boost: false, speed: 0.4 } }]),
  S("ship-shoot", "ship", lin(0, 0.42, 8), [{ at: 0.05, trig: ["primary", { verb: "shoot" }] }]),
  S("ship-blast", "ship", lin(0, 0.7, 8), [{ at: 0.05, trig: ["primary", { verb: "blast" }] }]),
  S("ship-drill", "ship", lin(0, 0.7, 8), [{ at: 0.05, state: { drilling: true } }]),
  S("ship-shield", "ship", lin(0, 0.7, 8), [{ at: 0.05, state: { shield: true } }]),
  S("ship-hit", "ship", lin(0, 0.5, 8), [{ at: 0.05, trig: ["hit", { dirX: 0.4, dirZ: 1 }] }]),
  S("ship-die", "ship", lin(0, 1.6, 8), [{ at: 0.05, state: { dead: true } }]),
  S("ship-respawn", "ship", lin(0, 1.0, 8), [{ at: 0, state: { dead: true } }, { at: 0.12, state: { dead: false } }]),
  S("ship-scan", "ship", lin(0, 0.8, 8), [{ at: 0.05, trig: ["use", { verb: "scan" }] }]),
  S("ship-flare", "ship", lin(0, 0.8, 8), [{ at: 0.05, trig: ["use", { verb: "flare" }] }]),
  S("ship-invisible", "ship", lin(0, 0.9, 8), [{ at: 0.05, state: { invisible: true } }]),
  S("ship-emote", "ship", lin(0, 0.9, 8), [{ at: 0.05, trig: ["emote", {}] }]),
  S("ship-teleport", "ship", lin(0, 0.5, 8), [{ at: 0.05, trig: ["move", { verb: "teleport" }] }]),
  S("person-idle", "person", lin(0, 1.8, 8), []),
  S("person-walk", "person", lin(0, 1.2, 8), [{ at: 0, state: { speed: 0.45 } }]),
  S("person-run", "person", lin(0, 0.8, 8), [{ at: 0, state: { speed: 1 } }]),
  S("person-jump", "person", lin(0, 0.9, 8), [{ at: 0.05, trig: ["jump", {}], state: { grounded: false } }, { at: 0.7, state: { grounded: true } }]),
  S("person-dig", "person", lin(0, 1.4, 8), [{ at: 0.05, state: { digging: true } }]),
  S("person-shoot", "person", lin(0, 0.42, 8), [{ at: 0.05, trig: ["primary", { verb: "shoot" }] }]),
  S("person-hit", "person", lin(0, 0.5, 8), [{ at: 0.05, trig: ["hit", { dirX: -0.4, dirZ: 1 }] }]),
  S("person-die", "person", lin(0, 1.5, 8), [{ at: 0.05, state: { dead: true } }]),
  S("person-respawn", "person", lin(0.9, 2.0, 8), [{ at: 0, state: { dead: true } }, { at: 1.0, state: { dead: false } }]),
  S("person-celebrate", "person", lin(0, 2.0, 8), [{ at: 0.05, trig: ["celebrate", {}] }]),
  S("person-stepOut", "person", lin(0, 0.6, 8), [{ at: 0.02, trig: ["stepOut", {}] }]),
  S("person-shield", "person", lin(0, 0.7, 8), [{ at: 0.05, state: { shield: true } }]),
];

const exe = process.env.PW_EXE;
const browser = await pw[engine].launch(exe ? { executablePath: exe } : engine === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } : {});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
page.on("console", (m) => { console.log("[page]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

for (const sc of scenarios) {
  if (only[0] !== "all" && !only.includes(sc.id)) continue;
  await page.goto("http://127.0.0.1:8113/dev/anim/demo.html?manual=1&nohud=1");
  await page.waitForFunction(() => window.demo && window.demo.ready);
  const dt = 1 / 60;
  let t = 0, si = 0, fi = 0;
  const end = sc.frames[sc.frames.length - 1];
  while (fi < sc.frames.length) {
    while (si < sc.steps.length && sc.steps[si].at <= t + 1e-6) {
      const s = sc.steps[si++];
      await page.evaluate(([ent, s]) => {
        if (s.state) Object.assign(window.demo.state[ent], s.state);
        if (s.trig) window.demo.ents[ent].a.trigger(s.trig[0], s.trig[1]);
      }, [sc.ent, s]);
    }
    await page.evaluate((d) => window.demo.step(d), dt);
    t += dt;
    if (t + 1e-6 >= sc.frames[fi]) {
      await page.screenshot({ path: path.join(shots, `${sc.id}-${String(fi).padStart(2, "0")}.png`) });
      fi++;
    }
    if (t > end + 1) break;
  }
  execFileSync("python3", [path.join(here, "strip.py"), sc.id, sc.ent, String(sc.frames.length)]);
  console.log("recorded", sc.id);
}
console.log("update cost ms (both entities)", await page.evaluate(() => window.demo.cost()));
await browser.close();
