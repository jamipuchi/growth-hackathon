// ============================================================================================================
// What rivals do to me (mischief), the big moments (one chip), and my own death (the card)
// ============================================================================================================
const short = (name, n = 12) => String(name == null ? "" : name).toUpperCase().slice(0, n);
const isBot = (name) => { try { const h = S.game && S.game.hud && S.game.hud(); const r = h && (h.scores || []).find((x) => x.name === name); return !!(r && r.bot); } catch { return false; } };

// A toast addressed to me. My death arrives as one ("Destroyed by bob · back in 3 s", killer: "bob" | null): the death card says all of it,
// so that toast is swallowed and only its killer is kept.
function onToast(m) {
  if (m && m.kind === "info" && !m.verb && ("killer" in m || /^Destroyed\b/.test(String(m.text || "")))) return noteKiller(m.killer);
  showToast(m);
}

// ---- mischief: { type: "mischief", kind, player (the victim, me), from, seconds, points?, dir?, victim? } (render.js also sends other players'
// messages on older builds: only mine count). The effects live in mischief-fx.js and play no sound (render.js plays them). ----
let empRun = null;    // the EMP running on the DOM controls (the sandboxed frame swaps its own controls)
function onMischief(m) {
  if (!m || (m.player && m.player !== S.player) || S.screen !== "play") return;
  const host = $("play"), secs = Number(m.seconds);
  if (!MFX) return plainMischief(m);
  try {
    switch (m.kind) {
      case "emp":      // the target is the whole play screen: its EMP overlay (and the countdown chip) then sit above the HUD; the frame is found inside it
        empRun = MFX.emp(host, secs > 0 ? secs : 5, S.ctl ? {} : { onSwap: (map) => { empMap = map || null; releaseAll(); } });
        break;
      case "inkbomb": MFX.inkBomb(host, { seconds: secs > 0 ? secs : 4 }); break;
      case "tractor": MFX.tractorHit(host, { by: m.from, dir: Number.isFinite(+m.dir) ? -m.dir : 0, seconds: secs > 0 ? secs : undefined }); break;   // server: 0 = right, PI/2 = UP; mischief-fx: PI/2 = DOWN
      case "mine": MFX.mineHit(host, { by: m.from, points: -Math.abs(Number.isFinite(+m.points) ? +m.points : 30), stunSeconds: secs > 0 ? secs : undefined, shakeEl: $("game") }); break;
      case "decoy":    // seconds 0: no victim = I shot a decoy of m.from; a victim = my own decoy fooled him
        if (m.victim) MFX.decoyFooled(host, { by: m.victim, mine: true, victim: m.victim }); else MFX.decoyFooled(host, { by: m.from });
        break;
    }
  } catch (e) { console.warn("mischief effect failed", e); }
}
// Without mischief-fx.js: the frame's own EMP still scrambles, and a line says what happened.
function plainMischief(m) {
  const P = COPY.mischief.plain;
  if (m.kind === "emp" && S.ctl && S.ctl.handle) { try { S.ctl.handle.fx("emp", { seconds: Number(m.seconds) > 0 ? Number(m.seconds) : 5 }); } catch {} }
  const text = m.kind === "decoy" ? (m.victim ? P.decoyMine : P.decoy) : tpl(P[m.kind] || "", { n: Math.abs(Number.isFinite(+m.points) ? +m.points : 30) });
  if (text) showToast({ kind: "info", text });
}

