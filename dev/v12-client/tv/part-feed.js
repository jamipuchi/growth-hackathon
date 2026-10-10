/* ---------- kill feed ---------- */

const isWordChar = (ch) => !!ch && /[a-z0-9]/i.test(ch);

// Splits text into [piece, colour|null] so every player name in it can be painted in that player's colour.
function colourSegments(text, names) {
  const low = text.toLowerCase();
  const hits = [];
  for (const [name, col] of names) {
    const n = String(name).toLowerCase();
    if (!n) continue;
    let i = -1;
    while ((i = low.indexOf(n, i + 1)) >= 0) {
      if (isWordChar(low[i - 1]) || isWordChar(low[i + n.length])) continue;
      hits.push({ i, e: i + n.length, col });
    }
  }
  hits.sort((a, b) => a.i - b.i || b.e - a.e);
  const out = [];
  let pos = 0;
  for (const h of hits) {
    if (h.i < pos) continue;
    if (h.i > pos) out.push([text.slice(pos, h.i), null]);
    out.push([text.slice(h.i, h.e), h.col]);
    pos = h.e;
  }
  if (pos < text.length) out.push([text.slice(pos), null]);
  return out;
}

// The server's announce lines carry one emoji per mischief (⚡ emp, 🦑 inkbomb, 🧲 tractor, 💣 mine, 🎭 decoy, 💰 steal): they become
// coloured icon chips. "bob ✕ ana" (+ " 💣" / " 🧲" for a mischief kill) becomes name · KO chip · name (· chip). Every other emoji is dropped.
const ICON_OF = { "⚡": "emp", "\u{1F991}": "ink", "\u{1F9F2}": "pull", "\u{1F4A3}": "mine", "\u{1F3AD}": "decoy", "\u{1F4B0}": "steal" };
const ICON_RE = /(⚡|\u{1F991}|\u{1F9F2}|\u{1F4A3}|\u{1F3AD}|\u{1F4B0})️?/gu;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2693}\u{2695}-\u{26FF}]️?/gu;
// → { lead: [chip keys before the words], tail: [chip keys after them], text, kill: [killer, victim] | null, ko: bool }
export function parseFeedLine(raw) {
  const lead = [], tail = [];
  const src = String(raw).replace(/⚔️?/g, "✕");
  let text = src.replace(ICON_RE, (m, ch, at) => {
    (/[a-z0-9]/i.test(src.slice(0, at)) ? tail : lead).push(ICON_OF[ch]);
    return " ";
  });
  text = text.replace(EMOJI_RE, "").replace(/\s+/g, " ").trim();
  let kill = null;
  const m = /^(.+?)\s*✕\s*(.+)$/.exec(text);
  if (m) kill = [m[1].trim(), m[2].trim()];
  const ko = !!kill || /\bwas destroyed$/i.test(text);
  if (ko && !kill) lead.unshift("ko");
  return { lead, tail, text, kill, ko };
}

// push(text, colour, names?, kind?): colour = the line's accent (the lead player's colour); names = [[name, colour], …] (or a Map)
// paints every player name in the text in its own colour; kind "hint" = a smaller purple line, "quiet" = a small dim line that
// is dropped first (a kill between two bots). opts.labels = the words on the chips ({ emp, ink, pull, mine, decoy, steal, ko }).
export function createKillFeed(container, opts = {}) {
  injectStyles();
  const max = opts.max || 5;
  const life = opts.life || 6000;
  const labels = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
  const el = document.createElement("div");
  el.className = "bse-feed";
  container.appendChild(el);
  const items = [];
  let lastSig = "", lastAt = 0;

  function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    clearTimeout(item.t1);
    clearTimeout(item.t2);
    item.el.remove();
  }
  function addText(parent, text, names) {
    if (!names) { parent.appendChild(document.createTextNode(text)); return; }
    for (const [piece, col] of colourSegments(text, names)) {
      if (col) {
        const sp = document.createElement("span");
        sp.style.color = col;
        sp.textContent = piece;
        parent.appendChild(sp);
      } else parent.appendChild(document.createTextNode(piece));
    }
  }
  function push(text, colour = "#9fd8ff", names, kind) {
    const line = parseFeedLine(text);
    const now = Date.now();
    const sig = line.lead.join() + "|" + line.text + "|" + line.tail.join();
    if (!line.text && !line.lead.length && !line.tail.length) return;
    if (sig === lastSig && now - lastAt < 1200) return; // the same line twice in a row is one event
    lastSig = sig;
    lastAt = now;
    const quiet = kind === "quiet";
    const d = document.createElement("div");
    d.className = "bse-feed-item" + (kind ? ` ${kind}` : "") + (line.ko ? " ko" : "");
    d.style.setProperty("--c", colour);
    for (const k of line.lead) d.appendChild(chipEl(k, labels[k]));
    if (line.kill) {
      addText(d, line.kill[0], names);
      d.appendChild(chipEl("ko", labels.ko));
      addText(d, line.kill[1], names);
    } else if (line.text) addText(d, line.text, names);
    for (const k of line.tail) d.appendChild(chipEl(k, labels[k]));
    el.appendChild(d);
    const item = { el: d, quiet };
    items.push(item);
    while (items.length > max) remove(items.find((it) => it.quiet && it !== item) || items[0]); // bot-only lines go first
    requestAnimationFrame(() => d.classList.add("in"));
    const ttl = quiet ? Math.round(life * 0.55) : life;
    item.t1 = setTimeout(() => {
      d.classList.remove("in");
      d.classList.add("out");
    }, ttl - 600);
    item.t2 = setTimeout(() => remove(item), ttl);
  }
  return { el, push, clear: () => items.slice().forEach(remove), destroy: () => { items.slice().forEach(remove); el.remove(); } };
}

