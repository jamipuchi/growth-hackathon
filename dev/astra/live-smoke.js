// Live smoke test of astra.js against the real OpenAI API. For the orchestrator, with the real key in the env or .env.
//   node dev/astra/live-smoke.js [controller.png]
// Without an argument it builds a test PNG (no libraries: zlib plus hand-built chunks) of a stick circle on the left
// and two labelled boxes, FIRE and LAND, on the right, and writes it to dev/astra/test-controller.png.
// Runs one controller call and one button call (region = the LAND box) and prints the layouts and times.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 512, H = 256;

// 5x7 bitmap glyphs for the labels.
const FONT = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};

function drawTestImage() {
  const px = new Uint8Array(W * H).fill(235); // greyscale paper
  const ink = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = 30; };
  const dot = (x, y, r = 2) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) ink(Math.round(x + dx), Math.round(y + dy)); };
  for (let y = 20; y < H; y += 24) for (let x = 0; x < W; x++) px[y * W + x] = 205; // ruled paper lines
  // Stick: a circle with a knob and four arrows.
  for (let a = 0; a < Math.PI * 2; a += 0.01) dot(105 + Math.cos(a) * 70, 140 + Math.sin(a) * 70);
  for (let a = 0; a < Math.PI * 2; a += 0.02) dot(105 + Math.cos(a) * 18, 140 + Math.sin(a) * 18);
  const box = (x0, y0, x1, y1) => { for (let x = x0; x <= x1; x++) { dot(x, y0); dot(x, y1); } for (let y = y0; y <= y1; y++) { dot(x0, y); dot(x1, y); } };
  const text = (s, x0, y0, scale) => [...s].forEach((ch, i) => FONT[ch].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === "1") for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) ink(x0 + (i * 6 + x) * scale + dx, y0 + y * scale + dy);
  })));
  box(330, 140, 490, 230); text("FIRE", 352, 164, 5);
  box(300, 25, 440, 105); text("LAND", 315, 48, 5);
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(gray) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit greyscale
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W + 1)] = 0; Buffer.from(gray.buffer, y * W, W).copy(raw, y * (W + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function main() {
  let file = process.argv[2];
  if (!file) {
    file = path.join(__dirname, "test-controller.png");
    fs.writeFileSync(file, encodePng(drawTestImage()));
    console.log(`wrote ${path.relative(process.cwd(), file)} (${W}x${H})`);
  }
  const image = "data:image/png;base64," + fs.readFileSync(file).toString("base64");
  const Astra = require("../../astra.js");
  const outDir = path.join(require("os").tmpdir(), "astra-smoke");
  Astra._internals.setDir(outDir); // keep the real controllers/ folder clean
  console.log(`saving to ${outDir}`);

  let t0 = Date.now();
  const controller = await Astra.generate({ player: "smoke", kind: "controller", image, speculative: false, requestId: "smoke-1", source: "photo" });
  console.log(`controller: ${Date.now() - t0} ms`, JSON.stringify(controller, null, 1));

  t0 = Date.now();
  const button = await Astra.generate({ player: "smoke", kind: "button", image, requestId: "smoke-2", region: { x: 0.57, y: 0.08, w: 0.3, h: 0.36 } });
  console.log(`button: ${Date.now() - t0} ms`, JSON.stringify(button, null, 1));

  t0 = Date.now();
  const again = await Astra.generate({ player: "smoke", kind: "controller", image });
  console.log(`controller again (cache): ${Date.now() - t0} ms, ok=${again.ok}`);

  const good = controller.ok && controller.layout.source === "model" && button.ok && button.layout.buttons.length === 1;
  console.log(good ? "LIVE SMOKE OK" : "LIVE SMOKE FAILED (see above; source 'default' means the 4 s timeout fired)");
  process.exit(good ? 0 : 1);
}

main();
