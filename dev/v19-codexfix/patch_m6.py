#!/usr/bin/env python3
# v19-codexfix M6 patch for render.js (class Perf, the quality governor): an outside frame-rate cap that no tier changes (Codex's
# regular route: both WebKit pages of a starved laptop sat at exactly 15 fps / 67 ms from tier 0 to tier 5) no longer leaves the
# game at the lowest quality for the rest of the round. A cascade of step-downs that started on steady, long, CPU-idle frames and
# reached the last tier without shortening them goes back to the tier it started from and holds it while the frames stay there
# (`capped`, like the 30 Hz Low Power Mode rule). Any step that helps (a GPU-bound phone) makes it a normal descent, as before.
# Usage: python3 -I patch_m6.py <path/to/render.js>
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
edits = []

def rep(old, new):
    edits.append((old, new))

rep(
"""    this.winAt = 0;
    this.sortBuf = new Float64Array(GOV_WIN);
  }""",
"""    this.winAt = 0;
    this.sortBuf = new Float64Array(GOV_WIN);
    // v1.9 (Codex M6): an outside cap. cascadeFrom = the tier a run of step-downs started from while none of them has shortened the
    // frames yet (cascadeP90 = the p90 that started it); capP90 = the frame time of a cap that no tier changed (quality holds there).
    this.cascadeFrom = -1;
    this.cascadeP90 = 0;
    this.capP90 = 0;
  }""")

rep(
"""    const p90 = this.winPct(this.winDt, 0.9), work90 = this.winPct(this.winWork, 0.9);
    this.capped = this.winPct(this.winDt, 0.1) >= 30 && p90 <= 36 && work90 < 8;
    if (p90 > STEP_DOWN_MS && !this.capped && this.tier < TIERS.length - 1) {
      // Into the last two tiers (bloom off, then near rocks only) only after a second slow window in a row.
      if (this.tier + 1 >= TIERS.length - 2 && ++this.slowRuns < 2) { this.sinceChange = 0; this.goodFor = 0; return false; }
      this.blockUntil[this.tier] = nowS + 20; // don't climb back into the tier we just left for 20 s
      return this.set(this.tier + 1);
    }""",
"""    const p90 = this.winPct(this.winDt, 0.9), work90 = this.winPct(this.winWork, 0.9), p10 = this.winPct(this.winDt, 0.1);
    this.capped = p10 >= 30 && p90 <= 36 && work90 < 8;
    // v1.9 (Codex M6): steady (p10 within 20 % of p90), long (>= 45 ms, under 22 fps) frames while the CPU is idle: the GPU, or a cap from
    // outside (a starved laptop's WebKit sat at exactly 15 fps on every tier). A descent is followed from its first step; the first step
    // after which the frames are not "stuck" at the same length (shorter by 10 %, uneven, or CPU-bound) makes it a normal descent.
    const stuck = p10 >= p90 * 0.8 && p90 >= 45 && work90 < 8;
    if (this.cascadeFrom >= 0 && !(stuck && p90 > this.cascadeP90 * 0.9)) this.cascadeFrom = -1;
    if (this.capP90 > 0) {
      if (p90 < this.capP90 * 0.6) this.capP90 = 0; // the cap lifted: the governor works as usual again
      else if (p90 <= this.capP90 * 1.15 && (stuck || p10 < this.capP90 * 0.85)) this.capped = true; // still capped, or lifting (a mixed window)
      else this.capP90 = 0; // slower than the cap: something else, the governor decides
    }
    if (this.cascadeFrom >= 0 && this.tier === TIERS.length - 1) {
      // Every tier tried and none shortened the frames: an outside cap. Back to the quality the cascade started from (no 20 s blocks),
      // held while the frames stay at this cap; they speed up or slow down past 15 % and the governor works as usual again.
      const back = this.cascadeFrom;
      this.cascadeFrom = -1;
      this.capP90 = p90;
      for (let i = back; i < TIERS.length; i++) this.blockUntil[i] = 0;
      this.set(back);
      this.capped = true;
      return true;
    }
    if (p90 > STEP_DOWN_MS && !this.capped && this.tier < TIERS.length - 1) {
      // Into the last two tiers (bloom off, then near rocks only) only after a second slow window in a row.
      if (this.tier + 1 >= TIERS.length - 2 && ++this.slowRuns < 2) { this.sinceChange = 0; this.goodFor = 0; return false; }
      this.blockUntil[this.tier] = nowS + 20; // don't climb back into the tier we just left for 20 s
      if (this.cascadeFrom < 0) { this.cascadeFrom = this.tier; this.cascadeP90 = p90; } // a descent starts here (dropped at the first step that helps)
      return this.set(this.tier + 1);
    }""")

# The ?perf overlay names the hold: an outside cap is not the 30 Hz Low Power Mode one.
rep(
"""${game.perf.capped ? ", 30 Hz cap" : ""}""",
"""${game.perf.capped ? (game.perf.capP90 > 0 ? ", outside cap" : ", 30 Hz cap") : ""}""")

out = src
for old, new in edits:
    n = out.count(old)
    if n != 1:
        sys.exit(f"anchor found {n} times (want 1):\n{old[:300]}")
    out = out.replace(old, new)
open(path, "w", encoding="utf-8").write(out)
print(f"patched {path}: {len(edits)} edits")
