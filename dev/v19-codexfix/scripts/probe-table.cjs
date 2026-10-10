// v19-codexfix: prints a probe.jsonl (M6) as a table: one row per 5 s window per page.
const L = require("fs").readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const t0 = L[0].at || Date.now();
for (const r of L) {
  if (r.error || !r.at) { console.log("err", r.error); continue; }
  const p = (v, n) => String(v ?? "-").padStart(n);
  console.log(p(((r.at - t0) / 1000).toFixed(0), 4), (r.screen || "tv").padEnd(7), "iv", p(r.ivAvg, 6), "p90", p(r.ivP90, 5), "max", p(r.ivMax, 6), "| rafMs", p(r.rafMs, 6), "rafMax", p(r.rafMax, 5), "lag", p(r.lagAvg, 6), "lagMax", p(r.lagMax, 5),
    "| work", r.work ? `${r.work.avg}/${r.work.p90}/${r.work.max}` : "-", "| tier", r.tier, "prog", r.programs, "tex", r.textures, "geo", r.geometries, "calls", r.calls, r.scene, "anims", r.anims, (r.animList || []).join(" "), r.canvases);
}