// ---- the announcement chip: one short line under the objective for 2.5 s. A more important one is not pushed out by a lesser one. ----
let chipTimer = 0, chipPrio = 0;
function moment(title, { sub = "", tone = "gold", prio = 1, ms = 2500 } = {}) {
  const el = $("chip");
  if (S.screen !== "play" || (chipPrio > prio && !el.classList.contains("off"))) return;
  chipPrio = prio;
  $("chipTitle").textContent = title; $("chipSub").textContent = sub; el.dataset.tone = tone;
  el.classList.remove("off");
  clearTimeout(chipTimer);
  chipTimer = setTimeout(() => { el.classList.add("off"); chipPrio = 0; }, ms);
}
// My skill hit a rival (the kill feed names me): a gold toast. mischief-fx.js makes it when it is loaded, else the chip does.
function ownMischief(kind, victim) {
  const title = tpl(COPY.mischief.own[kind], { name: short(victim) });
  if (MFX) { try { MFX.toast(title, { tone: "gold", seconds: 2.4, screenEl: $("play") }); return; } catch {} }
  moment(title, { tone: "gold", prio: 3 });
}
// The kill feed ("announce") lines worth a chip. The TV shows the whole feed; the phone only the big moments and the ones about me.
function onAnnounce(m) {
  const t = m && typeof m.text === "string" ? m.text.trim() : "";
  if (!t || S.screen !== "play") return;
  const me = S.player, M = COPY.moment;
  let g;
  if ((g = /^(\w+) ✕ (\w+)/.exec(t))) {                       // "bob ✕ ana" (+ " 💣" / " 🧲" for a mischief kill)
    if (g[1] === me) moment(tpl(M.kill, { name: short(g[2]) }), { sub: isBot(g[2]) ? "" : tpl(M.killSub, { n: C.SCORING.kill }), prio: 3 });
    else if (g[2] === me) noteKiller(g[1]);                    // the death card says who did it
  } else if ((g = /^\S+\s+(\w+) scrambled (\w+)'s buttons/.exec(t))) { if (g[1] === me) ownMischief("emp", g[2]); }
  else if ((g = /^\S+\s+(\w+) inked (\w+)'s screen/.exec(t))) { if (g[1] === me) ownMischief("inkbomb", g[2]); }
  else if ((g = /^\S+\s+(\w+) pulled (\w+) in/.exec(t))) { if (g[1] === me) ownMischief("tractor", g[2]); }
  else if ((g = /^\S+\s+(\w+) hit (\w+)'s mine/.exec(t))) { if (g[2] === me) ownMischief("mine", g[1]); }      // "ana hit bob's mine (-30)": bob owns the mine
  else if ((g = /^\S+\s+(\w+) landed the last hit on the boss/.exec(t))) moment(M.bossDown, { sub: g[1] === me ? tpl(M.bossLastMe, { n: C.SCORING.bossLastHit }) : tpl(M.bossLast, { name: short(g[1]) }), prio: 4 });
  else if (/brought the boss down/.test(t)) moment(M.bossDown, { sub: M.bossSwarm, prio: 4 });
  else if (/^Assists on/.test(t)) moment(M.powers, { sub: M.powersSub, tone: "violet", prio: 3 });
  else if ((g = /^\S+\s+(\w+) opened a chest \(\+(\d+)\)/.exec(t))) {
    if (g[1] === me) moment(M.chestMe, { sub: tpl(M.chestMeSub, { n: g[2] }), prio: 2 });
    else moment(tpl(M.chest, { name: short(g[1]) }), { sub: tpl(M.chestSub, { n: g[2] }), tone: "cyan", prio: 1 });
  } else if ((g = /^\S+\s+(\w+) stole (\d+) points from (\w+)/.exec(t))) {
    if (g[1] === me) moment(tpl(M.stoleMe, { n: g[2] }), { sub: tpl(M.stoleMeSub, { name: short(g[3]) }), prio: 3 });
    else if (g[3] === me) moment(tpl(M.stoleYou, { name: short(g[1]), n: g[2] }), { sub: M.stoleYouSub, tone: "red", prio: 3 });
    else moment(tpl(M.stole, { name: short(g[1]), n: g[2] }), { sub: tpl(M.stoleSub, { victim: short(g[3]) }), tone: "violet", prio: 2 });
  }
}

// ---- the death card: big and centred while my ship is destroyed ("DESTROYED!", who did it, BACK IN 3 · 2 · 1, the points), then a short
// "BACK IN THE FIGHT!" pop. Driven by flags.dead / respawnIn of my player (hud.me); the controls are let go of when it opens. ----
const death = { on: false, since: 0, n: 0, killer: null, killerAt: -1e9, test: null, fightTimer: 0, color: "" };
function noteKiller(name) {
  death.killer = name ? String(name) : null; death.killerAt = performance.now();
  if (death.on) paintKiller();
}
function paintKiller() {
  const el = $("deadBy"); el.replaceChildren();
  if (!death.killer) return;
  const [a, z] = COPY.dead.by.split("{name}");
  const dot = document.createElement("i"); if (death.color) dot.style.background = death.color;
  const b = document.createElement("b"); b.textContent = short(death.killer, 14);
  el.append(dot, a, b, z || "");
}
function setDeadN(left) {
  const n = Math.max(1, Math.ceil((left || 0) - 0.001)), el = $("deadN");
  if (death.n === n) return;
  death.n = n; el.textContent = n;
  el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
}
function updateDeath(h, me) {
  const round = h.phase === "playing" || h.phase === "assists";
  let dead = round && !!(me && me.flags && me.flags.dead);
  let left = me && Number.isFinite(me.respawnIn) ? me.respawnIn : C.TUNING.respawnSeconds;
  if (death.test) { const rest = (death.test.until - performance.now()) / 1000; if (rest > 0) { dead = true; left = rest; } else death.test = null; }
  if (dead && !death.on) {
    death.on = true; death.since = performance.now(); death.n = 0;
    releaseAll(); hideTip();
    clearTimeout(death.fightTimer); $("fight").classList.remove("on");
    if (!death.test && performance.now() - death.killerAt > 5000) death.killer = null;       // an old killer belongs to an earlier death
    const k = death.killer && (h.scores || []).find((x) => x.name === death.killer);
    death.color = k ? colorCss(k.color) : "";
    paintKiller();
    $("deadPts").textContent = tpl(COPY.dead.points, { n: C.SCORING.killed });
    $("dead").classList.add("on");
  } else if (!dead && death.on) {
    death.on = false;
    $("dead").classList.remove("on");
    if (performance.now() - death.since > 600) {         // back: a short pop
      const f = $("fight");
      f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
      clearTimeout(death.fightTimer); death.fightTimer = setTimeout(() => f.classList.remove("on"), 1200);
    }
  }
  if (death.on) setDeadN(left);
}

