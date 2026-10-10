// Node-only smoke test of space.html's page script with a fake game (no browser, no server, no network): jsdom from another project
// on this machine (nothing installed), render.js replaced by a stub that lets the test emit tick / world / hud / announce / toast.
// Checks the live-data paths: the /info join code, the death panel, quiet bot kills, mischief chips, the results (one winner, nobody,
// no result yet), hints not shown.
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/Users/jaumepuig/Documents/linkedin/node_modules/jsdom");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const html = fs.readFileSync(path.join(ROOT, "space.html"), "utf8");
const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
// ?noceremony: the results show their end at once (v1.5 ceremony: the title is the reason first, the winner ~3 s later)
const dom = new JSDOM(body, { pretendToBeVisual: true, url: "http://127.0.0.1:8266/space.html?noceremony" });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => (k === "measureText" ? (s) => ({ width: String(s).length * 45 }) : () => {}), set: () => true });
for (const k of ["document", "location", "addEventListener", "removeEventListener", "getComputedStyle", "requestAnimationFrame", "performance"]) if (k !== "performance") globalThis[k] = typeof w[k] === "function" ? w[k].bind(w) : w[k];
Object.assign(globalThis, { window: w, innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false }), Path2D: class { moveTo() {} lineTo() {} closePath() {} arc() {} }, Contract: { COLORS: [0x22d3ee, 0xf472b6, 0xa3e635] } });
let infoReply = { ok: true, json: async () => ({ controllerUrl: "https://192.168.1.20:8443/controller.html" }) };
globalThis.fetch = async (url) => (String(url).includes("/info") ? infoReply : { ok: true, status: 200, json: async () => ({}) });

const handlers = {};
const game = { on(ev, cb) { (handlers[ev] ||= []).push(cb); return () => {}; }, emit(ev, d) { (handlers[ev] || []).forEach((cb) => cb(d)); }, projectPlayers: () => [], followed: null, setPlayer() {}, setView() {} };
let startOpts = null;
globalThis.__R = { startGame: (o) => ((startOpts = o), game), sfx: null };
let code = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
code = code.replace('import * as R from "./render.js";', "const R = globalThis.__R;").replace('await import("./bigscreen-extras.js")', `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "bigscreen-extras.js")).href)})`);
const file = path.join(os.tmpdir(), `tv-page-${process.pid}.mjs`);
fs.writeFileSync(file, code);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const $ = (id) => w.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("exit", () => { try { fs.unlinkSync(file); } catch (e) { /* gone */ } });
await import(pathToFileURL(file).href);
await sleep(30);

const P = (name, i, flags = {}, extra = {}) => ({ name, color: 0x22d3ee + i * 1000, mode: "space", x: 0, y: 0, z: 0, hp: 100, score: 100 * i, flags, ...extra });
const players = [P("ana", 1, {}), P("bob", 2, {}), P("bot1", 3, { bot: true }), P("bot2", 4, { bot: true })];
const hud = (o) => ({ phase: "playing", clock: 30, left: 200, leftText: "3:20", round: 2, objective: "destroyBoss", objectiveText: "DESTROY THE BOSS", bar: 0.5, status: "BOSS 50%", assists: false,
  chests: { total: 5, open: 1 }, leaderboard: [{ name: "ana", stars: 1, total: 900 }, { name: "bob", stars: 0, total: 700 }], result: null, radar: [], tier: 0,
  scores: players.map((p) => ({ name: p.name, color: p.color, score: p.score, mode: "space", bot: !!p.flags.bot, dead: !!p.flags.dead, ready: true, stars: 0 })).sort((a, b) => b.score - a.score),
  me: { name: "bob", color: 0xf472b6, mode: "space", hp: 80, maxHp: 100, shieldEnergy: 1, boostEnergy: 1, flags: {}, respawnIn: null }, followed: "bob", ...o });

