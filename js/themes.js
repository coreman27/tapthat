/* themes.js — cosmetic themes (presentation only).
 * A theme sets data-theme on <html>; css/styles.css maps it to color/font tokens.
 * Themes never change hitboxes, timing, or the five gameplay colors.
 *
 * Ownership: 'default' is always free. Every other theme is a separate non-consumable
 * StoreKit product, verified natively (see MonetizationManager.swift) and exposed through
 * Monetization.ownsTheme(). Locked themes can be previewed but not saved. PREVIEW_ALL is a
 * development switch that makes everything usable; it must be false in release builds.
 */
(function (global) {
  'use strict';

  var ENABLED = true;
  var PREVIEW_ALL = false;

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

  // True when StoreKit has verified that the player owns this theme.
  function entitled(id) {
    var m = global.Monetization;
    return !!(m && typeof m.ownsTheme === 'function' && m.ownsTheme(id));
  }

  function find(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  // 'free' | 'owned' | 'preview' (dev switch) | 'locked'
  function ownership(id) {
    if (!find(id)) return 'locked';
    if (id === 'default') return 'free';
    if (entitled(id)) return 'owned';
    return PREVIEW_ALL ? 'preview' : 'locked';
  }

  function canUse(id) { return ownership(id) !== 'locked'; }

  // Falls back to the default for unknown or unusable ids, so a stale saved theme
  // (e.g. a refunded purchase) can never leave the game in a theme the player lost.
  function resolve(id) { return canUse(id) ? id : 'default'; }

  function setAttribute(id) {
    var root = global.document && global.document.documentElement;
    if (!root) return;
    if (id === 'default') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', id);
  }

  // Normal selection: only themes the player may use. Returns the theme actually applied.
  function apply(id) {
    var resolved = ENABLED ? resolve(id) : 'default';
    setAttribute(resolved);
    return resolved;
  }

  // At launch, before StoreKit has reported ownership, show the saved theme on trust so a
  // paying player never sees a flash of Classic. Callers must reconcile once ownership is
  // known (apply() would otherwise downgrade them and overwrite their saved choice).
  function applyTrusted(id) {
    var known = ENABLED && find(id) ? id : 'default';
    setAttribute(known);
    return known;
  }

  // Try a theme without owning it. Not saved; callers restore with apply(savedId).
  function preview(id) {
    var known = find(id) ? id : 'default';
    setAttribute(known);
    return known;
  }

  // The Themes entry point is shown only when there is something to unlock: the App Store
  // has returned at least one theme product, or the player already owns one. This keeps a
  // build shippable before the products exist (no dead buttons) and on the web build.
  function available() {
    if (!ENABLED) return false;
    if (PREVIEW_ALL) return true;
    var m = global.Monetization;
    if (!m || typeof m.getState !== 'function') return false;
    var state = m.getState();
    return !!(state && ((state.ownedThemes && state.ownedThemes.length) ||
      (state.themePrices && Object.keys(state.themePrices).length)));
  }

  global.Themes = {
    LIST: LIST,
    enabled: function () { return ENABLED; },
    available: available,
    previewAll: function () { return PREVIEW_ALL; },
    find: find,
    ownership: ownership,
    canUse: canUse,
    resolve: resolve,
    apply: apply,
    applyTrusted: applyTrusted,
    preview: preview
  };
})(window);
