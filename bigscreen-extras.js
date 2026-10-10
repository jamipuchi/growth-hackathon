// Big-screen extras: join QR, kill feed (icon chips, KO lines), player name tags (declutter, status chips). Fortnite-like (chunky,
// slanted, outlined). No dependencies.
// Sizes are in em: the host page sets --bse-fs (space.html: 1rem, which scales with the screen); default 10px (the phone).
// The look does not read any generic page variable (a page's own --ink or --shadow means something else); the only page input
// is --bse-fs. controller.html also uses createNameTags({ max: 25 }) (play mode, update(list) with no options).

const STYLE_ID = "bse-styles";

// Icon art shared by the kill feed chips and the status chips over the ships (inline SVG: identical on every platform, chunky,
// dark outline). Keys: emp, ink, pull, mine, decoy, steal, stun, ko.
export const ICON_SVG = {
  emp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.8 1.8 4.4 13.6h6.4L9.4 22.4l10.2-12.8h-6.6z" fill="#fff36a" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  ink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c3.6 4.7 6.6 7.9 6.6 11.7a6.6 6.6 0 0 1-13.2 0C5.4 10.1 8.4 6.9 12 2.2z" fill="#1d0f3f" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="9.6" cy="14.4" r="1.7" fill="#fff" opacity=".55"/></svg>',
  pull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 2.8h5.2v9.4a2.2 2.2 0 0 0 4.4 0V2.8h5.2v9.4a7.4 7.4 0 0 1-14.8 0z" fill="#ff3b5c" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/><path d="M4.6 2.8h5.2v4.4H4.6zM14.2 2.8h5.2v4.4h-5.2z" fill="#fff" stroke="#120a2e" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="14" r="7.4" fill="#2c2c45" stroke="#120a2e" stroke-width="2.2"/><path d="M16.2 8.6l2.4-2.4" stroke="#120a2e" stroke-width="3.4" stroke-linecap="round"/><path d="M18.6 6.2l2.4-2.4M18.6 6.2l3 .4M18.6 6.2l-.4-3" stroke="#ffd23d" stroke-width="2" stroke-linecap="round"/><circle cx="8.4" cy="11.4" r="1.9" fill="#fff" opacity=".6"/></svg>',
  decoy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 4.6h17.6v7.4a8.8 8.8 0 0 1-17.6 0z" fill="#fff" stroke="#120a2e" stroke-width="2.2" stroke-linejoin="round"/><path d="M6.8 10.2c1.2-1.6 3.2-1.6 4.4 0M12.8 10.2c1.2-1.6 3.2-1.6 4.4 0M8 14.6c1.3 2.6 6.7 2.6 8 0" fill="none" stroke="#120a2e" stroke-width="2.2" stroke-linecap="round"/></svg>',
  steal: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="#ffcb3d" stroke="#120a2e" stroke-width="2.2"/><circle cx="12" cy="12" r="5.9" fill="none" stroke="#b86a00" stroke-width="1.6"/><path d="M12 7v10M14.7 9.4c-.5-1.2-4.2-1.6-4.7.3-.5 2 4.8 1 4.7 3.4-.1 1.8-4 1.8-4.8.2" fill="none" stroke="#8a4a0a" stroke-width="1.8" stroke-linecap="round"/></svg>',
  stun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.6 6.3 20l1.5-6.5-5-4.4 6.6-.6z" fill="#fff36a" stroke="#120a2e" stroke-width="2" stroke-linejoin="round"/></svg>',
  ko: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#120a2e" stroke-width="7.4" stroke-linecap="round"/><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
};
// Words on the chips. The page passes its own (COPY table) through opts.labels; these defaults only keep old callers working.
const DEFAULT_LABELS = { emp: "EMP", ink: "INK", pull: "PULL", mine: "MINE", decoy: "DECOY", steal: "STEAL", stun: "STUN", ko: "KO" };
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function chipEl(key, label) {
  const c = document.createElement("span");
  c.className = "bse-chip " + key;
  c.innerHTML = (ICON_SVG[key] || "") + (label ? `<span>${escHtml(label)}</span>` : "");
  return c;
}

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