// v1.6: the results' ONE jingle is this page's fanfare: the TV asks render.js for no "win" (render.js:3919 skips it)
ok(startOpts && startOpts.screen === "big" && startOpts.winJingle === false, `startGame({ screen: "big", winJingle: false }) (${JSON.stringify(startOpts && { screen: startOpts.screen, winJingle: startOpts.winJingle })})`);

// ---- lobby: the join code from /info (the TV is on 127.0.0.1) ----
game.emit("world", { type: "world", round: 2, result: null, chests: [], leaderboard: [] });
game.emit("tick", { type: "tick", phase: "lobby", players, left: 0 });
game.emit("hud", hud({ phase: "lobby", clock: 0, left: 0, objectiveText: "GET READY" }));
await sleep(50);
ok($("hud").dataset.view === "lobby", "lobby view");
ok(w.__bigscreen.joinUrl() === "https://192.168.1.20:8443/controller.html", `join code = /info controllerUrl (${w.__bigscreen.joinUrl()})`);
ok($("joinUrl").querySelector(".js").textContent === "https://" && $("joinUrl").querySelector(".jh").textContent === "192.168.1.20:8443" && $("joinUrl").querySelector(".jp").textContent === "/controller.html", "address shown as https:// + host:port + path");
ok(!!$("qr").querySelector("canvas"), "QR canvas is there (no hint)");

// ---- play: followed player alive, then dead with a countdown, then back ----
game.emit("hud", hud({}));
ok($("hud").dataset.view === "play" && !$("meters").classList.contains("dead"), "play view, panel normal");
game.emit("hud", hud({ me: { name: "bob", color: 0xf472b6, mode: "space", hp: 0, maxHp: 100, flags: { dead: true }, respawnIn: 2.2 } }));
ok($("meters").classList.contains("dead") && $("deadTitle").textContent === "DESTROYED" && $("deadSub").textContent === "BACK IN 3", `dead panel: ${$("deadTitle").textContent} / ${$("deadSub").textContent}`);
game.emit("hud", hud({ me: { name: "bob", color: 0xf472b6, mode: "space", hp: 100, maxHp: 100, flags: {}, respawnIn: null } }));
ok(!$("meters").classList.contains("dead") && $("meters").classList.contains("back") && $("deadTitle").textContent === "BACK IN THE FIGHT!", "respawn: green BACK IN THE FIGHT!");
await sleep(1700);
game.emit("hud", hud({}));
ok(!$("meters").classList.contains("back"), "the green pop goes away");
game.emit("hud", hud({ me: { name: "ana", color: 0x22d3ee, mode: "space", hp: 0, maxHp: 100, flags: { dead: true }, respawnIn: 0.4 } }));
ok($("deadSub").textContent === "BACK IN 1", "respawn 0.4 s still says BACK IN 1");
game.emit("hud", hud({}));

