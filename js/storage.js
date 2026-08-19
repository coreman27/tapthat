/* storage.js — local persistence: best score, player name, adaptive stats */
(function (global) {
  'use strict';

  var KEY = 'dtt.v1';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      var data = JSON.parse(raw);
      return Object.assign(defaults(), data);
    } catch (e) {
      return defaults();
    }
  }

  function defaults() {
    return {
      best: 0,
      name: '',
      muted: false,
      // adaptive: per-category play/fail counts
      stats: {},
      games: 0
    };
  }

  var state = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  var Store = {
    get best() { return state.best; },
    get name() { return state.name; },
    get muted() { return state.muted; },
    get games() { return state.games; },
    get stats() { return state.stats; },

    setName: function (n) { state.name = (n || '').slice(0, 14); save(); },
    setMuted: function (m) { state.muted = !!m; save(); },

    setBest: function (score) {
      if (score > state.best) { state.best = score; save(); return true; }
      return false;
    },

    recordGame: function () { state.games += 1; save(); },

    // adaptive tracking
    recordPlay: function (category) {
      var s = state.stats[category] || { plays: 0, fails: 0 };
      s.plays += 1;
      state.stats[category] = s;
    },
    recordFail: function (category) {
      var s = state.stats[category] || { plays: 0, fails: 0 };
      s.fails += 1;
      state.stats[category] = s;
      save();
    },
    flush: save
  };

  global.Store = Store;
})(window);
