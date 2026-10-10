// Builds hall-mock/hall.json: the MOCK hall of fame (v1.9 demo, owner 13:41 "a mock hall of fame we can show as well").
// 16 real drawings from dev/v18-genquality (the shipped v18med run: its spec = <id>.view.json, its reading = <id>.spec.json
// .entity), with party player names, hand-written judge scores (0-100 per criterion, like hall.js parseAnswers) and
// comments. The output has exactly the shape of GET /hall (hall.js list()), images at /hall-mock/<id>.png.
//   node dev/v19-demo/hall-build-mock.mjs
// The PNGs were copied into hall-mock/ by hand (gen-corpus / v14 drawings, the photo downscaled with sips -Z 320).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "dev/v18-genquality/v18med");
const OUT = path.join(ROOT, "hall-mock");

// id (hall-mock/<id>.png), v18med source, player, colour, round, [creativity, effort, readability, fun], comment
const E = [
  ["color-robot", "bodies/color-robot", "Captain Crayon", "#22d3ee", 2, [93, 90, 95, 91], "Pincers, a blaster AND a lightning bolt. Overqualified for space."],
  ["monster-truck", "bodies/monster-truck", "Mr Wobbles", "#a3e635", 3, [91, 85, 90, 94], "Drill in front, fire behind, wheels the size of moons. Zero notes."],
  ["color-person", "bodies/color-person", "Zoe", "#f472b6", 1, [84, 89, 94, 87], "Pink hair puffs and a torch: the dark side of the moon is cancelled."],
  ["color-topview", "ships/color-topview", "Turbo Tia", "#facc15", 1, [80, 83, 93, 85], "Red hull, yellow wings, two guns. The poster jet, but it fires back."],
  ["horse-saddle", "bodies/horse-saddle", "Lady Neigh", "#fb923c", 3, [87, 83, 88, 79], "A horse. In space. With a saddle. Give this cowboy a planet."],
  ["chunky", "ships/E10-chunky", "Big Kev", "#c084fc", 2, [82, 77, 84, 83], "A flying shoebox with a drill nose and legs. Engineering? No. Genius? Yes."],
  ["saucer", "ships/E08-saucer", "Professor Pickles", "#60a5fa", 1, [70, 73, 92, 74], "Classic saucer, three portholes, a headlamp. Take me to your leader, politely."],
  ["color-messy", "ships/color-messy", "Glitter Gus", "#e879f9", 2, [86, 61, 69, 88], "A green potato in a purple hat with a jetpack. The room went wild."],
  ["rocket", "ships/E09-rocket", "Rocket Rosa", "#f87171", 1, [61, 70, 96, 72], "One porthole, three flames, four tiny feet. Textbook liftoff."],
  ["dog-claws", "bodies/dog-claws", "Barky McBarkface", "#34d399", 2, [75, 57, 71, 86], "Stick legs, a party hat and digging claws. Who's a good digger?"],
  ["cannon-flames", "ships/E04-cannon-flames", "Ace", "#fbbf24", 3, [58, 67, 91, 69], "Cannon on top, flames out back. A fighter that skips the small talk."],
  ["nose-drill", "ships/E06-nose-drill", "Drillbert", "#38bdf8", 2, [69, 63, 86, 68], "A drill on the nose. Asteroids, consider yourselves warned."],
  ["bike-lamp", "bodies/bike-lamp", "Pedal Pete", "#2dd4bf", 3, [66, 62, 90, 63], "A bicycle on a planet with no roads. Headlamp included, helmet not."],
  ["photo-bubble", "ships/photo-E16", "Thumbs", "#a78bfa", 1, [76, 49, 57, 79], "A ship in a shield bubble, with a bomb. The thumb cameo is free."],
  ["jaume-jet", "ships/jaume-jet", "DJ Jaume", "#fb7185", 3, [64, 46, 68, 81], "Drawn with one finger, mid-demo. Fastest ink in the galaxy."],
  ["blob", "bodies/blob", "Squish", "#818cf8", 2, [60, 31, 79, 85], "No arms, no legs, no worries. Just vibes and a big smile."],
];

const CRIT = ["creativity", "effort", "readability", "fun"];
const T0 = Date.parse("2026-10-10T11:20:00Z");
const entries = E.map(([id, src, player, color, round, sc, comment], i) => {
  const spec = JSON.parse(fs.readFileSync(path.join(SRC, `${src}.view.json`), "utf8"));
  const rec = JSON.parse(fs.readFileSync(path.join(SRC, `${src}.spec.json`), "utf8"));
  if (!fs.existsSync(path.join(OUT, `${id}.png`))) throw new Error(`missing hall-mock/${id}.png`);
  const ent = rec.entity || {};
  const kind = src.startsWith("ships/") ? "ship" : "explorer";
  const scores = Object.fromEntries(CRIT.map((k, j) => [k, sc[j]]));
  const score = Math.round(sc.reduce((s, v) => s + v, 0) / sc.length);
  return {
    id, player, color, round, kind, type: kind === "ship" ? "ship" : spec.type, at: T0 + round * 9 * 60000 + i * 7000, final: true,
    image: `/hall-mock/${id}.png`, spec, layout: null, ctrl: null, htmlSource: null,
    skills: (ent.unlocked || []).slice(0, 16).map((u) => ({ verb: u.verb, part: u.part || "" })),
    card: typeof ent.card === "string" ? ent.card.slice(0, 200) : null, source: rec.source || "draw",
    judge: "done", error: null, scores, score, comment, mock: false, cached: false, _n: i,
  };
});
// ranked like hall.js list(): score desc, ties to the earlier drawing
entries.sort((a, b) => b.score - a.score || a._n - b._n);
const out = {
  ok: true, session: "smock19", startedAt: T0, mockHall: true,
  judging: { running: false, done: entries.length, judged: entries.length, failed: 0, skipped: 0, pending: 0, unjudged: 0, total: entries.length,
    calls: entries.length, maxCalls: 60, api: "openai decisions", model: "gpt-6-luna", mock: false },
  entries: entries.map(({ _n, ...e }, i) => ({ rank: i + 1, ...e })),
};
fs.writeFileSync(path.join(OUT, "hall.json"), JSON.stringify(out, null, 1) + "\n");
console.log(out.entries.map((e) => `#${e.rank} ${e.score} ${e.player} (${e.kind}/${e.type}) ${e.skills.map((s) => s.verb).join(",")}`).join("\n"));
