// Static server for the inflate demo: the repo root, read-only, on port 8130. Usage: node dev/inflate/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.argv[2]) || 8130;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") return res.writeHead(302, { Location: "/dev/inflate/demo.html" }).end();
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || rel.split("/").some((p) => p.startsWith(".")) || !TYPES[path.extname(file)]) return res.writeHead(404).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)], "Cache-Control": "no-store" }).end(buf);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`inflate demo on http://127.0.0.1:${PORT}/dev/inflate/demo.html`));
