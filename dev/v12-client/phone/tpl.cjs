// prints the template HTML of the default layout (scratch: no server, no network)
const A = require("../../../astra-html.js");
const W = require("../../../world.js");
const lay = W.DEFAULT_LAYOUT;
const html = A.templateHtml(lay, { allowedActions: lay.buttons.map((b) => b.action) });
console.log(html.length, "bytes");
console.log(html);
console.log(JSON.stringify(A.validateHtml(html, { allowedActions: lay.buttons.map((b) => b.action) }).controls));
