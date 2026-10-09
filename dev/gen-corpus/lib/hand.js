// Hand-drawn stroke library for the generation corpus (runs in the browser, classic script → window.HAND).
// Everything is strokes (arrays of [x, y] in "units"), so the same drawing can go through the phone's finger
// pipeline (strokesPNG) or be inked onto a simulated notebook page and photographed (photo pipeline).
(function () {
  // ---- deterministic randomness -----------------------------------------------------------------------------------
  function rngOf(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (a0, b0) => a0 + (b0 - a0) * next();
    next.pick = (list) => list[Math.floor(next() * list.length)];
    next.sign = () => (next() < 0.5 ? -1 : 1);
    return next;
  }

  // ---- stroke font (single-stroke letters, cap height 6, baseline y = 6, descenders to 8) -------------------------
  const arc = (cx, cy, rx, ry, a0, a1, n = 14) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return out;
  };
  const U = {
    A: [[[0, 6], [2, 0], [4, 6]], [[0.8, 3.8], [3.2, 3.8]]],
    B: [[[0, 6], [0, 0], [2.6, 0], [3.5, 0.8], [3.5, 2.2], [2.6, 3], [0, 3]], [[2.6, 3], [3.8, 3.8], [3.8, 5.2], [2.9, 6], [0, 6]]],
    C: [arc(2.3, 3, 2.2, 3, -40, -320)],
    D: [[[0, 0], [0, 6], [1.8, 6], [3.5, 4.8], [4, 3], [3.5, 1.2], [1.8, 0], [0, 0]]],
    E: [[[3.8, 0], [0, 0], [0, 6], [3.8, 6]], [[0, 3], [3, 3]]],
    F: [[[3.8, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
    G: [arc(2.3, 3, 2.2, 3, -40, -320), [[2.4, 3.4], [4.3, 3.4], [4.3, 5.4]]],
    H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
    I: [[[1.5, 0], [1.5, 6]], [[0.3, 0], [2.7, 0]], [[0.3, 6], [2.7, 6]]],
    J: [[[3.6, 0], [3.6, 4.4], [2.9, 5.7], [1.8, 6], [0.7, 5.6], [0, 4.4]]],
    K: [[[0, 0], [0, 6]], [[3.8, 0], [0, 3.8]], [[1.3, 2.6], [4, 6]]],
    L: [[[0, 0], [0, 6], [3.6, 6]]],
    M: [[[0, 6], [0, 0], [2.2, 3.8], [4.4, 0], [4.4, 6]]],
    N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
    O: [arc(2.2, 3, 2.2, 3, -90, 275, 20)],
    P: [[[0, 6], [0, 0], [2.7, 0], [3.7, 0.9], [3.7, 2.3], [2.7, 3.2], [0, 3.2]]],
    Q: [arc(2.2, 3, 2.2, 3, -90, 275, 20), [[2.6, 4.4], [4.4, 6.4]]],
    R: [[[0, 6], [0, 0], [2.7, 0], [3.7, 0.9], [3.7, 2.3], [2.7, 3.2], [0, 3.2]], [[1.6, 3.2], [4, 6]]],
    S: [[[3.7, 0.8], [2.8, 0], [1.2, 0], [0.2, 0.8], [0.3, 2.2], [1.3, 2.9], [2.8, 3.1], [3.8, 3.9], [3.8, 5.2], [2.8, 6], [1.2, 6], [0, 5.2]]],
    T: [[[0, 0], [4.2, 0]], [[2.1, 0], [2.1, 6]]],
    U: [[[0, 0], [0, 4.4], [0.8, 5.7], [2, 6], [3.2, 5.7], [4, 4.4], [4, 0]]],
    V: [[[0, 0], [2, 6], [4, 0]]],
    W: [[[0, 0], [1.1, 6], [2.3, 2.2], [3.5, 6], [4.6, 0]]],
    X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
    Y: [[[0, 0], [2, 3]], [[4, 0], [2, 3], [2, 6]]],
    Z: [[[0, 0], [4, 0], [0, 6], [4, 6]]],
    "+": [[[2, 1.2], [2, 4.8]], [[0.2, 3], [3.8, 3]]],
    "!": [[[1, 0], [1, 4.2]], [[1, 5.7], [1, 6]]],
    "-": [[[0.3, 3], [3, 3]]],
    "?": [[[0.2, 1.2], [1, 0.1], [2.6, 0], [3.5, 0.9], [3.3, 2.2], [2, 3.2], [2, 4.4]], [[2, 5.7], [2, 6]]],
    "1": [[[0.6, 1.2], [2, 0], [2, 6]], [[0.6, 6], [3.4, 6]]],
    "2": [[[0.2, 1.2], [1.2, 0.1], [2.8, 0.1], [3.7, 1], [3.5, 2.4], [0, 6], [4, 6]]],
    "3": [[[0.2, 0.6], [1.4, 0], [2.8, 0.1], [3.6, 1], [3.3, 2.4], [1.6, 3], [3.4, 3.6], [3.8, 5], [2.8, 6], [1.2, 6], [0, 5.3]]],
  };
  const L = {
    a: [arc(1.8, 4, 1.7, 2, -90, 275, 16), [[3.5, 2], [3.5, 6]]],
    b: [[[0, 0], [0, 6]], arc(1.8, 4, 1.8, 2, 180, 545, 16)],
    c: [arc(2, 4, 1.9, 2, -40, -320, 14)],
    d: [arc(1.8, 4, 1.7, 2, 0, 365, 16), [[3.5, 0], [3.5, 6]]],
    e: [[[0.1, 4], [3.6, 4], [3.4, 2.9], [2.6, 2.1], [1.5, 2], [0.5, 2.6], [0, 3.9], [0.4, 5.3], [1.4, 6], [2.6, 6], [3.5, 5.3]]],
    f: [[[3, 0.3], [2.2, 0], [1.5, 0.6], [1.5, 6]], [[0.3, 2.3], [2.9, 2.3]]],
    g: [arc(1.8, 3.9, 1.7, 1.9, 0, 365, 16), [[3.5, 2], [3.5, 7.1], [2.7, 8], [1.2, 8], [0.4, 7.4]]],
    h: [[[0, 0], [0, 6]], [[0, 3.6], [0.8, 2.4], [2, 2], [3.2, 2.4], [3.6, 3.4], [3.6, 6]]],
    i: [[[1, 2], [1, 6]], [[1, 0.5], [1, 0.8]]],
    j: [[[2, 2], [2, 7.2], [1.4, 8], [0.3, 7.6]], [[2, 0.5], [2, 0.8]]],
    k: [[[0, 0], [0, 6]], [[3, 2], [0, 4.4]], [[1.2, 3.6], [3.4, 6]]],
    l: [[[1, 0], [1, 6]]],
    m: [[[0, 2], [0, 6]], [[0, 3.2], [0.6, 2.2], [1.4, 2], [2, 2.6], [2, 6]], [[2, 3.2], [2.6, 2.2], [3.4, 2], [4, 2.6], [4, 6]]],
    n: [[[0, 2], [0, 6]], [[0, 3.4], [0.8, 2.3], [2, 2], [3.2, 2.4], [3.6, 3.4], [3.6, 6]]],
    o: [arc(1.9, 4, 1.8, 2, -90, 275, 16)],
    p: [[[0, 2], [0, 8]], arc(1.8, 4, 1.8, 2, 180, 545, 16)],
    q: [arc(1.8, 4, 1.7, 2, 0, 365, 16), [[3.5, 2], [3.5, 8]]],
    r: [[[0, 2], [0, 6]], [[0, 3.6], [0.8, 2.4], [2, 2], [2.8, 2.3]]],
    s: [[[3, 2.6], [2.2, 2], [1, 2], [0.3, 2.6], [0.6, 3.6], [2.6, 4.3], [3.2, 5.2], [2.6, 6], [1, 6], [0.1, 5.4]]],
    t: [[[1.4, 0.4], [1.4, 5.4], [2, 6], [2.8, 5.8]], [[0.2, 2.2], [2.8, 2.2]]],
    u: [[[0, 2], [0, 4.8], [0.6, 5.8], [1.8, 6], [3, 5.6], [3.6, 4.4]], [[3.6, 2], [3.6, 6]]],
    v: [[[0, 2], [1.8, 6], [3.6, 2]]],
    w: [[[0, 2], [1, 6], [2, 3], [3, 6], [4, 2]]],
    x: [[[0, 2], [3.4, 6]], [[3.4, 2], [0, 6]]],
    y: [[[0, 2], [1.8, 6]], [[3.6, 2], [1.4, 8], [0.5, 8]]],
    z: [[[0, 2], [3.4, 2], [0, 6], [3.4, 6]]],
  };
  const glyphOf = (ch) => U[ch] || L[ch] || (U[ch.toUpperCase()] ? U[ch.toUpperCase()] : null);
  const advance = (g, ch) => (ch === " " ? 3 : Math.max(...g.flat().map((p) => p[0])) + 1.5);

  // ---- smooth hand wobble ------------------------------------------------------------------------------------------
  function resample(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    return out;
  }
  function wobble(pts, amp, rng, step = 1.2) {
    if (pts.length < 2 || amp <= 0) return pts.map((p) => [p[0], p[1]]);
    const r = resample(pts, step);
    const f1 = rng.range(0.05, 0.12), f2 = rng.range(0.18, 0.35), p1 = rng.range(0, 6.3), p2 = rng.range(0, 6.3);
    let dist = 0;
    return r.map((p, i) => {
      const a = r[Math.max(0, i - 1)], b = r[Math.min(r.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      if (i) dist += Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]);
      const n = amp * (0.65 * Math.sin(f1 * dist + p1) + 0.35 * Math.sin(f2 * dist + p2));
      return [p[0] - (dy / len) * n, p[1] + (dx / len) * n];
    });
  }

  // ---- a drawing: strokes plus helpers -----------------------------------------------------------------------------
  class Drawing {
    constructor(seed, { mess = 0.35, w = 200, h = 100 } = {}) {
      this.rng = rngOf(seed);
      this.mess = mess;
      this.w = w;
      this.h = h;
      this.strokes = [];
    }
    mark() { return this.strokes.length; }
    box(from = 0, to = this.strokes.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of this.strokes.slice(from, to)) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    add(pts, amp) {
      const a = amp == null ? this.mess : amp;
      this.strokes.push(wobble(pts, a, this.rng));
      return this;
    }
    line(x0, y0, x1, y1, amp) { return this.add([[x0, y0], [x1, y1]], amp); }
    poly(pts, closed = false, amp) {
      const p = closed ? [...pts, pts[0], [pts[0][0] + (pts[1][0] - pts[0][0]) * 0.08, pts[0][1] + (pts[1][1] - pts[0][1]) * 0.08]] : pts;
      return this.add(p, amp);
    }
    // A hand-drawn rectangle: one stroke, corners slightly off, the end overshoots the start.
    rect(x, y, w, h, { round = 0, amp } = {}) {
      const r = this.rng, j = () => r.range(-0.8, 0.8) * this.mess;
      if (round > 0) {
        const k = Math.min(round, w / 2, h / 2);
        const pts = [
          ...arc(x + w - k, y + k, k, k, -90, 0, 5), ...arc(x + w - k, y + h - k, k, k, 0, 90, 5),
          ...arc(x + k, y + h - k, k, k, 90, 180, 5), ...arc(x + k, y + k, k, k, 180, 270, 5),
        ];
        pts.push([x + w - k + 1.2, y + j()]);
        return this.add(pts, amp);
      }
      return this.add([[x + j(), y + j()], [x + w + j(), y + j()], [x + w + j(), y + h + j()], [x + j(), y + h + j()], [x + j(), y + j() + 0.4], [x + 1.5 + j(), y + j()]], amp);
    }
    // An ellipse drawn in one go: starts anywhere, overlaps its start by a bit.
    ellipse(cx, cy, rx, ry, { overlap = 18, amp, from } = {}) {
      const a0 = from == null ? this.rng.range(0, 360) : from;
      const pts = arc(cx, cy, rx, ry, a0, a0 + 360 + overlap * this.rng.range(0.4, 1.2), Math.max(16, Math.round((rx + ry) * 1.2)));
      return this.add(pts, amp);
    }
    arcPath(cx, cy, rx, ry, a0, a1, amp) { return this.add(arc(cx, cy, rx, ry, a0, a1, 18), amp); }
    arrow(x0, y0, x1, y1, { head = 0.3, amp } = {}) {
      this.line(x0, y0, x1, y1, amp);
      const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0) * head;
      this.add([[x1 + len * Math.cos(a + 2.6), y1 + len * Math.sin(a + 2.6)], [x1, y1], [x1 + len * Math.cos(a - 2.6), y1 + len * Math.sin(a - 2.6)]], amp);
      return this;
    }
    // A filled-looking triangle arrow (▲ ▶ ▼ ◀): an outline triangle, dir in degrees (0 = right).
    triArrow(cx, cy, s, dir) {
      const a = (dir * Math.PI) / 180;
      const p = (ang, r) => [cx + r * Math.cos(a + ang), cy + r * Math.sin(a + ang)];
      return this.poly([p(0, s), p(2.3, s * 0.85), p(-2.3, s * 0.85)], true);
    }
    // Handwriting. (cx, cy) is the centre of the word; h the cap height. style: caps | lower | as-is.
    text(str, cx, cy, h, { slant = this.rng.range(-0.12, 0.18), mess = this.mess, spacing = 1, align = "center" } = {}) {
      const k = h / 6;
      const chars = [...str];
      let width = 0;
      const glyphs = chars.map((ch) => { const g = glyphOf(ch); const adv = g ? advance(g, ch) * spacing : 3 * spacing; width += adv; return { g, adv, ch }; });
      width -= 1.5 * spacing;
      let x = align === "center" ? cx - (width * k) / 2 : cx;
      const top = cy - 3 * k;
      for (const { g, adv } of glyphs) {
        const dy = this.rng.range(-0.5, 0.5) * mess * k;
        const sz = 1 + this.rng.range(-0.12, 0.12) * mess;
        if (g) for (const s of g) {
          const pts = s.map(([gx, gy]) => [x + (gx * sz + (6 - gy) * slant) * k + this.rng.range(-0.25, 0.25) * mess * k, top + gy * sz * k + dy + this.rng.range(-0.25, 0.25) * mess * k]);
          this.strokes.push(wobble(pts, mess * k * 0.35, this.rng, 0.6 * k));
        }
        x += adv * k;
      }
      return this;
    }
    // Crossed out: a dense zigzag over the box.
    scribble(x, y, w, h) {
      const pts = [];
      const n = 7 + Math.floor(this.rng() * 4);
      for (let i = 0; i <= n; i++) pts.push([x + (w * i) / n + this.rng.range(-1, 1), i % 2 ? y + h : y]);
      this.add(pts, 0.4);
      return this.line(x, y + h, x + w, y);
    }
  }

  // ---- icons in a box (x, y, s = size) -----------------------------------------------------------------------------
  const ICONS = {
    crosshair(d, x, y, s) { const c = s / 2; d.ellipse(x + c, y + c, s * 0.34, s * 0.34); d.line(x + c, y + s * 0.05, x + c, y + s * 0.95); d.line(x + s * 0.05, y + c, x + s * 0.95, y + c); },
    flame(d, x, y, s) {
      d.add([[x + s * 0.5, y + s * 0.95], [x + s * 0.2, y + s * 0.7], [x + s * 0.3, y + s * 0.35], [x + s * 0.42, y + s * 0.5], [x + s * 0.5, y + s * 0.05], [x + s * 0.68, y + s * 0.42], [x + s * 0.75, y + s * 0.3], [x + s * 0.82, y + s * 0.68], [x + s * 0.5, y + s * 0.95]]);
      d.add([[x + s * 0.5, y + s * 0.85], [x + s * 0.4, y + s * 0.68], [x + s * 0.52, y + s * 0.5], [x + s * 0.6, y + s * 0.7], [x + s * 0.5, y + s * 0.85]]);
    },
    shield(d, x, y, s) { d.add([[x + s * 0.5, y + s * 0.05], [x + s * 0.9, y + s * 0.2], [x + s * 0.85, y + s * 0.6], [x + s * 0.5, y + s * 0.95], [x + s * 0.15, y + s * 0.6], [x + s * 0.1, y + s * 0.2], [x + s * 0.5, y + s * 0.05]]); },
    drill(d, x, y, s) {
      d.poly([[x + s * 0.1, y + s * 0.3], [x + s * 0.4, y + s * 0.3], [x + s * 0.4, y + s * 0.7], [x + s * 0.1, y + s * 0.7]], true);
      d.poly([[x + s * 0.4, y + s * 0.25], [x + s * 0.95, y + s * 0.5], [x + s * 0.4, y + s * 0.75]], true);
      d.line(x + s * 0.5, y + s * 0.3, x + s * 0.58, y + s * 0.62); d.line(x + s * 0.64, y + s * 0.36, x + s * 0.72, y + s * 0.6); d.line(x + s * 0.78, y + s * 0.42, x + s * 0.84, y + s * 0.55);
    },
    shovel(d, x, y, s) {
      d.line(x + s * 0.5, y + s * 0.05, x + s * 0.5, y + s * 0.55);
      d.line(x + s * 0.36, y + s * 0.05, x + s * 0.64, y + s * 0.05);
      d.add([[x + s * 0.3, y + s * 0.55], [x + s * 0.7, y + s * 0.55], [x + s * 0.68, y + s * 0.8], [x + s * 0.5, y + s * 0.95], [x + s * 0.32, y + s * 0.8], [x + s * 0.3, y + s * 0.55]]);
    },
    legs(d, x, y, s) {
      d.add([[x + s * 0.15, y + s * 0.15], [x + s * 0.85, y + s * 0.15], [x + s * 0.75, y + s * 0.4], [x + s * 0.25, y + s * 0.4], [x + s * 0.15, y + s * 0.15]]);
      d.line(x + s * 0.3, y + s * 0.4, x + s * 0.15, y + s * 0.8); d.line(x + s * 0.7, y + s * 0.4, x + s * 0.85, y + s * 0.8);
      d.line(x + s * 0.05, y + s * 0.8, x + s * 0.25, y + s * 0.8); d.line(x + s * 0.75, y + s * 0.8, x + s * 0.95, y + s * 0.8);
      d.line(x, y + s * 0.95, x + s, y + s * 0.95);
    },
    parachute(d, x, y, s) {
      d.arcPath(x + s * 0.5, y + s * 0.4, s * 0.45, s * 0.35, 180, 360);
      d.line(x + s * 0.05, y + s * 0.4, x + s * 0.5, y + s * 0.85); d.line(x + s * 0.95, y + s * 0.4, x + s * 0.5, y + s * 0.85); d.line(x + s * 0.5, y + s * 0.05, x + s * 0.5, y + s * 0.85);
      d.rect(x + s * 0.42, y + s * 0.82, s * 0.16, s * 0.14);
    },
    antenna(d, x, y, s) { d.line(x + s * 0.5, y + s * 0.95, x + s * 0.5, y + s * 0.3); d.arcPath(x + s * 0.5, y + s * 0.3, s * 0.35, s * 0.2, 0, 180); d.ellipse(x + s * 0.5, y + s * 0.12, s * 0.07, s * 0.07); },
    bulb(d, x, y, s) { d.ellipse(x + s * 0.5, y + s * 0.42, s * 0.25, s * 0.27); d.rect(x + s * 0.4, y + s * 0.68, s * 0.2, s * 0.14); for (const a of [200, 250, 290, 340]) { const r = (a * Math.PI) / 180; d.line(x + s * 0.5 + Math.cos(r) * s * 0.33, y + s * 0.42 + Math.sin(r) * s * 0.36, x + s * 0.5 + Math.cos(r) * s * 0.47, y + s * 0.42 + Math.sin(r) * s * 0.48); } },
    cross(d, x, y, s) { d.poly([[x + s * 0.38, y + s * 0.1], [x + s * 0.62, y + s * 0.1], [x + s * 0.62, y + s * 0.38], [x + s * 0.9, y + s * 0.38], [x + s * 0.9, y + s * 0.62], [x + s * 0.62, y + s * 0.62], [x + s * 0.62, y + s * 0.9], [x + s * 0.38, y + s * 0.9], [x + s * 0.38, y + s * 0.62], [x + s * 0.1, y + s * 0.62], [x + s * 0.1, y + s * 0.38], [x + s * 0.38, y + s * 0.38]], true); },
    bomb(d, x, y, s) { d.ellipse(x + s * 0.45, y + s * 0.58, s * 0.33, s * 0.33); d.add([[x + s * 0.62, y + s * 0.3], [x + s * 0.72, y + s * 0.15], [x + s * 0.85, y + s * 0.12]]); d.line(x + s * 0.88, y + s * 0.02, x + s * 0.9, y + s * 0.22); d.line(x + s * 0.78, y + s * 0.08, x + s * 0.98, y + s * 0.14); },
    bolt(d, x, y, s) { d.poly([[x + s * 0.6, y + s * 0.02], [x + s * 0.2, y + s * 0.55], [x + s * 0.48, y + s * 0.55], [x + s * 0.35, y + s * 0.98], [x + s * 0.82, y + s * 0.4], [x + s * 0.52, y + s * 0.4]], true); },
    eye(d, x, y, s) { d.add([[x + s * 0.05, y + s * 0.5], [x + s * 0.3, y + s * 0.25], [x + s * 0.7, y + s * 0.25], [x + s * 0.95, y + s * 0.5], [x + s * 0.7, y + s * 0.75], [x + s * 0.3, y + s * 0.75], [x + s * 0.05, y + s * 0.5]]); d.ellipse(x + s * 0.5, y + s * 0.5, s * 0.14, s * 0.14); },
    spiral(d, x, y, s) { const pts = []; for (let i = 0; i < 40; i++) { const a = i * 0.45, r = (s * 0.45 * i) / 40; pts.push([x + s / 2 + r * Math.cos(a), y + s / 2 + r * Math.sin(a)]); } d.add(pts); },
    gun(d, x, y, s) { d.poly([[x + s * 0.05, y + s * 0.3], [x + s * 0.95, y + s * 0.3], [x + s * 0.95, y + s * 0.45], [x + s * 0.45, y + s * 0.45], [x + s * 0.4, y + s * 0.85], [x + s * 0.2, y + s * 0.85], [x + s * 0.22, y + s * 0.45], [x + s * 0.05, y + s * 0.45]], true); },
  };

  // ---- controller pieces -------------------------------------------------------------------------------------------
  // A button: a shape with a label (inside, below or with an arrow) and/or an icon. Returns the tappable box.
  function button(d, { x, y, w, h, shape = "rect", label = "", icon = null, labelPos = "in", textH }) {
    const from = d.mark();
    if (shape === "circle") d.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
    else if (shape === "round") d.rect(x, y, w, h, { round: Math.min(w, h) * 0.3 });
    else if (shape === "rect") d.rect(x, y, w, h);
    const shapeBox = d.box(from);
    const th = textH || Math.min(h * 0.38, (w * 0.8) / Math.max(1, label.length * 0.95));
    if (icon && label && labelPos === "in") {
      ICONS[icon](d, x + w * 0.3, y + h * 0.08, Math.min(w * 0.4, h * 0.48));
      d.text(label, x + w / 2, y + h * 0.78, Math.min(th, h * 0.24));
    } else if (icon) {
      const s = Math.min(w, h) * 0.66;
      ICONS[icon](d, x + (w - s) / 2, y + (h - s) / 2, s);
    }
    if (label && !(icon && labelPos === "in")) {
      if (labelPos === "in") d.text(label, x + w / 2, y + h / 2, th);
      else if (labelPos === "below") d.text(label, x + w / 2, y + h + th * 0.9, th * 0.8);
      else if (labelPos === "above") d.text(label, x + w / 2, y - th * 0.9, th * 0.8);
      else if (labelPos === "arrow") {
        // the word sits off to the side, an arrow points at the shape
        const lx = x - w * 0.15, ly = y - h * 0.55;
        d.text(label, lx, ly, th * 0.75);
        d.arrow(lx + th * 0.4, ly + th * 0.55, x + w * 0.2, y + h * 0.15, { head: 0.35 });
      }
    }
    return shape === "none" ? d.box(from) : shapeBox;
  }
  // A stick: a circle with a knob, a ring, a D-pad cross or four separate arrows. Returns the cluster box.
  function stick(d, { cx, cy, r, style = "knob" }) {
    const from = d.mark();
    if (style === "knob") { d.ellipse(cx, cy, r, r); d.ellipse(cx + d.rng.range(-0.1, 0.1) * r, cy, r * 0.35, r * 0.35); }
    else if (style === "ring") { d.ellipse(cx, cy, r, r); d.ellipse(cx, cy, r * 0.75, r * 0.75); }
    else if (style === "dpad") {
      const a = r * 0.33;
      d.poly([[cx - a, cy - r], [cx + a, cy - r], [cx + a, cy - a], [cx + r, cy - a], [cx + r, cy + a], [cx + a, cy + a], [cx + a, cy + r], [cx - a, cy + r], [cx - a, cy + a], [cx - r, cy + a], [cx - r, cy - a], [cx - a, cy - a]], true);
      d.triArrow(cx, cy - r * 0.68, r * 0.16, -90); d.triArrow(cx, cy + r * 0.68, r * 0.16, 90); d.triArrow(cx - r * 0.68, cy, r * 0.16, 180); d.triArrow(cx + r * 0.68, cy, r * 0.16, 0);
    } else if (style === "arrows") {
      const g = r * 0.25;
      d.arrow(cx, cy - g, cx, cy - r); d.arrow(cx, cy + g, cx, cy + r); d.arrow(cx - g, cy, cx - r, cy); d.arrow(cx + g, cy, cx + r, cy);
    } else if (style === "circle-arrows") {
      d.ellipse(cx, cy, r, r);
      d.triArrow(cx, cy - r * 0.62, r * 0.17, -90); d.triArrow(cx, cy + r * 0.62, r * 0.17, 90); d.triArrow(cx - r * 0.62, cy, r * 0.17, 180); d.triArrow(cx + r * 0.62, cy, r * 0.17, 0);
    }
    return d.box(from);
  }

  // ---- entities (side views; each returns anchor points for parts) -------------------------------------------------
  const ENT = {
    // A fighter facing right. (x, y, w, h) is the body box.
    fighter(d, x, y, w, h) {
      d.poly([[x, y + h * 0.35], [x + w * 0.55, y + h * 0.2], [x + w * 0.85, y + h * 0.3], [x + w, y + h * 0.5], [x + w * 0.85, y + h * 0.68], [x + w * 0.5, y + h * 0.75], [x, y + h * 0.68]], true);
      d.poly([[x + w * 0.25, y + h * 0.3], [x + w * 0.1, y - h * 0.25], [x + w * 0.42, y + h * 0.24]], false);
      d.poly([[x + w * 0.3, y + h * 0.72], [x + w * 0.12, y + h * 1.15], [x + w * 0.48, y + h * 0.74]], false);
      d.add([[x + w * 0.62, y + h * 0.3], [x + w * 0.72, y + h * 0.18], [x + w * 0.84, y + h * 0.3]]);
      return { nose: [x + w, y + h * 0.5], tail: [x, y + h * 0.5], top: [x + w * 0.45, y + h * 0.22], bottom: [x + w * 0.55, y + h * 0.74], back: [x + w * 0.2, y + h * 0.4], wing: [x + w * 0.2, y - h * 0.15], dir: 1, size: h };
    },
    // A rocket standing up. (x, y, w, h) body box; nose up.
    rocket(d, x, y, w, h) {
      d.add([[x, y + h * 0.3], [x + w * 0.5, y], [x + w, y + h * 0.3]]);
      d.line(x, y + h * 0.3, x, y + h); d.line(x + w, y + h * 0.3, x + w, y + h); d.line(x, y + h, x + w, y + h);
      d.ellipse(x + w / 2, y + h * 0.45, w * 0.22, w * 0.22);
      d.poly([[x, y + h * 0.7], [x - w * 0.4, y + h], [x, y + h]], false); d.poly([[x + w, y + h * 0.7], [x + w * 1.4, y + h], [x + w, y + h]], false);
      return { nose: [x + w / 2, y], tail: [x + w / 2, y + h], top: [x + w / 2, y], bottom: [x + w / 2, y + h], side: [x + w, y + h * 0.55], sideL: [x, y + h * 0.55], vertical: true, size: w };
    },
    saucer(d, x, y, w, h) {
      d.ellipse(x + w / 2, y + h * 0.6, w / 2, h * 0.22);
      d.arcPath(x + w / 2, y + h * 0.42, w * 0.22, h * 0.38, 180, 360);
      d.line(x + w * 0.28, y + h * 0.42, x + w * 0.72, y + h * 0.42);
      for (const f of [0.25, 0.5, 0.75]) d.ellipse(x + w * f, y + h * 0.62, w * 0.025, w * 0.025, { overlap: 30 });
      return { nose: [x + w, y + h * 0.6], tail: [x, y + h * 0.6], top: [x + w / 2, y + h * 0.05], bottom: [x + w / 2, y + h * 0.82], back: [x + w * 0.1, y + h * 0.55], dir: 1, size: h * 0.5 };
    },
    block(d, x, y, w, h) {
      d.rect(x, y + h * 0.2, w * 0.8, h * 0.6);
      d.poly([[x + w * 0.8, y + h * 0.2], [x + w, y + h * 0.5], [x + w * 0.8, y + h * 0.8]], false);
      d.rect(x + w * 0.5, y + h * 0.3, w * 0.15, h * 0.15);
      d.line(x + w * 0.1, y + h * 0.2, x + w * 0.05, y); d.line(x + w * 0.05, y, x + w * 0.35, y + h * 0.2);
      return { nose: [x + w, y + h * 0.5], tail: [x, y + h * 0.5], top: [x + w * 0.5, y + h * 0.2], bottom: [x + w * 0.45, y + h * 0.8], back: [x + w * 0.2, y + h * 0.45], dir: 1, size: h * 0.6 };
    },
    // Person standing, facing the viewer. (cx, top, h).
    astronaut(d, cx, top, h, { helmet = true } = {}) {
      const u = h / 10;
      if (helmet) { d.ellipse(cx, top + u * 1.3, u * 1.3, u * 1.3); d.add([[cx - u * 0.8, top + u * 1.2], [cx + u * 0.8, top + u * 1.0], [cx + u * 0.7, top + u * 1.8], [cx - u * 0.7, top + u * 1.9], [cx - u * 0.8, top + u * 1.2]]); }
      else d.ellipse(cx, top + u * 1.3, u * 1.1, u * 1.2);
      d.rect(cx - u * 1.3, top + u * 2.7, u * 2.6, u * 3.4, { round: u * 0.6 });
      d.line(cx - u * 1.3, top + u * 3.2, cx - u * 2.8, top + u * 5.3); d.line(cx + u * 1.3, top + u * 3.2, cx + u * 2.8, top + u * 5.3);
      d.line(cx - u * 0.7, top + u * 6.1, cx - u * 1.1, top + u * 9.6); d.line(cx + u * 0.7, top + u * 6.1, cx + u * 1.1, top + u * 9.6);
      d.line(cx - u * 1.6, top + u * 9.7, cx - u * 0.6, top + u * 9.7); d.line(cx + u * 0.6, top + u * 9.7, cx + u * 1.6, top + u * 9.7);
      return { handR: [cx + u * 2.9, top + u * 5.4], handL: [cx - u * 2.9, top + u * 5.4], back: [cx - u * 1.3, top + u * 4], head: [cx, top], feet: [cx, top + h], size: h, u };
    },
    robot(d, cx, top, h) {
      const u = h / 10;
      d.rect(cx - u * 1.2, top + u * 0.8, u * 2.4, u * 1.8); d.ellipse(cx - u * 0.5, top + u * 1.6, u * 0.25, u * 0.25); d.ellipse(cx + u * 0.5, top + u * 1.6, u * 0.25, u * 0.25);
      d.line(cx, top + u * 0.8, cx, top + u * 0.1); d.ellipse(cx, top, u * 0.25, u * 0.25);
      d.rect(cx - u * 1.6, top + u * 2.9, u * 3.2, u * 3.3);
      d.line(cx - u * 1.6, top + u * 3.3, cx - u * 2.9, top + u * 5.4); d.line(cx + u * 1.6, top + u * 3.3, cx + u * 2.9, top + u * 5.4);
      d.rect(cx - u * 1.2, top + u * 6.2, u * 0.8, u * 3.4); d.rect(cx + u * 0.4, top + u * 6.2, u * 0.8, u * 3.4);
      return { handR: [cx + u * 3, top + u * 5.5], handL: [cx - u * 3, top + u * 5.5], back: [cx - u * 1.6, top + u * 4], head: [cx, top], feet: [cx, top + h], size: h, u };
    },
    car(d, x, y, w, h) {
      d.add([[x, y + h * 0.75], [x, y + h * 0.45], [x + w * 0.2, y + h * 0.4], [x + w * 0.32, y + h * 0.08], [x + w * 0.7, y + h * 0.08], [x + w * 0.82, y + h * 0.4], [x + w, y + h * 0.45], [x + w, y + h * 0.75], [x, y + h * 0.75]]);
      d.line(x + w * 0.5, y + h * 0.1, x + w * 0.5, y + h * 0.4); d.line(x + w * 0.22, y + h * 0.4, x + w * 0.8, y + h * 0.4);
      d.ellipse(x + w * 0.22, y + h * 0.78, h * 0.2, h * 0.2); d.ellipse(x + w * 0.22, y + h * 0.78, h * 0.06, h * 0.06, { overlap: 40 });
      d.ellipse(x + w * 0.78, y + h * 0.78, h * 0.2, h * 0.2); d.ellipse(x + w * 0.78, y + h * 0.78, h * 0.06, h * 0.06, { overlap: 40 });
      return { roof: [x + w * 0.5, y + h * 0.08], front: [x + w, y + h * 0.55], back: [x, y + h * 0.55], nose: [x + w, y + h * 0.55], dir: 1, size: h * 0.5 };
    },
    bike(d, x, y, w, h) {
      const r = h * 0.3;
      d.ellipse(x + r, y + h - r, r, r); d.ellipse(x + w - r, y + h - r, r, r);
      const bx = x + r, fx = x + w - r, wy = y + h - r;
      d.poly([[bx, wy], [x + w * 0.45, wy], [x + w * 0.38, y + h * 0.35], [bx, wy]], false);
      d.line(x + w * 0.45, wy, x + w * 0.66, y + h * 0.32); d.line(x + w * 0.38, y + h * 0.35, x + w * 0.66, y + h * 0.32);
      d.line(fx, wy, x + w * 0.66, y + h * 0.18); d.line(x + w * 0.6, y + h * 0.15, x + w * 0.74, y + h * 0.18);
      d.line(x + w * 0.32, y + h * 0.3, x + w * 0.44, y + h * 0.3);
      return { front: [x + w * 0.7, y + h * 0.2], back: [x + w * 0.3, y + h * 0.3], nose: [x + w, y + h * 0.4], roof: [x + w * 0.4, y + h * 0.2], dir: 1, size: h * 0.4 };
    },
    dog(d, x, y, w, h, { tail = true, ears = true } = {}) {
      d.ellipse(x + w * 0.45, y + h * 0.45, w * 0.3, h * 0.17);
      d.ellipse(x + w * 0.85, y + h * 0.22, w * 0.11, h * 0.13);
      if (ears) d.poly([[x + w * 0.8, y + h * 0.1], [x + w * 0.77, y - h * 0.02], [x + w * 0.86, y + h * 0.09]], false);
      d.ellipse(x + w * 0.88, y + h * 0.2, w * 0.012, w * 0.012, { overlap: 50 });
      d.line(x + w * 0.75, y + h * 0.33, x + w * 0.66, y + h * 0.4);
      for (const f of [0.22, 0.32, 0.58, 0.68]) d.line(x + w * f, y + h * 0.58, x + w * f + w * 0.01, y + h * 0.95);
      if (tail) d.add([[x + w * 0.15, y + h * 0.4], [x + w * 0.06, y + h * 0.25], [x + w * 0.03, y + h * 0.12]]);
      return { mouth: [x + w * 0.96, y + h * 0.28], feet: [x + w * 0.45, y + h * 0.95], footF: [x + w * 0.68, y + h * 0.95], back: [x + w * 0.45, y + h * 0.28], front: [x + w * 0.96, y + h * 0.3], dir: 1, size: h * 0.4 };
    },
    blob(d, cx, cy, r) {
      const pts = [];
      const k = d.rng.range(2, 4);
      for (let i = 0; i <= 36; i++) { const a = (i / 36) * Math.PI * 2; const rr = r * (1 + 0.18 * Math.sin(a * k + 1) + 0.08 * Math.sin(a * 5)); pts.push([cx + rr * Math.cos(a), cy + rr * 0.85 * Math.sin(a)]); }
      d.add(pts);
      d.ellipse(cx - r * 0.3, cy - r * 0.15, r * 0.1, r * 0.13); d.ellipse(cx + r * 0.3, cy - r * 0.15, r * 0.1, r * 0.13);
      d.arcPath(cx, cy + r * 0.1, r * 0.35, r * 0.25, 20, 160);
      return { top: [cx, cy - r], front: [cx + r, cy], handR: [cx + r, cy + r * 0.2], feet: [cx, cy + r * 0.85], size: r };
    },
    snake(d, x, y, w, h) {
      const pts = [];
      for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([x + w * t, y + h * 0.5 + Math.sin(t * Math.PI * 2.5) * h * 0.3]); }
      d.add(pts);
      const pts2 = pts.map(([px, py]) => [px, py + h * 0.14]);
      d.add(pts2);
      d.ellipse(x + w * 1.04, y + h * 0.62, w * 0.06, h * 0.13);
      d.ellipse(x + w * 1.05, y + h * 0.56, w * 0.008, w * 0.008, { overlap: 60 });
      d.line(x + w * 1.1, y + h * 0.66, x + w * 1.16, y + h * 0.62); d.line(x + w * 1.1, y + h * 0.66, x + w * 1.16, y + h * 0.7);
      return { mouth: [x + w * 1.1, y + h * 0.66], size: h };
    },
  };

  // ---- parts attached to anchors ------------------------------------------------------------------------------------
  const PARTS = {
    // Flames out of the tail, pointing away from the nose.
    flames(d, [ax, ay], { dir = -1, s = 10, vertical = false } = {}) {
      for (const k of [-0.35, 0, 0.35]) {
        const len = s * (k === 0 ? 1.5 : 1.0);
        if (vertical) d.add([[ax + k * s - s * 0.15, ay], [ax + k * s, ay + len * 0.6], [ax + k * s + s * 0.05, ay + len], [ax + k * s + s * 0.12, ay + len * 0.5], [ax + k * s + s * 0.15, ay]]);
        else d.add([[ax, ay + k * s - s * 0.15], [ax + dir * len * 0.6, ay + k * s], [ax + dir * len, ay + k * s + s * 0.05], [ax + dir * len * 0.5, ay + k * s + s * 0.12], [ax, ay + k * s + s * 0.15]]);
      }
    },
    cannon(d, [ax, ay], { dir = 1, s = 10, up = 0 } = {}) {
      d.rect(ax - s * 0.3, ay - s * 0.3 + up, s * 0.6, s * 0.4);
      d.line(ax, ay - s * 0.2 + up, ax + dir * s * 1.4, ay - s * 0.2 + up); d.line(ax, ay - s * 0.02 + up, ax + dir * s * 1.4, ay - s * 0.02 + up);
      d.line(ax + dir * s * 1.4, ay - s * 0.28 + up, ax + dir * s * 1.4, ay + s * 0.06 + up);
    },
    legs(d, [ax, ay], { s = 10, spread = 1 } = {}) {
      for (const k of [-1, 1]) {
        d.line(ax + k * s * 0.5 * spread, ay, ax + k * s * 1.1 * spread, ay + s * 1.1);
        d.line(ax + k * s * 1.1 * spread - s * 0.35, ay + s * 1.12, ax + k * s * 1.1 * spread + s * 0.35, ay + s * 1.12);
      }
    },
    drill(d, [ax, ay], { dir = 1, s = 10, vertical = false } = {}) {
      if (vertical) {
        d.poly([[ax - s * 0.4, ay], [ax, ay - s * 1.4], [ax + s * 0.4, ay]], false);
        for (const f of [0.3, 0.6, 0.9]) d.line(ax - s * 0.35 * (1 - f * 0.6), ay - s * 1.4 * f + s * 0.1, ax + s * 0.35 * (1 - f * 0.6), ay - s * 1.4 * f - s * 0.12);
        return;
      }
      d.poly([[ax, ay - s * 0.45], [ax + dir * s * 1.5, ay], [ax, ay + s * 0.45]], false);
      for (const f of [0.25, 0.5, 0.75]) d.line(ax + dir * s * 1.5 * f, ay - s * 0.45 * (1 - f) , ax + dir * s * 1.5 * f + dir * s * 0.18, ay + s * 0.45 * (1 - f));
    },
    bubble(d, cx, cy, rx, ry) { d.ellipse(cx, cy, rx, ry, { overlap: 25 }); },
    antenna(d, [ax, ay], { s = 10 } = {}) { d.line(ax, ay, ax + s * 0.2, ay - s * 1.2); d.arcPath(ax + s * 0.2, ay - s * 1.25, s * 0.45, s * 0.25, 180, 360); d.ellipse(ax + s * 0.2, ay - s * 1.4, s * 0.1, s * 0.1, { overlap: 40 }); },
    lamp(d, [ax, ay], { dir = 1, s = 10 } = {}) {
      d.ellipse(ax + dir * s * 0.3, ay, s * 0.3, s * 0.3);
      for (const a of [-25, 0, 25]) { const r = (a * Math.PI) / 180; d.line(ax + dir * s * 0.7, ay + Math.sin(r) * s * 0.5, ax + dir * s * 1.4, ay + Math.sin(r) * s * 1.1); }
    },
    redcross(d, [ax, ay], { s = 8 } = {}) { ICONS.cross(d, ax - s / 2, ay - s / 2, s); },
    bomb(d, [ax, ay], { s = 8 } = {}) { d.line(ax, ay, ax, ay + s * 0.4); ICONS.bomb(d, ax - s / 2, ay + s * 0.3, s); },
    shovel(d, [ax, ay], { s = 10, side = 1 } = {}) {
      d.line(ax, ay - s * 1.2, ax, ay + s * 0.8);
      d.line(ax - s * 0.25, ay - s * 1.2, ax + s * 0.25, ay - s * 1.2);
      d.add([[ax - s * 0.35, ay + s * 0.8], [ax + s * 0.35, ay + s * 0.8], [ax + s * 0.3, ay + s * 1.3], [ax, ay + s * 1.55], [ax - s * 0.3, ay + s * 1.3], [ax - s * 0.35, ay + s * 0.8]]);
    },
    handdrill(d, [ax, ay], { s = 10, dir = 1 } = {}) {
      d.rect(ax - s * 0.2, ay - s * 0.3, s * 0.8, s * 0.6); d.line(ax + s * 0.1, ay + s * 0.3, ax + s * 0.05, ay + s * 0.8);
      d.poly([[ax + dir * s * 0.6, ay - s * 0.25], [ax + dir * s * 1.5, ay], [ax + dir * s * 0.6, ay + s * 0.25]], false);
      d.line(ax + dir * s * 0.85, ay - s * 0.18, ax + dir * s * 0.95, ay + s * 0.18); d.line(ax + dir * s * 1.1, ay - s * 0.12, ax + dir * s * 1.2, ay + s * 0.12);
    },
    blaster(d, [ax, ay], { s = 10, dir = 1 } = {}) {
      d.poly([[ax - s * 0.2, ay - s * 0.3], [ax + dir * s * 1.3, ay - s * 0.3], [ax + dir * s * 1.3, ay], [ax + dir * s * 0.4, ay], [ax + dir * s * 0.3, ay + s * 0.5], [ax, ay + s * 0.5], [ax + dir * s * 0.05, ay], [ax - s * 0.2, ay]], true);
      d.line(ax + dir * s * 1.4, ay - s * 0.15, ax + dir * s * 1.8, ay - s * 0.15);
    },
    torch(d, [ax, ay], { s = 10 } = {}) { d.line(ax, ay + s * 0.6, ax + s * 0.2, ay - s * 0.6); ICONS.flame(d, ax - s * 0.25, ay - s * 1.35, s * 0.85); },
    roundshield(d, [ax, ay], { s = 10 } = {}) { d.ellipse(ax, ay, s * 0.7, s * 0.8); d.line(ax, ay - s * 0.6, ax, ay + s * 0.6); d.line(ax - s * 0.5, ay, ax + s * 0.5, ay); },
    jetpack(d, [ax, ay], { s = 10 } = {}) {
      d.rect(ax - s * 0.9, ay - s * 0.6, s * 0.8, s * 1.4, { round: s * 0.2 });
      PARTS.flames(d, [ax - s * 0.5, ay + s * 0.85], { s: s * 0.5, vertical: true });
    },
    claws(d, [ax, ay], { s = 8, dir = 1 } = {}) {
      for (const k of [-1, 0, 1]) d.add([[ax + k * s * 0.25, ay - s * 0.1], [ax + k * s * 0.3 + dir * s * 0.35, ay + s * 0.35], [ax + k * s * 0.32 + dir * s * 0.6, ay + s * 0.25]]);
    },
    wand(d, [ax, ay], { s = 10 } = {}) { d.line(ax, ay + s * 0.4, ax + s * 0.6, ay - s * 0.9); const c = [ax + s * 0.7, ay - s * 1.15]; for (const a of [0, 72, 144, 216, 288]) { const r = (a * Math.PI) / 180; d.line(c[0], c[1], c[0] + Math.cos(r) * s * 0.35, c[1] + Math.sin(r) * s * 0.35); } },
    cape(d, [ax, ay], { s = 10 } = {}) { d.add([[ax, ay - s * 0.8], [ax - s * 0.9, ay + s * 0.9], [ax - s * 0.3, ay + s * 0.75], [ax + s * 0.1, ay + s * 1.0], [ax + s * 0.25, ay - s * 0.6]]); },
  };

  window.HAND = { rngOf, Drawing, ICONS, button, stick, ENT, PARTS, arc };
})();
