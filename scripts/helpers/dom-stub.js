'use strict';
/* A tiny DOM stand-in for exercising UI code in node: elements are created on demand by id,
   with classes, text, children, value/selection, and event listeners you can fire. */
function makeDom(hiddenByDefault) {
  const elements = new Map();
  const hiddenIds = new Set(hiddenByDefault || []);
  function make(id) {
    const classes = new Set(hiddenIds.has(id) ? ['hidden'] : []);
    const el = {
      id, value: '', textContent: '', disabled: false, _html: '', children: [], listeners: {},
      selection: null, focused: false, style: {}, offsetWidth: 0,
      classList: {
        add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n),
        toggle: (n, on) => ((on === undefined ? !classes.has(n) : on) ? classes.add(n) : classes.delete(n))
      },
      get className() { return [...classes].join(' '); },
      set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; this.children = []; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, target: el, ...event })); },
      focus() { this.focused = true; },
      blur() { this.focused = false; },
      select() { this.selection = [0, String(this.value).length]; },
      setSelectionRange(a, b) { this.selection = [a, b]; }
    };
    return el;
  }
  const document = {
    hidden: false, readyState: 'complete',
    getElementById(id) { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    createElement() { return make('(created)'); },
    addEventListener() {}, removeEventListener() {},
    documentElement: { setAttribute() {}, removeAttribute() {} },
    activeElement: null
  };
  return { document, el: (id) => document.getElementById(id), hidden: (id) => document.getElementById(id).classList.contains('hidden') };
}
module.exports = { makeDom };
