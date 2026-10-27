/* gamecenter.test.js — leaderboards through Game Center: score sync (including the high score from
 * before this version), the weekly challenge following Apple's weekly period and rolling over on
 * Mondays, the home card, the all-time screen, the Weekly Challenge screen, and ranks after a run.
 * The native plugin is replaced by a fake that behaves like Apple's server.
 * Run: node --test scripts/gamecenter.test.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fakeGameCenter, gamePhone, mondayPeriod, IDS, DAY } = require('./helpers/gamecenter-fake');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const NOW = Date.parse('2026-10-28T12:00:00Z'); // a Wednesday, ISO week 2026-W44
const saved = (data) => new Map([['dtt.v1', JSON.stringify(data)]]);
const rowsOf = (list) => plain(list.children.map((r) => r.children.map((c) => c.textContent)));

// ---------- syncing scores ----------
test('an existing high score from before this version reaches the all-time board on first launch', async () => {
  const p = gamePhone({ storage: saved({ best: 37 }), period: mondayPeriod(NOW) });
  await p.GameCenter.init();
  await tick();
  assert.deepEqual(plain(p.gc.calls.submit), [{ score: 37, ids: [IDS.best] }]);
  assert.equal(p.gc.scoreOf('best'), 37);
  // relaunching the app does not post it again
  const again = gamePhone({ gc: p.gc, storage: p.storage, period: mondayPeriod(NOW) });
  await again.GameCenter.init();
  await tick();
  assert.equal(p.gc.calls.submit.length, 1);
});

test('this week\'s existing weekly best is synced too, but only once Apple confirms it is the same week', async () => {
  const week = '2026-W44';
  const p = gamePhone({ storage: saved({ best: 5, weekly: { id: week, best: 21, plays: 3 } }), period: mondayPeriod(NOW) });
  await p.GameCenter.init();
  await tick();
  assert.equal(p.gc.scoreOf('weekly'), 21);
  assert.ok(p.gc.calls.load.some((c) => c.id === IDS.weekly), 'it asked Apple for the current week first');

  // a weekly best from an earlier week is never posted to this week's board
  const stale = gamePhone({ storage: saved({ weekly: { id: '2026-W43', best: 50, plays: 1 } }), period: mondayPeriod(NOW) });
  await stale.GameCenter.init();
  await tick();
  assert.equal(stale.gc.scoreOf('weekly'), undefined);

  // and without Apple's period (board unavailable) the weekly score waits rather than guessing
  const unknown = gamePhone({ storage: saved({ weekly: { id: week, best: 9, plays: 1 } }), period: null });
  await unknown.GameCenter.init();
  await tick();
  assert.equal(unknown.gc.scoreOf('weekly'), undefined);
});

test('a score that fails to post is retried later until Apple accepts it', async () => {
  const p = gamePhone({ storage: saved({ best: 12 }), period: mondayPeriod(NOW) });
  p.gc.fail.submit = 1;
  await p.GameCenter.init();
  await tick();
  assert.equal(p.gc.scoreOf('best'), undefined, 'offline the first time');
  assert.equal(await p.GameCenter.sync(), true);
  assert.equal(p.gc.scoreOf('best'), 12);
  assert.equal(await p.GameCenter.sync(), false, 'nothing left to post');
});

test('signed out: nothing is posted; signing in later (Settings) posts the saved best at once', async () => {
  const p = gamePhone({ storage: saved({ best: 30 }), signedIn: false, period: mondayPeriod(NOW) });
  const state = await p.GameCenter.init();
  assert.equal(state.authenticated, false);
  assert.equal(p.gc.calls.submit.length, 0);
  p.gc.signIn();
  await tick();
  assert.equal(p.gc.scoreOf('best'), 30);
  assert.equal(p.GameCenter.getState().displayName, 'Me');
});

test('outside the iOS app everything is inert and nothing is shown', async () => {
  const p = gamePhone({ web: true });
  const state = await p.GameCenter.init();
  assert.equal(state.supported, false);
  await assert.rejects(p.GameCenter.board('best', 'global', 3), { code: 'unsupported' });
  assert.equal(await p.GameCenter.sync(), false);
  p.ui.init({});
  assert.equal(p.dom.hidden('btn-lb'), true, 'no leaderboard card in a browser');
  await p.ui.afterRun({ weeklyId: null, score: 20 });
  assert.equal(p.dom.hidden('over-rank'), true);
});

test('board data is cleaned up: malformed rows dropped, names kept as plain text and capped', () => {
  const { GameCenter } = gamePhone();
  const data = plain(GameCenter.normalize({
    entries: [{ rank: 1, score: 9, name: '<b>x</b>' }, { rank: 'x' }, null, { rank: 2, score: 3, name: 'y'.repeat(80), mine: true }],
    you: { rank: 2, score: 3, name: 'Me', mine: true }, total: 1, period: { start: 1, end: 'no' }
  }));
  assert.deepEqual(data.entries.map((e) => e.name.length), [8, 40]);
  assert.equal(data.entries[0].name, '<b>x</b>', 'text, rendered with textContent');
  assert.equal(data.total, 2, 'never smaller than the rows we have');
  assert.equal(data.period, null);
  assert.deepEqual(plain(GameCenter.normalize(undefined)), { entries: [], you: null, total: 0, period: null, recurring: false });
});

// ---------- the weekly challenge follows Apple, and changes every Monday ----------
test('Apple\'s weekly period decides the week (the seed) and the countdown, and survives a restart offline', async () => {
  const period = mondayPeriod(NOW);
  const p = gamePhone({ period });
  assert.equal(p.Weekly.source(), 'local');
  await p.GameCenter.init();
  await p.GameCenter.board('weekly', 'global', 1);
  assert.equal(p.Weekly.source(), 'apple');
  assert.equal(p.Weekly.weekId(), '2026-W44');
  assert.equal(p.Weekly.msUntilReset(), period.end - NOW);
  // relaunch with no network: the cached period still applies
  const offline = gamePhone({ storage: p.storage, signedIn: false });
  assert.equal(offline.Weekly.source(), 'apple');
  assert.equal(offline.Weekly.msUntilReset(), period.end - NOW);
});

test('the challenge changes every Monday: at 00:00 UTC without Game Center, and at Apple\'s rollover with it', () => {
  const sunday = Date.parse('2026-11-01T23:59:59Z');
  const monday = Date.parse('2026-11-02T00:00:00Z');
  const p = gamePhone({ now: sunday });
  assert.equal(p.Weekly.weekId(), '2026-W44');
  assert.equal(p.Weekly.msUntilReset(), 1000);
  p.clock.now = monday;
  assert.equal(p.Weekly.weekId(), '2026-W45');
  assert.equal(p.Weekly.msUntilReset(), 7 * DAY);

  // Apple's period: even if it rolls over a few hours after midnight UTC, the week id is the
  // same ISO week, and it changes exactly when Apple's period ends.
  const late = { start: Date.parse('2026-10-26T05:00:00Z'), end: Date.parse('2026-11-02T05:00:00Z') };
  const q = gamePhone({ now: Date.parse('2026-11-02T04:59:00Z') });
  q.Weekly.setPeriod(late.start, late.end);
  assert.equal(q.Weekly.weekId(), '2026-W44', 'still last week until Apple rolls over');
  assert.equal(q.Weekly.msUntilReset(), 60000);
  q.clock.now = late.end;
  assert.equal(q.Weekly.weekId(), '2026-W45', 'new commands the moment the period ends');
});

test('nonsense periods are ignored', () => {
  const p = gamePhone();
  assert.equal(p.Weekly.setPeriod(0, DAY), false, 'one day is not a week');
  assert.equal(p.Weekly.setPeriod(NOW, NOW - 7 * DAY), false);
  assert.equal(p.Weekly.setPeriod('x', 'y'), false);
  assert.equal(p.Weekly.source(), 'local');
});

// ---------- the home card: the all-time board ----------
const crowd = { Speedy: 60, 'Taps McGee': 44, Sam: 31, Zed: 12 };

test('the home card shows the all-time top three and where you stand', async () => {
  const p = gamePhone({ best: { ...crowd, Me: 20 } });
  await p.GameCenter.init();
  p.ui.init({});
  await tick();
  assert.equal(p.dom.hidden('btn-lb'), false);
  assert.deepEqual(rowsOf(p.el('lbp-list')), [['#1', 'Speedy', '60'], ['#2', 'Taps McGee', '44'], ['#3', 'Sam', '31']]);
  assert.equal(p.el('lbp-footer').textContent, 'You are #4 of 5');
  assert.ok(p.el('lbp-list').children.every((r) => /\blbp-row\b/.test(r.className)), 'styled preview rows');
  assert.equal(p.gc.calls.load.at(-1).id, IDS.best);
});

test('the home card: signed out, empty, and offline each get a friendly line', async () => {
  const out = gamePhone({ signedIn: false });
  await out.GameCenter.init();
  out.ui.init({});
  await tick();
  assert.match(out.el('lbp-footer').textContent, /Sign in to Game Center/);
  assert.equal(out.gc.calls.load.length, 0);

  const empty = gamePhone();
  await empty.GameCenter.init();
  empty.ui.init({});
  await tick();
  assert.match(empty.el('lbp-footer').textContent, /Be the first/);

  const offline = gamePhone({ best: crowd });
  offline.gc.fail.load = 5;
  await offline.GameCenter.init();
  offline.ui.init({});
  await tick();
  assert.equal(offline.el('lbp-list').children.length, 0);
  assert.equal(offline.el('lbp-footer').textContent, 'Tap to see the leaderboard');
});

test('the home card refreshes at most once a minute unless forced', async () => {
  const p = gamePhone({ best: crowd });
  await p.GameCenter.init();
  p.ui.init({});
  await tick();
  const before = p.gc.calls.load.length;
  p.ui.refreshPreview(); p.ui.refreshPreview();
  await tick();
  assert.equal(p.gc.calls.load.length, before);
  p.ui.refreshPreview(true);
  await tick();
  assert.equal(p.gc.calls.load.length, before + 1);
});

test('the preview model', () => {
  const { ui } = gamePhone();
  const gc = { checked: true, authenticated: true };
  const entries = [1, 2, 3, 4].map((n) => ({ rank: n, name: 'P' + n, score: 50 - n }));
  assert.equal(ui.previewModel(null, { checked: false }).state, 'checking');
  assert.equal(ui.previewModel(null, { checked: true, authenticated: false }).state, 'signed_out');
  assert.equal(ui.previewModel(null, gc).state, 'error');
  assert.equal(ui.previewModel({ entries: [], total: 0 }, gc).state, 'empty');
  const ready = plain(ui.previewModel({ entries, total: 9, you: null }, gc));
  assert.equal(ready.rows.length, 3);
  assert.equal(ready.footer, 'Play a round to get on the board');
  assert.equal(ui.previewModel({ entries, total: 9, you: { rank: 2 } }, gc).footer, 'You are #2 of 9');
});

// ---------- the all-time screen ----------
test('tapping the card opens the all-time board; your own row is added when you rank below it', async () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['P' + (i + 1), 200 - i]));
  const p = gamePhone({ best: { ...many, Me: 5 } });
  await p.GameCenter.init();
  p.ui.init({});
  await tick();
  p.el('btn-lb').fire('click');
  await tick();
  assert.equal(p.shown.at(-1), 'lb');
  const list = p.el('lb-list').children;
  assert.equal(list.length, 26, 'top 25, plus you');
  assert.match(list.at(-1).className, /me/);
  assert.match(list.at(-1).className, /gap/);
  assert.equal(p.el('lb-status').textContent, 'You are #31 of 31.');
  p.el('btn-lb-back').fire('click');
  assert.equal(p.shown.at(-1), 'home');
});

test('the friends tab shows only Game Center friends, and explains when friends access is off', async () => {
  const p = gamePhone({ best: { ...crowd, Me: 20 }, friends: ['Sam'] });
  await p.GameCenter.init();
  p.ui.init({});
  p.ui.openAllTime('home');
  await tick();
  p.el('lb-tab-friends').fire('click');
  await tick();
  assert.equal(p.gc.calls.load.at(-1).scope, 'friends');
  assert.deepEqual(rowsOf(p.el('lb-list')).map((r) => r[1]), ['Sam', 'Me']);
  assert.equal(p.el('lb-tab-friends').classList.contains('active'), true);
  p.gc.fail.friends = true;
  p.el('lb-tab-friends').fire('click');
  await tick();
  assert.match(p.el('lb-status').textContent, /Settings › Game Center › Friends/);
});

test('Open in Game Center shows Apple\'s own leaderboard', async () => {
  const p = gamePhone();
  await p.GameCenter.init();
  p.ui.init({});
  p.el('btn-lb-gc').fire('click');
  p.el('btn-wk-gc').fire('click');
  await tick();
  assert.deepEqual(p.gc.calls.show, [IDS.best, IDS.weekly]);
});

// ---------- the Weekly Challenge screen ----------
test('the Weekly Challenge has its own screen: week, time left, your best, this week\'s board, then Play', async () => {
  const period = mondayPeriod(NOW);
  const p = gamePhone({ storage: saved({ weekly: { id: '2026-W44', best: 14, plays: 3 } }), weekly: { Speedy: 33, Sam: 18, Me: 14 }, period });
  let started = 0;
  await p.GameCenter.init();
  p.ui.init({ startWeekly: () => { started++; } });
  p.ui.openWeekly();
  await tick();
  assert.equal(p.shown.at(-1), 'weekly');
  assert.equal(p.el('wk-when').textContent, 'Week 44 • New rounds in ' + p.Weekly.resetLabel(period.end - NOW));
  assert.equal(p.el('wk-best').textContent, '14');
  assert.equal(p.el('wk-plays').textContent, '3 runs this week');
  assert.deepEqual(rowsOf(p.el('wk-list')), [['#1', 'Speedy', '33'], ['#2', 'Sam', '18'], ['#3', 'Me', '14']]);
  assert.equal(p.el('wk-status').textContent, 'You are #3 of 3.');
  assert.equal(started, 0, 'opening the screen does not start a run');
  p.el('btn-wk-play').fire('click');
  assert.equal(started, 1);
  p.el('btn-wk-back').fire('click');
  assert.equal(p.shown.at(-1), 'home');
});

test('the Weekly Challenge screen before playing this week, and when signed out', async () => {
  const p = gamePhone({ signedIn: false });
  await p.GameCenter.init();
  p.ui.init({});
  p.ui.openWeekly();
  await tick();
  assert.equal(p.el('wk-best').textContent, '—');
  assert.equal(p.el('wk-plays').textContent, 'Not played yet');
  assert.match(p.el('wk-status').textContent, /Sign in to Game Center/);
  assert.match(p.el('wk-when').textContent, /^Week 44 • New rounds in /);
});

// ---------- after a run ----------
test('after a run the score is posted and the new rank is shown', async () => {
  const p = gamePhone({ best: crowd, weekly: { Speedy: 33 }, period: mondayPeriod(NOW) });
  await p.GameCenter.init();
  p.ui.init({});
  p.Store.setBest(50);
  await p.ui.afterRun({ weeklyId: null, score: 50 });
  assert.equal(p.gc.scoreOf('best'), 50);
  assert.equal(p.el('over-rank').textContent, 'All-time rank #2 of 5');
  assert.equal(p.dom.hidden('over-rank'), false);

  p.Store.recordWeekly('2026-W44', 40);
  await p.ui.afterRun({ weeklyId: '2026-W44', score: 40 });
  assert.equal(p.gc.scoreOf('weekly'), 40);
  assert.equal(p.el('over-rank').textContent, 'Weekly rank #1 of 2');
});

test('after a run: signed out, offline, and zero scores', async () => {
  const out = gamePhone({ signedIn: false });
  await out.GameCenter.init();
  out.ui.init({});
  await out.ui.afterRun({ weeklyId: null, score: 9 });
  assert.equal(out.el('over-rank').textContent, 'Sign in to Game Center to get ranked.');

  const offline = gamePhone({ period: mondayPeriod(NOW) });
  await offline.GameCenter.init();
  offline.ui.init({});
  offline.Store.setBest(9);
  offline.gc.fail.submit = 1;
  offline.gc.fail.load = 5;
  await offline.ui.afterRun({ weeklyId: null, score: 9 });
  assert.match(offline.el('over-rank').textContent, /posts to Game Center when you’re back online/);
  offline.gc.fail.load = 0;
  await offline.GameCenter.sync();
  assert.equal(offline.gc.scoreOf('best'), 9, 'caught up later');

  const zero = gamePhone();
  await zero.GameCenter.init();
  zero.ui.init({});
  await zero.ui.afterRun({ weeklyId: null, score: 0 });
  assert.equal(zero.dom.hidden('over-rank'), true);
});

// ---------- found on a real phone (2026-10-27) ----------
test('Game Center\'s "no score yet" placeholder (#0, score 0) is never shown as a row', async () => {
  const p = gamePhone({ weekly: {}, period: mondayPeriod(NOW) });
  await p.GameCenter.init();
  p.ui.init({});
  p.ui.openWeekly();
  await tick();
  assert.equal(p.el('wk-list').children.length, 0);
  assert.equal(p.el('wk-status').textContent, 'No scores yet. Be the first!');
  const raw = await p.gc.plugin.loadBoard({ id: IDS.weekly, scope: 'global', count: 5 });
  assert.equal(raw.you.rank, 0, 'the fake does what Apple does');
  assert.equal(p.GameCenter.normalize(raw).you, null);
});

test('the home card catches up when the saved best finishes posting while it was loading', async () => {
  const p = gamePhone({ storage: saved({ best: 46 }), period: mondayPeriod(NOW), submitDelay: 6 });
  p.ui.init({}); // listening before sign-in, as in the app
  await p.GameCenter.init();
  await tick(30);
  assert.equal(p.gc.scoreOf('best'), 46);
  assert.deepEqual(rowsOf(p.el('lbp-list')), [['#1', 'Me', '46']]);
  assert.equal(p.el('lbp-footer').textContent, 'You are #1 of 1');
});

test('a weekly board that has not opened yet says when it opens, and nothing is posted to it early', async () => {
  const opens = Date.parse('2026-11-02T00:00:00Z');
  const p = gamePhone({ storage: saved({ weekly: { id: '2026-W44', best: 26, plays: 1 } }), period: { start: opens, end: opens + 7 * DAY } });
  await p.GameCenter.init();
  p.ui.init({});
  p.ui.openWeekly();
  await tick();
  assert.equal(p.Weekly.upcoming(), opens);
  assert.equal(p.Weekly.source(), 'local', 'this week still runs on the Monday 00:00 UTC schedule');
  assert.equal(p.el('wk-list').children.length, 0);
  assert.equal(p.el('wk-status').textContent, 'The weekly leaderboard opens ' + p.ui.openingDay(opens) + '. Runs from then on are ranked.');
  assert.equal(p.gc.calls.submit.filter((c) => c.ids[0] === IDS.weekly).length, 0);
  p.Store.recordWeekly('2026-W44', 30);
  await p.ui.afterRun({ weeklyId: '2026-W44', score: 30 });
  assert.equal(p.el('over-rank').textContent, 'The weekly leaderboard opens ' + p.ui.openingDay(opens) + '.');
  // once it opens (Monday), this week's runs post as usual
  p.clock.now = opens + DAY;
  assert.equal(p.Weekly.source(), 'apple');
  assert.equal(p.Weekly.weekId(), '2026-W45');
  p.Store.recordWeekly('2026-W45', 12);
  await p.GameCenter.sync();
  assert.equal(p.gc.scoreOf('weekly'), 12);
});

test('a weekly board Apple gives no dates for yet still says it is not open, never "No scores yet"', async () => {
  const p = gamePhone({ storage: saved({ weekly: { id: '2026-W44', best: 26, plays: 2 } }), period: null });
  await p.GameCenter.init();
  p.ui.init({});
  p.ui.openWeekly();
  await tick();
  assert.equal(p.el('wk-status').textContent, 'The weekly leaderboard isn’t open yet. Runs are ranked once it opens.');
  assert.equal(p.el('wk-best').textContent, '26');
  await p.ui.afterRun({ weeklyId: '2026-W44', score: 26 });
  assert.equal(p.el('over-rank').textContent, 'The weekly leaderboard isn’t open yet.');
});

test('the plugin reads the first, upcoming week too (Apple may give only the next start date)', () => {
  const swift = read('ios/App/App/GameCenterPlugin.swift');
  assert.match(swift, /if let next = board\.nextStartDate, next > now \{ return \(next, next\.addingTimeInterval\(length\)\) \}/);
  assert.match(swift, /if let next = board\.nextStartDate, next > start \{ return \(start, next\) \}/, 'never a zero-length period');
  assert.match(swift, /result\["recurring"\] = true/);
});

// ---------- the app is wired for Game Center ----------
test('the leaderboard ids match App Store Connect', () => {
  assert.match(read('js/gamecenter.js'), /best: 'com\.coreyhall\.donttapthat\.best',\s*weekly: 'com\.coreyhall\.donttapthat\.weekly'/);
});

test('the iOS project: Game Center entitlement, plugin registered and compiled, friends permission text', () => {
  assert.match(read('ios/App/App/App.entitlements'), /<key>com\.apple\.developer\.game-center<\/key>\s*<true\/>/);
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length, 2, 'Debug and Release');
  assert.match(pbx, /GameCenterPlugin\.swift in Sources \*\/,/);
  assert.match(read('ios/App/App/MonetizationBridgeViewController.swift'), /registerPluginInstance\(GameCenterPlugin\(\)\)/);
  const swift = read('ios/App/App/GameCenterPlugin.swift');
  assert.match(swift, /public let jsName = "GameCenter"/);
  for (const m of ['authenticate', 'submitScore', 'loadBoard', 'showLeaderboard']) assert.match(swift, new RegExp('CAPPluginMethod\\(name: "' + m + '"'));
  assert.match(swift, /board\.type == \.recurring/, 'the weekly period comes from Apple');
  assert.match(read('ios/App/App/Info.plist'), /<key>NSGKFriendListUsageDescription<\/key>\s*<string>[^<]{10,}<\/string>/);
});

test('our own leaderboard server is gone from the app: no API calls, no opt-in, no ids, nothing collected', () => {
  const html = read('index.html');
  for (const id of ['screen-lb-optin', 'lb-sheet', 'btn-join-lb', 'lb-name-input', 'btn-lb-delete']) assert.equal(html.includes('id="' + id + '"'), false, id);
  for (const id of ['screen-weekly', 'wk-when', 'wk-best', 'wk-list', 'btn-wk-play', 'screen-lb', 'lb-list', 'btn-lb-gc']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.equal(fs.existsSync(path.join(root, 'js/leaderboard.js')), false);
  for (const f of fs.readdirSync(path.join(root, 'js'))) assert.doesNotMatch(read('js/' + f), /execute-api|fetch\(/, f);
  assert.match(read('ios/App/App/PrivacyInfo.xcprivacy'), /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  assert.match(html, /<script src="js\/gamecenter\.js"><\/script>/);
  assert.match(read('sw.js'), /\.\/js\/gamecenter\.js/);
});

// ---------- how players reach us ----------
function companyPage(rel) {
  const dir = process.env.HSS_REPO || path.join(root, '..', 'HallSoftwareSolutions');
  const file = path.join(dir, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

test('the published privacy policy describes Game Center leaderboards', (t) => {
  const policy = companyPage('dont-tap-that/privacy/index.html');
  if (policy === null) { t.diagnostic('company-site repo not found: skipped'); return; }
  assert.match(policy, /Game Center/);
  assert.doesNotMatch(policy, /Delete my leaderboard data|friend groups/i, 'no mention of the retired self-hosted leaderboard');
});

test('every place that tells players how to reach us uses one address', () => {
  const texts = [read('index.html')];
  for (const rel of ['dont-tap-that/index.html', 'dont-tap-that/privacy/index.html', 'dont-tap-that/support/index.html']) {
    const page = companyPage(rel);
    if (page !== null) texts.push(page);
  }
  const found = new Set();
  for (const text of texts) for (const m of text.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)) found.add(m[0]);
  assert.ok([...found].every((a) => a === 'support@hallsoftwaresolutions.com'), [...found].join(', '));
});

test('the in-app policy link goes to the live company page, and nothing shipped mentions the retired web version', () => {
  const html = read('index.html');
  const links = [...html.matchAll(/href="([^"]*privacy[^"]*)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 1);
  links.forEach((l) => assert.equal(l, 'https://hallsoftwaresolutions.com/dont-tap-that/privacy/'));
  const shipped = ['index.html', 'manifest.webmanifest', 'sw.js', ...fs.readdirSync(path.join(root, 'js')).map((f) => 'js/' + f)];
  for (const rel of shipped) assert.doesNotMatch(read(rel), /donttapthat\.com|cloudfront\.net/, rel);
});
