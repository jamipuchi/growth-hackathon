// A tiny fake DOM, just enough to execute controller.html's module script in Node (smoke test, no browser).
import fs from "fs";

const VOID = new Set(["input", "img", "br", "meta", "link", "hr", "use", "path", "circle", "rect", "ellipse", "line", "stop"]);

class ClassList {
  constructor(el) { this.el = el; this.s = new Set(); }
  add(...c) { c.forEach((x) => x && this.s.add(x)); }
  remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, force) { const on = force === undefined ? !this.s.has(c) : !!force; if (on) this.s.add(c); else this.s.delete(c); return on; }
  contains(c) { return this.s.has(c); }
  get value() { return [...this.s].join(" "); }
}

export class TextNode { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }

function parseSelector(sel) {
  return sel.split(",").map((part) => {
    part = part.trim();
    const m = { tag: null, id: null, classes: [], attrs: [] };
    const re = /([#.]?[\w-]+)|\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g;
    let x;
    while ((x = re.exec(part))) {
      if (x[1]) { if (x[1][0] === "#") m.id = x[1].slice(1); else if (x[1][0] === ".") m.classes.push(x[1].slice(1)); else m.tag = x[1].toLowerCase(); }
      else m.attrs.push([x[2], x[3]]);
    }
    return m;
  });
}

export class Element {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase(); this.ownerDocument = doc;
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.classList = new ClassList(this);
    this.listeners = {}; this._style = {}; this.width = 300; this.height = 150; this._inner = ""; this._rect = null; this.value = ""; this.files = []; this.disabled = false;
    const self = this;
    this.style = new Proxy(this._style, { get(t, k) { if (k === "setProperty") return (n, v) => { t[n] = v; }; if (k === "removeProperty") return (n) => { delete t[n]; }; return t[k] ?? ""; }, set(t, k, v) { t[k] = v; return true; } });
    this.dataset = new Proxy({}, {
      get: (t, k) => self.attrs.get("data-" + String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())),
      set: (t, k, v) => { self.attrs.set("data-" + String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(v)); return true; },
    });
  }
  get id() { return this.attrs.get("id") || ""; } set id(v) { this.attrs.set("id", v); }
  get className() { return this.classList.value; } set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join("") + (this.childNodes.length ? "" : this._inner.replace(/<[^>]*>/g, "")); }
  set textContent(v) { this.childNodes.forEach((n) => (n.parentNode = null)); this.childNodes = []; this._inner = ""; if (v !== "" && v != null) this.append(String(v)); }
  get innerHTML() { return this._inner || this.childNodes.map((n) => (n.nodeType === 3 ? n.data : n.outerHTML)).join(""); }
  set innerHTML(v) { this.childNodes.forEach((n) => (n.parentNode = null)); this.childNodes = []; this._inner = String(v); }
  get outerHTML() { return `<${this.localName}>${this.innerHTML}</${this.localName}>`; }
  get offsetWidth() { return this.getBoundingClientRect().width; } get offsetHeight() { return this.getBoundingClientRect().height; }
  get clientWidth() { return this.getBoundingClientRect().width; } get clientHeight() { return this.getBoundingClientRect().height; }
  get src() { return this.attrs.get("src") || ""; }
  set src(v) { this.attrs.set("src", v); if (this.localName === "img") setTimeout(() => this.onload && this.onload({}), 0); }
  decode() { return Promise.resolve(); }
  get naturalWidth() { return 100; } get naturalHeight() { return 100; }
  appendChild(n) { return this.append(n), n; }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === "string" || typeof n === "number" ? new TextNode(n) : n;
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this; this.childNodes.push(node);
    }
    this._inner = "";
  }
  prepend(...nodes) { for (const n of nodes.reverse()) { const node = typeof n === "string" ? new TextNode(n) : n; node.parentNode = this; this.childNodes.unshift(node); } }
  replaceChildren(...nodes) { this.childNodes.forEach((n) => (n.parentNode = null)); this.childNodes = []; this._inner = ""; this.append(...nodes); }
  remove() { if (this.parentNode) { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
  after(n) { if (this.parentNode) { const i = this.parentNode.childNodes.indexOf(this); n.parentNode = this.parentNode; this.parentNode.childNodes.splice(i + 1, 0, n); } }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === "class") this.className = v; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  matches(sel) {
    return parseSelector(sel).some((m) => (!m.tag || m.tag === this.localName) && (!m.id || m.id === this.id) && m.classes.every((c) => this.classList.contains(c))
      && m.attrs.every(([k, v]) => this.attrs.has(k) && (v === undefined || this.attrs.get(k) === v)));
  }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (x.matches(sel)) return x; return null; }
  *walk() { for (const c of this.childNodes) if (c.nodeType === 1) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) { return [...this.walk()].filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() {
    if (this._rect) return this._rect;
    const r = globalThis.__rects && globalThis.__rects[this.id];
    const x = r || { left: 0, top: 0, width: globalThis.innerWidth, height: globalThis.innerHeight };
    return { ...x, right: x.left + x.width, bottom: x.top + x.height, x: x.left, y: x.top };
  }
  addEventListener(t, cb) { (this.listeners[t] = this.listeners[t] || []).push(cb); }
  removeEventListener(t, cb) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== cb); }
  dispatchEvent(ev) {
    ev.target = ev.target || this; ev.currentTarget = this;
    ev.preventDefault = ev.preventDefault || (() => {}); ev.stopPropagation = ev.stopPropagation || (() => {});
    for (const f of this.listeners[ev.type] || []) f(ev);
    const h = this["on" + ev.type];
    if (typeof h === "function") h.call(this, ev);
    return true;
  }
  click() { return this.dispatchEvent({ type: "click" }); }
  focus() {} blur() {} setPointerCapture() {} releasePointerCapture() {}
  animate() { return { cancel() {} }; }
  getContext() {
    const ctx = new Proxy({ canvas: this }, { get(t, k) {
      if (k in t) return t[k];
      if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    }, set(t, k, v) { t[k] = v; return true; } });
    return ctx;
  }
  toDataURL() { return "data:image/png;base64,iVBORw0KGgo="; }
}

