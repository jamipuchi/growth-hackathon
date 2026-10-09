// HTTPS next to the HTTP server, so phones get a secure context (tilt, camera) on the LAN.
// A self-signed certificate for the laptop's LAN IP is made once with the system `openssl` and cached in .orch-certs/.
// Usage in server.js: require("./https").startHttps(handler)   (handler = the same (req, res) function as HTTP)
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CERT_DIR = path.join(__dirname, ".orch-certs");
const CERT_DAYS = 30;
const HTTP_PORT = 8000;

function lanIps() {
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) ips.push({ name, ip: a.address });
    }
  }
  // Wi-Fi first (en0 on a Mac), then everything else.
  ips.sort((a, b) => (b.name === "en0") - (a.name === "en0"));
  return ips.map((a) => a.ip);
}

function hostNames() {
  const names = new Set(["localhost", os.hostname()]);
  try {
    const local = execFileSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (local) names.add(`${local}.local`);
  } catch {}
  return [...names].filter(Boolean);
}

// iOS accepts a TLS cert only with: RSA >= 2048, SHA-2, names in subjectAltName, EKU serverAuth, validity <= 825 days.
function ensureCert({ dir = CERT_DIR, ips = lanIps(), hosts = hostNames() } = {}) {
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const metaFile = path.join(dir, "meta.json");
  const want = { ips: ["127.0.0.1", ...ips].sort(), hosts: [...hosts].sort() };
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const fresh = meta.expires - Date.now() > 24 * 3600 * 1000;
    const covers = want.ips.every((ip) => meta.ips.includes(ip)) && want.hosts.every((h) => meta.hosts.includes(h));
    if (fresh && covers && fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), created: false, ...meta };
    }
  } catch {}

  fs.mkdirSync(dir, { recursive: true });
  const san = [...want.hosts.map((h) => `DNS:${h}`), ...want.ips.map((ip) => `IP:${ip}`)].join(",");
  const cnf = path.join(dir, "openssl.cnf");
  fs.writeFileSync(cnf, [
    "[req]", "distinguished_name = dn", "prompt = no", "x509_extensions = v3",
    "[dn]", `CN = Space Party ${ips[0] || "localhost"}`, "O = Space Party (self-signed)",
    "[v3]", "basicConstraints = critical,CA:FALSE", "keyUsage = critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth", `subjectAltName = ${san}`, "",
  ].join("\n"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", String(CERT_DAYS),
    "-keyout", keyFile, "-out", certFile, "-config", cnf], { stdio: ["ignore", "ignore", "pipe"] });
  fs.chmodSync(keyFile, 0o600);
  const meta = { ...want, expires: Date.now() + CERT_DAYS * 24 * 3600 * 1000 };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), created: true, ...meta };
}

function tunnelCommand(httpPort = HTTP_PORT) {
  return `cloudflared tunnel --url http://localhost:${httpPort}`;
}

function printTunnel(httpPort = HTTP_PORT) {
  console.log("Tunnel fallback (real HTTPS, no certificate warning). Run in another terminal:");
  console.log(`  ${tunnelCommand(httpPort)}`);
  console.log("  then open https://<random>.trycloudflare.com/controller.html on the phone (URL printed by cloudflared).");
}

function startHttps(handler, { port = 8443, host = "0.0.0.0", quiet = false, certDir = CERT_DIR } = {}) {
  const { key, cert, created } = ensureCert({ dir: certDir });
  const server = https.createServer({ key, cert }, handler);
  server.listen(port, host, () => {
    if (quiet) return;
    const ip = lanIps()[0] || "localhost";
    console.log(`HTTPS on https://${ip}:${port}  (self-signed${created ? ", new certificate" : ""}; tilt and camera work here)`);
    console.log(`  big screen: https://${ip}:${port}/space.html`);
    console.log(`  phones:     https://${ip}:${port}/controller.html`);
    console.log('  iPhone: tap "Show Details" → "visit this website" → "Visit Website" once.');
    if (process.argv.includes("--tunnel")) printTunnel();
  });
  return server;
}

module.exports = { startHttps, ensureCert, lanIps, hostNames, tunnelCommand, printTunnel, CERT_DIR };

// `node https.js` makes (or reuses) the certificate and prints what it covers; `--tunnel` prints the fallback command.
if (require.main === module) {
  const c = ensureCert();
  console.log(`${c.created ? "Created" : "Reusing"} ${path.join(CERT_DIR, "cert.pem")}`);
  console.log(`  covers: ${[...c.hosts, ...c.ips].join(", ")}`);
  console.log(`  expires: ${new Date(c.expires).toISOString()}`);
  if (process.argv.includes("--tunnel")) printTunnel();
}
