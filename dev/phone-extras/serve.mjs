import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };

http
  .createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const file = path === "/" ? "/dev/phone-extras/demo.html" : path;
      const buf = await readFile(join(root, file));
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(buf);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(8111, () => console.log("phone-extras demo on http://localhost:8111/"));
