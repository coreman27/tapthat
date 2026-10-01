/* weekly.test.js — weekly challenge: week ids, seeded fairness, share links, storage.
 * Run: node --test scripts/weekly.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8');
}

// Modules attach to `window` and reference each other as bare globals, so the
// sandbox's global object is its own `window`.
function load(names, extra) {
  const ctx = Object.assign({ console }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  names.forEach((name) => vm.runInContext(source(name), ctx, { filename: name + '.js' }));
  return ctx;
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); }
  };
}

const at = (iso) => Date.parse(iso);

test('ISO week ids, including year boundaries', () => {
  const { Weekly } = load(['weekly']);
  assert.equal(Weekly.weekId(at('2026-09-28T00:00:00Z')), '2026-W40'); // Monday
  assert.equal(Weekly.weekId(at('2026-09-27T23:59:59Z')), '2026-W39'); // Sunday before
  assert.equal(Weekly.weekId(at('2026-01-01T12:00:00Z')), '2026-W01'); // Thursday
  assert.equal(Weekly.weekId(at('2025-12-29T00:00:00Z')), '2026-W01'); // Monday of 2026-W01
  assert.equal(Weekly.weekId(at('2024-12-30T10:00:00Z')), '2025-W01');
  assert.equal(Weekly.weekId(at('2027-01-03T23:00:00Z')), '2026-W53'); // 2026 has 53 weeks
  assert.equal(Weekly.weekId(at('2027-01-04T00:00:00Z')), '2027-W01');
});

test('reset happens at Monday 00:00 UTC for everyone', () => {
  const { Weekly } = load(['weekly']);
  assert.equal(Weekly.msUntilReset(at('2026-09-27T23:59:59Z')), 1000);
  assert.equal(Weekly.msUntilReset(at('2026-09-28T00:00:00Z')), 7 * 86400000);
  assert.equal(Weekly.msUntilReset(at('2026-09-30T12:00:00Z')), 4.5 * 86400000);
  // the id changes exactly when the countdown reaches zero
  const t = at('2026-09-30T08:15:00Z');
  const next = t + Weekly.msUntilReset(t);
  assert.notEqual(Weekly.weekId(next - 1), Weekly.weekId(next));
  assert.equal(Weekly.weekId(next), '2026-W41');
});

test('week id validation and countdown labels', () => {
  const { Weekly } = load(['weekly']);
  ['2026-W01', '2026-W40', '2026-W53'].forEach((id) => assert.ok(Weekly.isWeekId(id), id));
  ['2026-W00', '2026-W54', '26-W40', '2026-40', '', null, 5, '2026-W4'].forEach((id) =>
    assert.equal(Weekly.isWeekId(id), false, String(id)));
  assert.equal(Weekly.resetLabel(3 * 86400000 + 4 * 3600000), '3d 4h');
  assert.equal(Weekly.resetLabel(5 * 3600000 + 20 * 60000), '5h 20m');
  assert.equal(Weekly.resetLabel(30000), '1m');
});

test('seeded generator is deterministic, in range, and varies by week and round', () => {
  const { Weekly } = load(['weekly']);
  const draw = (id, round) => { const r = Weekly.rngFor(id, round); return [r(), r(), r(), r()]; };
  assert.deepEqual(draw('2026-W40', 0), draw('2026-W40', 0));
  assert.notDeepEqual(draw('2026-W40', 0), draw('2026-W40', 1));
  assert.notDeepEqual(draw('2026-W40', 0), draw('2026-W41', 0));
  const r = Weekly.rngFor('2026-W40', 7);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, 'in [0, 1)');
  }
});

// Mimics engine.nextRound: per-round seed, fixed selection, difficulty from score only.
function sequence(ctx, weekId, rounds) {
  const picks = [];
  let last = null;
  for (let round = 0; round < rounds; round++) {
    const rng = ctx.Weekly.rngFor(weekId, round);
    ctx.Challenges.setRng(rng);
    const score = round; // best case run: every round succeeds
    const def = ctx.Adaptive.pickNext(score, last, { rand: rng, fixed: true });
    last = def.id;
    picks.push([def.id, ctx.Adaptive.timeLimit(def, score), ctx.Challenges.rint(1, 1000), ctx.Challenges.pick(['a', 'b', 'c', 'd'])]);
  }
  ctx.Challenges.setRng(null);
  return picks;
}

test('weekly sequence is identical for every player regardless of their fail history', () => {
  const calm = load(['weekly', 'challenges', 'adaptive'], { Store: { stats: {} } });
  const struggling = load(['weekly', 'challenges', 'adaptive'], {
    Store: { stats: { tap: { plays: 40, fails: 39 }, color: { plays: 40, fails: 30 }, swipe: { plays: 10, fails: 9 } } }
  });
  const a = sequence(calm, '2026-W40', 60);
  const b = sequence(struggling, '2026-W40', 60);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, sequence(calm, '2026-W41', 60), 'a new week has new commands');
});

test('weekly sequence does not depend on how many random numbers a round consumes', () => {
  const ctx = load(['weekly', 'challenges', 'adaptive'], { Store: { stats: {} } });
  const baseline = sequence(ctx, '2026-W40', 30);
  // burn global randomness between rounds like timing-dependent gameplay might
  const noisy = [];
  let last = null;
  for (let round = 0; round < 30; round++) {
    const rng = ctx.Weekly.rngFor('2026-W40', round);
    ctx.Challenges.setRng(rng);
    const def = ctx.Adaptive.pickNext(round, last, { rand: rng, fixed: true });
    last = def.id;
    noisy.push([def.id, ctx.Adaptive.timeLimit(def, round), ctx.Challenges.rint(1, 1000), ctx.Challenges.pick(['a', 'b', 'c', 'd'])]);
    for (let i = 0; i < round; i++) Math.random();
  }
  assert.deepEqual(noisy, baseline);
});

test('normal runs still use real randomness and adaptive weighting', () => {
  const share = (stats) => {
    const ctx = load(['weekly', 'challenges', 'adaptive'], { Store: { stats } });
    let tap = 0;
    for (let i = 0; i < 4000; i++) {
      if (ctx.Adaptive.pickNext(30, null).category === 'tap') tap++;
    }
    return tap / 4000;
  };
  const neutral = share({});
  const failing = share({ tap: { plays: 100, fails: 100 } });
  assert.ok(failing > neutral * 1.5, 'failed category is favored in normal play (' + neutral + ' -> ' + failing + ')');
});

test('all gameplay randomness goes through the seedable rand()', () => {
  const calls = (name) => (source(name).match(/Math\.random/g) || []).length;
  assert.equal(calls('challenges'), 1, 'only the rand() fallback may use Math.random');
  assert.equal(calls('adaptive'), 1, 'only the default random source may use Math.random');
  assert.equal(calls('engine'), 0);
});

test('weekly share links round-trip and stay backward compatible', () => {
  const ctx = load(['weekly', 'share'], {
    location: { protocol: 'https:', origin: 'https://donttapthat.com', pathname: '/', hash: '', search: '' },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    escape, unescape, encodeURIComponent, decodeURIComponent
  });
  const { Share } = ctx;
  const weekly = Share.decodeChallenge(Share.encodeChallenge('Bill', 42, '2026-W40'));
  assert.deepEqual({ ...weekly }, { name: 'Bill', score: 42, weekId: '2026-W40' });
  const normal = Share.decodeChallenge(Share.encodeChallenge('Bill', 42));
  assert.equal(normal.weekId, null);
  const bogus = Share.decodeChallenge(Share.encodeChallenge('Bill', 42, 'not-a-week'));
  assert.equal(bogus.weekId, null, 'invalid week ids are dropped');
  assert.match(Share.buildUrl('Bill', 42, '2026-W40'), /#c=/);
});

test('weekly best is stored per week and resets when the week changes', () => {
  const storage = memoryStorage();
  const fresh = () => load(['storage'], { localStorage: storage }).Store;
  let store = fresh();
  assert.equal(store.weeklyBest('2026-W40'), 0);
  assert.equal(store.recordWeekly('2026-W40', 12), true);
  assert.equal(store.recordWeekly('2026-W40', 9), false);
  assert.equal(store.recordWeekly('2026-W40', 15), true);
  assert.equal(store.weeklyBest('2026-W40'), 15);
  assert.equal(store.weeklyPlays('2026-W40'), 3);
  assert.equal(store.best, 0, 'normal best is untouched by weekly runs');

  store = fresh(); // persisted
  assert.equal(store.weeklyBest('2026-W40'), 15);
  assert.equal(store.weeklyBest('2026-W41'), 0, 'a new week starts at zero');
  assert.equal(store.recordWeekly('2026-W41', 4), true);
  assert.equal(store.weeklyBest('2026-W40'), 0, 'only the current week is kept');
});
