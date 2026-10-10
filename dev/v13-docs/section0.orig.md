## 0. Design decisions, 9 October 23:10 (these override anything below that disagrees)

The owner answered a long round of questions after the first playtest. Where an older section says otherwise, this list wins; the sections below are being rewritten to match.

**Round and winning**
- A round ends at **4:00 at the latest, or earlier when every chest has been opened**. **Most points wins.** Tune so **25 players open all chests in about 3:00**; an expert about 3:00, a regular player about 4:00.
- **Session leaderboard:** each round's winner earns a star; the big screen keeps the running total for the evening.
- **Points:** chest +1500, boss last hit +1000, kill +200, killed -50.
- **Up to 25 players** per round (network, server and phone budgets must hold for 25).
- **Lobby started from the big screen:** players join from their phones; the host starts the round with a START button on `space.html` (no auto-start timer).

**World and pacing**
- **Much more space:** at least about a minute of flying to reach the boss rock, then more to the planet.
- **The boss** is armoured but **any weapon hurts it; it just takes many hits**. Its HP scales with the number of players. No special gate in space beyond having drawn a weapon.
- **The planet:** each player lands on their own once the boss is dead. Chests are of **two kinds: buried (needs a shovel or claws to DIG) and locked inside rocks (needs a drill to DRILL)**. The drill belongs to planet entities, not ships.

**Drawing, entities and controllers**
- **Two separate drawings, always:** the **entity** (the spaceship, then on the planet an astronaut, car, bike, animal…) becomes a 3D object in the world; the **controller** becomes the buttons on the phone screen.
- **Skills unlock only from what is drawn on the entity.** A plain ship only flies. Shoot needs a drawn gun, boost needs an exhaust with fire, and so on. **Nothing is automatic: the player must also draw the button** for every skill on their controller.
- **Sol is generous** when a drawn part is unclear (it unlocks the closest skill), and **a card shows what the drawing unlocked** ("Your ship can: fly, shoot (cannon), boost (flames)").
- **Full redraws only** (no add-a-part); each redraw costs one drawing from the world's budget (5 in space, 5 on the planet).
- **The controller is written by Sol as HTML:** a clean sci-fi UI matching the HUD, laid out the way the player drew it, running in a sandboxed frame that can only call the game's real actions. On the planet a new controller is **optional** (the space one is kept; a prompt suggests a redraw).

**PvP and mischief (ruthless, free-for-all)**
- Free-for-all, no teams. Dying costs -50 and a 3 s respawn; drawings are kept.
- Rivals can **steal chest points, steal the boss's last hit, and wreck parked ships** (a wrecked ship must be redrawn to take off).
- Mischief skills, each unlocked by drawing: **EMP** (a rival's buttons swap places for 5 s), **ink bomb** (ink covers a rival's screen until wiped), **tractor** (pulls rivals into rocks) and **mines**, **decoy** (a fake copy that draws fire).

**Style and copy (owner, 23:55)**
- **Style like Fortnite:** bright, saturated, cartoony 3D with chunky shapes and soft toon-like lighting (the plush inflated drawings fit right in); the UI is bold and chunky: slanted panels and buttons, heavy condensed italic capitals (Google Fonts "Bebas Neue" or "Barlow Condensed" 800 italic for headings, "Barlow" for body), white text with a dark outline or shadow, blue / purple / gold accents like Fortnite's rarity colours, big readable sizes, playful motion (pop-ins, bounces). This replaces the earlier "thin lines" HUD direction; `assets/reference/world-look.png` still sets the world's composition and palette.
- **Instructions must be SUPER CLEAR:** every screen answers "what do I do now?" in at most two short lines; numbered steps ("1 · DRAW YOUR SHIP on paper"), plain verbs, one example image per drawing step, the same three words everywhere (SHIP or ENTITY you draw, CONTROLLER, BUTTON), no jargon, no internal names (never "verb", "entity", "slot", "layout"). Every new copy string is checked by the first-timer persona of the playtest panel.

**Presentation**
- **Big screen = spectator TV:** cinematic camera, session leaderboard, kill feed, map, join QR. Not playable.
- **Simple synthesized sound effects** in v1. **English** only.
- **Iterate in playable versions:** every version runs end to end, is better than the last and adds more, until it is AAA-polished.

