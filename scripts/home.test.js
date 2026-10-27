/* home.test.js — the player card (name), and the leaderboard shown without joining.
 * Run: node --test scripts/home.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { setup, source, nativeState } = require('./helpers/monetization-harness');
const { makeDom } = require('./helpers/dom-stub');
const { createHandler } = require('../server/src/handler');
const { createMemoryStore } = require('../server/src/store-memory');
const { sequence } = require('../server/src/replay');

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
    LeaderboardUI: { init() {}, afterWeeklyRun() {}, refreshPreview() {} },
    navigator: {}, location: { protocol: 'capacitor:' }
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

// ---------- the leaderboard is shown without joining ----------
const WEEK = '2026-W43';
const NOW = Date.parse('2026-10-24T12:00:00Z');
const API = 'https://api.example.test';
const validRounds = (score) => sequence(WEEK, score).map((r) => (r.timeoutResult === 'success' ? r.limit : 300));

function phone(store, { opted = false } = {}) {
  const log = [];
  const handler = createHandler({ store, now: () => NOW, log() {}, allowedOrigins: [] });
  const storage = new Map();
  const dom = makeDom(['name-sheet', 'lb-sheet']);
  const shown = [];
  const ctx = {
    console, setTimeout, clearTimeout, AbortController, crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    document: dom.document, addEventListener() {},
    UI: { show: (id) => shown.push(id), toast() {} },
    Share: { shareText: () => Promise.resolve({ ok: true }) },
    fetch: async (url, init) => {
      const u = new URL(url);
      log.push({ method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams) });
      const res = await handler({ requestContext: { http: { method: init.method } }, rawPath: u.pathname, queryStringParameters: Object.fromEntries(u.searchParams), body: init.body });
      return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(res.body) };
    },
    confirm: () => true
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['storage', 'leaderboard-config', 'weekly', 'leaderboard', 'profile', 'leaderboard-ui'].forEach((n) =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8'), ctx));
  ctx.LeaderboardConfig.apiBase = API;
  // pin the week to the one the server accepts
  vm.runInContext(`Weekly.weekId = function () { return '${WEEK}'; };`, ctx);
  if (opted) ctx.Leaderboard.optIn();
  return { ctx, dom, el: dom.el, log, shown, Store: ctx.Store, lb: ctx.Leaderboard, ui: ctx.LeaderboardUI };
}

async function seedBoard(store) {
  const make = (name, score, i) => {
    const p = phone(store, { opted: true });
    return p.lb.submit({ weekId: WEEK, score, rounds: validRounds(score), name });
  };
  await make('Speedy', 30, 1); await make('Taps McGee', 20, 2); await make('Sam', 10, 3); await make('Zed', 8, 4);
}

test('the home card shows this week\'s top three immediately, with no account and no id', async () => {
  const store = createMemoryStore();
  await seedBoard(store);
  const viewer = phone(store); // has never joined
  viewer.ui.init({ playerName: () => 'Player', onNameChanged() {} });
  await tick(6);
  const rows = viewer.el('lbp-list').children.map((r) => r.children.map((c) => c.textContent));
  assert.deepEqual(plain(rows), [['#1', 'Speedy', '30'], ['#2', 'Taps McGee', '20'], ['#3', 'Sam', '10']]);
  assert.match(viewer.el('lbp-footer').textContent, /4 players this week/);
  assert.equal(viewer.Store.lb.deviceId, '', 'looking at the board creates no identity');
  assert.equal(viewer.Store.lb.optIn, false);
  assert.ok(viewer.log.length >= 1 && viewer.log.every((r) => r.method === 'GET' && r.path.includes('/leaderboard')));
  assert.ok(viewer.log.every((r) => !('deviceId' in r.query) || !r.query.deviceId), 'no id is sent when looking');
});

test('opening the leaderboard needs no joining; only posting and groups do', async () => {
  const store = createMemoryStore();
  await seedBoard(store);
  const viewer = phone(store);
  viewer.ui.init({ playerName: () => 'Player', onNameChanged() {} });
  await tick(4);
  viewer.el('btn-lb').fire('click');
  await tick(6);
  assert.equal(viewer.shown.at(-1), 'lb', 'straight to the board, not the join screen');
  assert.equal(viewer.shown.includes('lb-optin'), false);
  assert.equal(viewer.el('lb-list').children.length, 4);
  assert.equal(viewer.dom.hidden('lb-join-banner'), false, 'a gentle "join to post" prompt, not a wall');
  assert.equal(viewer.Store.lb.deviceId, '');
  // friends tab: viewing the board is open, groups need joining
  viewer.el('lb-tab-friends').fire('click');
  assert.equal(viewer.dom.hidden('lb-friends-join'), false);
  assert.equal(viewer.dom.hidden('lb-friends'), true);
  // the join prompt leads to the join screen
  viewer.el('btn-lb-joinbar').fire('click');
  assert.equal(viewer.shown.at(-1), 'lb-optin');
});

test('once joined, the prompt is gone and the board shows your own rank', async () => {
  const store = createMemoryStore();
  await seedBoard(store);
  const me = phone(store, { opted: true });
  await me.lb.submit({ weekId: WEEK, score: 15, rounds: validRounds(15), name: 'Me' });
  me.ui.init({ playerName: () => 'Me', onNameChanged() {} });
  await tick(4);
  me.el('btn-lb').fire('click');
  await tick(6);
  assert.equal(me.dom.hidden('lb-join-banner'), true);
  assert.match(me.el('lbp-footer').textContent, /You are #3 of 5/);
  assert.ok(me.log.some((r) => r.query.deviceId), 'joined players send their id so the board can show their rank');
});

test('the preview model: states, three rows, hidden players, and failures', () => {
  const { ui } = phone(createMemoryStore());
  const entries = [1, 2, 3, 4, 5].map((n) => ({ rank: n, name: 'P' + n, score: 60 - n, ref: String(n).repeat(12).slice(0, 12) }));
  const ready = plain(ui.previewModel({ entries, total: 9 }, [], ''));
  assert.equal(ready.state, 'ready');
  assert.equal(ready.rows.length, 3);
  assert.equal(ready.footer, '9 players this week');
  assert.equal(plain(ui.previewModel({ entries: [], total: 0 }, [], '')).state, 'empty');
  assert.match(ui.previewModel({ entries: [], total: 0 }, [], '').footer, /Be the first/);
  assert.equal(ui.previewModel(null).state, 'error');
  const hidden = plain(ui.previewModel({ entries, total: 9 }, ['111111111111'], ''));
  assert.deepEqual(hidden.rows.map((r) => r.name), ['P2', 'P3', 'P4'], 'a hidden player leaves the card');
  const mine = plain(ui.previewModel({ entries, total: 9, you: { rank: 2, ref: '222222222222' } }, [], '222222222222'));
  assert.equal(mine.rows[1].mine, true);
  assert.equal(mine.footer, 'You are #2 of 9');
});

test('the home preview refreshes when Home is shown, but not more than once a minute', async () => {
  const store = createMemoryStore();
  await seedBoard(store);
  const viewer = phone(store);
  viewer.ui.init({ playerName: () => 'Player', onNameChanged() {} });
  await tick(6);
  const before = viewer.log.length;
  viewer.ui.refreshPreview(); viewer.ui.refreshPreview();
  await tick(4);
  assert.equal(viewer.log.length, before, 'throttled');
  viewer.ui.refreshPreview(true); // forced (after joining, posting, or hiding someone)
  await tick(6);
  assert.equal(viewer.log.length, before + 1);
});

test('offline or failing: the card degrades to an invitation, never an error wall', async () => {
  const viewer = phone(createMemoryStore());
  viewer.ctx.fetch = async () => { throw new TypeError('network down'); };
  viewer.ui.init({ playerName: () => 'Player', onNameChanged() {} });
  await tick(6);
  assert.equal(viewer.el('lbp-list').children.length, 0);
  assert.match(viewer.el('lbp-footer').textContent, /Tap to see this week/);
});

test('reporting works without joining, creates only an anonymous id, and three reporters hide the entry', async () => {
  const store = createMemoryStore();
  const rude = phone(store, { opted: true });
  await rude.lb.submit({ weekId: WEEK, score: 40, rounds: validRounds(40), name: 'Rude' });
  const ref = rude.Store.lb.myRef;
  await seedBoard(store);
  const reporters = [phone(store), phone(store), phone(store)];
  for (const r of reporters) {
    assert.equal(r.Store.lb.deviceId, '');
    await r.lb.report(ref, WEEK, 'name');
    assert.ok(r.Store.lb.deviceId, 'an anonymous id exists only now, because a report was sent');
    assert.equal(r.Store.lb.optIn, false, 'reporting does not join the leaderboard');
    assert.equal(r.lb.isBlocked(ref), true);
  }
  const check = phone(store);
  const board = await check.lb.board(WEEK);
  assert.equal(board.entries.some((e) => e.name === 'Rude'), false, 'hidden for everyone after three reporters');
});

test('the home markup: player card, leaderboard card, name sheet, and no old name input', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['btn-name', 'player-avatar', 'player-name-text', 'player-sub', 'name-sheet', 'name-input', 'btn-name-save', 'btn-name-cancel', 'btn-lb', 'lbp-list', 'lbp-footer', 'lb-join-banner', 'btn-lb-joinbar', 'lb-friends-join']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.equal(html.includes('id="playerName"'), false, 'the old name text box is gone');
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
