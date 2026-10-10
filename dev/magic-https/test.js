// v1.9.2 magic-https (owner 15:05) + public link (owner 15:08). node dev/magic-https/test.js
// Needs .magic-certs/local-ip.sh/server.pem + server.key (see https.js) and DNS for <ip-with-dashes>.local-ip.sh.
// A: MAGIC_DOMAIN=local-ip.sh on 8690 / HTTPS 8691: `curl` WITHOUT -k to https://<ip-dashed>.local-ip.sh:8691 is 200 and
//    /info gives that link; PUBLIC_URL_FILE: a tunnel URL in the file wins (re-read per call), empty / http:// = ignored.
// B: no MAGIC_DOMAIN on 8693 / 8694: the self-signed link on the raw IP, as before (curl without -k fails, with -k is 200).
// C: MAGIC_DOMAIN=traefik.me (no cert there) on 8695 / 8696: falls back to the self-signed cert.
// Servers are this test's own children (ASTRA_MOCK=1), stopped by PID at the end.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const tls = require("tls");
const http = require("http");
const { spawn, execFileSync, spawnSync } = require("child_process");
const { loadMagicCert, magicHost } = require("../../https");

const ROOT = path.join(__dirname, "..", "..");
const DOMAIN = "local-ip.sh";
const ip = execFileSync("ipconfig", ["getifaddr", "en0"], { encoding: "utf8" }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "magic-https-"));
const urlFile = path.join(tmp, "public-url.txt");
const children = [];
let n = 0;
const ok = (t) => { n++; console.log(`ok  ${t}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p, timeout: 3000 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}
function curl(url, insecure = false) {
  const r = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "8", ...(insecure ? ["-k"] : []), url], { encoding: "utf8" });
  return { code: r.stdout.trim(), err: r.stderr.trim(), status: r.status };
}
function peerCert(host, port, servername) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername, rejectUnauthorized: false }, () => { const c = s.getPeerCertificate(); s.end(); resolve(c); });
    s.on("error", reject);
  });
}
async function startServer(port, httpsPort, extraEnv) {
  const env = { ...process.env, PORT: String(port), HTTPS_PORT: String(httpsPort), ASTRA_MOCK: "1", KEEPALIVE: "0",
    PERF_LOG: path.join(tmp, `perf-${port}.log`), ...extraEnv };
  for (const k of Object.keys(extraEnv)) if (extraEnv[k] === undefined) delete env[k];
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let log = "";
  child.stdout.on("data", (c) => (log += c)); child.stderr.on("data", (c) => (log += c));
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { const inf = await getJson(port, "/info"); if (inf.httpsUrl) return { child, info: inf, log: () => log }; } catch {}
  }
  throw new Error(`server on ${port} did not come up:\n${log}`);
}
function stop(child) { if (child && child.exitCode === null) { try { process.kill(child.pid, "SIGTERM"); } catch {} } }

(async () => {
  const magic = loadMagicCert(DOMAIN);
  assert.ok(!magic.error, `magic cert: ${magic.error}`);
  ok(`.magic-certs/${DOMAIN}: covers *.${DOMAIN}, key matches, expires ${new Date(magic.expires).toISOString().slice(0, 10)}`);
  const host = magicHost(ip, DOMAIN);
  assert.strictEqual(host, `${ip.replace(/\./g, "-")}.${DOMAIN}`);

  // ---- A: magic domain + PUBLIC_URL_FILE ----
  fs.writeFileSync(urlFile, "");
  const A = await startServer(8690, 8691, { MAGIC_DOMAIN: DOMAIN, PUBLIC_URL_FILE: urlFile, PUBLIC_URL: undefined });
  const magicUrl = `https://${host}:8691`;
  assert.strictEqual(A.info.httpsUrl, magicUrl);
  assert.strictEqual(A.info.controllerUrl, `${magicUrl}/controller.html`);
  assert.strictEqual(A.info.lanUrl, `http://${ip}:8690`);
  assert.strictEqual(A.info.publicUrl, undefined);
  ok(`/info (empty PUBLIC_URL_FILE): controllerUrl ${A.info.controllerUrl}`);
  assert.match(A.log(), new RegExp(`trusted \\*\\.${DOMAIN.replace(/\./g, "\\.")} cert`));
  ok("startup log names the trusted magic cert");
  const c1 = curl(`${magicUrl}/controller.html`);
  assert.strictEqual(c1.code, "200", `curl without -k: ${c1.code} ${c1.err}`);
  ok(`curl WITHOUT -k ${magicUrl}/controller.html -> 200 (system trust store)`);
  const pc = await peerCert(ip, 8691, host);
  assert.ok(String(pc.subjectaltname).includes(`DNS:*.${DOMAIN}`) && /Let's Encrypt/.test(pc.issuer && pc.issuer.O), JSON.stringify(pc.issuer));
  ok(`served cert: ${pc.subjectaltname}, issuer ${pc.issuer.O} ${pc.issuer.CN}`);

  fs.writeFileSync(urlFile, "https://example.trycloudflare.com\n");
  let inf = await getJson(8690, "/info");
  assert.strictEqual(inf.controllerUrl, "https://example.trycloudflare.com/controller.html");
  assert.strictEqual(inf.publicUrl, "https://example.trycloudflare.com");
  assert.strictEqual(inf.httpsUrl, magicUrl);
  assert.strictEqual(inf.lanUrl, `http://${ip}:8690`);
  ok("PUBLIC_URL_FILE = https://example.trycloudflare.com -> controllerUrl https://example.trycloudflare.com/controller.html (lanUrl / httpsUrl kept)");
  fs.writeFileSync(urlFile, "http://not-secure.example.com\n");
  inf = await getJson(8690, "/info");
  assert.strictEqual(inf.controllerUrl, `${magicUrl}/controller.html`);
  ok("PUBLIC_URL_FILE with an http:// URL is ignored");
  fs.writeFileSync(urlFile, "");
  inf = await getJson(8690, "/info");
  assert.strictEqual(inf.controllerUrl, `${magicUrl}/controller.html`);
  assert.strictEqual(inf.publicUrl, undefined);
  ok("PUBLIC_URL_FILE emptied again -> the magic link (re-read on every /info)");
  fs.unlinkSync(urlFile);
  inf = await getJson(8690, "/info");
  assert.strictEqual(inf.controllerUrl, `${magicUrl}/controller.html`);
  ok("PUBLIC_URL_FILE missing -> the magic link");
  stop(A.child);

  // ---- B: no MAGIC_DOMAIN: the old self-signed behaviour ----
  const B = await startServer(8693, 8694, { MAGIC_DOMAIN: undefined, PUBLIC_URL_FILE: undefined, PUBLIC_URL: undefined });
  assert.strictEqual(B.info.httpsUrl, `https://${ip}:8694`);
  assert.strictEqual(B.info.controllerUrl, `https://${ip}:8694/controller.html`);
  assert.strictEqual(B.info.publicUrl, undefined);
  ok(`no MAGIC_DOMAIN: /info controllerUrl ${B.info.controllerUrl} (raw IP)`);
  const b1 = curl(`https://${ip}:8694/controller.html`);
  assert.notStrictEqual(b1.code, "200", "self-signed must not pass without -k");
  const b2 = curl(`https://${ip}:8694/controller.html`, true);
  assert.strictEqual(b2.code, "200");
  const pb = await peerCert(ip, 8694);
  assert.match(String(pb.subject && pb.subject.O), /self-signed/);
  assert.match(B.log(), /self-signed/);
  ok(`no MAGIC_DOMAIN: self-signed cert (${pb.subject.O}); curl without -k fails (exit ${b1.status}), with -k 200`);
  stop(B.child);

  // ---- C: MAGIC_DOMAIN with no usable cert falls back ----
  const C = await startServer(8695, 8696, { MAGIC_DOMAIN: "traefik.me", PUBLIC_URL_FILE: undefined, PUBLIC_URL: "https://env.example.com/" });
  assert.strictEqual(C.info.httpsUrl, `https://${ip}:8696`);
  assert.strictEqual(C.info.controllerUrl, "https://env.example.com/controller.html");
  assert.match(C.log(), /magic domain traefik\.me not used: .*serving the self-signed cert/);
  const pcc = await peerCert(ip, 8696);
  assert.match(String(pcc.subject && pcc.subject.O), /self-signed/);
  ok("MAGIC_DOMAIN=traefik.me without a cert: logged, self-signed on the raw IP; PUBLIC_URL env (trailing / trimmed) wins");
  stop(C.child);

  await sleep(300);
  console.log(`\nmagic-https: ${n}/${n} passed`);
})().catch((err) => {
  console.error(`FAIL ${err.stack || err}`);
  process.exitCode = 1;
}).finally(() => {
  for (const c of children) stop(c);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
