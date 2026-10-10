# phone-extras.js (v13-phone sub-task): readable HUD pieces, pencil examples

Implement-only round: syntax check OK (`node dev/v11-client/check-syntax.mjs phone-extras.js`), not tested (owner: implement first).
Signatures, return shapes and the radar convention (heading-up, dz > 0 drawn UP, y = c - dz*k) are unchanged. The sketch
hints are unchanged (`wobble` only gained an optional `step` parameter, default 9).

- createVitals: one dark slanted plate (rgb(13 11 46 / .78), skewX(-9deg), 3px #120a2e border, 0 4px 0 shadow) behind
  three 22px bars. HP is green, gold under 50% (new class `pe-mid`) and red and blinking under 25% (`pe-low`). SHIELD is
  cyan, BOOST gold/orange. Labels are 14px (HP number 15px) Barlow Condensed 900 italic with the dark outline. `shieldOff` /
  `boostOff` grey the icon, show a hatched empty bar and put a 🔒 (CSS ::before) in front of the label. The dead state
  turns the plate dark red and keeps the blinking "BACK IN {n}…" text. The plate is 178px wide (was 158); play is
  landscape-only, where the HUD's left column is about 230px.
- createRadar: the static base (hard drop-shadow crescent, rgb(13 11 46 / .72) disc, cyan view cone, ring and cross,
  cyan inner rim, 3px dark outline) is painted once to a hidden canvas and copied with drawImage. update() allocates nothing:
  the change key is an integer hash instead of map/join. Every blip has a dark outline. Players are blue-white dots, and
  players out of range sit dim on the rim. Boss shots and unknown kinds are small red dots, hidden when out of range. The
  objective is a gold diamond and the boss a red 8-point burst; both are pinned to the rim when out of range. The "you"
  arrow is now cyan (was gold).
- createDrawCounter: the counter now sits on its own slanted plate and turns red when no drawings are left. Pips are 14px
  (empty ones 12.6px): gold when a drawing is left, dark with a faint rim when used. The text is unchanged (smoke t3
  regexes still match).
- exampleSvg: pencil-on-paper drawings (graphite #3d3c48, seeded wobble, double pass, cached per kind) in a 240x160 viewBox.
  There is no background rect any more: the page's .example card is the paper. The top-left corner stays clear for the
  EXAMPLE tag. Labels fit their space automatically and split onto two lines at ", " or " = " ("flames =" / "BOOST").
  All-caps words are bolder, and button words in the boxes scale to the box ("DIG" big, "DRILL" fits). All text is
  escaped, there is no script and no external refs, and English defaults apply when labels are missing.
- Reduced motion: the low-HP and respawn blinks stop.

For the test round: check the examples on the 138x92 portrait card and in the explorer prompt, and the vitals, radar and
add-screen counter over the sunny island and the pink nebula.
