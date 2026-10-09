import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const allowed = new Set(["/bigscreen-extras.js", "/dev/bigscreen-extras/demo.html"]);

const server = http.createServer(async (req, res) => {
  let p = new URL(req.url, "http://x").pathname;
  if (p === "/") p = "/dev/bigscreen-extras/demo.html";
  if (!allowed.has(p)) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(join(root, normalize(p)));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
});
server.listen(8112, () => console.log("bigscreen-extras demo on http://localhost:8112/"));
