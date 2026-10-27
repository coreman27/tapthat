/* gamecenter.js — leaderboards through Apple Game Center (native plugin: GameCenterPlugin.swift).
 *
 *  - Two leaderboards in App Store Connect: an all-time "classic" board and a weekly
 *    "recurring" board. Apple rolls the weekly board over; its current period is handed to
 *    Weekly.setPeriod so the weekly challenge's commands change at the same moment.
 *  - Names, friends and moderation are Apple's. Nothing is sent to any server of ours.
 *  - Sync: the best scores saved on this phone are posted whenever the player is signed in,
 *    and re-posted until Apple has accepted them. So a player's existing high score reaches
 *    the board on the first launch of this version, and runs played offline or signed out
 *    catch up later.
 * Outside the iOS app (browser, tests without a plugin) everything here is inert.
 */
(function (global) {
  'use strict';

  var IDS = {
    best: 'com.coreyhall.donttapthat.best',
    weekly: 'com.coreyhall.donttapthat.weekly'
  };
  var KEY = 'dtt.gc'; // what Apple has accepted: { best: n, weekly: { id, score } }
  var MAX_NAME = 40;

  var C = global.Capacitor;
  var native = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.getPlatform() === 'ios');
  var plugin = native && C.Plugins ? C.Plugins.GameCenter || null : null;

  var state = { supported: !!plugin, checked: !plugin, authenticated: false, displayName: '' };
  var listeners = [];
  var syncing = null;

  function snapshot() { return Object.assign({}, state); }
  function publish() { listeners.forEach(function (fn) { fn(snapshot()); }); }
  function onChange(fn) { listeners.push(fn); }

  function loadSynced() {
    try {
      var v = JSON.parse(global.localStorage.getItem(KEY) || 'null') || {};
      return { best: v.best | 0, weekly: v.weekly && typeof v.weekly.id === 'string' ? { id: v.weekly.id, score: v.weekly.score | 0 } : { id: '', score: 0 } };
    } catch (e) { return { best: 0, weekly: { id: '', score: 0 } }; }
  }
  function saveSynced(v) { try { global.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  function makeError(code, message) { var e = new Error(message); e.code = code; return e; }
  function unavailable() { return Promise.reject(makeError('unsupported', 'Leaderboards are available in the iOS app.')); }

  function applyAuth(value) {
    var was = state.authenticated;
    state.checked = true;
    state.authenticated = !!(value && value.authenticated === true);
    state.displayName = state.authenticated && value && typeof value.displayName === 'string' ? value.displayName.slice(0, MAX_NAME) : '';
    publish();
    if (state.authenticated && !was) sync();
    return snapshot();
  }

  // Signs in with Game Center (Apple shows its own sheet when needed). Never throws.
  function init() {
    if (!plugin) return Promise.resolve(snapshot());
    if (typeof plugin.addListener === 'function') {
      try { plugin.addListener('authChanged', applyAuth); } catch (e) { /* older bridge */ }
    }
    return Promise.resolve().then(function () { return plugin.authenticate(); })
      .then(applyAuth, function () { return applyAuth(null); });
  }

  /* Pure: a board from the plugin, cleaned up. Names are other players' text: kept as text. */
  function normalize(raw) {
    raw = raw || {};
    function row(e) {
      // Game Center reports "you have no score yet" as an entry with rank 0: that is no entry.
      if (!e || typeof e.rank !== 'number' || typeof e.score !== 'number' || e.rank < 1) return null;
      return { rank: e.rank | 0, score: e.score | 0, name: String(e.name || 'Player').slice(0, MAX_NAME), mine: e.mine === true };
    }
    var entries = (Array.isArray(raw.entries) ? raw.entries : []).map(row).filter(Boolean);
    var you = row(raw.you);
    var period = raw.period && typeof raw.period.start === 'number' && typeof raw.period.end === 'number'
      ? { start: raw.period.start, end: raw.period.end } : null;
    return { entries: entries, you: you, total: Math.max(raw.total | 0, entries.length), period: period, recurring: raw.recurring === true };
  }

  // which: 'best' | 'weekly'; scope: 'global' | 'friends'
  function board(which, scope, count) {
    if (!plugin) return unavailable();
    if (!state.authenticated) return Promise.reject(makeError('not_authenticated', 'Sign in to Game Center to see the leaderboard.'));
    return plugin.loadBoard({ id: IDS[which], scope: scope === 'friends' ? 'friends' : 'global', count: count || 10 })
      .then(function (raw) {
        var data = normalize(raw);
        if (which === 'weekly' && data.period && global.Weekly.setPeriod(data.period.start, data.period.end)) publish();
        return data;
      }, function (error) {
        throw makeError((error && error.code) || 'load_failed', (error && error.message) || 'Could not load the leaderboard.');
      });
  }

  // A weekly board with no open week: Apple gave no current period (not started yet).
  function notOpen(data) { return data.recurring && global.Weekly.source() !== 'apple'; }

  function submit(which, score) {
    return plugin.submitScore({ score: score, leaderboardIDs: [IDS[which]] });
  }

  // Learn Apple's current weekly period when we don't have one yet.
  function ensurePeriod() {
    if (global.Weekly.source() === 'apple') return Promise.resolve();
    return board('weekly', 'global', 1).then(function () {}, function () {});
  }

  /* Posts any best score Apple hasn't accepted yet. Safe to call any time; never throws.
     A weekly score is only posted while we know it belongs to Apple's current period. */
  function sync() {
    if (!plugin || !state.authenticated) return Promise.resolve(false);
    if (syncing) return syncing;
    var posted = false;
    syncing = ensurePeriod().then(function () {
      var done = loadSynced();
      var jobs = [];
      var best = global.Store.best | 0;
      if (best > done.best) {
        jobs.push(submit('best', best).then(function () { done.best = best; posted = true; }, function () {}));
      }
      var week = global.Weekly.weekId();
      var weekly = global.Store.weeklyBest(week) | 0;
      var already = done.weekly.id === week ? done.weekly.score : 0;
      if (weekly > already && global.Weekly.source() === 'apple') {
        jobs.push(submit('weekly', weekly).then(function () { done.weekly = { id: week, score: weekly }; posted = true; }, function () {}));
      }
      return Promise.all(jobs).then(function () {
        saveSynced(done);
        if (posted) publish(); // screens showing a board reload it
        return posted;
      });
    }).then(function (result) { syncing = null; return result; }, function () { syncing = null; return false; });
    return syncing;
  }

  /* After a run: post it if it beat what Apple has, then report the player's standing.
     Resolves { status: 'ranked', rank, total } | { status: 'signed_out' } | { status: 'offline' }. */
  function afterRun(which) {
    if (!plugin) return Promise.resolve({ status: 'unsupported' });
    if (!state.authenticated) return Promise.resolve({ status: 'signed_out' });
    return sync().then(function () { return board(which, 'global', 1); }).then(function (data) {
      if (data.you) return { status: 'ranked', rank: data.you.rank, total: data.total };
      if (which === 'weekly' && (global.Weekly.upcoming() || notOpen(data))) return { status: 'not_open', opens: global.Weekly.upcoming() };
      return { status: 'offline' };
    }, function () { return { status: 'offline' }; });
  }

  function show(which) {
    if (!plugin) return unavailable();
    return plugin.showLeaderboard({ id: which ? IDS[which] : '' });
  }

  global.GameCenter = {
    IDS: IDS,
    init: init,
    getState: snapshot,
    onChange: onChange,
    board: board,
    sync: sync,
    afterRun: afterRun,
    show: show,
    normalize: normalize,
    notOpen: notOpen
  };
})(window);
