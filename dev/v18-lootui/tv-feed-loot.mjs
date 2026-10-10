// v1.8 loot on the TV: "✨ ana · 🔥 RAPID FIRE" (announce.quiet) is a small dim kill-feed line with its emoji kept (no chips), dropped
// when the feed is busy or right after another loot line. bigscreen-extras.js createKillFeed in the v12 fake DOM: node dev/v18-lootui/tv-feed-loot.mjs
import { Document } from "../v12-client/phone/smoke/dom.mjs";
const doc = new Document();
globalThis.document = doc;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const { createKillFeed } = await import("../../bigscreen-extras.js");
let fails = 0, n = 0;
const ok = (name, cond, extra = "") => { n++; if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  → " + JSON.stringify(extra) : ""}`); };
const lines = (f) => f.el.childNodes.filter((c) => c.nodeType === 1);
const cls = (el) => el.classList.value;

const host = doc.createElement("div"); doc.body.appendChild(host);
const feed = createKillFeed(host, { max: 5, life: 6500, side: "left", lootGap: 0 });
ok("a loot line shows on a quiet feed", feed.push("✨ ana · 🔥 RAPID FIRE", "#ff0", [["ana", "#f0f"]], "loot") === true && lines(feed).length === 1);
const first = lines(feed)[0];
ok("it is small and dim (quiet loot), emoji kept, no chips", /\bquiet\b/.test(cls(first)) && /\bloot\b/.test(cls(first)) && first.textContent.includes("🔥") && first.textContent.includes("✨") && !first.querySelector(".bse-chip"), [cls(first), first.textContent]);
ok("💎 GEMS is not a chest chip", feed.push("✨ ana · 💎 GEMS", "#ff0", null, "loot") && lines(feed)[1].textContent.includes("💎"));
feed.push("ana ✕ bob", "#f0f"); // 3 lines now: busy
ok("busy feed (3+ lines): the loot line is dropped", feed.push("✨ bob · 🧲 MAGNET", "#0ff", null, "loot") === false && lines(feed).length === 3);
feed.clear();
const gap = createKillFeed(host, { max: 5, side: "left" });
ok("default gap: a second loot line within 700 ms is dropped", gap.push("✨ ana · ⛽ BOOST", "#ff0", null, "loot") === true && gap.push("✨ bob · ❤️ REPAIR", "#ff0", null, "loot") === false);
// a loud line pushes a loot line out first when full
const full = createKillFeed(host, { max: 3, busy: 3, side: "left", lootGap: 0 });
full.push("✨ ana · 👻 GHOST", "#fff", null, "loot"); full.push("ana ✕ bob", "#f0f"); full.push("bob ✕ cat", "#f0f"); full.push("cat ✕ dan", "#f0f");
ok("over max: the loot line goes first", lines(full).length === 3 && !lines(full).some((l) => /\bloot\b/.test(cls(l))), lines(full).map(cls));
console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
