// Simulated notebook photos (browser, classic script → window.PHOTO). Strokes are inked onto a ruled page, the page
// is "photographed" (rotation, keystone perspective, shadow, a thumb at the edge, noise, blur, JPEG), and the result goes
// through the phone's own analysePhoto + renderPhoto (copied verbatim from controller.html by build.mjs).
// Ground-truth rectangles follow the exact same chain: units → page px → photo px (homography) → analysis px → crop.
(function () {
  const PW = 1200, PH = 900;        // the page
  const FW = 1400, FH = 1050;       // the photo frame

  // ---- homography (4 point pairs) ----------------------------------------------------------------------------------
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
    return x;
  }
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  const apply = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };

  // ---- the page ----------------------------------------------------------------------------------------------------
  function page(strokes, c, rng) {
    const cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
    const g = cv.getContext("2d");
    g.fillStyle = "rgb(246,244,237)"; g.fillRect(0, 0, PW, PH);
    const p = c.photo;
    if (p.paper === "lined") {
      g.strokeStyle = "rgb(160,192,226)"; g.lineWidth = 1.6;
      for (let y = 70; y < PH; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(PW, y); g.stroke(); }
      g.strokeStyle = "rgb(232,150,150)"; g.beginPath(); g.moveTo(110, 0); g.lineTo(110, PH); g.stroke();
    } else if (p.paper === "grid") {
      g.strokeStyle = "rgb(188,206,226)"; g.lineWidth = 1.1;
      for (let y = 15; y < PH; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(PW, y); g.stroke(); }
      for (let x = 15; x < PW; x += 30) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PH); g.stroke(); }
    }
    // the drawing: fit 70 % of the page, a little off centre
    const k = Math.min((PW * 0.7) / c.w, (PH * 0.7) / c.h);
    const ox = (PW - c.w * k) / 2 + rng.range(-0.04, 0.04) * PW, oy = (PH - c.h * k) / 2 + rng.range(-0.03, 0.03) * PH;
    const pen = { pen: ["rgba(28,36,82,0.95)", 3.4], marker: ["rgba(18,18,18,0.97)", 7.5], pencil: ["rgba(92,92,98,0.82)", 2.6] }[p.pen] || ["#222", 3];
    g.lineCap = g.lineJoin = "round";
    const passes = p.pen === "pencil" ? [[0, 0, 1], [0.7, 0.4, 0.35]] : [[0, 0, 1]];
    for (const [dx, dy, alpha] of passes) {
      g.globalAlpha = alpha; g.strokeStyle = pen[0];
      for (const s of strokes) {
        g.lineWidth = pen[1] * rng.range(0.85, 1.15);
        g.beginPath(); g.moveTo(ox + s[0][0] * k + dx, oy + s[0][1] * k + dy);
        for (let i = 1; i < s.length; i++) g.lineTo(ox + s[i][0] * k + dx, oy + s[i][1] * k + dy);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    return { canvas: cv, toPage: ([x, y]) => [ox + x * k, oy + y * k] };
  }

  // ---- the photo ---------------------------------------------------------------------------------------------------
  function photograph(pg, c, rng, inkBoxPage) {
    const p = c.photo;
    const sc = rng.range(1.02, 1.12) * FW / PW;
    const rot = ((p.rot || 0) * Math.PI) / 180, ks = p.keystone || 0;
    const cx = FW / 2 + rng.range(-20, 20), cy = FH / 2 + rng.range(-15, 15);
    const corner = (sx, sy) => {
      const top = sy < 0;
      const x = sx * (PW / 2) * sc * (top ? 1 - ks : 1), y = sy * (PH / 2) * sc * (top ? 1 - ks * 0.4 : 1);
      return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
    };
    const src = [[0, 0], [PW, 0], [PW, PH], [0, PH]];
    const dst = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const H = homography(src, dst), Hinv = homography(dst, src);
    const pd = pg.canvas.getContext("2d").getImageData(0, 0, PW, PH).data;
    const out = new ImageData(FW, FH), o = out.data;
    const shadowAng = rng.range(0, Math.PI * 2), sh = p.shadow || 0;
    const blob = { x: rng.range(0.2, 0.8) * FW, y: rng.range(0.2, 0.8) * FH, r: rng.range(0.25, 0.45) * FW };
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const [u, v] = apply(Hinv, [x + 0.5, y + 0.5]);
        let r, gg, b;
        if (u >= 0 && v >= 0 && u < PW - 1 && v < PH - 1) {
          const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i = (y0 * PW + x0) * 4;
          const lerp = (ch) => (pd[i + ch] * (1 - fx) + pd[i + 4 + ch] * fx) * (1 - fy) + (pd[i + PW * 4 + ch] * (1 - fx) + pd[i + PW * 4 + 4 + ch] * fx) * fy;
          r = lerp(0); gg = lerp(1); b = lerp(2);
        } else {
          const t = 0.5 + 0.5 * Math.sin(x * 0.01 + y * 0.003);
          r = 70 + 25 * t; gg = 52 + 18 * t; b = 40 + 12 * t;
        }
        // light: a gradient from one side, a soft shadow blob (the phone), a vignette
        const gx = ((x / FW - 0.5) * Math.cos(shadowAng) + (y / FH - 0.5) * Math.sin(shadowAng)) + 0.5;
        const dB = Math.hypot(x - blob.x, y - blob.y) / blob.r;
        const vig = Math.hypot(x / FW - 0.5, y / FH - 0.5);
        const light = (1 - sh * 0.75 * Math.min(1, Math.max(0, gx))) * (1 - sh * 0.35 * Math.max(0, 1 - dB * dB)) * (1 - 0.18 * vig * vig * 4);
        const n = (rng() - 0.5) * 10;
        const j = (y * FW + x) * 4;
        o[j] = r * light + n; o[j + 1] = gg * light + n; o[j + 2] = b * light * 0.97 + n; o[j + 3] = 255;
      }
    }
    const cv = document.createElement("canvas"); cv.width = FW; cv.height = FH;
    const g = cv.getContext("2d");
    g.putImageData(out, 0, 0);
    if (p.thumb) {
      // a thumb holding the page at the edge, kept clear of the drawing
      const ink = inkBoxPage.map((pt) => apply(H, pt));
      const inkBottom = Math.max(...ink.map((q) => q[1])), inkRight = Math.max(...ink.map((q) => q[0]));
      g.save();
      if (p.thumb === "bottom") {
        const room = Math.max(40, FH - inkBottom - 25);
        g.translate(FW * rng.range(0.62, 0.82), FH + room * 0.15); g.rotate(rng.range(-0.3, 0.3));
        drawThumb(g, Math.min(110, room * 0.9), Math.min(190, room * 1.1));
      } else {
        const room = Math.max(40, FW - inkRight - 25);
        g.translate(FW + room * 0.15, FH * rng.range(0.35, 0.65)); g.rotate(Math.PI / 2 + rng.range(-0.3, 0.3));
        drawThumb(g, Math.min(110, room * 0.9), Math.min(190, room * 1.1));
      }
      g.restore();
    }
    const blurred = document.createElement("canvas"); blurred.width = FW; blurred.height = FH;
    const bg = blurred.getContext("2d");
    bg.filter = `blur(${rng.range(0.4, 1.0).toFixed(2)}px)`;
    bg.drawImage(cv, 0, 0);
    return { canvas: blurred, H };
  }
  function drawThumb(g, rx, ry) {
    const grad = g.createRadialGradient(-rx * 0.3, -ry * 0.4, rx * 0.1, 0, 0, Math.max(rx, ry));
    grad.addColorStop(0, "rgb(238,190,160)"); grad.addColorStop(0.7, "rgb(214,158,128)"); grad.addColorStop(1, "rgb(170,112,90)");
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(250,225,215,0.75)";
    g.beginPath(); g.ellipse(0, -ry * 0.55, rx * 0.55, ry * 0.3, 0, 0, Math.PI * 2); g.fill();
  }

  // ---- the full chain: strokes (units) → the 512 px image the phone sends, plus a mapper for GT rectangles ----------
  async function run(strokes, c, rng, pipeline) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pg = page(strokes, c, rng);
    const inkBoxPage = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(pg.toPage);
    const ph = photograph(pg, c, rng, inkBoxPage);
    const blob = await new Promise((res) => ph.canvas.toBlob(res, "image/jpeg", 0.84));
    const a = await pipeline.analysePhoto(blob);
    const rendered = pipeline.renderPhoto(a);
    const s = a.W / FW;
    // renderPhoto's crop, rotation and scale, replayed for one point
    const m = Math.round(0.04 * Math.max(a.box.w, a.box.h));
    const cx0 = Math.max(0, a.box.x - m), cy0 = Math.max(0, a.box.y - m);
    const cw = Math.min(a.W, a.box.x + a.box.w + m) - cx0, ch = Math.min(a.H, a.box.y + a.box.h + m) - cy0;
    const odd = a.turns % 2 === 1, rw = odd ? ch : cw, rh = odd ? cw : ch, k = 512 / Math.max(rw, rh);
    const OW = Math.round(rw * k), OH = Math.round(rh * k);
    const ang = (a.turns * Math.PI) / 2, cos = Math.round(Math.cos(ang)), sin = Math.round(Math.sin(ang));
    const toImage = ([ux, uy]) => {
      const [px, py] = apply(ph.H, pg.toPage([ux, uy]));
      const lx = (px * s - cx0 - cw / 2) * k, ly = (py * s - cy0 - ch / 2) * k;
      return [(lx * cos - ly * sin + OW / 2) / OW, (lx * sin + ly * cos + OH / 2) / OH];
    };
    const mapRect = (r) => {
      const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(toImage);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const X0 = Math.max(0, Math.min(...xs)), Y0 = Math.max(0, Math.min(...ys)), X1 = Math.min(1, Math.max(...xs)), Y1 = Math.min(1, Math.max(...ys));
      return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
    };
    // the raw photo, for eyeballing only: 800 px wide
    const small = document.createElement("canvas"); small.width = 800; small.height = Math.round((800 * FH) / FW);
    small.getContext("2d").drawImage(ph.canvas, 0, 0, small.width, small.height);
    const raw = small.toDataURL("image/jpeg", 0.72);
    return { image: rendered.image, raw, mapRect, turns: a.turns, photoMs: a.ms, size: [OW, OH] };
  }

  window.PHOTO = { run, homography, apply };
})();
