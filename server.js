// Tiny no-dependency server: static files + a relay from phone controllers to the game screen.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8000;
const ROOT = __dirname;
const CONTROLLERS_DIR = path.join(ROOT, "controllers");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".css": "text/css" };
const screens = new Set();

fs.mkdirSync(CONTROLLERS_DIR, { recursive: true });

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  screens.forEach((res) => res.write(line));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const safeName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

async function handlePost(req, res, url) {
  const body = await readBody(req);
  if (url.pathname === "/input") {
    broadcast(JSON.parse(body));
  } else if (url.pathname === "/controller") {
    const player = safeName(url.searchParams.get("player"));
    if (!player) throw new Error("missing player");
    const png = Buffer.from(body.replace(/^data:image\/png;base64,/, ""), "base64");
    fs.writeFileSync(path.join(CONTROLLERS_DIR, `${player}.png`), png);
    fs.rmSync(path.join(CONTROLLERS_DIR, `${player}.json`), { force: true });
    broadcast({ type: "join", player });
  } else {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(204).end();
}

function serveStatic(res, url) {
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(": connected\n\n");
      screens.add(res);
      req.on("close", () => screens.delete(res));
    } else if (req.method === "POST") {
      await handlePost(req, res, url);
    } else {
      serveStatic(res, url);
    }
  } catch (err) {
    console.error(err);
    res.writeHead(400).end(String(err.message));
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Draw It Live on http://localhost:${PORT}`));
