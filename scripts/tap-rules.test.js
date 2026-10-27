/* tap-rules.test.js — the tap discipline rules, through the real engine and challenges:
 * missing the button, double tapping a single tap, tapping a hold, and holding a tap all fail.
 * A fake clock drives timers and performance.now so holds and double taps are exact.
 * Run: node --test scripts/tap-rules.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function makeEl(tag) {
  const listeners = {};
  const captures = new Set();
  const classes = new Set();
  const el = {
    tagName: tag, style: {}, children: [], parentNode: null, textContent: '', innerHTML: '',
    clientWidth: 360, clientHeight: 500, offsetWidth: 0,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c), toggle: (c, on) => ((on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c))
    },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get className() { return [...classes].join(' '); },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children.splice(el.children.indexOf(c), 1); c.parentNode = null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 500 }),
    addEventListener(t, fn, capture) { (listeners[t] = listeners[t] || []).push(fn); if (capture) captures.add(fn); },
    removeEventListener(t, fn) { if (listeners[t]) listeners[t] = listeners[t].filter((f) => f !== fn); },
    fire(t, event, capture) { (listeners[t] || []).slice().forEach((fn) => { if (capture === null || captures.has(fn) === capture) fn(event); }); },
    // like a browser: ancestors' capture listeners, the target, then bubbling
    dispatch(t, extra) {
      const event = { preventDefault() {}, target: el, clientX: 0, clientY: 0, ...extra };
      const path = []; for (let n = el.parentNode; n; n = n.parentNode) path.push(n);
      path.slice().reverse().forEach((n) => n.fire(t, event, true));
      el.fire(t, event, null);
      path.forEach((n) => n.fire(t, event, false));
    }
  };
  Object.defineProperty(el, 'innerHTML', { get: () => '', set: () => { el.children = []; } });
  return el;
}

function game() {
  let now = 1000;
  let timers = [];
  let seq = 0;
  let frames = [];
  const ctx = {
    console,
    document: { createElement: makeEl, getElementById: () => makeEl('div'), addEventListener() {} },
    performance: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    Store: { recordPlay() {}, recordFail() {}, stats: {} },
    Sound: { tick() {}, bad() {}, good() {}, great() {}, ready() {}, unlock() {} },
    Weekly: { rngFor: () => Math.random }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const n of ['challenges', 'adaptive', 'engine']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  }
  const screen = makeEl('section');
  const field = makeEl('div');
  screen.appendChild(field);
  const notif = makeEl('div');
  screen.appendChild(notif);
  const hud = makeEl('div'); // the command, score and timer bar sit outside the play area
  screen.appendChild(hud);
  const results = [];
  let script = [];
  ctx.Adaptive.pickNext = () => { const id = script.shift() || 'tapme'; return ctx.Challenges.DEFS.find((d) => d.id === id); };
  const instruction = makeEl('div');
  ctx.Engine.init({ field, instruction, timerFill: makeEl('div'), notifLayer: notif, screenGame: screen, scoreEl: makeEl('div') });
  ctx.Engine.onGameOver((r) => results.push(r));

  function advance(ms) {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = until;
  }
  function pumpFrames() { const f = frames; frames = []; f.forEach((fn) => fn()); }
  const button = () => field.children.find((c) => /gbtn/.test(c.className));
  const buttons = () => field.children.filter((c) => /gbtn/.test(c.className));
  return {
    ctx, field, notif, hud, results, instruction, advance, pumpFrames, button, buttons,
    play(ids) { script = ids.slice(); ctx.Engine.start(); advance(550); },
    score: () => ctx.Engine.getScore(),
    over: () => results.at(-1),
    down: (el) => el.dispatch('pointerdown'),
    up: (el) => el.dispatch('pointerup'),
    tap(el, holdMs = 60) { el.dispatch('pointerdown'); advance(holdMs); el.dispatch('pointerup'); }
  };
}

const { EXTRA_TAP_MS, HOLD_MS } = (() => { const g = game(); return { EXTRA_TAP_MS: g.ctx.Engine.EXTRA_TAP_MS, HOLD_MS: g.ctx.Engine.HOLD_MS }; })();

test('a clean single tap clears the round once the finger lifts and a moment passes', () => {
  const g = game();
  g.play(['tapme', 'tapme']);
  g.tap(g.button());
  assert.equal(g.score(), 0, 'not yet: it might still be a double tap');
  g.advance(EXTRA_TAP_MS);
  assert.equal(g.score(), 1);
  assert.equal(g.results.length, 0);
});

test('the reaction time counts from the touch, not the release', () => {
  const g = game();
  g.play(['tapme', 'tapme']);
  g.advance(300);
  g.tap(g.button(), 120);
  g.advance(EXTRA_TAP_MS);
  assert.equal(g.ctx.Engine.getRounds()[0], 300);
});

test('missing the button fails', () => {
  const g = game();
  g.play(['tapcolor']);
  g.tap(g.field);
  g.advance(300);
  assert.equal(g.over().reason, 'Missed the button.');
  assert.equal(g.over().score, 0);
});

test('missing counts anywhere on the game screen, not just the play area (a TAP ME found on a phone)', () => {
  const g = game();
  g.play(['tapme']);
  g.tap(g.hud);
  g.advance(300);
  assert.equal(g.over().reason, 'Missed the button.');
});

test('a miss is fine when the round is about not tapping, or chasing a runaway button', () => {
  for (const id of ['donttap', 'notif', 'runaway', 'swipe']) {
    const g = game();
    g.play([id]);
    g.field.dispatch('pointerdown');
    g.field.dispatch('pointerup');
    g.advance(50);
    assert.equal(g.results.length, 0, id);
  }
});

test('double tapping a single tap fails', () => {
  const g = game();
  g.play(['tapme', 'tapme']);
  const b = g.button();
  g.tap(b);
  g.advance(EXTRA_TAP_MS - 60);
  g.down(b); // the second tap of a double tap, wherever it lands
  g.advance(300);
  assert.equal(g.over().reason, 'Double tap. One tap only.');
  assert.equal(g.over().score, 0, 'the round is not counted');
});

test('a second tap after the window is just the next tap, not a double tap', () => {
  const g = game();
  g.play(['tapme', 'tapme']);
  g.tap(g.button());
  g.advance(EXTRA_TAP_MS + 1);
  assert.equal(g.score(), 1);
  g.field.dispatch('pointerdown'); // between rounds: harmless
  g.advance(200);
  assert.equal(g.results.length, 0);
});

test('holding a tap fails', () => {
  const g = game();
  g.play(['tapme']);
  g.down(g.button());
  g.advance(HOLD_MS);
  assert.equal(g.score(), 0);
  g.advance(300);
  assert.equal(g.over().reason, 'That was a hold. Just tap.');
});

test('a slow but normal tap (under the hold limit) still counts', () => {
  const g = game();
  g.play(['tapme', 'tapme']);
  g.tap(g.button(), HOLD_MS - 50);
  g.advance(EXTRA_TAP_MS);
  assert.equal(g.score(), 1);
});

test('tapping a HOLD fails; holding it until the bar fills clears it', () => {
  const g = game();
  g.play(['hold']);
  g.tap(g.button(), 80);
  g.advance(300);
  assert.equal(g.over().reason, 'That was a tap. Hold it.');

  const h = game();
  h.play(['hold', 'tapme']);
  const b = h.button();
  h.down(b);
  h.advance(1000);
  h.pumpFrames();
  assert.equal(h.score(), 1, 'held long enough');
  h.up(b);
  h.advance(50);
  assert.equal(h.results.length, 0, 'letting go afterwards is fine');
});

test('letting go of a HOLD halfway fails', () => {
  const g = game();
  g.play(['hold']);
  const b = g.button();
  g.down(b);
  g.advance(300);
  g.up(b);
  g.advance(300);
  assert.equal(g.over().reason, 'Let go too early.');
});

test('TAP TWICE: two taps clear it, a third one is a double tap', () => {
  const ok = game();
  ok.play(['taptwice', 'tapme']);
  ok.tap(ok.button()); ok.advance(100); ok.tap(ok.button());
  ok.advance(EXTRA_TAP_MS);
  assert.equal(ok.score(), 1);

  const g = game();
  g.play(['taptwice']);
  const b = g.button();
  g.tap(b); g.advance(100); g.tap(b); g.advance(80);
  g.down(b);
  g.advance(300);
  assert.equal(g.over().reason, 'Double tap. One tap only.');
});

test('bait and switch: a miss fails before the flip, but once it says DON\'T TAP, empty space is safe', () => {
  const g = game();
  g.play(['lastinstant']);
  g.tap(g.field);
  g.advance(300);
  assert.equal(g.over().reason, 'Missed the button.');

  const h = game();
  h.play(['lastinstant', 'tapme']);
  h.advance(1100); // flipped by now
  h.tap(h.field);
  h.advance(50);
  assert.equal(h.results.length, 0);
});

test('a wrong button still fails at once, as before', () => {
  const g = game();
  g.play(['tapnumber']);
  const target = g.instruction.textContent.replace('TAP ', '');
  const wrong = g.buttons().find((b) => b.textContent !== target);
  g.down(wrong);
  g.advance(300);
  assert.equal(g.over().reason, 'That was ' + wrong.textContent + '.');
});

test('difficulty ramps 10% slower: it peaks at ~50, and every timer is a little longer mid-game', () => {
  const g = game();
  const A = g.ctx.Adaptive;
  assert.equal(A.RAMP_SCORE, 49.5);
  assert.equal(A.difficulty(45), 45 / 49.5);
  assert.equal(A.difficulty(50), 1);
  const tapme = g.ctx.Challenges.DEFS.find((d) => d.id === 'tapme');
  const old = (score) => Math.round(tapme.baseTime + (tapme.minTime - tapme.baseTime) * Math.min(1, score / 45));
  for (const score of [10, 20, 30, 40]) assert.ok(A.timeLimit(tapme, score) > old(score), 'score ' + score);
  assert.equal(A.timeLimit(tapme, 60), tapme.minTime, 'the hardest timing is unchanged, just reached later');
});

test('How to play explains the new rules', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<li>One clean tap\. Missing the button, double-tapping, or holding a tap ends the run\.<\/li>/);
  assert.match(html, /<li>When it says <b>HOLD<\/b>, hold until the bar fills\.<\/li>/);
});
