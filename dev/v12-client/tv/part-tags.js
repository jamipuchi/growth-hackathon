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
      const chipW = chips * 3.7 + 0.4, chipH = chips ? 1.55 : 0;
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
