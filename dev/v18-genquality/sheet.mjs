#!/usr/bin/env node
// Screenshots before-after.html for both sets: dev/v18-genquality/before-after-{ships,bodies}.png (Chromium, one browser).
//   node dev/v18-genquality/sheet.mjs [--port 8609] [--before base] [--after v18med]
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const PORT = Number(opt("port", 8609)), BEFORE = opt("before", "base"), AFTER = opt("after", "v18med");
if (PORT < 8600 || PORT > 8609) throw new Error("this lane uses ports 8600-8609");
const PW_CORE = process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core";
const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const newest = fs.readdirSync(CACHE).filter((x) => /^chromium-\d+$/.test(x)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()))[0];
const CHROME = path.join(CACHE, newest, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const server = spawn(process.execPath, [path.join(ROOT, "dev/v14-ship/serve.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
let browser = null;
try {
  await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("exit", () => reject(new Error("serve.mjs exited"))); });
  browser = await require(PW_CORE).chromium.launch({ executablePath: CHROME, headless: true });
  for (const set of ["ships", "bodies"]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 800 } });
    await page.goto(`http://127.0.0.1:${PORT}/dev/v18-genquality/before-after.html?set=${set}&before=${BEFORE}&after=${AFTER}`);
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const out = path.join(HERE, `before-after-${set}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`sheet: ${path.relative(ROOT, out)}`);
    await page.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
