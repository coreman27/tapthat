/* adaptive.test.js — opening-round selection: new players get the gentle unlock order, everyone
 * else gets a varied opening weighted by what they fail.
 * Run: node --test scripts/adaptive.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8');
}

// Challenges only needs its DEFS for selection; Store is stubbed with the stats under test.
function load(stats) {
  const ctx = { console, Store: { stats: stats } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source('challenges'), ctx, { filename: 'challenges.js' });
  vm.runInContext(source('adaptive'), ctx, { filename: 'adaptive.js' });
  return ctx;
}

// Seeded generator so the counts are stable run to run.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function openings(ctx, runs, opts) {
  const firsts = {};
  const pairs = new Set();
  for (let i = 0; i < runs; i++) {
    const a = ctx.Adaptive.pickNext(0, null, opts);
    const b = ctx.Adaptive.pickNext(1, a.id, opts);
    firsts[a.id] = (firsts[a.id] || 0) + 1;
    pairs.add(a.id + '>' + b.id);
  }
  return { firsts, pairs };
}

test('a brand-new player still opens TAP ME -> DON\'T TAP ME', () => {
  const ctx = load({});
  const { firsts, pairs } = openings(ctx, 200);
  assert.deepEqual(Object.keys(firsts), ['tapme']);
  assert.deepEqual([...pairs], ['tapme>donttap']);
});

test('a returning player gets varied openings from the basics', () => {
  const ctx = load({ tap: { plays: 20, fails: 1 }, wait: { plays: 10, fails: 1 }, color: { plays: 5, fails: 1 } });
  const { firsts, pairs } = openings(ctx, 600, { rand: seeded(7) });
  assert.deepEqual(Object.keys(firsts).sort(), ['donttap', 'tapcolor', 'tapme']);
  assert.ok(pairs.size >= 5, 'expected many different first-two-round openings, got ' + [...pairs].join(', '));
  for (const p of pairs) {
    const [a, b] = p.split('>');
    assert.notEqual(a, b, 'no immediate repeats');
  }
});

test('the opening leans toward what the player fails', () => {
  const ctx = load({ tap: { plays: 50, fails: 0 }, wait: { plays: 50, fails: 30 }, color: { plays: 50, fails: 0 } });
  const { firsts } = openings(ctx, 900, { rand: seeded(11) });
  assert.ok(firsts.donttap > firsts.tapme * 2, JSON.stringify(firsts));
  assert.ok(firsts.donttap > firsts.tapcolor * 2, JSON.stringify(firsts));
});

test('weekly runs ignore history: same seed, same opening, for new and returning players', () => {
  const fresh = load({});
  const veteran = load({ wait: { plays: 50, fails: 40 } });
  for (let seed = 1; seed <= 20; seed++) {
    const a = openings(fresh, 1, { rand: seeded(seed), fixed: true }).pairs;
    const b = openings(veteran, 1, { rand: seeded(seed), fixed: true }).pairs;
    assert.deepEqual([...a], [...b]);
  }
});

test('past the opening, unlocks still follow score', () => {
  const ctx = load({ tap: { plays: 20, fails: 1 } });
  for (let i = 0; i < 200; i++) {
    const d = ctx.Adaptive.pickNext(3, null);
    assert.ok(d.minScore <= 3, d.id + ' unlocked too early');
  }
});
