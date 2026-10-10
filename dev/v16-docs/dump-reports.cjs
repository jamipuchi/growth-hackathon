// Prints summary / pass / verification / followups of worker reports (claude -p JSON or plain report JSON).
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log('#### ' + f + ' (unreadable: ' + e.message + ')'); continue; }
  const so = j.structured_output || (j.summary ? j : null);
  console.log('#### ' + f + (so ? '' : ' (no structured output; is_error=' + j.is_error + ')'));
  if (!so) continue;
  for (const k of ['summary', 'pass', 'verification', 'followups']) {
    const v = so[k];
    if (v === undefined) continue;
    console.log('-- ' + k + ': ' + (Array.isArray(v) ? '\n  * ' + v.join('\n  * ') : v));
  }
}
