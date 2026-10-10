// tv agent: measures the results screen in the page (page.evaluate(measureResults)): every player row (podium + the rest) and the
// session leaderboard rows: inside the viewport, no two intersecting, names not clipped, the banner hidden. Self-contained on purpose.
export function measureResults() {
  const vw = innerWidth, vh = innerHeight;
  const vis = (e) => e.getClientRects().length > 0;
  const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const rows = [];
  for (const e of pick("#podium .pc")) rows.push({ kind: "podium", name: (e.querySelector(".nm") || e).textContent.trim(), ...rect(e), el: e });
  for (const e of pick("#resRest .rr")) rows.push({ kind: "row", name: (e.querySelector(".nm") || e).textContent.trim(), ...rect(e), el: e });
  const lb = pick("#resLb .lrow").map((e) => ({ kind: "board", name: (e.querySelector(".nm") || e).textContent.trim(), ...rect(e), el: e }));
  const extra = [];
  for (const id of ["resTitle", "resSub", "resNext"]) { const e = document.getElementById(id); if (e && vis(e)) extra.push({ kind: id, name: id, ...rect(e), el: e }); }
  const card = document.getElementById("resBoard"), cardR = card && vis(card) ? rect(card) : null;
  const all = [...rows, ...lb, ...extra];
  const problems = [];
  for (const a of all) {
    if (a.x < -0.5 || a.y < -0.5 || a.r > vw + 0.5 || a.b > vh + 0.5) problems.push(`outside viewport: ${a.kind} ${a.name} [${a.x | 0},${a.y | 0},${a.r | 0},${a.b | 0}] vs ${vw}x${vh}`);
    const nm = a.el.querySelector && a.el.querySelector(".nm");
    if (nm && nm.scrollWidth > nm.clientWidth + 1) problems.push(`name clipped: ${a.kind} ${a.name}`);
  }
  const inter = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (inter(a, b)) problems.push(`overlap: ${a.kind} ${a.name} x ${b.kind} ${b.name}`);
  }
  if (cardR) {
    for (const a of [...rows, ...extra]) if (inter(a, { ...cardR })) problems.push(`on the leaderboard card: ${a.kind} ${a.name}`);
    for (const a of lb) if (a.b > cardR.b + 0.5 || a.y < cardR.y - 0.5) problems.push(`board row outside its card: ${a.name} bottom ${a.b | 0} card bottom ${cardR.b | 0}`);
  }
  const banner = document.getElementById("banner"), bb = document.getElementById("bannerBox");
  const bannerHidden = !!banner && (getComputedStyle(banner).display === "none" || !banner.getClientRects().length);
  const rowsOnly = rows;
  const fontPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const minFont = Math.min(...rows.map((r) => parseFloat(getComputedStyle(r.el.querySelector(".nm") || r.el).fontSize)));
  return {
    viewport: `${vw}x${vh}`, remPx: +fontPx.toFixed(2), players: rows.length, podium: rows.filter((r) => r.kind === "podium").length, rest: rows.filter((r) => r.kind === "row").length, boardRows: lb.length,
    lowestRowBottom: Math.round(Math.max(...rowsOnly.map((r) => r.b))), highestRowTop: Math.round(Math.min(...rowsOnly.map((r) => r.y))), nextRect: extra.find((e) => e.kind === "resNext") ? Math.round(extra.find((e) => e.kind === "resNext").y) : null,
    boardLowest: lb.length ? Math.round(Math.max(...lb.map((r) => r.b))) : null, cardBottom: cardR ? Math.round(cardR.b) : null,
    title: (document.getElementById("resTitle") || {}).textContent, sub: (document.getElementById("resSub") || {}).textContent, bannerHidden, minNamePx: +minFont.toFixed(1),
    firstRowName: rows[0] && rows[0].name, problems,
  };
}

