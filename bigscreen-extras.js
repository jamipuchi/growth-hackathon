// Big-screen extras: join QR, kill feed, player name tags. No dependencies.

const STYLE_ID = "bse-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.bse-qr{display:inline-flex;flex-direction:column;align-items:center;gap:10px;padding:16px 18px 12px;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#cfe9ff;
  border:1px solid rgba(120,200,255,.45);border-radius:6px;background:rgba(6,10,30,.55);
  box-shadow:0 0 24px rgba(80,160,255,.25),inset 0 0 18px rgba(80,160,255,.08)}
.bse-qr-title{font-size:14px;font-weight:600;letter-spacing:.42em;text-indent:.42em;text-shadow:0 0 10px rgba(120,200,255,.8)}
.bse-qr canvas{display:block;border-radius:3px;box-shadow:0 0 22px rgba(160,210,255,.45)}
.bse-qr-url{font-size:11px;letter-spacing:.12em;opacity:.75;word-break:break-all;text-align:center;max-width:100%}
.bse-feed{position:absolute;top:18px;right:22px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;
  pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;z-index:20}
.bse-feed-item{font-size:13px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;padding:5px 12px 5px 14px;
  background:linear-gradient(270deg,rgba(6,10,30,.7),rgba(6,10,30,0));border-right:2px solid currentColor;
  text-shadow:0 0 8px currentColor;opacity:0;transform:translateX(24px);
  transition:opacity .25s ease-out,transform .25s ease-out}
.bse-feed-item.in{opacity:1;transform:none}
.bse-feed-item.out{opacity:0;transition:opacity .6s ease-in;transform:none}
.bse-tags{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10}
.bse-tag{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;display:none}
.bse-tag-in{position:absolute;left:0;bottom:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.bse-tag-name{font-size:11px;font-weight:600;letter-spacing:.22em;text-indent:.22em;text-transform:uppercase;white-space:nowrap;text-shadow:0 0 6px currentColor,0 1px 2px #000}
.bse-tag-bar{width:56px;height:3px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden}
.bse-tag-fill{width:100%;height:100%;background:currentColor;box-shadow:0 0 6px currentColor;transform-origin:left center;will-change:transform}
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

export function createJoinQR(container, url, opts = {}) {
  injectStyles();
  const px = opts.size || 220;
  const quiet = 4;
  const wrap = document.createElement("div");
  wrap.className = "bse-qr";
  const title = document.createElement("div");
  title.className = "bse-qr-title";
  title.textContent = "SCAN TO JOIN";
  const canvas = document.createElement("canvas");
  const urlEl = document.createElement("div");
  urlEl.className = "bse-qr-url";
  wrap.append(title, canvas, urlEl);
  container.appendChild(wrap);

  function draw(text) {
    urlEl.textContent = text.replace(/^https?:\/\//, "");
    let qr;
    try {
      qr = encodeQR(text);
    } catch (e) {
      canvas.style.display = "none";
      return;
    }
    canvas.style.display = "block";
    const cells = qr.size + quiet * 2;
    const scale = Math.max(1, Math.floor((px * (window.devicePixelRatio || 1)) / cells));
    canvas.width = canvas.height = cells * scale;
    canvas.style.width = canvas.style.height = `${(cells * scale) / (window.devicePixelRatio || 1)}px`;
    canvas.style.imageRendering = "pixelated";
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#000";
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) if (qr.modules[y * qr.size + x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
  draw(url);
  return { el: wrap, canvas, setUrl: draw, destroy: () => wrap.remove() };
}

/* ---------- kill feed ---------- */

export function createKillFeed(container, opts = {}) {
  injectStyles();
  const max = opts.max || 5;
  const life = opts.life || 6000;
  const el = document.createElement("div");
  el.className = "bse-feed";
  container.appendChild(el);
  const items = [];

  function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    clearTimeout(item.t1);
    clearTimeout(item.t2);
    item.el.remove();
  }
  function push(text, colour = "#9fd8ff") {
    const d = document.createElement("div");
    d.className = "bse-feed-item";
    d.style.color = colour;
    d.textContent = String(text).replace(/⚔️?/g, "✕").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{2693}\u{2695}-\u{26FF}]️?/gu, "").replace(/\s+/g, " ").trim();
    el.appendChild(d);
    const item = { el: d };
    items.push(item);
    while (items.length > max) remove(items[0]);
    requestAnimationFrame(() => d.classList.add("in"));
    item.t1 = setTimeout(() => d.classList.add("out"), life - 600);
    item.t2 = setTimeout(() => remove(item), life);
  }
  return { el, push, destroy: () => { items.slice().forEach(remove); el.remove(); } };
}

/* ---------- name tags ---------- */

export function createNameTags(container, opts = {}) {
  injectStyles();
  const max = opts.max || 8;
  const layer = document.createElement("div");
  layer.className = "bse-tags";
  container.appendChild(layer);
  const tags = [];
  for (let i = 0; i < max; i++) {
    const root = document.createElement("div");
    root.className = "bse-tag";
    root.innerHTML = '<div class="bse-tag-in"><div class="bse-tag-name"></div><div class="bse-tag-bar"><div class="bse-tag-fill"></div></div></div>';
    layer.appendChild(root);
    tags.push({
      root,
      name: root.querySelector(".bse-tag-name"),
      fill: root.querySelector(".bse-tag-fill"),
      shown: false, text: null, color: null, x: NaN, y: NaN, hp: NaN,
    });
  }
  function update(list) {
    const n = Math.min(list.length, max);
    for (let i = 0; i < max; i++) {
      const t = tags[i];
      const p = i < n ? list[i] : null;
      const show = !!p && p.visible !== false;
      if (show !== t.shown) {
        t.root.style.display = show ? "block" : "none";
        t.shown = show;
      }
      if (!show) continue;
      if (p.name !== t.text) {
        t.name.textContent = t.text = p.name;
      }
      if (p.color !== t.color) {
        t.root.style.color = t.color = p.color;
      }
      if (p.x !== t.x || p.y !== t.y) {
        t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - (opts.offset || 0)).toFixed(1)}px,0)`;
        t.x = p.x;
        t.y = p.y;
      }
      const f = Math.max(0, Math.min(1, p.hp / (p.maxHp || 1)));
      if (f !== t.hp) {
        t.fill.style.transform = `scaleX(${f})`;
        t.hp = f;
      }
    }
  }
  return { el: layer, update, destroy: () => layer.remove() };
}
