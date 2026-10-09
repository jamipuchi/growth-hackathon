// node perf-report.js [perf.log] [--since 10m] [--json]
// One row per device/screen from the POST /perf samples in perf.log, with PASS/FAIL against PLAN.md section 4:
//   phone: average fps >= 55, 1% low >= 30, at most 80 draw calls and 120k triangles;  big: average fps >= 58.
// Exit code: 0 all pass, 1 any fail, 2 no samples.
const fs = require("fs");
const path = require("path");

const TARGETS = {
  phone: { avg: 55, low: 30, calls: 80, tris: 120000 },
  big: { avg: 58 },
};

function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/.exec(String(s || "").trim());
  if (!m) throw new Error(`bad --since "${s}" (use 30s, 10m, 2h, 1d)`);
  return Number(m[1]) * { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2] || "m"];
}

// A line is a JSON sample, optionally after a timestamp prefix ("2026-10-09T20:00:00.000Z {...}").
function parseLine(line) {
  const i = line.indexOf("{");
  if (i < 0) return null;
  let s;
  try { s = JSON.parse(line.slice(i)); } catch { return null; }
  if (!s || typeof s !== "object" || typeof s.fps !== "number") return null;
  const stamp = s.t ?? s.ts ?? s.time ?? s.at ?? (line.slice(0, i).trim() || undefined);
  const t = typeof stamp === "number" ? (stamp < 1e12 ? stamp * 1000 : stamp) : Date.parse(stamp);
  return { ...s, t: Number.isFinite(t) ? t : null };
}

function uaFamily(ua = "") {
  const ios = /(iPhone|iPad|iPod).*? OS (\d+)[_\d]*/.exec(ua);
  if (ios) {
    const browser = /CriOS/.test(ua) ? ", Chrome" : /FxiOS/.test(ua) ? ", Firefox" : /EdgiOS/.test(ua) ? ", Edge" : "";
    return `${ios[1] === "iPod" ? "iPhone" : ios[1]} (iOS ${ios[2]}${browser})`;
  }
  const android = /Android (\d+)/.exec(ua);
  const os = android ? `Android ${android[1]}` : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /(Chrome|Chromium)\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" ") || "unknown";
}

function percentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const max = (v) => (v.length ? Math.max(...v) : NaN);
const nums = (rows, k) => rows.map((r) => r[k]).filter((x) => typeof x === "number" && Number.isFinite(x));

// Each sample already summarises ~5 s. Per device: avg fps = mean of sample fps; 1% low = 5th percentile of the
// sample 1% lows (the minimum when there are fewer than 20 samples); p90 ms = 90th percentile of the sample p90s.
function summarise(samples) {
  const groups = new Map();
  for (const s of samples) {
    const screen = s.screen === "big" ? "big" : "phone";
    const device = uaFamily(s.ua);
    const player = screen === "big" ? s.player || "-" : s.player || "?";
    const key = `${screen}\u0000${player}\u0000${device}`;
    if (!groups.has(key)) groups.set(key, { screen, player, device, rows: [] });
    groups.get(key).rows.push(s);
  }
  return [...groups.values()].map(({ screen, player, device, rows }) => {
    const r = {
      screen, player, device,
      samples: rows.length,
      avgFps: mean(nums(rows, "fps")),
      low1: percentile(nums(rows, "low1"), 5),
      p90ms: percentile(nums(rows, "p90ms"), 90),
      maxCalls: max(nums(rows, "calls")),
      maxTris: max(nums(rows, "tris")),
      tiers: [...new Set(nums(rows, "tier"))].sort((a, b) => a - b),
      first: Math.min(...rows.map((x) => x.t ?? Infinity)),
      last: Math.max(...rows.map((x) => x.t ?? -Infinity)),
    };
    const T = TARGETS[screen];
    const fails = [];
    if (!(r.avgFps >= T.avg)) fails.push(`avg<${T.avg}`);
    if (T.low != null && !(r.low1 >= T.low)) fails.push(`1%low<${T.low}`);
    if (T.calls != null && r.maxCalls > T.calls) fails.push(`calls>${T.calls}`);
    if (T.tris != null && r.maxTris > T.tris) fails.push(`tris>${T.tris / 1000}k`);
    return { ...r, pass: fails.length === 0, fails };
  }).sort((a, b) => (a.screen === b.screen ? a.player.localeCompare(b.player) : a.screen === "phone" ? -1 : 1));
}

function fmt(n, d = 1) {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

function table(rows) {
  const head = ["screen", "player", "device", "samples", "avg fps", "1% low", "p90 ms", "max calls", "max tris", "tiers", "result"];
  const body = rows.map((r) => [
    r.screen, r.player, r.device, String(r.samples), fmt(r.avgFps), fmt(r.low1), fmt(r.p90ms),
    fmt(r.maxCalls, 0), Number.isFinite(r.maxTris) ? `${(r.maxTris / 1000).toFixed(1)}k` : "-",
    r.tiers.join(",") || "-", r.pass ? "PASS" : `FAIL (${r.fails.join(", ")})`,
  ]);
  const width = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => cells.map((c, i) => (i >= 3 && i <= 9 ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  ").trimEnd();
  return [line(head), width.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  let file = path.join(__dirname, "perf.log");
  let since = null;
  let sinceLabel = "all";
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" || args[i].startsWith("--since=")) {
      sinceLabel = args[i] === "--since" ? args[++i] : args[i].slice(8);
      since = parseDuration(sinceLabel);
      sinceLabel = `last ${sinceLabel}`;
    }
    else if (args[i] === "--json") json = true;
    else file = args[i];
  }
  if (!fs.existsSync(file)) {
    console.error(`no ${file}: open the game with phones connected first (they POST /perf every 5 s)`);
    return 2;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  let samples = lines.map(parseLine).filter(Boolean);
  const bad = lines.length - samples.length;
  const undated = samples.filter((s) => s.t == null).length;
  if (since != null) {
    const cutoff = Date.now() - since;
    samples = samples.filter((s) => s.t == null || s.t >= cutoff);
  }
  const rows = summarise(samples);
  if (json) {
    console.log(JSON.stringify({ file, since, samples: samples.length, skippedLines: bad, rows }, null, 2));
  } else {
    console.log(`perf report: ${file} (${sinceLabel}, ${samples.length} samples${bad ? `, ${bad} unreadable lines skipped` : ""}${undated && since != null ? `, ${undated} without a time kept` : ""})`);
    console.log("targets: phone avg >= 55 fps, 1% low >= 30, <= 80 calls, <= 120k tris; big avg >= 58 fps\n");
    console.log(rows.length ? table(rows) : "no samples");
    if (rows.length) console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} pass`);
  }
  if (!rows.length) return 2;
  return rows.every((r) => r.pass) ? 0 : 1;
}

module.exports = { parseLine, uaFamily, summarise, parseDuration, percentile, TARGETS };

if (require.main === module) process.exitCode = main(process.argv);
