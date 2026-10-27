/* home.test.js — the player card (name), the Game Center wiring in main.js, and the launch splash.
 * Run: node --test scripts/home.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { setup, source, nativeState } = require('./helpers/monetization-harness');
const { makeDom } = require('./helpers/dom-stub');

const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = (n = 3) => (async () => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); })();

// ---------- Profile (pure) ----------
function profile() { const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source('profile'), ctx); return ctx.Profile; }

test('names: whitespace collapsed, control characters dropped, 14 characters max, emoji never split', () => {
  const P = profile();
  assert.equal(P.normalize('  Corey   Hall  '), 'Corey Hall');
  assert.equal(P.normalize('Co\u0000re\ty\n'), 'Co re y');
  assert.equal(P.normalize('A'.repeat(40)), 'A'.repeat(14));
  assert.equal(P.normalize(null), '');
  assert.equal(P.normalize('   '), '');
  const emoji = P.normalize('\u{1F600}'.repeat(20));
  assert.equal(Array.from(emoji).length, 14);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji), 'no half surrogate pairs');
  assert.equal(P.normalize('Zoë'), 'Zoë');
});

test('monogram, subtitle and greeting', () => {
  const P = profile();
  assert.equal(P.initial('corey'), 'C');
  assert.equal(P.initial('  élan'), 'É');
  assert.equal(P.initial('\u{1F600} Fun'), '\u{1F600}');
  assert.equal(P.initial(''), '');
  assert.equal(P.subtitle('', 50), 'Tap to set how you appear');
  assert.equal(P.subtitle('Corey', 0), 'Ready when you are');
  assert.equal(P.subtitle('Corey', 52), 'Best 52');
  assert.equal(P.greeting('Corey', true), 'Nice to meet you, Corey');
  assert.equal(P.greeting('Corey', false), 'Looking good, Corey');
});

// ---------- the player card in the real main.js ----------
async function home(options = {}) {
  const f = setup({ state: nativeState({ ...(options.state || {}) }), ...options.setup });
  const dom = makeDom(['name-sheet', 'btn-lb', 'new-best', 'versus', 'over-mode', 'over-rank', 'btn-join-lb', 'btn-continue', 'ad-break-notice']);
  const toasts = [];
  Object.assign(f.context, {
    setTimeout, clearTimeout,
    document: dom.document,
    UI: { register() {}, show() {}, toast: (m) => toasts.push(m), onShow: null },
    Sound: { unlock() {}, best() {} },
    Engine: { init() {}, onUpdate() {}, onGameOver() {}, start() {}, resume: () => false, canResume: () => false, getScore: () => 0, getRounds: () => [] },
    Share: { readIncoming: () => null },
    Weekly: { weekId: () => '2026-W43', msUntilReset: () => 1e8, resetLabel: () => '1d', isWeekId: () => true },
    Themes: { LIST: [], enabled: () => false, available: () => false, previewAll: () => false, apply: (i) => i, applyTrusted: (i) => i, preview: (i) => i, resolve: (i) => i, canUse: () => true, find: () => null, ownership: () => 'free' },
    LeaderboardUI: { init() {}, afterRun() {}, refreshPreview() {}, openWeekly() {}, renderWeeklyInfo() {} },
    GameCenter: { init() {}, onChange() {} },
    navigator: {}, location: { protocol: 'capacitor:' },
    ...options.stubs
  });
  vm.runInContext(source('storage'), f.context);
  vm.runInContext(source('profile'), f.context);
  if (options.saved) f.context.Store.setName(options.saved);
  if (options.best) f.context.Store.setBest(options.best);
  vm.runInContext(source('main'), f.context);
  await tick(4);
  return { f, dom, el: dom.el, toasts, Store: f.context.Store, ctx: f.context };
}

test('first run: an inviting empty card, then the name sheet opens with focus', async () => {
  const h = await home();
  assert.equal(h.el('player-name-text').textContent, 'Add your name');
  assert.equal(h.el('player-avatar').textContent, '+');
  assert.equal(h.el('btn-name').classList.contains('empty'), true);
  assert.equal(h.el('player-sub').textContent, 'Tap to set how you appear');
  assert.equal(h.dom.hidden('name-sheet'), true);
  h.el('btn-name').fire('click');
  assert.equal(h.dom.hidden('name-sheet'), false);
  assert.equal(h.el('name-input').focused, true, 'focused inside the tap so iOS raises the keyboard');
});

test('an existing name is shown permanently, and the sheet opens with it highlighted', async () => {
  const h = await home({ saved: 'Corey' });
  assert.equal(h.el('player-name-text').textContent, 'Corey');
  assert.equal(h.el('player-avatar').textContent, 'C');
  assert.equal(h.el('btn-name').classList.contains('empty'), false);
  assert.equal(h.el('player-sub').textContent, 'Ready when you are');
  h.el('btn-name').fire('click');
  assert.equal(h.el('name-input').value, 'Corey');
  assert.deepEqual(plain(h.el('name-input').selection), [0, 5], 'the whole name is selected, so typing replaces it');
});

test('saving a new name updates the card, the saved name, and greets the player', async () => {
  const h = await home({ saved: 'Corey' });
  h.el('btn-name').fire('click');
  h.el('name-input').value = '  Ace   of Spades ';
  h.el('btn-name-save').fire('click');
  assert.equal(h.Store.name, 'Ace of Spades');
  assert.equal(h.el('player-name-text').textContent, 'Ace of Spades');
  assert.equal(h.el('player-avatar').textContent, 'A');
  assert.equal(h.dom.hidden('name-sheet'), true, 'the sheet closes');
  assert.equal(h.el('btn-name').classList.contains('just-saved'), true, 'the card does its little celebration');
  assert.deepEqual(h.toasts, ['Looking good, Ace of Spades']);
});

test('the very first name gets a welcome, not a compliment', async () => {
  const h = await home();
  h.el('btn-name').fire('click');
  h.el('name-input').value = 'Sam';
  h.el('name-input').fire('keydown', { key: 'Enter' });
  assert.equal(h.Store.name, 'Sam');
  assert.deepEqual(h.toasts, ['Nice to meet you, Sam']);
  assert.equal(h.el('btn-name').classList.contains('empty'), false);
});

test('Cancel, Escape and tapping outside change nothing', async () => {
  const h = await home({ saved: 'Corey' });
  for (const close of [
    () => h.el('btn-name-cancel').fire('click'),
    () => h.el('name-input').fire('keydown', { key: 'Escape' }),
    () => h.el('name-sheet').fire('click', { target: h.el('name-sheet') })
  ]) {
    h.el('btn-name').fire('click');
    h.el('name-input').value = 'Someone Else';
    close();
    assert.equal(h.dom.hidden('name-sheet'), true);
    assert.equal(h.Store.name, 'Corey');
    assert.equal(h.el('player-name-text').textContent, 'Corey');
  }
  assert.deepEqual(h.toasts, []);
});

test('an empty or blank name is refused and the sheet stays open', async () => {
  const h = await home({ saved: 'Corey' });
  h.el('btn-name').fire('click');
  h.el('name-input').value = '    ';
  h.el('btn-name-save').fire('click');
  assert.equal(h.Store.name, 'Corey');
  assert.equal(h.dom.hidden('name-sheet'), false);
  assert.deepEqual(h.toasts, ['Pick a name first.']);
});

test('saving the same name again does not celebrate', async () => {
  const h = await home({ saved: 'Corey' });
  h.el('btn-name').fire('click');
  h.el('btn-name-save').fire('click');
  assert.equal(h.el('btn-name').classList.contains('just-saved'), false);
  assert.deepEqual(h.toasts, []);
});

test('the card shows the player\'s best once they have one', async () => {
  const h = await home({ saved: 'Corey', best: 47 });
  assert.equal(h.el('player-sub').textContent, 'Best 47');
  const fresh = await home({ saved: 'Corey' });
  assert.equal(fresh.el('player-sub').textContent, 'Ready when you are');
});

// ---------- Game Center wiring in main.js ----------
test('the Weekly Challenge card opens its own screen instead of starting a run', async () => {
  const h = await home();
  let opened = 0, started = 0;
  h.ctx.LeaderboardUI.openWeekly = () => { opened++; };
  h.ctx.Engine.start = () => { started++; };
  h.el('btn-weekly').fire('click');
  assert.equal(opened, 1);
  assert.equal(started, 0);
});

test('Game Center sign-in starts at launch, and the weekly screen gets a way to start a run', async () => {
  const calls = { init: 0, onChange: 0, ui: null };
  const h = await home({ stubs: {
    GameCenter: { init() { calls.init++; }, onChange() { calls.onChange++; } },
    LeaderboardUI: { init(o) { calls.ui = o; }, afterRun() {}, refreshPreview() {}, openWeekly() {}, renderWeeklyInfo() {} }
  } });
  assert.equal(calls.init, 1);
  assert.equal(calls.onChange, 1, 'a new weekly period from Apple re-draws the week line');
  assert.equal(typeof calls.ui.startWeekly, 'function');
  assert.ok(h);
});

test('the home markup: player card, leaderboard card, weekly card, name sheet, and no old name input', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['btn-name', 'player-avatar', 'player-name-text', 'player-sub', 'name-sheet', 'name-input', 'btn-name-save', 'btn-name-cancel', 'btn-lb', 'lbp-list', 'lbp-footer', 'btn-weekly', 'weekly-line']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.equal(html.includes('id="playerName"'), false, 'the old name text box is gone');
  assert.match(html, /<button id="btn-lb" class="card-btn lb-preview hidden">\s*<span class="cb-main">\s*<strong>Leaderboard<\/strong>/, 'the all-time board on Home');
  assert.match(html, /<script src="js\/profile\.js"><\/script>/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), /\.\/js\/profile\.js/);
});

// ---------- launch splash ----------
test('splash: an overlay on top of a ready home screen, so it can never trap anyone', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<section id="screen-home" class="screen active">/, 'home is already the active screen underneath');
  assert.match(html, /<div id="splash" class="splash" aria-hidden="true">/);
  assert.equal((html.match(/<span class="t t\d"><i class="s"><\/i><i class="b"><\/i><\/span>/g) || []).length, 5, 'five tiles');
  for (const cls of ['sp-mark', 'sp-slash', 'sp-word', 'sp-tag', 'sp-ring r1', 'sp-ring r3']) assert.ok(html.includes('class="' + cls + '"'), cls);
});

test('splash: ends by itself in CSS within about two seconds, is skippable, and respects Reduce Motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const m = css.match(/\.splash \{[^}]*animation: sp-out ([\d.]+)s ease ([\d.]+)s forwards/);
  assert.ok(m, 'the splash fades itself out without any script');
  assert.ok(Number(m[1]) + Number(m[2]) <= 2.2, 'gone within 2.2 s');
  assert.match(css, /@keyframes sp-out \{[^\n]*100% \{ opacity: 0; visibility: hidden; pointer-events: none; \}/, 'invisible and click-through at the end');
  assert.match(css, /\.splash\.skip \{ animation: sp-out 0\.\d+s ease forwards !important; \}/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.splash \{ animation: sp-out [\d.]+s ease ([\d.]+)s forwards; \}/);
  assert.ok(reduced && Number(reduced[1]) < 1.5, 'Reduce Motion: no movement and a shorter, static splash');
  for (const c of ['blue', 'red', 'green', 'yellow', 'purple']) assert.ok(css.includes('background: var(--' + c + ');'), 'tiles use the real gameplay color ' + c);
});

test('splash: the first frame matches the native launch image (same background, same mark)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  const gen = fs.readFileSync(path.join(__dirname, 'generate-splash.js'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capacitor.config.json'), 'utf8'));
  assert.match(css, /--bg: #0a0b0f;/);
  assert.match(gen, /const bgIn = \[10, 11, 15\], bgOut = \[10, 11, 15\];/, 'native background is the same flat #0a0b0f');
  assert.equal(config.ios.backgroundColor, '#0a0b0f', 'the WebView background matches too');
  assert.match(gen, /const discR = N \* 0\.13;/);
  assert.match(css, /\.sp-mark \{\s*position: relative; width: 26vh; height: 26vh;/, 'disc diameter 26% of the screen height, like the aspect-filled native image');
  assert.match(css, /\.splash \{\s*position: absolute; inset: 0; z-index: 60; overflow: hidden; background: var\(--bg\);/);
});

test('splash: a tap skips it', async () => {
  const h = await home();
  assert.equal(h.el('splash').classList.contains('skip'), false);
  h.el('splash').fire('pointerdown');
  assert.equal(h.el('splash').classList.contains('skip'), true);
});
