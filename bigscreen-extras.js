// Big-screen extras: join QR, kill feed, player name tags. Fortnite-like (chunky, slanted, outlined). No dependencies.
// Sizes are in em: the host page sets --bse-fs (space.html: 1rem, which scales with the screen); default 10px (the phone).
// The look does not read any generic page variable (a page's own --ink or --shadow means something else); the only page input
// is --bse-fs. controller.html also uses createNameTags({ max: 8 }).

const STYLE_ID = "bse-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.bse-qr,.bse-feed,.bse-tags{--bse-fh:"Barlow Condensed",Impact,"Arial Narrow",system-ui,sans-serif;
  --bse-fb:Barlow,system-ui,-apple-system,"Segoe UI",sans-serif;--bse-ink:#120a2e;
  --bse-shadow:#0a0830;--bse-ok:#4ade5a;font-size:var(--bse-fs,10px)}

.bse-qr{display:flex;flex-direction:column;align-items:center;gap:.8em;width:100%;color:#fff;font-family:var(--bse-fb)}
.bse-qr-title{font:italic 900 1.9em/1 var(--bse-fh);text-transform:uppercase;letter-spacing:.03em;
  -webkit-text-stroke:.1em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .1em 0 rgb(10 6 30/.55)}
.bse-qr-tile{box-sizing:border-box;width:100%;background:#fff;border:.3em solid #fff;border-radius:.9em;
  box-shadow:0 0 0 .18em var(--bse-ink),0 .55em 0 .18em var(--bse-shadow)}
.bse-qr-tile canvas{display:block;width:100%;height:auto;aspect-ratio:1/1;image-rendering:pixelated;border-radius:.4em}
.bse-qr-url{font:800 1.15em/1.2 var(--bse-fb);letter-spacing:.02em;color:#ffe9a3;background:rgb(10 6 30/.55);
  padding:.35em .9em;border-radius:.6em;text-align:center;overflow-wrap:anywhere;max-width:100%}

.bse-feed{position:absolute;top:1.8em;right:2.2em;display:flex;flex-direction:column;align-items:flex-end;gap:.5em;
  pointer-events:none;z-index:25;font-family:var(--bse-fb)}
.bse-feed-item{position:relative;isolation:isolate;max-width:24em;padding:.42em 1em .5em 1.3em;
  font:italic 800 1.3em/1.1 var(--bse-fh);text-transform:uppercase;letter-spacing:.02em;color:#fff;text-align:right;
  -webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .1em 0 rgb(10 6 30/.55);
  opacity:0;transform:translateX(2.4em) scale(.92)}
.bse-feed-item::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;
  background:linear-gradient(180deg,rgb(40 29 128/.95),rgb(20 13 66/.95));border:.1em solid rgb(255 255 255/.6);
  border-right:.42em solid var(--c,#9fd8ff);box-shadow:0 .22em 0 var(--bse-shadow)}
.bse-feed-item.hint{font-size:1.1em;font-weight:700}
.bse-feed-item.hint::before{background:linear-gradient(180deg,rgb(120 60 220/.95),rgb(76 34 160/.95))}
.bse-feed-item.in{opacity:1;transform:none;transition:opacity .2s ease-out,transform .34s cubic-bezier(.34,1.56,.64,1)}
.bse-feed-item.out{opacity:0;transform:translateX(1em);transition:opacity .5s ease-in,transform .5s ease-in}

.bse-tags{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10;font-family:var(--bse-fb)}
.bse-tags.n-md{font-size:calc(var(--bse-fs,10px)*.86)}
.bse-tags.n-sm{font-size:calc(var(--bse-fs,10px)*.72)}
.bse-tag{position:absolute;left:0;top:0;width:0;height:0;will-change:transform}
.bse-tag-in{position:absolute;left:0;bottom:0;transform:translateX(-50%)}
.bse-tag-card{position:relative;isolation:isolate;display:flex;flex-direction:column;align-items:center;gap:.28em;transform-origin:50% 100%}
.bse-tag-card.bse-pop{animation:bse-pop .34s cubic-bezier(.34,1.56,.64,1) both}
.bse-tag-top{display:flex;align-items:center;gap:.4em;white-space:nowrap}
.bse-tag-name{font:italic 800 1.35em/1.05 var(--bse-fh);text-transform:uppercase;letter-spacing:.03em;
  -webkit-text-stroke:.16em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .12em 0 rgb(10 6 30/.6)}
.bse-tag-mark,.bse-tag-badge,.bse-tag-sub{display:none}
.bse-tag-bar{width:4.8em;height:.72em;transform:skewX(-14deg);background:rgb(10 6 30/.8);border:.15em solid #fff;
  border-radius:.25em;box-shadow:0 .16em 0 var(--bse-shadow);overflow:hidden}
.bse-tag-fill{width:100%;height:100%;background:linear-gradient(180deg,#9bf7a6,var(--bse-ok));transform-origin:left center}
.bse-tag-fill.mid{background:linear-gradient(180deg,#ffe27a,#ffb000)}
.bse-tag-fill.low{background:linear-gradient(180deg,#ff8aa0,#ff3b5c)}
.bse-tags.bse-m-lobby .bse-tag-bar{display:none}
.bse-tags.bse-m-lobby .bse-tag-card{flex-direction:row;padding:.34em .85em .42em;gap:.45em}
.bse-tags.bse-m-lobby .bse-tag-card::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-8deg);border-radius:.45em;
  background:linear-gradient(180deg,rgb(40 30 130/.93),rgb(18 12 62/.93));border:.14em solid rgb(255 255 255/.7);
  box-shadow:0 .26em 0 var(--bse-shadow)}
.bse-tags.bse-m-lobby .bse-tag-badge.on{display:inline-block;font:italic 900 1.05em/1 var(--bse-fh);color:#ffcb3d;
  -webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill}
.bse-tags.bse-m-lobby .bse-tag-sub.on{display:inline-block;font:800 .74em/1 var(--bse-fb);letter-spacing:.07em;text-transform:uppercase;
  padding:.3em .7em;border-radius:.7em}
.bse-tag-sub.ok{background:var(--bse-ok);color:#08260f}
.bse-tag-sub.wait{background:rgb(255 255 255/.18);color:#ddd8ff}
.bse-tag-sub.bot{background:rgb(255 255 255/.12);color:#aeb0d4}
.bse-tags.bse-m-lobby.n-sm .bse-tag-sub.on,.bse-tags.bse-m-lobby.n-md .bse-tag-sub.on{display:none}
.bse-tags.bse-m-lobby.n-sm .bse-tag-card,.bse-tags.bse-m-lobby.n-md .bse-tag-card{padding:.3em .75em .38em}
.bse-tags.bse-m-lobby.n-sm .bse-tag-mark.on,.bse-tags.bse-m-lobby.n-md .bse-tag-mark.on{display:inline-block;font:900 1em/1 var(--bse-fb)}
.bse-tag-mark.ok{color:var(--bse-ok)}
.bse-tag-mark.wait{color:#c8c2ff}
.bse-tag-mark.bot{color:#aeb0d4}
@keyframes bse-pop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.bse-tag-card.bse-pop{animation:none}.bse-feed-item.in,.bse-feed-item.out{transition:opacity .2s}}
`;
  document.head.appendChild(s);
}

/* ---------- QR encoder: byte mode, EC level M, versions 1-6 ---------- */

// [total codewords, ec codewords per block, blocks] per version, level M
const QR_M = { 1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1], 4: [100, 18, 2], 5: [134, 24, 2], 6: [172, 16, 4] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsRemainder(data, ecLen) {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gmul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const rem = new Array(ecLen).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gmul(gen[i + 1], f);
  }
  return rem;
}

function formatBits(mask) {
  const data = (0 << 3) | mask; // EC level M = 00
  let r = data;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((data << 10) | r) ^ 0x5412;
}

/** Returns { size, modules: Uint8Array(size*size) } for the text, or throws if it does not fit in version 6. */
export function encodeQR(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    const [total, ec, blocks] = QR_M[v];
    if (bytes.length <= total - ec * blocks - 2) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR text too long for version 6-M");
  const [total, ecLen, blocks] = QR_M[version];
  const dataCap = total - ecLen * blocks;

  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);

  const per = dataCap / blocks;
  const dBlocks = [];
  const eBlocks = [];
  for (let i = 0; i < blocks; i++) {
    const d = data.slice(i * per, (i + 1) * per);
    dBlocks.push(d);
    eBlocks.push(rsRemainder(d, ecLen));
  }
  const codewords = [];
  for (let i = 0; i < per; i++) dBlocks.forEach((d) => codewords.push(d[i]));
  for (let i = 0; i < ecLen; i++) eBlocks.forEach((e) => codewords.push(e[i]));
  const stream = [];
  codewords.forEach((c) => put2(stream, c));
  function put2(arr, c) {
    for (let i = 7; i >= 0; i--) arr.push((c >>> i) & 1);
  }

  const size = 17 + 4 * version;
  const base = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size); // function-module mask
  const set = (x, y, v) => {
    base[y * size + x] = v ? 1 : 0;
    fn[y * size + x] = 1;
  };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  const al = ALIGN[version];
  for (const cy of al)
    for (const cx of al) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const drawFormat = (mask) => {
    const f = formatBits(mask);
    const bit = (i) => (f >>> i) & 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, 1);
  };
  drawFormat(0);

  // zigzag data placement
  const place = (mask) => {
    const m = base.slice();
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - v : v;
          if (fn[y * size + x]) continue;
          let bit = k < stream.length ? stream[k] : 0;
          k++;
          const hit = [
            (x + y) % 2 === 0,
            y % 2 === 0,
            x % 3 === 0,
            (x + y) % 3 === 0,
            (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
            ((x * y) % 2) + ((x * y) % 3) === 0,
            (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
            (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
          ][mask];
          if (hit) bit ^= 1;
          m[y * size + x] = bit;
        }
    }
    return m;
  };

  const penalty = (m) => {
    let p = 0;
    const at = (x, y) => m[y * size + x];
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        const line = [];
        for (let b = 0; b < size; b++) {
          const c = pass ? at(a, b) : at(b, a);
          line.push(c);
          if (b > 0 && c === (pass ? at(a, b - 1) : at(b - 1, a))) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else run = 1;
        }
        const s = line.join("");
        for (const pat of ["10111010000", "00001011101"]) {
          let i = -1;
          while ((i = s.indexOf(pat, i + 1)) >= 0) p += 40;
        }
      }
    }
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = at(x, y);
        if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) p += 3;
      }
    let dark = 0;
    for (const v of m) dark += v;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };

  let best = null;
  let bestMask = 0;
  let bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = place(mask);
    // temporarily write format so penalty sees it
    const saved = base.slice();
    base.set(m);
    drawFormat(mask);
    const withFmt = base.slice();
    base.set(saved);
    const p = penalty(withFmt);
    if (p < bestP) {
      bestP = p;
      best = withFmt;
      bestMask = mask;
    }
  }
  return { size, version, mask: bestMask, modules: best };
}

/* ---------- join QR ---------- */

// opts.size: CSS px of the code (default 220), or "fit" = as wide as its container, redrawn when that changes.
// opts.title: string for the title above the code (default "SCAN TO JOIN"), false = no title. opts.showUrl: default true.
// The page that owns the copy passes its own strings; the defaults only keep old callers working.
export function createJoinQR(container, url, opts = {}) {
  injectStyles();
  const fit = opts.size === "fit";
  const quiet = 4;
  const wrap = document.createElement("div");
  wrap.className = "bse-qr";
  let title = null;
  if (opts.title !== false) {
    title = document.createElement("div");
    title.className = "bse-qr-title";
    title.textContent = opts.title || "SCAN TO JOIN";
  }
  const tile = document.createElement("div");
  tile.className = "bse-qr-tile";
  const canvas = document.createElement("canvas");
  tile.appendChild(canvas);
  let urlEl = null;
  if (opts.showUrl !== false) {
    urlEl = document.createElement("div");
    urlEl.className = "bse-qr-url";
  }
  for (const n of [title, tile, urlEl]) if (n) wrap.appendChild(n);
  if (!fit) {
    wrap.style.cssText = "width:auto;display:inline-flex";
    tile.style.width = "auto";
  }
  container.appendChild(wrap);

  let text = url;
  function draw(next) {
    if (typeof next === "string") text = next;
    if (urlEl) urlEl.textContent = text.replace(/^https?:\/\//, "");
    let qr;
    try {
      qr = encodeQR(text);
    } catch (e) {
      tile.style.display = "none";
      return;
    }
    tile.style.display = "";
    const dpr = window.devicePixelRatio || 1;
    const css = fit ? canvas.clientWidth || tile.clientWidth || 260 : opts.size || 220;
    const cells = qr.size + quiet * 2;
    // Exact device pixels, module edges rounded to whole pixels: crisp at any size, no blur from scaling.
    const px = Math.max(cells, Math.round(css * dpr));
    canvas.width = canvas.height = px;
    if (!fit) canvas.style.width = canvas.style.height = `${css}px`;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, px, px);
    g.fillStyle = "#0d0a26";
    const s = px / cells;
    for (let y = 0; y < qr.size; y++) {
      const y0 = Math.round((y + quiet) * s);
      const y1 = Math.round((y + 1 + quiet) * s);
      for (let x = 0; x < qr.size; ) {
        if (!qr.modules[y * qr.size + x]) {
          x++;
          continue;
        }
        let x2 = x;
        while (x2 < qr.size && qr.modules[y * qr.size + x2]) x2++;
        const a = Math.round((x + quiet) * s);
        g.fillRect(a, y0, Math.round((x2 + quiet) * s) - a, y1 - y0);
        x = x2;
      }
    }
  }
  draw(url);
  let ro = null;
  if (fit && typeof ResizeObserver === "function") {
    let lastW = canvas.clientWidth;
    ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      if (w && w !== lastW) {
        lastW = w;
        draw();
      }
    });
    ro.observe(tile);
  }
  return { el: wrap, canvas, setUrl: draw, destroy: () => { if (ro) ro.disconnect(); wrap.remove(); } };
}

/* ---------- kill feed ---------- */

const isWordChar = (ch) => !!ch && /[a-z0-9]/i.test(ch);

// Splits text into [piece, colour|null] so every player name in it can be painted in that player's colour.
function colourSegments(text, names) {
  const low = text.toLowerCase();
  const hits = [];
  for (const [name, col] of names) {
    const n = String(name).toLowerCase();
    if (!n) continue;
    let i = -1;
    while ((i = low.indexOf(n, i + 1)) >= 0) {
      if (isWordChar(low[i - 1]) || isWordChar(low[i + n.length])) continue;
      hits.push({ i, e: i + n.length, col });
    }
  }
  hits.sort((a, b) => a.i - b.i || b.e - a.e);
  const out = [];
  let pos = 0;
  for (const h of hits) {
    if (h.i < pos) continue;
    if (h.i > pos) out.push([text.slice(pos, h.i), null]);
    out.push([text.slice(h.i, h.e), h.col]);
    pos = h.e;
  }
  if (pos < text.length) out.push([text.slice(pos), null]);
  return out;
}

// push(text, colour, names?, kind?): colour = the line's accent (the lead player's colour); names = [[name, colour], …]
// (or a Map) paints every player name in the text in its own colour; kind "hint" = a smaller purple line.
export function createKillFeed(container, opts = {}) {
  injectStyles();
  const max = opts.max || 5;
  const life = opts.life || 6000;
  const el = document.createElement("div");
  el.className = "bse-feed";
  container.appendChild(el);
  const items = [];
  let lastText = "", lastAt = 0;

  function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    clearTimeout(item.t1);
    clearTimeout(item.t2);
    item.el.remove();
  }
  function push(text, colour = "#9fd8ff", names, kind) {
    const clean = String(text)
      .replace(/\u2694\uFE0F?/g, "\u2715")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2693}\u{2695}-\u{26FF}]\uFE0F?/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const now = Date.now();
    if (!clean || (clean === lastText && now - lastAt < 1200)) return; // the same line twice in a row is one event
    lastText = clean;
    lastAt = now;
    const d = document.createElement("div");
    d.className = "bse-feed-item" + (kind ? ` ${kind}` : "");
    d.style.setProperty("--c", colour);
    if (names) {
      for (const [piece, col] of colourSegments(clean, names)) {
        if (col) {
          const sp = document.createElement("span");
          sp.style.color = col;
          sp.textContent = piece;
          d.appendChild(sp);
        } else d.appendChild(document.createTextNode(piece));
      }
    } else d.textContent = clean;
    el.appendChild(d);
    const item = { el: d };
    items.push(item);
    while (items.length > max) remove(items[0]);
    requestAnimationFrame(() => d.classList.add("in"));
    item.t1 = setTimeout(() => {
      d.classList.remove("in");
      d.classList.add("out");
    }, life - 600);
    item.t2 = setTimeout(() => remove(item), life);
  }
  return { el, push, destroy: () => { items.slice().forEach(remove); el.remove(); } };
}

/* ---------- name tags ---------- */

// update(list, { limit }): list = game.projectPlayers() (nearest first) → at most `limit` tags, nearest on top; a player keeps
// the same tag while they stay in view (no flicker when two ships swap distance order). Positions use transforms only.
// "play" tags: name + health bar. "lobby" cards (setMode("lobby")): name, star badge and a status pill from
// setInfo({ [name]: { sub, short, tone: "ok"|"wait"|"bot", badge } }); the size steps down with the number of cards.
export function createNameTags(container, opts = {}) {
  injectStyles();
  const max = opts.max || 8;
  const offset = opts.offset || 0;
  const layer = document.createElement("div");
  layer.className = "bse-tags bse-m-play n-lg";
  container.appendChild(layer);
  const tags = [];
  const byName = new Map();
  const picked = [];
  let frameId = 0, mode = "play", density = "lg", infos = {};

  for (let i = 0; i < max; i++) {
    const root = document.createElement("div");
    root.className = "bse-tag";
    root.style.display = "none";
    root.innerHTML = '<div class="bse-tag-in"><div class="bse-tag-card"><div class="bse-tag-top"><span class="bse-tag-mark"></span><span class="bse-tag-name"></span><span class="bse-tag-badge"></span></div><div class="bse-tag-sub"></div><div class="bse-tag-bar"><div class="bse-tag-fill"></div></div></div></div>';
    layer.appendChild(root);
    const q = (c) => root.querySelector("." + c);
    tags.push({
      root, card: q("bse-tag-card"), name: q("bse-tag-name"), mark: q("bse-tag-mark"), badge: q("bse-tag-badge"), sub: q("bse-tag-sub"), fill: q("bse-tag-fill"),
      used: false, key: null, seen: -1, shown: false, text: null, color: null, x: NaN, y: NaN, hp: NaN, hpClass: "", z: -1,
      subText: null, subTone: null, markText: null, badgeText: null,
    });
  }

  const applyClasses = () => { layer.className = `bse-tags bse-m-${mode} n-${density}`; };
  function claim(name) {
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      if (t.used) continue;
      t.used = true;
      t.key = name;
      byName.set(name, t);
      // Forget what this tag showed before: it is somebody else now (and pops in when it is shown).
      t.text = t.color = t.subText = t.subTone = t.markText = t.badgeText = null;
      t.hp = NaN;
      t.x = t.y = NaN;
      t.card.classList.add("bse-pop");
      return t;
    }
    return null;
  }
  function release(t) {
    t.used = false;
    byName.delete(t.key);
    t.key = null;
    if (t.shown) {
      t.root.style.display = "none";
      t.shown = false;
    }
    t.card.classList.remove("bse-pop");
  }
  const toggle = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };

  function update(list, o) {
    frameId++;
    const limit = Math.min(max, o && o.limit != null ? o.limit : max);
    let n = 0;
    for (let i = 0; i < list.length && n < limit; i++) {
      const p = list[i];
      if (p.visible === false) continue;
      picked[n++] = p;
      const t = byName.get(p.name);
      if (t) t.seen = frameId;
    }
    for (let i = 0; i < tags.length; i++) if (tags[i].used && tags[i].seen !== frameId) release(tags[i]);
    const d = mode === "lobby" ? (n > 16 ? "sm" : n > 8 ? "md" : "lg") : "lg";
    if (d !== density) {
      density = d;
      applyClasses();
    }
    for (let i = 0; i < n; i++) {
      const p = picked[i];
      let t = byName.get(p.name);
      if (!t) {
        t = claim(p.name);
        if (!t) continue;
        t.seen = frameId;
      }
      if (!t.shown) {
        t.root.style.display = "";
        t.shown = true;
      }
      if (t.z !== i) {
        t.root.style.zIndex = String(max + 1 - i);
        t.z = i;
      }
      if (p.name !== t.text) t.name.textContent = t.text = p.name;
      if (p.color !== t.color) t.root.style.color = t.color = p.color;
      if (p.x !== t.x || p.y !== t.y) {
        t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - offset).toFixed(1)}px,0)`;
        t.x = p.x;
        t.y = p.y;
      }
      if (mode === "lobby") {
        const f = infos[p.name];
        const sub = f && f.sub ? f.sub : "";
        const tone = f && f.tone ? f.tone : "wait";
        const mark = f && f.short ? f.short : "";
        const badge = f && f.badge ? f.badge : "";
        if (sub !== t.subText || tone !== t.subTone) {
          t.sub.textContent = t.subText = sub;
          t.subTone = tone;
          t.sub.className = `bse-tag-sub ${tone}${sub ? " on" : ""}`;
          t.mark.className = `bse-tag-mark ${tone}${mark ? " on" : ""}`;
        }
        if (mark !== t.markText) {
          t.mark.textContent = t.markText = mark;
          t.mark.className = `bse-tag-mark ${tone}${mark ? " on" : ""}`;
        }
        if (badge !== t.badgeText) {
          t.badge.textContent = t.badgeText = badge;
          toggle(t.badge, "on", !!badge);
        }
      } else {
        const h = Math.max(0, Math.min(1, p.hp / (p.maxHp || 1)));
        if (h !== t.hp) {
          t.fill.style.transform = `scaleX(${h})`;
          t.hp = h;
          const c = h < 0.3 ? "low" : h < 0.6 ? "mid" : "";
          if (c !== t.hpClass) {
            t.fill.className = "bse-tag-fill" + (c ? ` ${c}` : "");
            t.hpClass = c;
          }
        }
      }
    }
    picked.length = 0;
  }
  function setMode(m) {
    m = m === "lobby" ? "lobby" : "play";
    if (m === mode) return;
    mode = m;
    density = "lg";
    applyClasses();
  }
  function setInfo(map) {
    infos = map || {};
  }
  return { el: layer, update, setMode, setInfo, destroy: () => layer.remove() };
}
