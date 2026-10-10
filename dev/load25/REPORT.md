WORKS WITH CAVEATS — 25 players

25/25 joined, became READY, played, landed and took the quick explorer. No server exceptions, failed inputs or incorrect kicks in the valid gameplay run. `/input` p50/p95/p99: **1.01 / 2.75 / 4.64 ms**; TV **119.6–120 FPS** during measured play with 25 ships; WebKit phone **56.2 → 60 FPS** with 25 ships. **The main deployment risk is bandwidth: ~255 MB/min of phone SSE payload, ~34 Mbit/s server upload.**

Confidence is **moderate for local 25-player capacity**, insufficient to promise the same experience through ngrok or on 25 physical phones. This was a bounded test, not a soak. The automatic round-end-to-visible-Hall interval remains unverified; backend judging and the native 25-entry Hall display were verified separately.

Measured 2026-10-10, starting 16:03:32 Europe/Madrid, within the 15-minute limit. Target was the supplied frozen v1.9.3 copy, zero bots, default 30-second auto-start and two-minute maximum round. All eight relevant game-file hashes matched the main repository at verification ([hashes](build-hashes.json)). No game files were edited.

| Measurement | Result |
|---|---|
| 25 unique drawings submitted | All 25 `/generate` requests launched within **1 ms**; 50 real Sol calls, entity + ship spec per drawing |
| Generation response p50 / p95 / max | **3.725 / 5.043 / 5.713 s**, 25-way drawing concurrency |
| Join → READY p50 / p95 / max | **3.736 / 5.048 / 5.724 s** for that burst |
| Final generation fallbacks | **0/25**; all entity readings and all final ship specs were model-generated |
| Temporary inflate placeholder | **25/25** generation responses initially lacked a spec; genuine model specs arrived later. This is progressive rendering, not a failed generation |
| Original ship-spec latency | Approximately **6.63 s p50**, **9.57 s p95**, **11.36 s max**; default spec timeout is 12 s |
| External calls across all checks | **60 Sol / 40 Decisions**; limits 60 / 80. **0 HTTP errors, 0 429s, 0 timeouts, 0 blocked calls** |
| Valid round participation | **25 READY, 25 playing, 25 landed, 25 successful quick explorers**; 23 explicitly reached DIG and all 25 reached DRILL |
| Auto-start / round end | 30-second lobby timer + countdown worked; all chests were opened after **49.954 s** of play, ending the round before its two-minute maximum |
| `/input` load | **35,326** measured play requests, all HTTP 204; **707 requests/s**, **42,430 requests/min** equivalent |
| `/input` latency | p50 **1.013 ms**, p95 **2.751 ms**, p99 **4.641 ms**, max **10.545 ms**; localhost round trip |
| Server CPU, sampled every 2 s | Play mean **5.56%**, p95 **10.1%**, max **10.7%**; macOS `ps`, where one saturated core is 100% |
| Server RSS | Play mean **130.95 MiB**, play max **145.66 MiB**; whole valid run max **146.09 MiB** |
| Event-loop interval drift | 100-ms preload timer; play p50 **0.686 ms**, p95 **1.501 ms**, p99 **1.788 ms**, max **1.942 ms** |
| Tick delivery per phone | **14.974 tick messages/s** against configured 15 Hz; **32.15–32.21 total messages/s** |
| SSE per phone during play | **169.74–169.76 kB/s**; all 25 individual measurements in [phones.csv](phones.csv) |
| SSE total for 25 simulated phones | **4.244 MB/s**, **254.62 MB/min**, excluding TV and extra browser observer streams |
| 26th player | HTTP **400**, `{"error":"the game is full"}` |
| Wrongly kicked / input failures / server exceptions | **0 / 0 / 0** in the valid run |
| Round end → all 25 scores available | **3.307 s**, polling resolution 1.5 s; 15 real Decisions calls, remaining entries reused same-image scores |
| Separate uncached 25-unique-drawing judging | **25/25 scored in 4.013 s**, 25 Decisions calls, zero failures; original real drawings and specs |
| Round end → automatic Hall visibly showing all 25 | **Not measured**: the harness exited while the podium was still visible. This is a test coverage gap, not evidence of a game failure |
| Native Hall rendering | Separately verified **25 DRAWINGS RANKED**, 25 drawing images, no page errors, using the original genuinely scored archive; [screenshot](hall-25-unique.png) |

Browser measurements used one browser at a time, GPU-enabled Chromium at 1920×1080 and three sequential WebKit pages at 844×390, configured DPR 3. The phone renderer adaptively used DPR 1.25, tier 2. WebKit on this Mac is a browser proxy, not physical iPhone hardware.

| Browser scene | FPS samples | Draw calls | 1% low |
|---|---:|---:|---:|
| Chromium TV, 25 ships, lobby | 120 | 104 | 106.8–107.5 FPS |
| Chromium TV, 25 ships, playing | 120, 119.6 | 45, 47 | 106.8, 84.7 FPS |
| WebKit load01, 25 ships, playing | 56.2, 60.0 | 55, 49 | 10.7, 51.7 FPS |
| WebKit load02, 25 landed players | 56.3, 60.0 | 58, 58 | 11.2, 51.7 FPS |
| WebKit load03, 25 landed players | 56.8, 60.0 | 56, 71 | 11.9, 55.6 FPS |