export class Document {
  constructor() {
    this.hidden = false; this.listeners = {};
    this.documentElement = new Element("html", this); this.head = new Element("head", this); this.body = new Element("body", this);
    this.documentElement.append(this.head, this.body);
    this.title = "";
  }
  createElement(t) { return new Element(t, this); }
  createTextNode(t) { return new TextNode(t); }
  getElementById(id) { return [...this.documentElement.walk()].find((e) => e.id === id) || null; }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  addEventListener(t, cb) { (this.listeners[t] = this.listeners[t] || []).push(cb); }
  removeEventListener(t, cb) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== cb); }
  dispatchEvent(ev) { ev.preventDefault = ev.preventDefault || (() => {}); for (const f of this.listeners[ev.type] || []) f(ev); }
}

// Parse the HTML of <body> (well formed, as in controller.html) into the document.
export function parseInto(doc, html) {
  const root = doc.body;
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) { // close
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === m[1].toLowerCase()) { stack.length = i; break; }
    } else if (m[2]) {
      const el = new Element(m[2], doc);
      const ar = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = ar.exec(m[3]))) { const v = a[3] ?? a[4] ?? a[5] ?? ""; el.attrs.set(a[1], v); if (a[1] === "class") el.className = v; }
      stack[stack.length - 1].append(el);
      if (!m[4] && !VOID.has(el.localName)) stack.push(el);
    } else if (m[5]) {
      if (stack.length > 1 && (m[5].trim() || (!m[5].includes("\n") && m[5].length))) stack[stack.length - 1].append(new TextNode(m[5].includes("\n") ? m[5].trim() : m[5]));
    }
  }
}


// ---- serialize a document back to static HTML (for the WeasyPrint layout preview) ----
const kebab = (k) => (k.startsWith("--") ? k : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
export function serialize(node) {
  if (node.nodeType === 3) return esc(node.data);
  const attrs = new Map(node.attrs);
  attrs.delete("class"); attrs.delete("style");
  let a = "";
  const cls = node.classList.value;
  if (cls) a += ` class="${escAttr(cls)}"`;
  const st = Object.entries(node._style).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${kebab(k)}:${v}`).join(";");
  if (st || node.attrs.get("style")) a += ` style="${escAttr([node.attrs.get("style"), st].filter(Boolean).join(";"))}"`;
  for (const [k, v] of attrs) a += ` ${k}="${escAttr(v)}"`;
  if (VOID.has(node.localName)) return `<${node.localName}${a}/>`;
  const inner = node.childNodes.length ? node.childNodes.map(serialize).join("") : node._inner;
  return `<${node.localName}${a}>${inner}</${node.localName}>`;
}
