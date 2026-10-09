// Preload for server tests without a key or network: node -r ./dev/astra/fake-openai.cjs server.js
// Answers https://api.openai.com/v1/responses from the recorded corpus answers (dev/gen-corpus/fixtures/{after,confirm}),
// matched by the image's hash; an image with no recording gets HTTP 599. Every other URL uses the real fetch.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CORPUS = path.join(__dirname, "../gen-corpus");
const byImage = new Map();
for (const run of ["after", "confirm", "pad"]) {
  const dir = path.join(CORPUS, "fixtures", run);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    const f = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const call = f.calls.find((c) => c.status === 200 && c.response);
    if (call) byImage.set(f.imageSha, call.response);
  }
}
const realFetch = globalThis.fetch;
let served = 0;
globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith("https://api.openai.com/")) return realFetch(url, opts);
  const req = JSON.parse(opts.body);
  const image = ((req.input[0].content.find((c) => c.type === "input_image") || {}).image_url) || "";
  const body = byImage.get(crypto.createHash("sha1").update(image).digest("hex"));
  served++;
  if (process.env.FAKE_OPENAI_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_OPENAI_DELAY_MS)));
  if (!body) return new Response(JSON.stringify({ error: { message: "no fixture for this image" } }), { status: 599 });
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
process.on("exit", () => process.stderr.write(`fake-openai: ${served} request(s) answered from fixtures\n`));
