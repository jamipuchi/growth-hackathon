// Per-entity update cost and heap growth. Run: dev/anim/run-bench.sh  (needs `node dev/anim/serve.mjs`)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pw = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
const browser = await pw.chromium.launch({ executablePath: process.env.PW_EXE, args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"] });
const page = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://127.0.0.1:8113/dev/anim/demo.html?manual=1&nohud=1");
await page.waitForFunction(() => window.demo && window.demo.ready);
const cdp = await page.context().newCDPSession(page);
for (const rate of [1, 4]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const r = await page.evaluate(() => {
    const d = window.demo, N = 20000, dt = 1 / 60;
    const run = (name) => {
      const a = d.ents[name].a, st = d.state[name];
      for (let i = 0; i < 600; i++) a.update(dt, st);
      gc(); const h0 = performance.memory.usedJSHeapSize;
      let worst = 0;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        const k = i % 240;
        st.speed = 0.5 + 0.5 * Math.sin(i * 0.01); st.turn = Math.sin(i * 0.02);
        st.boost = k > 60 && k < 120; st.shield = k > 100 && k < 180; st.drilling = name === "ship" && k > 20 && k < 50; st.digging = name === "person" && k > 130 && k < 170;
        if (k === 0) a.trigger("primary", { verb: "shoot" });
        if (k === 30) a.trigger("hit", {});
        if (k === 200) a.trigger("jump", {});
        const s = performance.now(); a.update(dt, st); const e = performance.now() - s; if (e > worst) worst = e;
      }
      const ms = performance.now() - t0;
      const h1 = performance.memory.usedJSHeapSize;
      return { msPerUpdate: ms / N, worstMs: worst, heapBytesPerUpdate: (h1 - h0) / N };
    };
    return { ship: run("ship"), person: run("person") };
  });
  console.log(`cpu throttle x${rate}`, JSON.stringify(r));
}
await browser.close();
