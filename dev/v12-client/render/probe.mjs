// Render agent: do the browsers launch at all? (each attempt closes what it opened)
import { launchBig, launchPhoneBrowser, runCleanups } from "./lib2.mjs";
const t0 = Date.now(); const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
try { const b = await launchBig(); await b.page.setContent("<title>x</title><canvas id=c></canvas>"); const gl = await b.page.evaluate(() => !!document.getElementById("c").getContext("webgl2")); console.log(`chromium ok ${lap()} webgl2=${gl}`); await b.browser.close(); } catch (e) { console.log(`chromium FAILED ${lap()}: ${String(e.message).split("\n")[0]}`); }
try { const pb = await launchPhoneBrowser(); const { page } = await pb.newPhone(); await page.setContent("<canvas id=c></canvas>"); const gl = await page.evaluate(() => !!document.getElementById("c").getContext("webgl2") || !!document.getElementById("c").getContext("webgl")); console.log(`webkit ok ${lap()} webgl=${gl}`); await pb.browser.close(); } catch (e) { console.log(`webkit FAILED ${lap()}: ${String(e.message).split("\n")[0]}`); }
await runCleanups(); process.exit(0);
