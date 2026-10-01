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
      theme: 'default',
      // adaptive: per-category play/fail counts
      stats: {},
      games: 0,
      // weekly challenge: only the current week is kept; { id, best, plays }
      weekly: { id: '', best: 0, plays: 0 }
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
    get theme() { return state.theme; },
    get games() { return state.games; },
    get stats() { return state.stats; },

    setName: function (n) { state.name = (n || '').slice(0, 14); save(); },
    setMuted: function (m) { state.muted = !!m; save(); },
    setTheme: function (id) { state.theme = String(id || 'default').slice(0, 24); save(); },

    setBest: function (score) {
      if (score > state.best) { state.best = score; save(); return true; }
      return false;
    },

    recordGame: function () { state.games += 1; save(); },

    // weekly challenge (separate from the normal best)
    weeklyBest: function (id) {
      var w = state.weekly;
      return w && w.id === id ? (w.best | 0) : 0;
    },
    weeklyPlays: function (id) {
      var w = state.weekly;
      return w && w.id === id ? (w.plays | 0) : 0;
    },
    recordWeekly: function (id, score) {
      var w = state.weekly;
      if (!w || w.id !== id) w = state.weekly = { id: id, best: 0, plays: 0 };
      w.plays += 1;
      var isBest = score > w.best;
      if (isBest) w.best = score;
      save();
      return isBest;
    },

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
