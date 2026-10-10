// Syntax check of every inline <script> (non-module and module) in the given HTML files: node dev/v17-ready/check-html.js a.html b.html
const fs = require("fs"), vm = require("vm");
let bad = 0;
for (const file of process.argv.slice(2)) {
  const html = fs.readFileSync(file, "utf8");
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(html))) {
    if (/\bsrc=/.test(m[1]) || /type="(application\/json|importmap)"/.test(m[1])) continue;
    i++;
    const mod = /type="module"/.test(m[1]);
    try {
      if (mod) new vm.SourceTextModule ? new vm.SourceTextModule(m[2]) : new Function(m[2].replace(/^\s*import[^;]*;/gm, ""));
      else new vm.Script(m[2], { filename: `${file}#${i}` });
    } catch (e) {
      if (mod && !vm.SourceTextModule) { try { new Function("return async () => {" + m[2].replace(/^\s*(import|export)[^;\n]*;?/gm, "") + "}"); continue; } catch (e2) { e = e2; } }
      bad++; console.log(`${file} script #${i}${mod ? " (module)" : ""}: ${e.message}`);
    }
  }
  console.log(`${file}: ${i} inline scripts checked`);
}
process.exit(bad ? 1 : 0);
