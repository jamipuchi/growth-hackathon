// Node-only unit check of the kill-feed line parser (bigscreen-extras.js parseFeedLine) and the QR encoder on the /info URLs.
import { parseFeedLine, encodeQR } from "../../../bigscreen-extras.js";
const cases = [
  "bob ✕ ana",
  "bob ✕ ana 💣",
  "bob ✕ ana 🧲",
  "⚡ bob scrambled ana's buttons",
  "🦑 bob inked ana's screen",
  "🧲 bob pulled ana in",
  "💣 ana hit bob's mine (-30)",
  "🎭 ana shot bob's decoy",
  "💰 bob stole 750 points from ana!",
  "ana was destroyed",
  "🏆 Time's up! bob wins round 3 with 4800 points",
  "💥 bob landed the last hit on the boss! LAND ON THE PLANET",
  "🔧 bob wrecked ana's ship (+100)",
  "💎 bob opened a chest (+1500)",
  "bob ⚔️ ana",
  "bob ✕ ana️ 💣",
];
for (const c of cases) console.log(JSON.stringify(c), "→", JSON.stringify(parseFeedLine(c)));
for (const u of ["http://192.168.100.100:8266/controller.html", "https://192.168.100.100:8443/controller.html", "https://very-long-hostname.local.example:8443/controller.html"]) {
  try { const q = encodeQR(u); console.log("QR", u.length, "chars → version", q.version, "size", q.size); } catch (e) { console.log("QR FAIL", u, e.message); }
}
