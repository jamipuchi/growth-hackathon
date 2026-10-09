// Lobby QR check: big screen with ?join=<LAN URL>, screenshot + BarcodeDetector-free check that the QR canvas exists.
//   node dev/int-client/qr-shot.mjs [--port 8125]
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 8125);
const server = spawn(process.execPath, ["server.js"], { cwd: path.resolve(HERE, "../.."), env: { ...process.env, PORT: String(PORT), HTTPS_PORT: "0", ASTRA_MOCK: "1", OPENAI_API_KEY: "" }, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let k = 0; k < 50; k++) { if (await new Promise((r) => http.get(`http://127.0.0.1:${PORT}/space.html`, (res) => { res.resume(); r(true); }).on("error", () => r(false)))) break; await sleep(200); }
  const { chromium } = require(process.env.PW_CORE || "/Users/jaumepuig/Documents/linkedin/node_modules/playwright-core");
  const b = await chromium.launch({ executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`http://127.0.0.1:${PORT}/space.html?join=http://192.168.1.23:${PORT}/controller.html`);
  await sleep(2500);
  const info = await p.evaluate(() => ({ qr: !!document.querySelector("#qr canvas"), w: document.querySelector("#qr canvas")?.width, url: document.getElementById("joinUrl").textContent }));
  await p.screenshot({ path: path.join(HERE, "lobby-qr-big.png") });
  console.log(JSON.stringify(info));
  await b.close();
} finally { server.kill("SIGTERM"); }
