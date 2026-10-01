/* themes.js — cosmetic themes (presentation only).
 * A theme sets data-theme on <html>; css/styles.css maps it to color/font tokens.
 * Themes never change hitboxes, timing, or the five gameplay colors.
 *
 * Ownership: 'default' is always free. Until theme purchases are wired to StoreKit,
 * PREVIEW_ALL lets every theme be tried. Before release, theme purchases must
 * replace PREVIEW_ALL (see MONETIZATION_ROADMAP.md, Story 2.1) and ENABLED must be
 * true only when that is done.
 */
(function (global) {
  'use strict';

  var ENABLED = true;      // show the Themes entry point
  var PREVIEW_ALL = true;  // everything is tryable; no purchases yet

  var LIST = Object.freeze([
    Object.freeze({ id: 'default', name: 'Classic', blurb: 'The original dark look.',
      swatch: ['#0b0b12', '#4f8cff', '#7c5cff'] }),
    Object.freeze({ id: 'arcade', name: 'Neon Arcade', blurb: 'Glowing magenta and cyan.',
      swatch: ['#0a0014', '#ff2bd6', '#00e5ff'] }),
    Object.freeze({ id: 'terminal', name: 'Hacker Terminal', blurb: 'Green phosphor, monospace.',
      swatch: ['#020a04', '#33ff66', '#00d68f'] }),
    Object.freeze({ id: 'space', name: 'Space Station', blurb: 'Deep navy and ice blue.',
      swatch: ['#050b1a', '#38bdf8', '#818cf8'] })
  ]);

  // Placeholder for verified StoreKit entitlements (Story 2.1). Returns true when the
  // player owns the theme. Intentionally false until purchases are implemented.
  function entitled() { return false; }

  function find(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  // 'free' | 'preview' | 'owned' | 'locked'
  function ownership(id) {
    if (!find(id)) return 'locked';
    if (id === 'default') return 'free';
    if (entitled(id)) return 'owned';
    return PREVIEW_ALL ? 'preview' : 'locked';
  }

  function canUse(id) { return ownership(id) !== 'locked'; }

  // Falls back to the default for unknown or unusable ids, so a stale saved
  // theme can never leave the game unreadable.
  function resolve(id) { return canUse(id) ? id : 'default'; }

  function apply(id) {
    var resolved = ENABLED ? resolve(id) : 'default';
    var root = global.document && global.document.documentElement;
    if (root) {
      if (resolved === 'default') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', resolved);
    }
    return resolved;
  }

  global.Themes = {
    LIST: LIST,
    enabled: function () { return ENABLED; },
    previewAll: function () { return PREVIEW_ALL; },
    find: find,
    ownership: ownership,
    canUse: canUse,
    resolve: resolve,
    apply: apply
  };
})(window);