// ---- announce lines ----
const feedItems = () => [...w.document.querySelectorAll(".bse-feed-item")];
game.emit("announce", { type: "announce", text: "bot1 ✕ bot2", big: false });
game.emit("announce", { type: "announce", text: "ana ✕ bob 💣", big: false });
game.emit("announce", { type: "announce", text: "⚡ ana scrambled bob's buttons", big: false });
await sleep(30);
let items = feedItems();
ok(items.length === 3, `three feed lines (${items.length})`);
ok(items[0].classList.contains("quiet") && items[0].classList.contains("ko"), "a kill between two bots is a quiet KO line");
ok(!items[1].classList.contains("quiet") && items[1].querySelector(".bse-chip.mine") && items[1].querySelector(".bse-chip.ko"), "a kill with a human: KO chip + mine chip, not quiet");
ok(items[2].querySelector(".bse-chip.emp"), "mischief line: EMP chip");
ok(!$("bannerBox").classList.contains("show"), "no banner for those");
game.emit("announce", { type: "announce", text: "💰 ana stole 750 points from bob!", big: false });
await sleep(250);
ok($("bannerBox").classList.contains("show") && /stole/i.test($("bannerText").textContent) && !/💰/.test($("bannerText").textContent), "a steal still shows the gold banner (text without emoji)");
// v1.4+: no free skills at 3:00, the chests glow (world.js announce); an old server's "Assists on: ..." reads the same
game.emit("announce", { type: "announce", text: "3:00! The chests glow. Missing a skill? Draw it now!", big: true });
await sleep(250);
ok(/CHESTS GLOW/.test($("bannerText").textContent) && !/BONUS TIME|UNLOCKED/.test($("bannerText").textContent), `3:00 line rewritten in plain words (${$("bannerText").textContent})`);
game.emit("announce", { type: "announce", text: "Assists on: every gate skill is unlocked and the chests glow!", big: true });
await sleep(250);
ok(/CHESTS GLOW/.test($("bannerText").textContent) && !/UNLOCKED/.test($("bannerText").textContent), `old server's assists line: same plain words (${$("bannerText").textContent})`);
game.emit("toast", { type: "toast", player: "bob", kind: "hint", text: "Draw LAND" });
ok(!w.document.body.textContent.includes("Draw LAND"), "private hints are not shown on the TV");
w.__bigscreen.feed("🎭 ana shot bob's decoy");
await sleep(30);
ok(feedItems().some((i) => i.querySelector(".bse-chip.decoy")), "__bigscreen.feed() goes through the same path");

// ---- results: one winner ----
game.emit("world", { type: "world", round: 2, result: { round: 2, reason: "chests", winner: "ana", scores: [["bob", 700], ["ana", 650], ["bot1", 300], ["bot2", 0]] }, chests: [], leaderboard: [] });
game.emit("hud", hud({ phase: "scoreboard", clock: 9, result: { round: 2, reason: "chests", winner: "ana", scores: [["bob", 700], ["ana", 650], ["bot1", 300], ["bot2", 0]] } }));
await sleep(30);
ok($("hud").dataset.view === "results", "results view");
ok(/ana WINS!/.test($("resTitle").textContent), `title names the winner (${$("resTitle").textContent})`);
ok($("resSub").textContent === "EVERY CHEST IS OPEN!", "reason chip");
const podNames = [...w.document.querySelectorAll("#podium .pc")].map((e) => e.querySelector(".nm").textContent);
ok(podNames.length === 3 && podNames.includes("ana") && w.document.querySelector("#podium .p1 .nm").textContent === "ana", `podium: ana is 1st (${podNames})`);
ok(w.document.querySelector("#resRest .rr .nm").textContent === "bot2" && w.document.querySelectorAll("#resRest .rr").length === 1, "the rest: 1 row (4 players - 3 on the podium)");
game.emit("hud", hud({ phase: "scoreboard", clock: 8, result: { round: 3, reason: "time", winner: null, scores: [["ana", 0], ["bob", 0]] } }));
ok($("resTitle").textContent === "NOBODY SCORED" && w.document.querySelectorAll("#resRest .rr").length === 2, "nobody scored: title + all players listed");
game.emit("world", { type: "world", round: 3, result: null, chests: [], leaderboard: [] });
game.emit("hud", hud({ phase: "scoreboard", clock: 8, result: null }));
await sleep(5);
ok($("resTitle").textContent === "ROUND OVER" && !w.document.querySelector("#podium .nobody"), "no result yet: ROUND OVER, no 'nobody scored' flash");
ok(w.getComputedStyle($("banner")).display === "none" || $("hud").dataset.view === "results", "banner hidden in the results view (CSS in a browser)");

// ---- back to a lobby: the code is still there ----
game.emit("hud", hud({ phase: "lobby", clock: 0, left: 0, result: null }));
ok($("hud").dataset.view === "lobby" && w.__bigscreen.joinUrl().startsWith("https://"), "next lobby keeps the join code");
// a server without /info: the TV on localhost shows the hint
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
