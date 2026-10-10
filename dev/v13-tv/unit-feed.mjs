// Node-only check of the v1.3 kill-feed parser (bigscreen-extras.js parseFeedLine → .fun segments). For the testing round:
//   node dev/v13-tv/unit-feed.mjs        (exit 1 on a failed case)
import { parseFeedLine, DEFAULT_LINES } from "../../bigscreen-extras.js";
const S = (segs) => (segs || []).map((s) => (s.c ? `[${s.c}]` : s.n != null ? `<${s.n}>` : s.p != null ? `!${s.p}!` : s.t)).join(" ");
const cases = [
  ["⚡ bob scrambled ana's buttons", "<bob> [emp] <ana> !BUTTONS SCRAMBLED!!"],
  ["\u{1F991} bob inked ana's screen", "<bob> [ink] <ana> !SPLAT!!"],
  ["\u{1F9F2} bob pulled ana in", "<bob> [pull] <ana> !YOINK!!"],
  ["\u{1F4A3} ana hit bob's mine (-30)", "<ana> HIT <bob> 'S [mine] !BOOM! −30!"],
  ["\u{1F3AD} ana shot bob's decoy", "<ana> FELL FOR <bob> 'S [decoy]"],
  ["\u{1F4B0} bob stole 750 points from ana!", "<bob> [steal] <ana> !+750 STOLEN!!"],
  ["\u{1F4A5} bob landed the last hit on the boss (stolen from ana)! LAND ON THE PLANET", "<bob> [boss] !STOLE THE LAST HIT FROM! <ana>"],
  ["\u{1F4A5} bob landed the last hit on the boss! LAND ON THE PLANET", "<bob> [boss] !LAST HIT! BOSS DOWN!!"],
  ["\u{1F4A5} The swarm brought the boss down! ana did the most damage: +1000. LAND ON THE PLANET", "[boss] !BOSS DOWN!! <ana> DID THE MOST DAMAGE"],
  ["\u{1F527} bob wrecked ana's ship (+150)", "<bob> [wreck] <ana> !SHIP WRECKED! +150!"],
  ["\u{1F527} ana's ship was wrecked", "[wreck] <ana> !SHIP WRECKED!!"],
  ["\u{1F48E} bob opened a chest (+1500)", "[chest] <bob> !OPENED A CHEST! +1500!"],
  ["ana landed on the planet. DIG UP A CHEST", "[planet] <ana> LANDED ON THE PLANET"],
  ["\u{1F3C6} Time's up! bob wins round 3 with 4800 points", "[win] <bob> !WINS THE ROUND!!"],
];
let bad = 0;
for (const [raw, want] of cases) {
  const got = S(parseFeedLine(raw, DEFAULT_LINES).fun);
  if (got !== want) { bad++; console.log("FAIL", JSON.stringify(raw), "\n  got ", got, "\n  want", want); } else console.log("ok  ", got);
}
// kills keep the old shape (no fun): killer, KO chip, victim, the trick's chip at the end
for (const raw of ["bob ✕ ana", "bob ✕ ana \u{1F4A3}", "ana was destroyed", "Round 3: REACH THE BOSS"]) {
  const l = parseFeedLine(raw);
  const ok = l.fun === null && (raw.includes("✕") ? l.kill && l.kill[0] === "bob" : true);
  if (!ok) { bad++; console.log("FAIL", raw, JSON.stringify(l)); } else console.log("ok  ", raw, JSON.stringify(l));
}
console.log(bad ? `${bad} FAILED` : "all OK");
process.exit(bad ? 1 : 0);
