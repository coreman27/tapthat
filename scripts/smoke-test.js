/* smoke-test.js — headless validation of game logic without a browser.
 * Loads the real game modules in a stubbed DOM sandbox and:
 *  - builds every challenge (no exceptions)
 *  - simulates correct/incorrect taps and asserts success/fail resolve
 *  - checks adaptive selection, unlock gating, timeLimit bounds
 *  - round-trips the friend-challenge share link
 * Run: node scripts/smoke-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('  \u2717 ' + msg); } else { console.log('  \u2713 ' + msg); } }

// ---- minimal DOM stub ----
function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag, style: {}, _class: new Set(), children: [], parentNode: null,
    textContent: '', innerHTML: '',
    clientWidth: 360, clientHeight: 500, offsetWidth: 0,
    classList: {
      add: function () { for (const c of arguments) el._class.add(c); },
      remove: function () { for (const c of arguments) el._class.delete(c); },
      toggle: function (c, on) { if (on === undefined) on = !el._class.has(c); on ? el._class.add(c) : el._class.delete(c); },
      contains: function (c) { return el._class.has(c); }
    },
    set className(v) { el._class = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return Array.from(el._class).join(' '); },
    appendChild: function (c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild: function (c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }; },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter(function (f) { return f !== fn; }); },
    dispatch: function (t, ev) { (listeners[t] || []).slice().forEach(function (fn) { fn(Object.assign({ preventDefault: function () {}, target: el }, ev)); }); },
    _listeners: listeners
  };
  return el;
}

const registry = {};
const document = {
  createElement: makeEl,
  getElementById: function (id) { return registry[id] || (registry[id] = makeEl('div')); },
  addEventListener: function () {}, removeEventListener: function () {},
  readyState: 'complete'
};

const sandbox = {
  console: console,
  document: document,
  navigator: { vibrate: function () {}, share: undefined, clipboard: undefined },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  cancelAnimationFrame: function () {},
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
  atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
  Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, String: String,
  localStorage: (function () { const m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; })(),
  location: { origin: 'https://x.test', pathname: '/', search: '', hash: '' },
  history: { replaceState: function () {} },
  AudioContext: function () { return { state: 'running', resume: function () {}, currentTime: 0, createOscillator: function () { return { type: '', frequency: { setValueAtTime: function () {} }, connect: function () { return this; }, start: function () {}, stop: function () {} }; }, createGain: function () { return { gain: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () { return this; } }; }, destination: {} }; }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// load modules in order
['storage', 'audio', 'weekly', 'share', 'challenges', 'adaptive', 'engine', 'ui'].forEach(function (name) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: name + '.js' });
});

const W = sandbox;

console.log('\n1) Share link round-trip');
(function () {
  const code = W.Share.encodeChallenge('Bill', 51);
  const dec = W.Share.decodeChallenge(code);
  assert(dec && dec.name === 'Bill' && dec.score === 51, 'encode/decode preserves name+score');
  const url = W.Share.buildUrl('Jo', 7);
  assert(/#c=/.test(url), 'buildUrl contains challenge code');
})();

console.log('\n2) Every challenge builds without throwing');
function buildEnv(onResolve) {
  const field = makeEl('div'); field.clientWidth = 360; field.clientHeight = 500;
  const notif = makeEl('div');
  return {
    env: {
      field: field, notifLayer: notif, fw: 360, fh: 500, difficulty: 0.5, score: 20,
      rint: W.Challenges.rint, pick: W.Challenges.pick, shuffle: W.Challenges.shuffle,
      makeBtn: function (o) { const b = makeEl('button'); b.className = 'gbtn ' + (o.cls || 'neutral'); b.textContent = o.label || ''; b.style = {}; b._cls = o.cls; field.appendChild(b); return b; },
      setInstruction: function (t) { field._instruction = t; },
      addCleanup: function () {},
      success: function () { onResolve('success'); },
      fail: function (r) { onResolve('fail', r); }
    }, field: field
  };
}
W.Challenges.DEFS.forEach(function (def) {
  let ok = true;
  try { const b = buildEnv(function () {}); def.build(b.env); } catch (e) { ok = false; console.error('    ' + def.id + ': ' + e.message); }
  assert(ok, 'build ok: ' + def.id);
  assert(typeof def.category === 'string' && def.baseTime >= def.minTime, 'valid meta: ' + def.id);
});

console.log('\n3) Correct action resolves success; wrong action resolves fail');
function findByText(field, txt) { return field.children.find(function (c) { return c.textContent === txt; }); }
function findByCls(field, cls) { return field.children.find(function (c) { return c._cls === cls; }); }

(function () {
  // tapme -> tap the button = success
  let res = null; let b = buildEnv(function (r) { res = r; });
  W.Challenges.DEFS.find(function (d) { return d.id === 'tapme'; }).build(b.env);
  b.field.children[0].dispatch('pointerdown', {});
  assert(res === 'success', 'tapme: tapping succeeds');

  // donttap -> tapping the red button = fail
  res = null; b = buildEnv(function (r) { res = r; });
  W.Challenges.DEFS.find(function (d) { return d.id === 'donttap'; }).build(b.env);
  b.field.children[0].dispatch('pointerdown', {});
  assert(res === 'fail', 'donttap: tapping fails the run');

  // tapcolor -> tap the instructed color = success
  res = null; b = buildEnv(function (r) { res = r; });
  W.Challenges.DEFS.find(function (d) { return d.id === 'tapcolor'; }).build(b.env);
  var want = (b.field._instruction || '').replace('TAP ', '').toLowerCase();
  var target = findByCls(b.field, want);
  assert(!!target, 'tapcolor: instructed color button exists (' + want + ')');
  if (target) { target.dispatch('pointerdown', {}); assert(res === 'success', 'tapcolor: tapping correct color succeeds'); }

  // taptwice -> needs two taps
  res = null; b = buildEnv(function (r) { res = r; });
  W.Challenges.DEFS.find(function (d) { return d.id === 'taptwice'; }).build(b.env);
  b.field.children[0].dispatch('pointerdown', {});
  assert(res === null, 'taptwice: one tap does not resolve');
  b.field.children[0].dispatch('pointerdown', {});
  assert(res === 'success', 'taptwice: second tap succeeds');

  // tapnumber -> tap the instructed number
  res = null; b = buildEnv(function (r) { res = r; });
  W.Challenges.DEFS.find(function (d) { return d.id === 'tapnumber'; }).build(b.env);
  var num = (b.field._instruction || '').replace('TAP ', '');
  var nb = findByText(b.field, num);
  assert(!!nb, 'tapnumber: target number button exists (' + num + ')');
  if (nb) { nb.dispatch('pointerdown', {}); assert(res === 'success', 'tapnumber: tapping correct number succeeds'); }
})();

console.log('\nTouch cancellation and repeated rounds');
(function () {
  let result = null;
  const b = buildEnv(function (r) { result = r; });
  const cleanups = [];
  b.env.addCleanup = function (fn) { cleanups.push(fn); };
  b.env.pick = function (items) { return items[0]; }; // SWIPE LEFT
  W.Challenges.DEFS.find(function (d) { return d.id === 'swipe'; }).build(b.env);
  b.field.dispatch('pointerdown', { clientX: 150, clientY: 150 });
  b.field.dispatch('pointercancel', {});
  b.field.dispatch('pointerup', { clientX: 80, clientY: 150 });
  assert(result === null, 'cancelled swipe cannot resolve from a stale pointerup');
  b.field.dispatch('pointerdown', { clientX: 150, clientY: 150 });
  b.field.dispatch('pointerup', { clientX: 80, clientY: 150 });
  assert(result === 'success', 'fresh swipe works after cancellation');
  cleanups.forEach(function (fn) { fn(); });
  assert(['pointerdown', 'pointerup', 'pointercancel'].every(function (event) {
    return b.field._listeners[event].length === 0;
  }), 'swipe cleanup removes all pointer handlers');
})();

(function () {
  const originalTimeout = W.setTimeout;
  const originalPick = W.Adaptive.pickNext;
  const timers = [];
  W.setTimeout = function (fn, delay) { timers.push({ fn, delay }); return timers.length; };
  let round = 0;
  W.Adaptive.pickNext = function () {
    const id = round++ % 2 === 0 ? 'tapme' : 'taptwice';
    return W.Challenges.DEFS.find(function (d) { return d.id === id; });
  };
  const field = makeEl('div');
  W.Engine.init({
    field, instruction: makeEl('div'), timerFill: makeEl('div'),
    notifLayer: makeEl('div'), screenGame: makeEl('div'), scoreEl: makeEl('div')
  });
  function advance(delay) {
    const i = timers.findIndex(function (timer) { return timer.delay === delay; });
    if (i < 0) throw new Error('Missing round transition timer: ' + delay);
    timers.splice(i, 1)[0].fn();
  }
  try {
    W.Engine.start();
    advance(550);
    for (let i = 0; i < 20; i++) {
      const button = field.children[field.children.length - 1];
      button.dispatch('pointerdown', {});
      button.dispatch('pointerup', {});
      if (i % 2 === 1) {
        assert(W.Engine.getScore() === i, 'round ' + i + ': TAP TWICE waits for second tap');
        button.dispatch('pointerdown', {});
        button.dispatch('pointerup', {});
      }
      assert(W.Engine.getScore() === i + 1, 'round ' + i + ': taps advance score');
      button.dispatch('pointerdown', {});
      assert(W.Engine.getScore() === i + 1, 'round ' + i + ': old button handler removed');
      if (i < 19) advance(170);
    }
    const rounds = W.Engine.getRounds();
    assert(rounds.length === 20 && rounds.every(function (t) { return Number.isInteger(t) && t >= 1; }),
      'engine records one reaction time per cleared round');
  } finally {
    W.Engine.stop();
    W.setTimeout = originalTimeout;
    W.Adaptive.pickNext = originalPick;
  }
})();

console.log('\n3b) Weekly mode through the real engine is deterministic');
(function () {
  const originalTimeout = W.setTimeout;
  const timers = [];
  W.setTimeout = function (fn, delay) { timers.push({ fn, delay }); return timers.length; };
  function firstRoundLayout(weekId) {
    timers.length = 0;
    const field = makeEl('div');
    W.Engine.init({
      field, instruction: makeEl('div'), timerFill: makeEl('div'),
      notifLayer: makeEl('div'), screenGame: makeEl('div'), scoreEl: makeEl('div')
    });
    W.Engine.start({ weeklyId: weekId });
    timers.splice(timers.findIndex(function (t) { return t.delay === 550; }), 1)[0].fn();
    const b = field.children[field.children.length - 1];
    const layout = b.style.left + ',' + b.style.top;
    W.Engine.stop();
    return layout;
  }
  try {
    assert(firstRoundLayout('2026-W40') === firstRoundLayout('2026-W40'), 'same week => identical first-round layout');
    const weeks = ['2026-W10', '2026-W20', '2026-W30', '2026-W40', '2026-W50'];
    const layouts = new Set(weeks.map(firstRoundLayout));
    assert(layouts.size > 1, 'different weeks => different layouts');
    const draws = new Set();
    for (let i = 0; i < 8; i++) draws.add(W.Challenges.rint(1, 1000000000));
    assert(draws.size > 1, 'seeded generator is released after a weekly run (normal play is random again)');
  } finally {
    W.setTimeout = originalTimeout;
  }
})();

console.log('\n3c) Rewarded Continue: the real engine resumes once, only casually, and flags the run');
(function () {
  const originalTimeout = W.setTimeout;
  const originalPick = W.Adaptive.pickNext;
  const timers = [];
  W.setTimeout = function (fn, delay) { timers.push({ fn, delay }); return timers.length; };
  const def = function (id) { return W.Challenges.DEFS.find(function (d) { return d.id === id; }); };
  let script = [];
  W.Adaptive.pickNext = function () { return def(script.shift() || 'tapme'); };
  const field = makeEl('div');
  const results = [];
  W.Engine.init({
    field, instruction: makeEl('div'), timerFill: makeEl('div'),
    notifLayer: makeEl('div'), screenGame: makeEl('div'), scoreEl: makeEl('div')
  });
  W.Engine.onGameOver(function (payload) { results.push(payload); });
  function advance(delay) {
    const i = timers.findIndex(function (t) { return t.delay === delay; });
    if (i < 0) throw new Error('Missing timer: ' + delay);
    timers.splice(i, 1)[0].fn();
  }
  const lastButton = function () { return field.children[field.children.length - 1]; };
  function tapCorrect() { lastButton().dispatch('pointerdown', {}); lastButton().dispatch('pointerup', {}); }
  function failNow() { lastButton().dispatch('pointerdown', {}); }   // DON'T TAP ME: tapping it fails
  try {
    // --- casual run: two clears, then a failure at score 2 ---
    script = ['tapme', 'tapme', 'donttap'];
    W.Engine.start(); advance(550);
    tapCorrect(); advance(170); tapCorrect(); advance(170);
    assert(W.Engine.canResume() === false, 'cannot continue while a run is in progress');
    failNow(); advance(260);
    assert(results.length === 1 && results[0].score === 2 && results[0].assisted === false, 'first ending: score 2, not assisted');
    assert(W.Engine.canResume() === true, 'a casual failure with a score can be continued');

    // --- continue: same score, ready beat, fresh challenge, assisted ---
    script = ['donttap'];
    assert(W.Engine.resume() === true, 'resume succeeds once');
    assert(W.Engine.getScore() === 2, 'resumes at the existing score');
    assert(W.Engine.isAssisted() === true, 'the run is now assisted');
    assert(W.Engine.canResume() === false && W.Engine.resume() === false, 'a second continue is refused');
    advance(900);
    assert(W.Engine.getRounds().length === 2, 'rounds from before the failure are preserved');
    failNow(); advance(260);
    assert(results.length === 2 && results[1].score === 2 && results[1].assisted === true, 'final ending is flagged assisted');
    assert(W.Engine.canResume() === false && W.Engine.resume() === false, 'no further continue after the assisted ending');

    // --- weekly runs are never continued ---
    script = ['tapme', 'donttap'];
    W.Engine.start({ weeklyId: '2026-W40' }); advance(550);
    tapCorrect(); advance(170); failNow(); advance(260);
    assert(results[2].weeklyId === '2026-W40' && W.Engine.canResume() === false, 'weekly failures cannot be continued');

    // --- failing before scoring, or stopping, offers nothing ---
    script = ['donttap'];
    W.Engine.start(); advance(550); failNow(); advance(260);
    assert(results[3].score === 0 && W.Engine.canResume() === false, 'a failure at score 0 cannot be continued');
    script = ['tapme', 'donttap'];
    W.Engine.start(); advance(550); tapCorrect(); advance(170); failNow(); advance(260);
    assert(W.Engine.canResume() === true, 'a casual failure can be continued...');
    W.Engine.stop();
    assert(W.Engine.canResume() === false && W.Engine.resume() === false, '...until the run is abandoned');

    // --- a fresh start clears the assisted flag ---
    script = ['tapme'];
    W.Engine.start(); advance(550);
    assert(W.Engine.isAssisted() === false, 'a new run is not assisted');
  } finally {
    W.Engine.stop();
    W.setTimeout = originalTimeout;
    W.Adaptive.pickNext = originalPick;
  }
})();

console.log('\n4) Adaptive selection + timing');
(function () {
  for (var s = 0; s <= 50; s += 5) {
    var def = W.Adaptive.pickNext(s, null);
    assert(def && s >= def.minScore, 'score ' + s + ': picks unlocked challenge (' + def.id + ')');
    var t = W.Adaptive.timeLimit(def, s);
    assert(t <= def.baseTime && t >= def.minTime, 'score ' + s + ': timeLimit within bounds');
  }
  var d0 = W.Adaptive.difficulty(0), d45 = W.Adaptive.difficulty(45);
  assert(d0 === 0 && d45 >= 0.99, 'difficulty ramps 0 -> 1');
})();

console.log('\n5) Adaptive weights toward failed categories');
(function () {
  // record many color fails, then sample: color challenges should appear more often
  for (var i = 0; i < 40; i++) { W.Store.recordPlay('color'); W.Store.recordFail('color'); }
  var counts = {};
  for (var j = 0; j < 400; j++) { var d = W.Adaptive.pickNext(30, null); counts[d.category] = (counts[d.category] || 0) + 1; }
  console.log('    category sample:', JSON.stringify(counts));
  assert((counts.color || 0) > 60, 'color (high-fail) is over-represented after failures');
})();

console.log('\n' + (failures === 0 ? '\u2705 ALL SMOKE TESTS PASSED' : '\u274c ' + failures + ' ASSERTION(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
