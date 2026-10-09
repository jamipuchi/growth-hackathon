#!/usr/bin/env node
// Syntax check for the client track (no browser, no server, safe to run anywhere, any time).
//   node dev/v11-client/check-syntax.mjs <file...> [--quiet]
// .js / .mjs: checked as an ES module (node --check on a temp .mjs copy). A .js file with no import/export that is not
//   valid module syntax is also tried as a classic script (contract.js, verbs.js... load with <script src>); .cjs: classic.
// .html: every inline <script> block is checked (type="module" as a module, no type / text/javascript as a classic
//   script; importmaps, JSON and other non-JS types and <script src> blocks are skipped). Errors report the HTML line.
// Prints OK or FAIL per file (FAIL lines carry file:line, the message and the source line). Exit code 1 when any fails.
// Only syntax is checked: imports are not resolved and nothing runs.
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: node dev/v11-client/check-syntax.mjs <file.js|file.mjs|file.html ...> [--quiet]");
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v11-syntax-"));
let counter = 0;
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

// node --check on a temp copy; `padLines` blank lines in front keep the reported line number equal to the real one.
function nodeCheck(code, ext, padLines = 0) {
  const file = path.join(tmp, `f${++counter}.${ext}`);
  fs.writeFileSync(file, "\n".repeat(padLines) + code);
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status === 0) return { ok: true };
  const lines = String(r.stderr || "").split("\n");
  // First line of node's report: "<real path of the temp file>:<line>" (the path may be the realpath of ours).
  const at = lines.findIndex((l) => /^(?:file:\/\/)?\/.+\/f\d+\.(?:mjs|cjs):\d+$/.test(l));
  const line = at >= 0 ? Number(lines[at].slice(lines[at].lastIndexOf(":") + 1)) : null;
  const src = at >= 0 ? lines[at + 1] || "" : "";
  const caret = at >= 0 ? lines[at + 2] || "" : "";
  const errLine = lines.find((l) => /^(\w*Error)\b/.test(l)) || lines.find((l) => l.trim()) || "syntax error";
  return { ok: false, line, src, caret, message: errLine.trim() };
}

const hasModuleSyntax = (code) => /^\s*(import\s*(?:[\w$]+\s*(?:,|from)|\{|\*|["'])|export\s)/m.test(code);

// → { ok, mode, error? }
function checkScript(code, { hint, padLines = 0 }) {
  if (hint === "classic") {
    const r = nodeCheck(code, "cjs", padLines);
    return r.ok ? { ok: true, mode: "script" } : { ok: false, mode: "script", error: r };
  }
  const asModule = nodeCheck(code, "mjs", padLines);
  if (asModule.ok) return { ok: true, mode: "module" };
  // Not module syntax. A file with no import/export may still be a fine classic script (sloppy-mode code).
  if (hint === "auto" && !hasModuleSyntax(code)) {
    const asScript = nodeCheck(code, "cjs", padLines);
    if (asScript.ok) return { ok: true, mode: "script" };
  }
  return { ok: false, mode: "module", error: asModule };
}

const SKIP_TYPES = /^(importmap|speculationrules|application\/(json|ld\+json)|text\/(template|html|x-template|plain))$/i;

function htmlBlocks(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    const code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
    const type = ((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || "").trim();
    if (SKIP_TYPES.test(type)) continue;
    const module = type.toLowerCase() === "module";
    const contentStart = m.index + m[0].indexOf(">") + 1;
    const line = html.slice(0, contentStart).split("\n").length;   // line of the first character of the block
    blocks.push({ code, module, line, type: type || "classic" });
  }
  return blocks;
}

function show(label, r) {
  const e = r.error;
  const where = e.line ? `${label}:${e.line}` : label;
  console.log(`FAIL ${where}  ${e.message}`);
  if (e.src) console.log(`       ${e.src.trim().slice(0, 160)}`);
}

let failed = 0;
for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (err) {
    failed++; console.log(`FAIL ${file}  cannot read: ${err.code || err.message}`); continue;
  }
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") {
    const blocks = htmlBlocks(text);
    const bad = [];
    const modes = { module: 0, classic: 0 };
    for (const b of blocks) {
      const r = checkScript(b.code, { hint: b.module ? "module" : "classic", padLines: b.line - 1 });
      modes[b.module ? "module" : "classic"]++;
      if (!r.ok) bad.push({ b, r });
    }
    if (bad.length) {
      failed++;
      for (const { b, r } of bad) show(file, { error: { ...r.error, message: `${r.error.message} (inline ${b.module ? "module" : "classic"} script starting at line ${b.line})` } });
    } else if (!quiet) {
      console.log(`OK   ${file}  (${blocks.length} inline script block${blocks.length === 1 ? "" : "s"}: ${modes.module} module, ${modes.classic} classic)`);
    }
    continue;
  }
  const hint = ext === ".cjs" ? "classic" : ext === ".mjs" ? "module" : "auto";
  const r = checkScript(text, { hint });
  if (r.ok) { if (!quiet) console.log(`OK   ${file}  (${r.mode})`); } else { failed++; show(file, r); }
}

if (!quiet || failed) console.log(failed ? `${failed} of ${files.length} file${files.length === 1 ? "" : "s"} FAILED` : `all ${files.length} OK`);
process.exit(failed ? 1 : 0);
