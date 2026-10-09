// Fills a running Space Party server with fake human players that each have a DRAWN ship (so the big-screen lobby shows
// drawn 3D ships). No browser needed: plain HTTP (POST /join, POST /generate kind ship, final).
//   node dev/v11-client/seed.mjs --port 8171 --players 8 [--explorers] [--ready] [--start-at K] [--names a,b,c] [--json]
//   --explorers  also post an explorer drawing for each (names starting car/bike/dog/blob become those types: server.cjs)
//   --ready      mark every seeded player ready (lobby ticks)
//   --start-at   skip the first K names of the list (to add more players later: --start-at 8 --players 16)
//   --names      explicit names instead of the built-in list (a "plain" prefix gives a drawn ship with nothing unlocked)
//   --serve      start dev/v11-client/server.cjs on --port first (our own child; --bots N, --fast and the other server flags
//                are passed through), seed, then keep running (heartbeat) until Ctrl-C or --seconds S, and stop the server.
//                Open http://localhost:<port>/space.html yourself to look at the lobby.
//   --keepalive  (without --serve) stay running and keep the seeded players active until Ctrl-C (world.js drops a human
//                after 10 minutes without input)
// Each player's ship is a different rocket (samples.cjs variant), so the drawings differ. Needs the server to be the test
// wrapper for forced explorer types; against the plain server.js it still seeds (everything is the dev kit "person").
import { args, makeLogger, request, get, seedPlayers, keepAlive, startServer, installSignalHandlers, runCleanups, sleep, SEED_NAMES, waitForCalm } from "./lib.mjs";

const A = args();
const log = makeLogger("seed");
installSignalHandlers(log);

const port = A.num("port", 8171);
const players = A.num("players", 8);
const startAt = A.num("start-at", 0);
const names = A.list("names");
const base = `http://127.0.0.1:${port}`;

async function main() {
  let server = null;
  if (A.flag("serve")) {
    if (!(await waitForCalm({ log, skip: A.flag("ignore-hold") }))) throw new Error("the laptop is busy (HOLD)");
    const passthrough = [];
    for (const f of ["fast"]) if (A.flag(f)) passthrough.push(`--${f}`);
    for (const o of ["assists", "cap", "scoreboard", "serve-files"]) if (A.opt(o) != null) passthrough.push(o === "serve-files" ? "--serve" : `--${o}`, A.opt(o));
    server = await startServer({ port, bots: A.num("bots", 0), serverArgs: passthrough, log });
  }
  const up = await request(base, "GET", "/__test/info", undefined, { timeout: 3000 });
  const plain = up.status !== 200 && (await get(base, "/space.html")).status === 200;   // plain server.js (no wrapper)
  if (up.status !== 200 && !plain) throw new Error(`no server answers on ${base} (start one: PORT=${port} node dev/v11-client/server.cjs, or pass --serve)`);
  if (plain) log("this is not the test wrapper: explorer types by name prefix will not be forced");

  const result = await seedPlayers(base, players, { names: names.length ? names : null, startAt, explorers: A.flag("explorers"), ready: A.flag("ready"), log });
  if (A.flag("json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const name of result.ok) {
      const e = result.entities[name];
      console.log(`  ${name.padEnd(10)} ship [${(e.ship.verbs || []).join(" ")}]${e.explorer ? `  explorer ${e.explorer.type}` : ""}`);
    }
  }
  if (!names.length && startAt + players > SEED_NAMES.length) log(`only ${SEED_NAMES.length} built-in names: asked for names up to #${startAt + players}`);

  if (server || A.flag("keepalive")) {
    keepAlive(base, result.ok, 30000);
    const seconds = A.num("seconds", 0);
    log(`${result.ok.length} players are in the lobby of ${base}/space.html; ${seconds ? `stopping after ${seconds} s` : "press Ctrl-C to stop"}`);
    await (seconds ? sleep(seconds * 1000) : new Promise(() => {}));
  }
  await runCleanups();
  return result.failed.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch(async (e) => { console.error(`[seed] failed: ${e.message}`); await runCleanups(); process.exit(1); });
