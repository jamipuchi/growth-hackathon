// Validates every file in samples/ against Contract.CHECKS. Run: node dev/astra/check-samples.js
const fs = require("fs");
const path = require("path");
const Contract = require("../../contract.js");

const dir = path.join(__dirname, "../../samples");
const files = { "world.json": "world", "tick.json": "tick", "layout.json": "layout", "input.json": "input", "perf.json": "perf" };
let failed = 0;
for (const [file, check] of Object.entries(files)) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  const messages = Array.isArray(data) ? data : [data];
  const errors = messages.flatMap((m) => Contract.CHECKS[check](m));
  console.log(`${errors.length ? "FAIL" : "ok  "} ${file} (${messages.length} message${messages.length > 1 ? "s" : ""})${errors.length ? ": " + errors.join("; ") : ""}`);
  if (errors.length) failed++;
}
console.log(failed ? `${failed} sample file(s) invalid` : "all samples valid");
process.exit(failed ? 1 : 0);