The first WebKit sample includes cold loading and a frame hitch. Only load01's samples were taken before everyone landed; the other two pages measured the island. The server emitted real `perf big` / `perf phone` lines, retained in [server.log](server.log) and [perf.jsonl](perf.jsonl).

For ngrok, extrapolating the measured 25-phone workload gives **~42,430 input requests/min**, **254.62 MB/min outgoing SSE**, and approximately **4.23 MB/min input bodies**. Allowing an illustrative 600 bytes of combined HTTP request/response overhead per input adds **25.46 MB/min**, for **~284.3 MB/min combined application traffic (~37.9 Mbit/s)**. This estimate excludes TLS/TCP/tunnel overhead, cold static asset downloads, and CDN traffic; no compression benefit is assumed. The actual whole-server measurement, including the TV/browser observers and their asset loads, was 43,066 requests/min and 294.21 MB/min response bodies. **No load was sent through ngrok.**

The harness is [sim.mjs](sim.mjs): one `nice -n 5` Node process owns all 25 simulated phones. Each has its own name, device token and continuously open SSE stream. Axis posts use a 55-ms schedule (**18.2 Hz per axis**) and one request in flight per axis; the existing expert route driver supplies steering and changed button states. Buttons are route-driven holds/changes, not uniformly timed synthetic taps. Drawings use E04 synthetic strokes from `dev/v191-release/c-strokes.json`, with distinct numbered pixels to prevent cache coalescing in the original burst. Controllers and explorers use `/default`; no extra model generations are hidden in the driver.

**Coverage limitations and recovery:** the first instrumentation version attached a `data` listener to GET requests, prematurely triggering the server's request-close SSE cleanup. It also blocked the Three.js CDN. Its gameplay, kicks and browser results are discarded; its 25-way real API-generation measurements remain valid. After fixing the harness, 25 players completed the game using **five unique drawings shared across the 25 players**, requiring the remaining 10 Sol calls. Thus there was no single valid full run combining 25 distinct model variants, 25 live SSE streams and automatic Hall visibility. The original 25 distinct drawings were then judged uncached through the unchanged Hall module and displayed in the native Hall page via a local archive viewer. No mock generation or mock judging was used. The measured simulator is preserved as [sim.executed.mjs](sim.executed.mjs); `sim.mjs` now defaults to 25 unique drawings and waits for the visible Hall on a future run. That final harness improvement was syntax-checked, not rerun against an exhausted Sol budget.

**Risks and smallest fixes to consider:**

- **Internet upload is the constraint:** [server.js:118](../../server.js#L118), [server.js:481](../../server.js#L481) send uncompressed SSE state to every phone; [world.js:2025](../../world.js#L2025) includes full world snapshots. Smallest deployment mitigation: keep phones on the local HTTPS/LAN route. A small code option is negotiated gzip for SSE with `Z_SYNC_FLUSH`; measure latency and proxy buffering before relying on it.
- **Many tiny input requests:** [controller.html:1596](../../controller.html#L1596), [server.js:951](../../server.js#L951). Coalesce both latest axis values into one POST per flush; the server already accepts arrays. This reduces requests when both axes are active without reducing the control sampling rate.
- **Spec tail is close to timeout / hedges amplify concurrency:** [astra.js:120](../../astra.js#L120), [astra.js:126](../../astra.js#L126). Ten of the original specs took over the default 7-second hedge threshold. This test used `ASTRA_HEDGE_MS=60000` and `ASTRA_SPEC_HEDGE_MS=60000`, disabling delayed duplicates within existing timeouts. Smallest bounded-call configuration is those environment overrides; the default hedged rush was not tested.
- **Automatic Hall timing needs one more observation:** [space.html:2109](../../space.html#L2109) waits for the ceremony, then the Hall. Keep the harness running until `#hallOver.on iframe` contains all 25 ranked drawings. This wait is now in `sim.mjs`; the current report deliberately leaves the measured display interval blank.

Evidence: [metrics.json](metrics.json), [per-call latency/error CSV](api-calls.csv), [raw call ledger](api.jsonl), [per-phone CSV](phones.csv), [2-second CPU/RSS samples](ps.jsonl), [lag and traffic counters](monitor.jsonl), [full results](results.json), [uncached original judging](judge-original.json). Initial discarded gameplay evidence is retained under `attempt1/` and is not counted as a game defect.

Safety and cleanup: only the isolated clone was executed; local listeners were 8810/8811 and the Hall archive viewer on 8812. No request was sent to 8107, 8550 or 80; the live processes and source directory were not modified. No `.env` contents were printed. All owned processes exited, no test listeners remain, and `/private/tmp/claude-501/load25-build` was deleted. See [cleanup.json](cleanup.json).
