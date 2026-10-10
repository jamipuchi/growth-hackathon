// HTTPS next to the HTTP server, so phones get a secure context (tilt, camera) on the LAN.
// A self-signed certificate for the laptop's LAN IP is made once with the system `openssl` and cached in .orch-certs/.
// Usage in server.js: require("./https").startHttps(handler)   (handler = the same (req, res) function as HTTP)
// v1.9.2 magic domain (owner 15:05): MAGIC_DOMAIN=local-ip.sh (or --magic-domain local-ip.sh) serves the real wildcard
// certificate kept in .magic-certs/<domain>/ instead of the self-signed one, so phones open
// https://192-168-40-12.local-ip.sh:<port> with no warning (the domain's DNS answers <ip-with-dashes>.<domain> -> that IP).
// The files are downloaded by hand (never committed): local-ip.sh publishes server.pem + server.key, traefik.me
// fullchain.pem + privkey.pem. A missing, expired (< 1 day left) or mismatched cert falls back to the self-signed one.
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CERT_DIR = path.join(__dirname, ".orch-certs");
const MAGIC_DIR = path.join(__dirname, ".magic-certs");
const MAGIC_FILES = [["fullchain.pem", "privkey.pem"], ["server.pem", "server.key"], ["cert.pem", "key.pem"]];
const DAY_MS = 24 * 3600 * 1000;
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

// The magic domain asked for: --magic-domain D on the command line, else MAGIC_DOMAIN; "" when neither (or not a hostname).
function magicDomainFrom(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--magic-domain");
  const d = String((i > 0 && argv[i + 1]) || env.MAGIC_DOMAIN || "").trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : "";
}

// 192.168.40.12 + local-ip.sh -> 192-168-40-12.local-ip.sh (the name the magic DNS resolves back to that IP).
const magicHost = (ip, domain) => `${String(ip).replace(/\./g, "-")}.${domain}`;

// The wildcard cert for `domain` in <dir>/<domain>/, checked: covers *.<domain>, valid now and for more than a day,
// and the key is the cert's key. Returns { key, cert, domain, expires, issuer, files } or { error } (never throws).
function loadMagicCert(domain, { dir = MAGIC_DIR, now = Date.now() } = {}) {
  if (!domain) return { error: "no magic domain" };
  const base = path.join(dir, domain);
  const pair = MAGIC_FILES.find(([c, k]) => fs.existsSync(path.join(base, c)) && fs.existsSync(path.join(base, k)));
  if (!pair) return { error: `no cert + key in ${base}` };
  try {
    const cert = fs.readFileSync(path.join(base, pair[0]));
    const key = fs.readFileSync(path.join(base, pair[1]));
    const x = new crypto.X509Certificate(cert);
    const sans = String(x.subjectAltName || "").split(/,\s*/);
    if (!sans.includes(`DNS:*.${domain}`)) return { error: `cert does not cover *.${domain}` };
    const from = Date.parse(x.validFrom), expires = Date.parse(x.validTo);
    if (!(from <= now)) return { error: `cert not valid before ${x.validFrom}` };
    if (!(expires - now > DAY_MS)) return { error: `cert expires ${x.validTo}` };
    if (!x.checkPrivateKey(crypto.createPrivateKey(key))) return { error: "key does not match the cert" };
    return { key, cert, domain, expires, issuer: x.issuer.replace(/\n/g, ", "), files: pair.map((f) => path.join(base, f)) };
  } catch (err) {
    return { error: `unreadable cert: ${err.message}` };
  }
}

function tunnelCommand(httpPort = HTTP_PORT) {
  return `cloudflared tunnel --url http://localhost:${httpPort}`;
}

function printTunnel(httpPort = HTTP_PORT) {
  console.log("Tunnel fallback (real HTTPS, no certificate warning). Run in another terminal:");
  console.log(`  ${tunnelCommand(httpPort)}`);
  console.log("  then open https://<random>.trycloudflare.com/controller.html on the phone (URL printed by cloudflared).");
}

// server.magic = { domain, expires } when the magic cert is served, else null (server.js builds the phone link from it).
function startHttps(handler, { port = 8443, host = "0.0.0.0", quiet = false, certDir = CERT_DIR,
  magicDomain = magicDomainFrom(), magicDir = MAGIC_DIR } = {}) {
  const magic = magicDomain ? loadMagicCert(magicDomain, { dir: magicDir }) : null;
  const useMagic = !!(magic && !magic.error);
  const { key, cert, created } = useMagic ? magic : ensureCert({ dir: certDir });
  const server = https.createServer({ key, cert }, handler);
  server.magic = useMagic ? { domain: magic.domain, expires: magic.expires } : null;
  server.listen(port, host, () => {
    if (quiet) return;
    const ip = lanIps()[0] || "localhost";
    if (useMagic) {
      const h = magicHost(ip, magic.domain);
      console.log(`HTTPS on https://${h}:${port}  (trusted *.${magic.domain} cert from ${path.dirname(magic.files[0])}, ` +
        `expires ${new Date(magic.expires).toISOString().slice(0, 10)}; no warning, tilt and camera work here)`);
      console.log(`  big screen: https://${h}:${port}/space.html`);
      console.log(`  phones:     https://${h}:${port}/controller.html`);
      console.log(`  https://${ip}:${port} answers too, with a name warning (the cert is for *.${magic.domain})`);
    } else {
      if (magicDomain) console.log(`HTTPS magic domain ${magicDomain} not used: ${magic.error}; serving the self-signed cert`);
      console.log(`HTTPS on https://${ip}:${port}  (self-signed${created ? ", new certificate" : ""}; tilt and camera work here)`);
      console.log(`  big screen: https://${ip}:${port}/space.html`);
      console.log(`  phones:     https://${ip}:${port}/controller.html`);
      console.log('  iPhone: tap "Show Details" → "visit this website" → "Visit Website" once.');
    }
    if (process.argv.includes("--tunnel")) printTunnel();
  });
  return server;
}

module.exports = { startHttps, ensureCert, lanIps, hostNames, tunnelCommand, printTunnel, magicDomainFrom, magicHost, loadMagicCert,
  CERT_DIR, MAGIC_DIR };

// `node https.js` makes (or reuses) the certificate and prints what it covers; `--tunnel` prints the fallback command.
// With MAGIC_DOMAIN (or --magic-domain D) it checks that domain's cert instead (never prints the key).
if (require.main === module && magicDomainFrom()) {
  const d = magicDomainFrom(), m = loadMagicCert(d);
  if (m.error) { console.log(`Magic domain ${d}: not usable (${m.error})`); process.exitCode = 1; }
  else console.log(`Magic domain ${d}: OK, ${m.files[0]}\n  issuer: ${m.issuer}\n  expires: ${new Date(m.expires).toISOString()}\n  phones: https://${magicHost(lanIps()[0] || "127.0.0.1", d)}:8443/controller.html`);
} else if (require.main === module) {
  const c = ensureCert();
  console.log(`${c.created ? "Created" : "Reusing"} ${path.join(CERT_DIR, "cert.pem")}`);
  console.log(`  covers: ${[...c.hosts, ...c.ips].join(", ")}`);
  console.log(`  expires: ${new Date(c.expires).toISOString()}`);
  if (process.argv.includes("--tunnel")) printTunnel();
}