/* chips: chunky coloured icon plates (kill feed lines and the status chips over the ships) */
.bse-chip{--ca:#8ff3ff;--cb:#1aa7ff;position:relative;isolation:isolate;display:inline-flex;align-items:center;gap:.3em;vertical-align:middle;
  padding:.1em .62em .18em .46em;margin:0 .2em;font:italic 900 .86em/1.1 var(--bse-fh);letter-spacing:.05em;text-transform:uppercase;
  color:#fff;-webkit-text-stroke:.16em var(--bse-ink);paint-order:stroke fill;white-space:nowrap;text-shadow:0 .1em 0 rgb(10 6 30/.5)}
.bse-chip::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;
  background:linear-gradient(180deg,var(--ca),var(--cb));border:.12em solid #fff;box-shadow:0 .16em 0 var(--bse-shadow)}
.bse-chip svg{width:1.3em;height:1.3em;flex:none;display:block;margin:-.1em 0}
.bse-chip.emp{--ca:#8ff3ff;--cb:#1aa7ff}
.bse-chip.ink{--ca:#c99bff;--cb:#7a35e8}
.bse-chip.pull{--ca:#9af59a;--cb:#2fb84a}
.bse-chip.mine{--ca:#ffbf73;--cb:#ff7a1a}
.bse-chip.decoy{--ca:#ffa5ee;--cb:#e03fc4}
.bse-chip.steal,.bse-chip.stun{--ca:#ffe27a;--cb:#ffb000;color:#241400;-webkit-text-stroke:0;text-shadow:0 .1em 0 rgb(255 255 255/.5)}
.bse-chip.ko{--ca:#ff8aa0;--cb:#e0183f}

.bse-feed{position:absolute;top:1.8em;right:2.2em;display:flex;flex-direction:column;align-items:flex-end;gap:.5em;
  pointer-events:none;z-index:25;font-family:var(--bse-fb)}
.bse-feed-item{position:relative;isolation:isolate;max-width:27em;padding:.32em 1.05em .44em 1.15em;
  font:italic 800 1.6em/1.16 var(--bse-fh);text-transform:uppercase;letter-spacing:.02em;color:#fff;text-align:right;
  -webkit-text-stroke:.14em var(--bse-ink);paint-order:stroke fill;text-shadow:0 .1em 0 rgb(10 6 30/.55);
  opacity:0;transform:translateX(2.4em) scale(.92)}
.bse-feed-item::before{content:"";position:absolute;inset:0;z-index:-1;transform:skewX(-10deg);border-radius:.3em;
  background:linear-gradient(180deg,rgb(40 29 128/.95),rgb(20 13 66/.95));border:.1em solid rgb(255 255 255/.6);
  border-right:.42em solid var(--c,#9fd8ff);box-shadow:0 .22em 0 var(--bse-shadow)}
.bse-feed-item.ko::before{background:linear-gradient(180deg,rgb(86 22 66/.96),rgb(40 12 48/.96))}
.bse-feed-item.hint{font-size:1.25em;font-weight:700}
.bse-feed-item.hint::before{background:linear-gradient(180deg,rgb(120 60 220/.95),rgb(76 34 160/.95))}
.bse-feed-item.quiet{font-size:1.2em;font-weight:700}
.bse-feed-item.quiet::before{background:linear-gradient(180deg,rgb(34 26 100/.8),rgb(18 12 56/.8))}
.bse-feed-item.in{opacity:1;transform:none;transition:opacity .2s ease-out,transform .34s cubic-bezier(.34,1.56,.64,1)}
.bse-feed-item.quiet.in{opacity:.82}
.bse-feed-item.out{opacity:0;transform:translateX(1em);transition:opacity .5s ease-in,transform .5s ease-in}
.bse-feed-item.ko.in::before{animation:bse-flash .9s ease-out both}
.bse-feed-item.ko.in .bse-chip.ko{animation:bse-pop .4s cubic-bezier(.34,1.56,.64,1) both}

.bse-tags{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:10;font-family:var(--bse-fb)}
.bse-tags.n-md{font-size:calc(var(--bse-fs,10px)*.86)}
.bse-tags.n-sm{font-size:calc(var(--bse-fs,10px)*.72)}
.bse-tag{position:absolute;left:0;top:0;width:0;height:0;will-change:transform;transform-origin:0 0}
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
.bse-tag-st{display:flex;gap:.1em;justify-content:center;white-space:nowrap}
.bse-tag-st:empty{display:none}
.bse-tag-st .bse-chip{display:none;font-size:1.02em}
.bse-tag-st .bse-chip.on{display:inline-flex}
.bse-tag-dot{display:none;position:absolute;left:0;bottom:0;width:.95em;height:.95em;margin-left:-.475em;border-radius:50%;background:currentColor;
  border:.17em solid #fff;box-shadow:0 0 0 .13em var(--bse-ink),0 .2em 0 .13em var(--bse-shadow)}
.bse-tag.m1 .bse-tag-bar{display:none}
.bse-tag.m1 .bse-tag-name{font-size:1.12em}
.bse-tag.m2 .bse-tag-card{display:none}
.bse-tag.m2 .bse-tag-dot{display:block}
.bse-tag.bot .bse-tag-bar{width:3.6em}
.bse-tags.bse-m-lobby .bse-tag-st,.bse-tags.bse-m-lobby .bse-tag-dot{display:none!important}
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
@keyframes bse-flash{0%{filter:brightness(2.2) saturate(1.7)}100%{filter:none}}
@media (prefers-reduced-motion:reduce){.bse-tag-card.bse-pop,.bse-feed-item.ko.in::before,.bse-feed-item.ko.in .bse-chip.ko{animation:none}.bse-feed-item.in,.bse-feed-item.out{transition:opacity .2s}}
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

// The server's announce lines carry one emoji per mischief (⚡ emp, 🦑 inkbomb, 🧲 tractor, 💣 mine, 🎭 decoy, 💰 steal): they become
// coloured icon chips. "bob ✕ ana" (+ " 💣" / " 🧲" for a mischief kill) becomes name · KO chip · name (· chip). Every other emoji is dropped.
const ICON_OF = { "⚡": "emp", "\u{1F991}": "ink", "\u{1F9F2}": "pull", "\u{1F4A3}": "mine", "\u{1F3AD}": "decoy", "\u{1F4B0}": "steal" };
const ICON_RE = /(⚡|\u{1F991}|\u{1F9F2}|\u{1F4A3}|\u{1F3AD}|\u{1F4B0})️?/gu;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2693}\u{2695}-\u{26FF}]️?/gu;
// → { lead: [chip keys before the words], tail: [chip keys after them], text, kill: [killer, victim] | null, ko: bool }
export function parseFeedLine(raw) {
  const lead = [], tail = [];
  const src = String(raw).replace(/⚔️?/g, "✕");
  let text = src.replace(ICON_RE, (m, ch, at) => {
    (/[a-z0-9]/i.test(src.slice(0, at)) ? tail : lead).push(ICON_OF[ch]);
    return " ";
  });
  text = text.replace(EMOJI_RE, "").replace(/\uFE0F/g, "").replace(/\s+/g, " ").trim();
  let kill = null;
  const m = /^(.+?)\s*✕\s*(.+)$/.exec(text);
  if (m) kill = [m[1].trim(), m[2].trim()];
  const ko = !!kill || /\bwas destroyed$/i.test(text);
  if (ko && !kill) lead.unshift("ko");
  return { lead, tail, text, kill, ko };
}

// push(text, colour, names?, kind?): colour = the line's accent (the lead player's colour); names = [[name, colour], …] (or a Map)
// paints every player name in the text in its own colour; kind "hint" = a smaller purple line, "quiet" = a small dim line that
// is dropped first (a kill between two bots). opts.labels = the words on the chips ({ emp, ink, pull, mine, decoy, steal, ko }).
export function createKillFeed(container, opts = {}) {
  injectStyles();
  const max = opts.max || 5;
  const life = opts.life || 6000;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  const el = document.createElement("div");
  el.className = "bse-feed";
  container.appendChild(el);
  const items = [];
  let lastSig = "", lastAt = 0;

  function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    clearTimeout(item.t1);
    clearTimeout(item.t2);
    item.el.remove();
  }
  function addText(parent, text, names) {
    if (!names) { parent.appendChild(document.createTextNode(text)); return; }
    for (const [piece, col] of colourSegments(text, names)) {
      if (col) {
        const sp = document.createElement("span");
        sp.style.color = col;
        sp.textContent = piece;
        parent.appendChild(sp);
      } else parent.appendChild(document.createTextNode(piece));
    }
  }
  function push(text, colour = "#9fd8ff", names, kind) {
    const line = parseFeedLine(text);
    const now = Date.now();
    const sig = line.lead.join() + "|" + line.text + "|" + line.tail.join();
    if (!line.text && !line.lead.length && !line.tail.length) return;
    if (sig === lastSig && now - lastAt < 1200) return; // the same line twice in a row is one event
    lastSig = sig;
    lastAt = now;
    const quiet = kind === "quiet";
    const d = document.createElement("div");
    d.className = "bse-feed-item" + (kind ? ` ${kind}` : "") + (line.ko ? " ko" : "");
    d.style.setProperty("--c", colour);
    d.dataset.line = String(text); // the server's line as sent (tests and tours read it; the screen shows chips instead of the emoji)
    for (const k of line.lead) d.appendChild(chipEl(k, labels[k]));
    if (line.kill) {
      addText(d, line.kill[0], names);
      d.appendChild(chipEl("ko", labels.ko));
      addText(d, line.kill[1], names);
    } else if (line.text) addText(d, line.text, names);
    for (const k of line.tail) d.appendChild(chipEl(k, labels[k]));
    el.appendChild(d);
    const item = { el: d, quiet };
    items.push(item);
    while (items.length > max) remove(items.find((it) => it.quiet && it !== item) || items[0]); // bot-only lines go first
    requestAnimationFrame(() => d.classList.add("in"));
    const ttl = quiet ? Math.round(life * 0.55) : life;
    item.t1 = setTimeout(() => {
      d.classList.remove("in");
      d.classList.add("out");
    }, ttl - 600);
    item.t2 = setTimeout(() => remove(item), ttl);
  }
  return { el, push, clear: () => items.slice().forEach(remove), destroy: () => { items.slice().forEach(remove); el.remove(); } };
}

/* ---------- name tags ---------- */

// update(list, { limit, focus }): list = game.projectPlayers() (nearest first) → at most `limit` tags; a player keeps the same tag
// while they stay in view (no flicker when two ships swap distance order). Positions use transforms only.
// "play" tags: name + health bar, status chips (items with `flags`: emp / inked / tractored / stun) and a declutter: tags are
// placed humans first (items with `bot` come after), `focus` (the followed player) first of all, then nearest; a tag that
// would overlap a placed one shrinks to its name, and when even that overlaps it becomes a coloured dot. Far ships get a
// smaller tag. Everything is arithmetic on a few numbers per tag (no layout reads, no allocation per frame).
// "lobby" cards (setMode("lobby")): name, star badge and a status pill from
// setInfo({ [name]: { sub, short, tone: "ok"|"wait"|"bot", badge } }); the size steps down with the number of cards.
// opts: { max, offset, labels: { emp, ink, pull, stun } (words on the status chips) }.
const FLAG_BITS = [["emp", "emp"], ["inked", "ink"], ["tractored", "pull"], ["stun", "stun"]];

export function createNameTags(container, opts = {}) {
  injectStyles();
  const max = opts.max || 8;
  const offset = opts.offset || 0;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  const layer = document.createElement("div");
  layer.className = "bse-tags bse-m-play n-lg";
  container.appendChild(layer);
  const tags = [];
  const byName = new Map();
  const picked = [];
  const ord = new Array(max).fill(null);
  const RX0 = new Float32Array(max), RX1 = new Float32Array(max), RY0 = new Float32Array(max), RY1 = new Float32Array(max);
  let frameId = 0, mode = "play", density = "lg", infos = {}, fs = 10, nPlaced = 0;

  for (let i = 0; i < max; i++) {
    const root = document.createElement("div");
    root.className = "bse-tag m0";
    root.style.display = "none";
    root.innerHTML = '<div class="bse-tag-in"><div class="bse-tag-card"><div class="bse-tag-st"></div><div class="bse-tag-top"><span class="bse-tag-mark"></span><span class="bse-tag-name"></span><span class="bse-tag-badge"></span></div><div class="bse-tag-sub"></div><div class="bse-tag-bar"><div class="bse-tag-fill"></div></div></div><div class="bse-tag-dot"></div></div>';
    layer.appendChild(root);
    const q = (c) => root.querySelector("." + c);
    tags.push({
      root, card: q("bse-tag-card"), name: q("bse-tag-name"), mark: q("bse-tag-mark"), badge: q("bse-tag-badge"), sub: q("bse-tag-sub"), fill: q("bse-tag-fill"), stRow: q("bse-tag-st"),
      used: false, key: null, seen: -1, shown: false, text: null, color: null, x: NaN, y: NaN, s: NaN, hp: NaN, hpClass: "", z: -1,
      subText: null, subTone: null, markText: null, badgeText: null,
      m: 0, bot: false, st: 0, stEls: null, p: null, pri: 0,
    });
  }

  // The size of 1em in px (the page sets --bse-fs, 1rem on the TV: it changes with the window), for the declutter.
  const measure = () => { try { fs = parseFloat(getComputedStyle(layer).fontSize) || fs; } catch (e) { /* keep the last size */ } };
  measure();
  const onResize = () => measure();
  addEventListener("resize", onResize);

  // Width of a name in em (italic 800 caps + the outline), measured once per name on a canvas (no DOM layout).
  const widths = new Map();
  let mctx = null;
  const onFonts = () => widths.clear();
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", onFonts);
  function nameEm(name) {
    let w = widths.get(name);
    if (w !== undefined) return w;
    try {
      mctx = mctx || document.createElement("canvas").getContext("2d");
      mctx.font = 'italic 800 100px "Barlow Condensed", Impact, "Arial Narrow", sans-serif';
      w = mctx.measureText(name.toUpperCase()).width / 100 + name.length * 0.03 + 0.2;
    } catch (e) { w = name.length * 0.55 + 0.2; }
    if (widths.size > 400) widths.clear();
    widths.set(name, w);
    return w;
  }

  const applyClasses = () => { layer.className = `bse-tags bse-m-${mode} n-${density}`; measure(); };
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
      t.x = t.y = t.s = NaN;
      t.card.classList.add("bse-pop");
      return t;
    }
    return null;
  }
  function release(t) {
    t.used = false;
    byName.delete(t.key);
    t.key = null;
    t.p = null;
    if (t.shown) {
      t.root.style.display = "none";
      t.shown = false;
    }
    if (t.m || t.bot) { t.m = 0; t.bot = false; t.root.className = "bse-tag m0"; }
    t.card.classList.remove("bse-pop");
  }
  const toggle = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };

  // Status chips over the name: built the first time a flag is seen, then only their `on` class changes.
  function setChips(t, st) {
    t.st = st;
    if (!t.stEls) {
      if (!st) return;
      t.stEls = FLAG_BITS.map(([, key]) => chipEl(key, labels[key]));
      for (const c of t.stEls) t.stRow.appendChild(c);
    }
    for (let b = 0; b < t.stEls.length; b++) toggle(t.stEls[b], "on", ((st >> b) & 1) === 1);
  }

  // Does the rect overlap one already placed? (a small gap counts as overlap)
  function hits(x0, y0, x1, y1, gap) {
    for (let i = 0; i < nPlaced; i++) if (x0 < RX1[i] + gap && x1 > RX0[i] - gap && y0 < RY1[i] + gap && y1 > RY0[i] - gap) return true;
    return false;
  }

  function update(list, o) {
    frameId++;
    const limit = Math.min(max, o && o.limit != null ? o.limit : max);
    const focus = o && o.focus ? o.focus : null;
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
    let k = 0;
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
      if (p.name !== t.text) t.name.textContent = t.text = p.name;
      if (p.color !== t.color) t.root.style.color = t.color = p.color;
      t.p = p;
      // order: the followed player, then humans, then bots; nearest first inside each group (insertion sort, n <= 25)
      t.pri = (focus && p.name === focus ? -1e9 : 0) + (p.bot === true ? 1e6 : 0) + (p.dist || 0);
      let j = k++;
      while (j > 0 && ord[j - 1].pri > t.pri) { ord[j] = ord[j - 1]; j--; }
      ord[j] = t;
    }
    n = k;
    nPlaced = 0;
    for (let i = 0; i < n; i++) {
      const t = ord[i], p = t.p;
      if (t.z !== i) {
        t.root.style.zIndex = String(max + 1 - i);
        t.z = i;
      }
      if (mode === "lobby") {
        if (t.m || t.bot) { t.m = 0; t.bot = false; t.root.className = "bse-tag m0"; }
        if (p.x !== t.x || p.y !== t.y) {
          t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - offset).toFixed(1)}px,0)`;
          t.x = p.x;
          t.y = p.y;
        }
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
        continue;
      }
      // ---- play: status chips, size by distance, declutter ----
      const f = p.flags;
      const st = f ? (f.emp ? 1 : 0) | (f.inked ? 2 : 0) | (f.tractored ? 4 : 0) | (f.stun ? 8 : 0) : 0;
      if (st !== t.st) setChips(t, st);
      const chips = (st & 1) + ((st >> 1) & 1) + ((st >> 2) & 1) + ((st >> 3) & 1);
      const bot = p.bot === true;
      const isFocus = !!focus && p.name === focus;
      let s = 1.25 - (p.dist || 0) * 0.0021;
      s = s > 1 ? 1 : s < 0.7 ? 0.7 : s;
      if (bot) s *= 0.85;
      if (isFocus) s = 1;
      s = Math.round(s * 100) / 100;
      const ax = p.x, ay = p.y - offset; // the anchor: bottom centre of the card
      const E = fs * s;
      const nw = nameEm(p.name);
      const chipW = chips * 4.2 + 0.4, chipH = chips ? 1.9 : 0;
      let m = 0;
      if (!isFocus) {
        // hysteresis: a tag that was shrunk needs extra room before it grows again (no flicker as ships drift)
        const grow = t.m > 0 ? 0.7 * E : 0;
        const w0 = Math.max(nw * 1.35, bot ? 4.1 : 5.3, chipW) * E, h0 = (2.75 + chipH) * E;
        if (hits(ax - w0 / 2 - grow, ay - h0 - grow, ax + w0 / 2 + grow, ay + grow, 0.25 * E)) {
          m = 1;
          const grow2 = t.m > 1 ? 0.7 * E : 0;
          const w1 = Math.max(nw * 1.12, chipW) * E, h1 = (1.6 + chipH) * E;
          if (hits(ax - w1 / 2 - grow2, ay - h1 - grow2, ax + w1 / 2 + grow2, ay + grow2, 0.25 * E)) m = 2;
        }
      }
      if (m === 0) {
        const w = Math.max(nw * 1.35, bot ? 4.1 : 5.3, chipW) * E, h = (2.75 + chipH) * E;
        RX0[nPlaced] = ax - w / 2; RX1[nPlaced] = ax + w / 2; RY0[nPlaced] = ay - h; RY1[nPlaced] = ay; nPlaced++;
      } else if (m === 1) {
        const w = Math.max(nw * 1.12, chipW) * E, h = (1.6 + chipH) * E;
        RX0[nPlaced] = ax - w / 2; RX1[nPlaced] = ax + w / 2; RY0[nPlaced] = ay - h; RY1[nPlaced] = ay; nPlaced++;
      }
      if (m !== t.m || bot !== t.bot) {
        t.m = m;
        t.bot = bot;
        t.root.className = "bse-tag m" + m + (bot ? " bot" : "");
      }
      if (p.x !== t.x || p.y !== t.y || s !== t.s) {
        t.root.style.transform = `translate3d(${p.x.toFixed(1)}px,${(p.y - offset).toFixed(1)}px,0) scale(${s})`;
        t.x = p.x;
        t.y = p.y;
        t.s = s;
      }
      if (m < 2) {
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
  return {
    el: layer, update, setMode, setInfo,
    destroy: () => { removeEventListener("resize", onResize); if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener("loadingdone", onFonts); layer.remove(); },
  };
}
