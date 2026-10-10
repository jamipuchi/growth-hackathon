// Deterministic island heightmap shared by the server (require) and the browser (<script>), so physics and visuals agree.
// v1.7 (owner, 10 Oct 12:22): the island doubles to 840 m across (2x width, 4x area; ORCHESTRATE.md A-005 revision).
// height() itself is in the larger convention, height(x, z) = the old 420 m island's height(x / 2, z / 2): the same hills
// and heights, twice as wide. Every reader (world.js physics and placement, render.js and the A-005 kit, the e2e driver)
// passes it directly: never add the kit's createScaledHeightAt on top (that would scale twice).
(function (root) {
  const ISLAND_SIZE = 840;
  const MAX_HEIGHT = 38;
  const FEATURE = 120; // m per noise cell (60 on the 420 m island)

  function hash(x, y, seed) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  function smoothNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed);
    const b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed);
    const d = hash(ix + 1, iy + 1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm(x, y, seed) {
    let total = 0;
    let amp = 0.5;
    let freq = 1;
    for (let i = 0; i < 5; i++) {
      total += amp * smoothNoise(x * freq, y * freq, seed + i * 13);
      amp *= 0.5;
      freq *= 2;
    }
    return total;
  }

  // Height in world units; below 0 is sea. A radial falloff keeps it an island.
  function height(x, z, seed) {
    const half = ISLAND_SIZE / 2;
    const r = Math.hypot(x, z) / half;
    const falloff = Math.max(0, 1 - r * r);
    const n = fbm(x / FEATURE + 10, z / FEATURE + 10, seed);
    return (n * 1.4 - 0.25) * MAX_HEIGHT * falloff - (1 - falloff) * 6;
  }

  const Terrain = { ISLAND_SIZE, MAX_HEIGHT, height, hash };
  root.Terrain = Terrain;
  if (typeof module !== "undefined") module.exports = Terrain;
})(typeof globalThis !== "undefined" ? globalThis : this);
