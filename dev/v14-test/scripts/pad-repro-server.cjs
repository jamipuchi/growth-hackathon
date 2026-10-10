// QA-only deterministic replay: no outbound model calls and no game-file changes.
const path = require('node:path');
const fs = require('node:fs');
const ROOT = '/private/tmp/claude-501/v14-test';
const OUT = '/Users/jaumepuig/Documents/growth-hackathon/dev/v14-test';
process.env.ASTRA_MOCK = '1';
const A = require(path.join(ROOT, 'astra.js'));
const orig = A.generate;
const recorded = JSON.parse(fs.readFileSync('/Users/jaumepuig/Documents/growth-hackathon/dev/v14-qa/data/real-generation.json', 'utf8')).requests.find(r => r.kind === 'ship').entity;
A.generate = async body => body.kind === 'ship' ? {ok:true, entity:recorded} : orig(body);
const H = require(path.join(ROOT, 'astra-html.js'));
H.generateControllerHtml = async ({layout, allowedActions}) => {
  await new Promise(r => setTimeout(r, 1200));
  const html = H.templateHtml(layout, {allowedActions}) + '<!-- QA delayed model delivery -->';
  return {ok:true, html, controls:H.validateHtml(html,{allowedActions}).controls, source:'model'};
};
require(path.join(ROOT, 'dev/v11-client/server.cjs'));
