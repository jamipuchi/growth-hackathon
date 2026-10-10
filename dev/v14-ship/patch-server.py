#!/usr/bin/env python3
# v14-ship3d: the server.js side of drawn 3D ships (apply ONLY once v13-server and v14-fix-server have exited: they own
# server.js until then). Idempotent: running it twice changes nothing. Usage: python3 dev/v14-ship/patch-server.py
#   --stdout: print the patched source instead of writing server.js (dev/v14-ship/server.cjs runs it that way)
#   1. serve ship3d.js (PUBLIC_FILES)
#   2. keep each ship drawing's spec by the drawing's hash (the ?v= of its URL), attach it to every entity message and
#      parked ship next to `image`
#   3. GET /ship-spec?v=<hash> → { ok, spec } (the phone's result card: its first ship comes before its event stream)
#   4. a spec that lands after the /generate answer (astra.onShipSpec) re-sends that player's entity
import re, sys, pathlib

p = pathlib.Path(__file__).resolve().parents[2] / "server.js"
s = p.read_text()
TO_STDOUT = "--stdout" in sys.argv
if "shipSpecs" in s:
    if TO_STDOUT: sys.stdout.write(s); sys.exit(0)
    print("server.js already patched"); sys.exit(0)

def rep(old, new):
    global s
    if s.count(old) != 1:
        sys.exit(f"anchor not found exactly once: {old[:70]!r} ({s.count(old)})")
    s = s.replace(old, new)

# 1. ship3d.js is a public file
rep('"inflate.js",', '"inflate.js", "ship3d.js",')

# 2. specs by drawing hash + attach next to image
rep('''const drawnImages = Object.create(null); // player → { [entity type]: "/drawings/<player>-<kind>.png?v=<hash>" }''',
'''const drawnImages = Object.create(null); // player → { [entity type]: "/drawings/<player>-<kind>.png?v=<hash>" }
// v1.4 (ship3d.js): the ship spec Astra read from each ship drawing (astra-ship.js: hull, wings, engines... as parts), by
// the drawing's hash (the ?v= of its URL). Every ship entity message and parked ship carries it as `spec`, next to `image`.
const shipSpecs = new Map(); // hash → spec (newest 200)
const vOfUrl = (url) => { const m = /[?&]v=([0-9a-f]{6,40})/.exec(String(url || "")); return m ? m[1] : ""; };
function noteShipSpec(v, spec) {
  if (!v || !spec || typeof spec !== "object") return;
  shipSpecs.delete(v);
  shipSpecs.set(v, spec);
  if (shipSpecs.size > 200) shipSpecs.delete(shipSpecs.keys().next().value);
}
const shipSpecOf = (url) => shipSpecs.get(vOfUrl(url)) || null;''')

rep('''function drawnEntity(player, entity) {
  const url = entity && drawnImages[player] && drawnImages[player][kindOfEntity(entity)];
  if (!url || entity.image === url) return entity;
  const p = world.players[player];
  if (p && p.entity === entity) { entity.image = url; return entity; }
  return { ...entity, image: url };
}''', '''function drawnEntity(player, entity) {
  const url = entity && drawnImages[player] && drawnImages[player][kindOfEntity(entity)];
  const spec = url && entity.type === "ship" ? shipSpecOf(url) : null; // v1.4: the parts ship3d.js builds
  if (!url || (entity.image === url && (!spec || entity.spec === spec))) return entity;
  const p = world.players[player];
  if (p && p.entity === entity) { entity.image = url; if (spec) entity.spec = spec; return entity; }
  return spec ? { ...entity, image: url, spec } : { ...entity, image: url };
}''')

rep('''    const url = c && drawnImages[c.player] && drawnImages[c.player].ship;
    if (!url || c.image === url) return c;
    changed = true;
    return { ...c, image: url };''', '''    const url = c && drawnImages[c.player] && drawnImages[c.player].ship;
    const spec = url ? shipSpecOf(url) : null;
    if (!url || (c.image === url && (!spec || c.spec === spec))) return c;
    changed = true;
    return spec ? { ...c, image: url, spec } : { ...c, image: url };''')

# 2b. the /generate answer's spec is kept with the drawing
rep('''      const image = keepDrawing(player, body.kind, body.image);''',
'''      const image = keepDrawing(player, body.kind, body.image);
      if (image && body.kind === "ship" && result.entity.spec) noteShipSpec(vOfUrl(image), result.entity.spec);''')

# 3. GET /ship-spec?v=<hash>
rep('''    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/drawings/")) serveDrawing(req, res, url);''',
'''    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/drawings/")) serveDrawing(req, res, url);
    else if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/ship-spec") {
      // v1.4: the spec of a ship drawing by its hash (the phone's result card); 404 until Astra has one.
      const spec = shipSpecs.get(String(url.searchParams.get("v") || "").slice(0, 40));
      json(res, spec ? 200 : 404, spec ? { ok: true, spec } : { ok: false, error: "no spec" });
    }''')

# 4. a late spec re-sends the entity (and the parked ship)
rep('''function loadAstra() {
  try { return (astra = astra || require("./astra")); } catch (err) { console.log(`astra unavailable: ${err.message}`); return null; }
}''', '''function loadAstra() {
  try {
    astra = astra || require("./astra");
    if (astra && !lateSpecHooked && typeof astra.onShipSpec === "function") { lateSpecHooked = true; astra.onShipSpec(onLateShipSpec); }
    return astra;
  } catch (err) { console.log(`astra unavailable: ${err.message}`); return null; }
}
// v1.4: the model's ship spec arrived after the /generate answer (that answer carried a spec made from the entity's
// parts): keep it and send the player's ship again, so every screen rebuilds it from the model's parts.
let lateSpecHooked = false;
function onLateShipSpec({ player, image, spec }) {
  const m = /^data:image\\/png;base64,(.+)$/.exec(String(image || ""));
  if (!m || !spec) return;
  const v = sha1(Buffer.from(m[1], "base64")).slice(0, 10);
  noteShipSpec(v, spec);
  const url = drawnImages[player] && drawnImages[player].ship;
  if (!url || vOfUrl(url) !== v) return; // an older drawing of theirs: kept by its hash, nothing to send
  const p = world.players[player];
  if (p && p.entity && p.entity.type === "ship") broadcast({ type: "entity", player, entity: p.entity });
  if (p && p.mode === "planet") broadcast(world.worldMessage({ entities: false }));
}''')

if TO_STDOUT:
    sys.stdout.write(s)
else:
    p.write_text(s)
    print("server.js patched")
