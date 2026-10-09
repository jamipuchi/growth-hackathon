// node dev/https/test.js: startHttps on 8444 with a tiny handler, fetch it (cert checks off for this test only), check the cert.
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { execFileSync } = require("child_process");
const { startHttps, ensureCert, lanIps, tunnelCommand } = require("../../https");

const PORT = 8444;
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), "space-party-certs-"));

function get(host, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host, port: PORT, path: urlPath, rejectUnauthorized: false, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

(async () => {
  const t0 = Date.now();
  const handler = (req, res) => res.writeHead(200, { "Content-Type": "text/plain" }).end(`ok ${req.url}`);
  const server = startHttps(handler, { port: PORT, quiet: true, certDir });
  await new Promise((r) => server.once("listening", r));
  const tCert = Date.now() - t0;
  const ip = lanIps()[0] || "127.0.0.1";
  try {
    for (const host of ["127.0.0.1", ip]) {
      const t = Date.now();
      const r = await get(host, "/controller.html");
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body, "ok /controller.html");
      console.log(`PASS GET https://${host}:${PORT}/controller.html → ${r.status} in ${Date.now() - t} ms`);
    }

    const text = execFileSync("openssl", ["x509", "-in", path.join(certDir, "cert.pem"), "-noout", "-text"], { encoding: "utf8" });
    assert.match(text, new RegExp(`IP Address:${ip.replace(/\./g, "\\.")}`), "SAN has the LAN IP");
    assert.match(text, /TLS Web Server Authentication/, "EKU serverAuth");
    assert.match(text, /sha256WithRSAEncryption/, "SHA-256 signature");
    assert.match(text, /(Public-Key|RSA Public-Key): \(2048 bit\)/, "RSA 2048");
    assert.match(text, /CA:FALSE/, "not a CA");
    const days = execFileSync("openssl", ["x509", "-in", path.join(certDir, "cert.pem"), "-noout", "-startdate", "-enddate"], { encoding: "utf8" });
    const [from, to] = days.trim().split("\n").map((l) => Date.parse(l.split("=")[1]));
    const validDays = Math.round((to - from) / 86400000);
    assert.strictEqual(validDays, 30);
    console.log(`PASS cert: SAN has IP ${ip}, EKU serverAuth, sha256, RSA 2048, CA:FALSE, valid ${validDays} days (created in ${tCert} ms)`);

    const t = Date.now();
    const again = ensureCert({ dir: certDir });
    assert.strictEqual(again.created, false);
    console.log(`PASS cert cached: second call reuses it (${Date.now() - t} ms)`);

    assert.strictEqual(tunnelCommand(), "cloudflared tunnel --url http://localhost:8000");
    console.log(`PASS tunnel command: ${tunnelCommand()}`);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(certDir, { recursive: true, force: true });
  }
  console.log(`ALL PASS in ${Date.now() - t0} ms`);
})().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
