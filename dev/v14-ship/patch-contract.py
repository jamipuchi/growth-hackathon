#!/usr/bin/env python3
# v14-ship3d: contract.js documentation of the ship spec (apply ONLY once v13-server and v14-fix-server have exited).
# Doc comments only; no check changes (no check validates entity keys). Idempotent. python3 dev/v14-ship/patch-contract.py
import sys, pathlib
p = pathlib.Path(__file__).resolve().parents[2] / "contract.js"
s = p.read_text()
if "ship3d.js" in s:
    print("contract.js already patched"); sys.exit(0)
def rep(old, new):
    global s
    if s.count(old) != 1: sys.exit(f"anchor not found exactly once: {old[:60]!r}")
    s = s.replace(old, new)
rep('''parked: [{ player, x, z, hp, maxHp, wrecked, image? }] },''', '''parked: [{ player, x, z, hp, maxHp, wrecked, image?, spec? }] },''')
rep('''   *                        source: "plain"|"model"|"devkit"|"bot", anims, image?,''',
'''   *                        source: "plain"|"model"|"devkit"|"bot", anims, image?,
   *                        spec?,                                        // v1.4, ships only: the drawing as 3D parts
   *                                                                      // (astra-ship.js: hull, cockpit, wings, fins,
   *                                                                      // engines, weapons, extras, palette; source
   *                                                                      // "model" | "entity"), built by ship3d.js on
   *                                                                      // every screen; also on island.parked[]. A
   *                                                                      // model spec that lands after the /generate
   *                                                                      // answer re-sends the entity''')
rep(''' * GET  /info ''', ''' * GET  /ship-spec?v=<hash>                          → { ok, spec } | 404   // v1.4: the spec of a ship drawing by the
   *                                                  // ?v= of its /drawings URL (sha1 of the PNG, 10 hex): the phone's
   *                                                  // result card (its first ship comes before its event stream)
   * GET  /info ''')
p.write_text(s)
print("contract.js patched")
