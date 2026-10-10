// v1.8 render helper (node only): prints "name|quality|triangles" for every build of entity-budget.mjs's spec set, so a change to
// entity3d.js can be compared with the previous version (builds that fitted their budget before should stay the same).
// THREE_JS=/path/to/three.module.js node dev/v18-render/entity-snapshot.mjs > after.txt
process.argv.push("--all");
const log = console.log;
const lines = [];
console.log = (s) => { for (const l of String(s).split("\n")) { const m = /^(?:ok  |OVER) (.{34}) (\w+)\s+(\d+) tris/.exec(l); if (m) lines.push(`${m[1].trim()}|${m[2]}|${m[3]}`); } };
const exit = process.exit;
process.exit = () => { log(lines.join("\n")); exit(0); };
await import("./entity-budget.mjs");
