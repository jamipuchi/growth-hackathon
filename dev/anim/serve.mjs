// Static server for the animation demo. Serves the repo root on port 8113. No dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(root, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(root) || path.basename(file).startsWith(".env")) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  });
}).listen(8113, "127.0.0.1", () => console.log("anim demo on http://127.0.0.1:8113/dev/anim/demo.html"));
