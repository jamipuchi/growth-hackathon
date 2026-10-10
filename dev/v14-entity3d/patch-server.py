#!/usr/bin/env python3
"""v14-entity3d: server.js carries the explorer's BODY spec (astra-body.js) the way it carries the ship spec.

astra.js (v14-entity3d) now runs the spec call for explorer drawings too and puts the body spec on the explorer entity
(entity.spec, source "model" | "entity"); a late one comes through the same onShipSpec listener with kind "explorer".
server.js keeps specs by drawing hash already (shipSpecs, GET /ship-spec?v=); this patch makes that kind-agnostic:
  1. /generate: a finished explorer's spec is kept by its drawing's hash too (not only ships').
  2. drawnEntity: every drawn entity (ship or explorer) gets the spec kept for its drawing.
  3. onLateShipSpec: the late spec of an explorer drawing re-sends the player's explorer.
Usage: python3 dev/v14-entity3d/patch-server.py [--dry-run]   (idempotent; refuses when an anchor is missing)
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
P = ROOT / "server.js"
s = P.read_text()
dry = "--dry-run" in sys.argv

EDITS = [
    (
        '      if (image && body.kind === "ship" && result.entity.spec) noteShipSpec(vOfUrl(image), result.entity.spec);',
        '      if (image && result.entity.spec) noteShipSpec(vOfUrl(image), result.entity.spec); // v1.4: ship and body specs alike',
    ),
    (
        '  const spec = url && entity.type === "ship" ? shipSpecOf(url) : null; // v1.4: the parts ship3d.js builds',
        '  const spec = url ? shipSpecOf(url) : null; // v1.4: the parts ship3d.js (ships) or entity3d.js (explorers) builds',
    ),
    (
        '''function onLateShipSpec({ player, image, spec }) {
  const m = /^data:image\\/png;base64,(.+)$/.exec(String(image || ""));
  if (!m || !spec) return;
  const v = sha1(Buffer.from(m[1], "base64")).slice(0, 10);
  noteShipSpec(v, spec);
  const url = drawnImages[player] && drawnImages[player].ship;
  if (!url || vOfUrl(url) !== v) return; // an older drawing of theirs: kept by its hash, nothing to send
  const p = world.players[player];
  if (p && p.entity && p.entity.type === "ship") broadcast({ type: "entity", player, entity: p.entity });''',
        '''function onLateShipSpec({ player, kind, image, spec }) {
  const m = /^data:image\\/png;base64,(.+)$/.exec(String(image || ""));
  if (!m || !spec) return;
  const v = sha1(Buffer.from(m[1], "base64")).slice(0, 10);
  noteShipSpec(v, spec);
  const family = kind === "explorer" ? "explorer" : "ship"; // v1.4: an explorer's body spec comes the same way
  const url = drawnImages[player] && drawnImages[player][family];
  if (!url || vOfUrl(url) !== v) return; // an older drawing of theirs: kept by its hash, nothing to send
  const p = world.players[player];
  if (p && p.entity && kindOfEntity(p.entity) === family) broadcast({ type: "entity", player, entity: p.entity });''',
    ),
]

done = 0
for old, new in EDITS:
    if new in s:
        continue
    if s.count(old) != 1:
        sys.exit(f"anchor not found exactly once ({s.count(old)}): {old[:80]!r}")
    s = s.replace(old, new)
    done += 1
if not dry:
    P.write_text(s)
print(f"{'dry run: ' if dry else ''}{done} edit(s) {'would be ' if dry else ''}applied, {len(EDITS) - done} already in place")
