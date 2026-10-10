#!/usr/bin/env node
// A static server for the v14-entity3d dev pages: the repo's public files on 127.0.0.1 (never dotfiles such as .env, never
// controllers/ or .orch/). POST /save?name=<file>.png stores a PNG data URL under dev/v14-entity3d/compare/ (the contact
// sheets and renders the harness takes in the browser).
//   node dev/v14-entity3d/serve.mjs [port=8441]
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PORT = Number(process.argv[2] || 8441);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".glb": "model/gltf-binary", ".css": "text/css", ".svg": "image/svg+xml", ".ktx2": "image/ktx2", ".bin": "application/octet-stream" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/save") {
    const name = String(url.searchParams.get("name") || "").replace(/[^\w./-]/g, "");
    if (!/^[\w-]+(\/[\w.-]+)*\.png$/.test(name) || name.includes("..")) { res.writeHead(400); return res.end("bad name"); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const b64 = body.replace(/^data:image\/png;base64,/, "");
      const file = path.join(HERE, "compare", name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, file: path.relative(ROOT, file) }));
    });
    return;
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "dev/v14-entity3d/view.html";
  if (rel.split("/").some((p) => p.startsWith(".")) || /^(controllers|node_modules)\//.test(rel)) { res.writeHead(403); return res.end("forbidden"); }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`v14-entity3d static server on http://127.0.0.1:${PORT}/ (pid ${process.pid})`));
