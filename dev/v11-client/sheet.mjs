// Contact sheets of the tour's screenshots: a few downscaled overview PNGs instead of 35 full-size images (cheap to look at).
// Pure Node (a small PNG decoder + box-filter downscale + the stroke font of samples.cjs for the labels), no dependencies.
//   node dev/v11-client/sheet.mjs [--dir dev/v11-client/shots] [--out dir] [--match prefix] [--cols N]
// Writes <dir>/contact-big.png (1440x900 big-screen shots), contact-phone.png (landscape phone shots), contact-portrait.png
// (portrait phone shots); each cell is labelled with its file name. shots.mjs calls this at the end of a tour.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const Samples = createRequire(import.meta.url)("./samples.cjs");

// ---- PNG decode (8-bit, not interlaced: what Playwright writes) ------------------------------------------------------------------

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, channels, ctype, data: out, palette };
}

// RGB of the image scaled into dw x dh (box filter); alpha is composited on `bg`.
function scaleRgb(img, dw, dh, bg = [255, 255, 255]) {
  const { w, h, channels, ctype, data, palette } = img;
  const out = new Uint8Array(dw * dh * 3);
  const px = (i) => {
    if (ctype === 0) return [data[i], data[i], data[i], 255];
    if (ctype === 4) return [data[i], data[i], data[i], data[i + 1]];
    if (ctype === 3) { const k = data[i] * 3; return [palette[k], palette[k + 1], palette[k + 2], 255]; }
    return [data[i], data[i + 1], data[i + 2], channels === 4 ? data[i + 3] : 255];
  };
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * h) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * h) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * w) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * w) / dw));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const [pr, pg, pb, pa] = px((sy * w + sx) * channels);
        const al = pa / 255;
        r += pr * al + bg[0] * (1 - al); g += pg * al + bg[1] * (1 - al); b += pb * al + bg[2] * (1 - al); n++;
      }
      const o = (dy * dw + dx) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

// ---- Sheets -------------------------------------------------------------------------------------------------------------------

const BG = [216, 216, 220], LABEL_BG = [245, 245, 247], INK = 40;
const GROUPS = {
  big: { cols: 3, cell: 640, label: "contact-big.png" },
  phone: { cols: 3, cell: 640, label: "contact-phone.png" },
  portrait: { cols: 6, cell: 250, label: "contact-portrait.png" },
};

function drawLabel(sheet, W, x, y, w, h, text) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const o = ((y + yy) * W + x + xx) * 3; sheet[o] = LABEL_BG[0]; sheet[o + 1] = LABEL_BG[1]; sheet[o + 2] = LABEL_BG[2]; }
  const th = Math.min(h - 8, 13), label = text.toUpperCase();
  let size = th;
  while (size > 6 && Samples.textWidth(label, size) > w - 10) size -= 1;
  const strokes = Samples.text(label, 5, Math.round((h - size) / 2), size);
  const cov = Samples.rasterise(strokes, w, h, Math.max(1.2, size / 8));
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const c = cov[yy * w + xx];
    if (c <= 0) continue;
    const o = ((y + yy) * W + x + xx) * 3;
    for (let k = 0; k < 3; k++) sheet[o + k] = Math.round(sheet[o + k] * (1 - c) + INK * c);
  }
}

// files: absolute PNG paths. Returns the written sheet paths. `order` (names) sorts the cells, else alphabetical.
export function makeSheets({ dir, out: outDir = dir, files = null, order = [], match = "", cols = 0 }) {
  const all = (files || fs.readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("contact")).map((f) => path.join(dir, f))).filter((f) => path.basename(f).startsWith(match));
  const rank = (f) => { const i = order.indexOf(path.basename(f, ".png")); return i < 0 ? 1e6 : i; };
  all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const groups = { big: [], phone: [], portrait: [] };
  for (const f of all) {
    let img;
    try { img = decodePng(fs.readFileSync(f)); } catch (e) { console.log(`sheet: skipping ${path.basename(f)}: ${e.message}`); continue; }
    const ratio = img.w / img.h;
    groups[ratio < 0.9 ? "portrait" : ratio < 2 ? "big" : "phone"].push({ f, img, ratio });
  }
  const written = [];
  for (const [name, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const g = GROUPS[name], nCols = Math.min(cols || g.cols, items.length), rows = Math.ceil(items.length / nCols);
    const imgW = g.cell, imgH = Math.round(g.cell / (name === "portrait" ? 0.462 : name === "big" ? 1.6 : 2.16)), labelH = 22, pad = 6;
    const cellW = imgW + pad, cellH = imgH + labelH + pad;
    const W = nCols * cellW + pad, H = rows * cellH + pad;
    const sheet = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { sheet[i * 3] = BG[0]; sheet[i * 3 + 1] = BG[1]; sheet[i * 3 + 2] = BG[2]; }
    items.forEach(({ f, img, ratio }, i) => {
      const cx = pad + (i % nCols) * cellW, cy = pad + Math.floor(i / nCols) * cellH;
      // fit the screenshot inside the cell (letterboxed on the sheet background)
      let dw = imgW, dh = Math.round(imgW / ratio);
      if (dh > imgH) { dh = imgH; dw = Math.round(imgH * ratio); }
      const rgb = scaleRgb(img, dw, dh);
      const ox = cx + Math.floor((imgW - dw) / 2), oy = cy + Math.floor((imgH - dh) / 2);
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const s = (y * dw + x) * 3, o = ((oy + y) * W + ox + x) * 3; sheet[o] = rgb[s]; sheet[o + 1] = rgb[s + 1]; sheet[o + 2] = rgb[s + 2]; }
      drawLabel(sheet, W, cx, cy + imgH, imgW, labelH, path.basename(f, ".png"));
    });
    const out = path.join(outDir, g.label);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(out, Samples.encodePng(W, H, sheet, 3));
    written.push({ file: out, shots: items.length, size: `${W}x${H}` });
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const dir = path.resolve(opt("dir", path.join(HERE, "shots")));
  const t0 = Date.now();
  const written = makeSheets({ dir, out: path.resolve(opt("out", dir)), match: opt("match", ""), cols: Number(opt("cols", 0)) });
  for (const w of written) console.log(`${path.relative(process.cwd(), w.file)}  ${w.shots} shots, ${w.size}`);
  console.log(written.length ? `done in ${((Date.now() - t0) / 1000).toFixed(1)} s` : `no PNG files found in ${dir}`);
}
