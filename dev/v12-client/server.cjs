// Test server for the v1.2 client track: the v1.1 harness wrapper (dev/v11-client/server.cjs: ASTRA_MOCK=1, HTTPS off,
// the /__test/* hooks to skip travel: /__test/state, /round, /teleport, /boss) around the REAL server.js of this tree
// (the v1.2 server, merged 01:56), plus the three client modules server.js does not list in PUBLIC_FILES yet
// (ctrl-sandbox.js, mischief-fx.js, sfx.js: served from the repo root by the wrapper, reported to the orchestrator).
//   PORT=8260 node dev/v12-client/server.cjs [--bots N] [--fast] [--assists S] [--cap S] [--scoreboard S]
// Perf samples go to dev/v12-client/perf.log, Astra's drawing copies to dev/v12-client/controllers-out/.
"use strict";
const path = require("path");
const EXTRA = ["ctrl-sandbox.js", "mischief-fx.js", "sfx.js"];
const i = process.argv.indexOf("--serve");
if (i >= 0) process.argv[i + 1] = [...new Set([...String(process.argv[i + 1] || "").split(","), ...EXTRA].filter(Boolean))].join(",");
else process.argv.push("--serve", EXTRA.join(","));
process.env.PERF_LOG = process.env.PERF_LOG || path.join(__dirname, "perf.log");
process.env.V11_DRAWINGS_DIR = process.env.V11_DRAWINGS_DIR || path.join(__dirname, "controllers-out");
process.env.PORT = process.env.PORT || "8260";
require("../v11-client/server.cjs");
