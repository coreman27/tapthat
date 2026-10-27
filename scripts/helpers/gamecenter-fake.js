'use strict';
/* A stand-in for the native GameCenter plugin (ios/App/App/GameCenterPlugin.swift) that behaves
   like Apple's server: boards keep each player's best, rank high to low, report the local player's
   own entry, scope friends, and give the recurring board's current period. Failures can be injected. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeDom } = require('./dom-stub');

const IDS = { best: 'com.coreyhall.donttapthat.best', weekly: 'com.coreyhall.donttapthat.weekly' };
const DAY = 86400000;

function fakeGameCenter(options = {}) {
  const me = options.me || 'Me';
  const boards = { [IDS.best]: new Map(), [IDS.weekly]: new Map() };
  for (const [name, score] of Object.entries(options.best || {})) boards[IDS.best].set(name, score);
  for (const [name, score] of Object.entries(options.weekly || {})) boards[IDS.weekly].set(name, score);
  const friends = new Set(options.friends || []);
  const calls = { authenticate: 0, submit: [], load: [], show: [] };
  const fail = { submit: 0, load: 0, friends: false };
  let listener = null;
  let auth = { authenticated: options.signedIn !== false, displayName: me };
  let period = options.period === undefined ? null : options.period;

  function rows(id, scope) {
    return [...boards[id].entries()]
      .filter(([name]) => scope !== 'friends' || name === me || friends.has(name))
      .sort((a, b) => b[1] - a[1])
      .map(([name, score], i) => ({ rank: i + 1, name, score, mine: name === me }));
  }

  const plugin = {
    async addListener(name, cb) { if (name === 'authChanged') listener = cb; return { remove() {} }; },
    async authenticate() { calls.authenticate++; return { ...auth }; },
    async submitScore({ score, leaderboardIDs }) {
      calls.submit.push({ score, ids: leaderboardIDs.slice() });
      if (!auth.authenticated) throw Object.assign(new Error('Not signed in'), { code: 'not_authenticated' });
      if (fail.submit > 0) { fail.submit--; throw Object.assign(new Error('The Internet connection appears to be offline.'), { code: 'submit_failed' }); }
      for (const id of leaderboardIDs) boards[id].set(me, Math.max(boards[id].get(me) || 0, score));
      return { ok: true };
    },
    async loadBoard({ id, scope, count }) {
      calls.load.push({ id, scope, count });
      if (!auth.authenticated) throw Object.assign(new Error('Sign in'), { code: 'not_authenticated' });
      if (fail.load > 0) { fail.load--; throw Object.assign(new Error('offline'), { code: 'load_failed' }); }
      if (scope === 'friends' && fail.friends) throw Object.assign(new Error('Friends are hidden. Allow access in Settings › Game Center › Friends.'), { code: 'friends_denied' });
      const all = rows(id, scope);
      const result = { entries: all.slice(0, count), total: all.length };
      const you = all.find((r) => r.mine);
      if (you) result.you = you;
      if (id === IDS.weekly && period) result.period = { ...period };
      return result;
    },
    async showLeaderboard({ id }) { calls.show.push(id); }
  };

  return {
    plugin, boards, calls, fail, IDS,
    signIn(name = me) { auth = { authenticated: true, displayName: name }; if (listener) listener({ ...auth }); },
    setPeriod(p) { period = p; },
    scoreOf(which, name = me) { return boards[IDS[which]].get(name); }
  };
}

/* One phone running the real storage, weekly, gamecenter and leaderboard-ui scripts.
   Pass `storage` (a Map) to simulate relaunching the app on the same phone. */
function gamePhone(options = {}) {
  const gc = options.gc || fakeGameCenter(options);
  const storage = options.storage || new Map();
  const clock = { now: options.now || Date.parse('2026-10-28T12:00:00Z') };
  const dom = makeDom(['btn-lb', 'over-rank']);
  const shown = [];
  const toasts = [];
  const RealDate = Date;
  const ctx = {
    console, setTimeout, clearTimeout,
    Date: class extends RealDate { static now() { return clock.now; } },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    document: dom.document,
    UI: { show: (id) => shown.push(id), toast: (m) => toasts.push(m) },
    Capacitor: options.web ? undefined : { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { GameCenter: gc.plugin } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = (n) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'js', n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  ['storage', 'weekly', 'gamecenter', 'leaderboard-ui'].forEach(load);
  return { ctx, gc, dom, el: dom.el, shown, toasts, storage, clock, Store: ctx.Store, Weekly: ctx.Weekly, GameCenter: ctx.GameCenter, ui: ctx.LeaderboardUI };
}

// Apple's weekly period that contains `t`, starting Monday 00:00 UTC.
function mondayPeriod(t) {
  const d = new Date(t);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(today).getUTCDay() || 7;
  const start = today - (dow - 1) * DAY;
  return { start, end: start + 7 * DAY };
}

module.exports = { fakeGameCenter, gamePhone, mondayPeriod, IDS, DAY };
