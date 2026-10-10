// Node-only DOM test of bigscreen-extras.js (jsdom from another project on this machine; nothing installed): the kill feed (chips, KO,
// quiet lines, max 5) and the name tags (declutter modes, status chips, focus, lobby mode). No browser, no server.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("/Users/jaumepuig/Documents/linkedin/node_modules/jsdom");
const dom = new JSDOM("<!doctype html><html><body><div id=hud></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
for (const k of ["window", "document", "requestAnimationFrame", "getComputedStyle", "addEventListener", "removeEventListener", "Node"]) globalThis[k] = k === "window" ? dom.window : dom.window[k]?.bind ? dom.window[k].bind(dom.window) : dom.window[k];
globalThis.document = dom.window.document;
const X = await import("../../../bigscreen-extras.js");
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const hud = document.getElementById("hud");

// ---- kill feed ----
const names = new Map([["ana", "#ff0000"], ["bob", "#00ff00"], ["bot1", "#888888"], ["bot2", "#999999"]]);
const feed = X.createKillFeed(hud, { max: 5, life: 60000, labels: { emp: "EMP", ink: "INK", pull: "PULL", mine: "MINE", decoy: "DECOY", steal: "STEAL", ko: "KO" } });
feed.push("⚡ ana scrambled bob's buttons", "#f00", names);
feed.push("bob ✕ ana 💣", "#0f0", names);
feed.push("💰 ana stole 750 points from bob!", "#f00", names);
feed.push("bot1 ✕ bot2", "#888", names, "quiet");
feed.push("bot1 was destroyed", "#888", names, "quiet");
let items = [...feed.el.children];
ok(items.length === 5, `five lines (${items.length})`);
ok(items[0].querySelector(".bse-chip.emp") && /EMP/.test(items[0].textContent), "emp chip with its word on the first line");
ok(items[1].classList.contains("ko") && items[1].querySelector(".bse-chip.ko") && items[1].querySelector(".bse-chip.mine"), "kill line: KO chip + mine chip");
ok(items[1].children.length >= 4, "kill line has name spans, KO chip and mine chip");
ok([...items[1].querySelectorAll("span")].some((s) => s.style.color === "rgb(0, 255, 0)" || s.style.color === "#0f0"), "killer name painted in its colour");
ok(items[2].querySelector(".bse-chip.steal"), "steal chip");
ok(items[3].classList.contains("quiet") && items[3].classList.contains("ko"), "bot kill is quiet + ko");
feed.push("🧲 bob pulled ana in", "#0f0", names); // 6th line: the oldest QUIET line goes first, not the oldest
items = [...feed.el.children];
ok(items.length === 5, "still five after a sixth");
ok(!items.some((i) => /BOT1 ✕|bot1.*bot2/i.test(i.textContent) && i.classList.contains("quiet")), "the quiet bot kill was dropped first");
ok(items.some((i) => /scrambled/i.test(i.textContent)), "the first human line is still there");   // v1.3 fun line: "ana [EMP] BUTTONS SCRAMBLED! bob"
feed.push("🧲 bob pulled ana in", "#0f0", names); // dedupe
ok(feed.el.children.length === 5 && [...feed.el.children].filter((i) => /pulled|yoink/i.test(i.textContent)).length === 1, "the same line twice in a row is one line");   // v1.3 fun line: "bob [PULL] YOINK! ana"
feed.push("🏆 Time's up! ana wins round 3 with 4800 points", "#f00", names);
ok(![...feed.el.children].some((i) => /🏆/.test(i.textContent)), "other emoji are dropped");
feed.destroy();

// ---- name tags ----
const tags = X.createNameTags(hud, { max: 25, offset: 6, labels: { emp: "EMP", ink: "INK", pull: "PULL", stun: "STUN" } });
const mk = (n, crowd) => Array.from({ length: n }, (_, i) => ({ name: "p" + i, color: "#" + ((i * 4000321) & 0xffffff).toString(16).padStart(6, "0"), hp: 50, maxHp: 100, visible: true, dist: 30 + i * 8, bot: i >= 3, flags: i === 1 ? { emp: true } : i === 2 ? { inked: true, tractored: true, stun: true } : null,
  x: crowd ? 700 + (i % 5) * 18 : 100 + (i % 5) * 260, y: crowd ? 400 + Math.floor(i / 5) * 10 : 150 + Math.floor(i / 5) * 120 }));
const count = () => { const shown = [...tags.el.children].filter((e) => e.style.display !== "none"); const m = { m0: 0, m1: 0, m2: 0 }; for (const t of shown) m[(t.className.match(/m\d/) || ["m0"])[0]]++; return { shown: shown.length, ...m }; };
tags.update(mk(25, false), { limit: 25, focus: "p0" });
let c = count();
ok(c.shown === 25, `25 tags shown, not 12 (${JSON.stringify(c)})`);
ok(c.m0 >= 20, `a sparse screen keeps (almost) every tag full (${JSON.stringify(c)})`);
const chips = [...tags.el.querySelectorAll(".bse-tag-st .bse-chip.on")].map((e) => e.className.replace(/bse-chip|on/g, "").trim());
ok(chips.sort().join() === "emp,ink,pull,stun", `status chips emp+ink+pull+stun on (${chips})`);
tags.update(mk(25, true), { limit: 25, focus: "p0" });
c = count();
ok(c.shown === 25 && c.m1 + c.m2 > 8, `a crowd shrinks tags (${JSON.stringify(c)})`);
const first = [...tags.el.children].find((e) => e.querySelector(".bse-tag-name").textContent === "p0");
ok(/m0/.test(first.className), "the focused player keeps a full tag in a crowd");
ok(/translate3d\(.*\) scale\(1\)/.test(first.style.transform), `focused tag at scale 1 (${first.style.transform})`);
// humans (items without bot) come before bots in the stacking order
const z = (n) => +([...tags.el.children].find((e) => e.querySelector(".bse-tag-name").textContent === n).style.zIndex);
ok(z("p0") > z("p1") && z("p2") > z("p5"), `z-order: focus, humans, then bots (${z("p0")} ${z("p1")} ${z("p2")} ${z("p5")})`);
tags.update(mk(25, true).slice(0, 5), { limit: 25 });
c = count();
ok(c.shown === 5, `tags of players that left the view are released (${JSON.stringify(c)})`);
tags.update(mk(25, false).map((p, i) => ({ ...p, visible: i < 10 })), { limit: 25 });
ok(count().shown === 10, "invisible players get no tag");
// the phone's call: update(list) with no options, and a list longer than the pool
tags.update(mk(30, false));
ok(count().shown === 25, `update(list) with no options: at most max (25) tags (${JSON.stringify(count())})`);
const phone = X.createNameTags(hud, { max: 8, offset: 4 });
phone.update(mk(12, false));
ok([...phone.el.children].filter((e) => e.style.display !== "none").length === 8, "an old caller with max 8 still gets 8 tags");
phone.destroy();
// lobby mode
tags.setMode("lobby");
tags.setInfo(Object.fromEntries(mk(4, false).map((p) => [p.name, { sub: "✔ READY", short: "✔", tone: "ok", badge: "★ 2" }])));
tags.update(mk(4, false), { limit: 25 });
const card = tags.el.querySelector(".bse-tag:not([style*='none'])");
ok(tags.el.className.includes("bse-m-lobby") && /READY/.test(card.textContent), "lobby cards still carry the status text");
tags.setMode("play");
tags.update(mk(25, false), { limit: 25 });
ok(count().shown === 25, "back in play: 25 tags");
tags.destroy();
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
