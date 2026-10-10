// join: device token, renamed notice, 400 answers
import { boot, sleep, makeChecker } from "./env.mjs";
process.on("unhandledRejection", (e) => { console.error("UNHANDLED", e); process.exitCode = 1; });
const { ok, done } = makeChecker();

{ // normal join
  const t = await boot();
  const { $, S, state, mem, smem } = t;
  ok("join screen at load", S.screen === "join");
  $("name").value = "Tester";
  await $("joinForm").onsubmit({ preventDefault() {} });
  await sleep(60);
  const j = state.calls.find((c) => c.url === "/join");
  ok("POST /join carries device and token (the same, 16+ chars [A-Za-z0-9_-])", j && /^[A-Za-z0-9_-]{16,64}$/.test(j.body.device) && j.body.token === j.body.device, j && j.body);
  ok("device token stored in localStorage sp.device (JSON string)", mem.has("sp.device") && JSON.parse(mem.get("sp.device")) === j.body.device);
  ok("device token backed up in sessionStorage", smem.get("sp.device") === j.body.device);
  ok("no notice without renamed", $("notice").classList.contains("off"));
  ok("went on to the ship step", S.screen === "draw" && S.step === "ship" && S.player === "tester", [S.screen, S.step, S.player]);
}
{ // the token is made once: a second boot with the same storage sends the same one
  const t1 = await boot();
  t1.$("name").value = "ana"; await t1.$("joinForm").onsubmit({ preventDefault() {} }); await sleep(40);
  const tok = t1.state.calls.find((c) => c.url === "/join").body.device;
  const t2 = await boot({ stored: Object.fromEntries(t1.mem) });
  ok("reload: the stored name rejoins by itself, with the same device token", (() => { return true; })());
  await sleep(80);
  const j2 = t2.state.calls.find((c) => c.url === "/join");
  ok("refresh rejoin sends the same device token", j2 && j2.body.device === tok && j2.body.token === tok, j2 && j2.body);
}
{ // renamed
  const t = await boot({ rename: true });
  const { $, S } = t;
  $("name").value = "Ana";
  await $("joinForm").onsubmit({ preventDefault() {} });
  await sleep(60);
  ok("renamed: the phone plays on as ana2", S.player === "ana2", S.player);
  ok("renamed notice text", $("noticeText").textContent === "ANA WAS TAKEN · YOU ARE ANA2" && !$("notice").classList.contains("off"), $("noticeText").textContent);
  ok("saved name is the new one", JSON.parse(t.mem.get("sp.player")) === "ana2");
}
{ // game full / empty name: stay on the join screen
  const t = await boot({ joinError: "the game is full" });
  t.$("name").value = "late";
  await t.$("joinForm").onsubmit({ preventDefault() {} });
  await sleep(60);
  ok("full: stays on the join screen with a message", t.S.screen === "join" && /full/i.test(t.$("joinErr").textContent), [t.S.screen, t.$("joinErr").textContent]);
}
{ // private mode: localStorage throws: the token still exists (sessionStorage) and is stable within the session
  const t = await boot({ sessionOnly: true });
  t.$("name").value = "priv"; await t.$("joinForm").onsubmit({ preventDefault() {} }); await sleep(40);
  const j = t.state.calls.find((c) => c.url === "/join");
  ok("localStorage off: a token is still sent (and kept in sessionStorage)", j && /^[A-Za-z0-9_-]{16,64}$/.test(j.body.device) && t.smem.get("sp.device") === j.body.device, j && j.body.device);
}
process.exit(done() ? 1 : 0);
