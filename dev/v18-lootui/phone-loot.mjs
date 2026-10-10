// v1.8 loot on the phone: the power-up / bubble countdown chips (kept with the HUD hidden), the loot-card toast, game.on("pickup").
// Runs controller.html in the v12 fake DOM (no browser): node dev/v18-lootui/phone-loot.mjs
import { boot, sleep, makeChecker } from "../v12-client/phone/smoke/env.mjs";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED", e); process.exitCode = 1; });
const { ok, done } = makeChecker();
const joinAs = async (t, name = "tester") => { t.$("name").value = name; await t.$("joinForm").onsubmit({ preventDefault() {} }); await sleep(50); };
const fire = (R, type, m) => (R.handlers[type] || []).forEach((cb) => cb({ type, ...m }));
const text = (el) => String(el.textContent || "").replace(/\s+/g, " ").trim();

const t = await boot(); const { $, T, R } = t;
await joinAs(t); T.go("play"); await sleep(150);
const C = globalThis.Contract || t.window?.Contract;
const K = C.TUNING.loot.kinds;

// a timed power-up from hud().me.powerup (render.js shape)
R.hud.phase = "playing";
R.hud.me = { ...R.hud.me, flags: {}, bubble: 0, powerup: { kind: "rapid", label: K.rapid.label, icon: K.rapid.icon, color: K.rapid.color, left: 4.2, seconds: K.rapid.seconds, text: "🔥 RAPID FIRE · 5s" } };
await sleep(260);
const pu = $("puChip"), bub = $("bubChip"), box = $("lootChips");
ok("power-up chip on: icon + label + seconds", pu.classList.contains("on") && box.classList.contains("on") && /RAPID FIRE/.test(text(pu)) && /5s/.test(text(pu)) && text(pu).includes(K.rapid.icon), text(pu));
ok("chip in the power-up colour (#ff5a1f)", String(pu.style["--pc"] || "").toLowerCase() === "#ff5a1f", pu.style["--pc"]);
const arc = pu.querySelector(".arc");
ok("ring empties with left / seconds (4.2 / 8 -> offset 48)", arc && String(arc.style.strokeDashoffset) === "48", arc && arc.style.strokeDashoffset);
ok("bubble chip off with no bubble", !bub.classList.contains("on"));
ok("the box is placed (left / top set)", /px$/.test(String(box.style.left)) && /px$/.test(String(box.style.top)), [box.style.left, box.style.top]);

// MEGA BLAST waits for the next shot
R.hud.me.powerup = { kind: "mega", label: K.mega.label, icon: K.mega.icon, color: K.mega.color, left: 15, seconds: K.mega.seconds };
await sleep(260);
ok("MEGA BLAST chip says NEXT SHOT", /MEGA BLAST/.test(text(pu)) && /NEXT SHOT/.test(text(pu)), text(pu));

// a SHIELD pickup's bubble: its own chip, cyan, with the seconds
R.hud.me.bubble = 5.3;
await sleep(260);
ok("bubble chip on: SHIELD + 6s", bub.classList.contains("on") && /SHIELD/.test(text(bub)) && /6s/.test(text(bub)), text(bub));
ok("bubble chip cyan (#22d3ee)", String(bub.style["--pc"] || "").toLowerCase() === "#22d3ee", bub.style["--pc"]);

// the HUD hidden: the chips stay (gameplay-critical): not in the hudoff hidden list, the box still on
T.hud(true); await sleep(260);
ok("HUD hidden: chips still on", box.classList.contains("on") && pu.classList.contains("on") && bub.classList.contains("on"));
T.hud(false); await sleep(150);

// both end
R.hud.me.powerup = null; R.hud.me.bubble = 0;
await sleep(260);
ok("both chips gone when the power-up and the bubble end", !pu.classList.contains("on") && !bub.classList.contains("on") && !box.classList.contains("on"));

// dead: no chips
R.hud.me.flags = { dead: true }; R.hud.me.bubble = 3;
await sleep(260);
ok("no chip while dead", !box.classList.contains("on"));
R.hud.me.flags = {}; R.hud.me.bubble = 0;

// the loot-card toast (server toast with pickup)
fire(R, "toast", { player: "tester", kind: "info", verb: null, text: "🔥 RAPID FIRE · 8s", sketch: null, ghost: null, pickup: "rapid", seconds: 8 });
await sleep(20);
ok("toast with pickup is a loot card", $("toast").dataset.kind === "loot" && !$("toast").classList.contains("off"), $("toast").dataset.kind);
ok("loot card: icon badge + label + small seconds", $("toastIcon").textContent === K.rapid.icon && /^RAPID FIRE/.test(text($("toastText"))) && /8s/.test(text($("toastText"))), [$("toastIcon").textContent, text($("toastText"))]);
fire(R, "toast", { player: "tester", kind: "info", verb: null, text: "plain words", sketch: null, ghost: null });
await sleep(20);
ok("a plain toast is not a loot card", $("toast").dataset.kind === "info" && $("toastIcon").textContent === "" && text($("toastText")) === "plain words");
const rare = T.pickupToast("homing");
ok("test hook pickupToast(homing): loot card, rare tier", rare.kind === "loot" && $("toast").dataset.tier === "rare", rare);

// game.on("pickup"): a buzz kind is logged
fire(R, "pickup", { kind: "rapid", label: "RAPID FIRE", icon: "🔥", color: K.rapid.color, seconds: 8, timed: true });
ok("game.on(pickup) buzzes powerup", T.haptics().log.slice(-1)[0] === "powerup", T.haptics().log.slice(-3));
process.exit(done() ? 1 : 0);
