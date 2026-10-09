const { webkit, devices } = require("/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
(async () => {
  const b = await webkit.launch({executablePath: process.env.HOME+"/Library/Caches/ms-playwright/webkit-2311/pw_run.sh"});
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
  const p = await ctx.newPage();
  p.on("console", (m) => console.log("console:", m.text()));
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p.goto("http://localhost:8111/");
  await p.waitForSelector(".pe-vitals");
  const click = (id) => p.click("#b-" + id);
  const shot = (n) => p.screenshot({ path: `shots/${n}.png` });
  await p.waitForTimeout(300);
  await shot("01-full-3of5");
  await click("hit"); await p.waitForTimeout(80); await shot("02-hit-flash");
  await click("hurt"); await click("1_of_5"); await p.waitForTimeout(500); await shot("03-hurt-1left");
  await click("low"); await p.waitForTimeout(500); await shot("04-low");
  await click("dead"); await click("none_space_"); await p.waitForTimeout(300); await shot("05-dead-closed-space");
  await click("none_planet_"); await p.waitForTimeout(200); await shot("06-closed-planet");
  await click("full"); await click("3_of_5");
  for (const s of ["drill", "landing", "shovel"]) { await click(s); await p.waitForTimeout(3000); await shot("sketch-" + s); }
  // cost
  const r = await p.evaluate(() => {
    const { vitals, count, S, C } = window.__pe; const out = {};
    const run = (name, fn, n = 5000) => { for (let i = 0; i < 500; i++) fn(i); const t = performance.now(); for (let i = 0; i < n; i++) fn(i); out[name] = (performance.now() - t) / n; };
    run("vitals_unchanged", () => vitals.update(S));
    run("vitals_changing", (i) => vitals.update({ hp: 50 + (i % 50), maxHp: 100, shieldEnergy: (i % 100) / 100, boostEnergy: (i % 77) / 77, dead: false, respawnIn: 0 }));
    run("count_unchanged", () => count.update(C));
    run("count_changing", (i) => count.update({ left: i % 6, max: 5, world: "space" }));
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
