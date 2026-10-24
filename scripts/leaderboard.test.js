/* leaderboard.test.js — the app's Leaderboard client against the real server handler.
 * A fake fetch routes requests in-process to server/src/handler.js (in-memory store), so
 * this checks the actual client/server contract, offline retry, and privacy behavior.
 * Run: node --test scripts/leaderboard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const { createHandler, refOf } = require('../server/src/handler');
const { createMemoryStore } = require('../server/src/store-memory');
const v = require('../server/src/validate');
const { sequence } = require('../server/src/replay');

const WEEK = '2026-W40';
const NOW = Date.parse('2026-09-30T12:00:00Z');
const API = 'https://api.example.test';

const validRounds = (score) => sequence(WEEK, score).map((r) => (r.timeoutResult === 'success' ? r.limit : 300));

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, val) => { data.set(k, String(val)); }, data };
}

/* One "phone": its own localStorage; shares the server store with other phones. */
function phone(server, opts) {
  opts = opts || {};
  const storage = opts.storage || memoryStorage();
  const log = [];
  const state = { offline: false };
  const fetchImpl = async (url, init) => {
    log.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (state.offline) throw new TypeError('network down');
    const u = new URL(url);
    const res = await server.handler({
      requestContext: { http: { method: init.method } }, rawPath: u.pathname,
      queryStringParameters: Object.fromEntries(u.searchParams), body: init.body
    });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  const ctx = {
    console, localStorage: storage, fetch: fetchImpl, crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout, clearTimeout, AbortController
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['storage', 'leaderboard-config', 'weekly', 'leaderboard', 'leaderboard-ui'].forEach((n) =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8'), ctx, { filename: n + '.js' }));
  ctx.LeaderboardConfig.apiBase = opts.apiBase === null ? '' : (opts.apiBase === undefined ? API : opts.apiBase);
  return { ctx, lb: ctx.Leaderboard, Store: ctx.Store, log, state, storage };
}

function server() {
  const store = createMemoryStore();
  const handler = createHandler({ store, now: () => NOW, log() {} });
  return { store, handler };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (score, name) => ({ weekId: WEEK, score, rounds: validRounds(score), name: name || 'Tester' });

test('disabled by default: no identity, no network, no menu', async () => {
  const p = phone(server(), { apiBase: null });
  assert.equal(p.lb.enabled(), false);
  assert.equal(p.lb.isOptedIn(), false);
  assert.equal(p.lb.optIn(), false);
  await assert.rejects(() => p.lb.submit(run(5)), (e) => e.code === 'not_opted_in');
  await assert.rejects(() => p.lb.board(WEEK), (e) => e.code === 'disabled');
  assert.equal(p.log.length, 0, 'no requests were made');
  assert.equal(p.Store.lb.deviceId, '', 'no identifier created');
});

test('only https API urls enable the feature', () => {
  assert.equal(phone(server(), { apiBase: 'http://insecure.test' }).lb.enabled(), false);
  assert.equal(phone(server(), { apiBase: '' }).lb.enabled(), false);
  assert.equal(phone(server(), { apiBase: API }).lb.enabled(), true);
});

test('nothing is created or sent until the player opts in; identity matches server formats', async () => {
  const p = phone(server());
  assert.equal(p.Store.lb.deviceId, '');
  await assert.rejects(() => p.lb.submit(run(5)), (e) => e.code === 'not_opted_in');
  assert.equal(p.log.length, 0);
  assert.equal(p.lb.optIn(), true);
  assert.ok(v.isDeviceId(p.Store.lb.deviceId), 'device id is a valid UUID');
  assert.ok(v.isDeviceKey(p.Store.lb.deviceKey), 'device key is a valid secret');
  assert.equal(p.lb.isOptedIn(), true);
});

test('identity survives an app restart and is not regenerated', () => {
  const s = server();
  const first = phone(s);
  first.lb.optIn();
  const second = phone(s, { storage: first.storage });
  assert.equal(second.Store.lb.deviceId, first.Store.lb.deviceId);
  second.lb.optIn();
  assert.equal(second.Store.lb.deviceKey, first.Store.lb.deviceKey);
});

test('end to end: submit, rank, and read the weekly board', async () => {
  const s = server();
  const ann = phone(s); ann.lb.optIn();
  const ben = phone(s); ben.lb.optIn();
  const a = await ann.lb.submit(run(20, 'Ann'));
  assert.deepEqual({ rank: a.rank, total: a.total, improved: a.improved }, { rank: 1, total: 1, improved: true });
  const b = await ben.lb.submit(run(30, 'Ben'));
  assert.equal(b.rank, 1);
  const board = await ann.lb.board(WEEK);
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score]), [[1, 'Ben', 30], [2, 'Ann', 20]]);
  assert.equal(board.you.rank, 2, 'the board reports your own rank');
  assert.equal(JSON.stringify(board).includes(ann.Store.lb.deviceId), false);
});

test('offline: the run is remembered and retried later, keeping only the best', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  p.state.offline = true;
  await assert.rejects(() => p.lb.submit(run(10)), (e) => e.code === 'network' && p.lb.isTransient(e));
  assert.equal(p.Store.lb.pending.score, 10);
  await assert.rejects(() => p.lb.submit(run(7)));
  assert.equal(p.Store.lb.pending.score, 10, 'a worse run does not replace the pending best');
  await assert.rejects(() => p.lb.submit(run(14)));
  assert.equal(p.Store.lb.pending.score, 14);

  assert.equal(await p.lb.flushPending().then((r) => r), null, 'still offline: flush quietly gives up');
  assert.equal(p.Store.lb.pending.score, 14);
  p.state.offline = false;
  const res = await p.lb.flushPending();
  assert.equal(res.best, 14);
  assert.equal(p.Store.lb.pending, null, 'pending cleared after success');
  assert.equal((await p.lb.board(WEEK)).total, 1);
});

test('permanent rejections are not retried forever', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  const cheat = run(15);
  cheat.rounds[2] = 5; // superhuman reaction
  await assert.rejects(() => p.lb.submit(cheat), (e) => e.code === 'implausible_run' && !p.lb.isTransient(e));
  assert.equal(p.Store.lb.pending, null, 'rejected runs are dropped, not queued');
  await assert.rejects(() => p.lb.submit({ ...run(5), weekId: '2026-W20' }), (e) => e.code === 'week_closed');
  assert.equal(p.Store.lb.pending, null);
});

test('friend groups: create, share code, join, compare', async () => {
  const s = server();
  const host = phone(s); host.lb.optIn();
  const guest = phone(s); guest.lb.optIn();
  const { code } = await host.lb.createGroup('Host');
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.deepEqual([...host.Store.lb.groups], [code]);
  const joined = await guest.lb.joinGroup(' ' + code.toLowerCase().slice(0, 3) + '-' + code.toLowerCase().slice(3) + ' ', 'Guest');
  assert.equal(joined.members, 2);
  await host.lb.submit(run(12, 'Host'));
  await guest.lb.submit(run(18, 'Guest'));
  const board = await host.lb.groupBoard(code, WEEK);
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score]), [[1, 'Guest', 18], [2, 'Host', 12]]);
  assert.equal(host.lb.normalizeCode('a b-c_d e f1'), 'ABCDEF');
});

test('bad group codes fail locally without a network call', async () => {
  const p = phone(server()); p.lb.optIn();
  await assert.rejects(() => p.lb.joinGroup('abc', 'X'), (e) => e.code === 'bad_code');
  assert.equal(p.log.length, 0);
  await assert.rejects(() => p.lb.joinGroup('ZZZZZZ', 'X'), (e) => e.code === 'no_group' && e.status === 404);
});

test('delete my data removes it from the server and from the phone', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  const other = phone(s); other.lb.optIn();
  await p.lb.submit(run(12, 'Me'));
  await other.lb.submit(run(8, 'Other'));
  const { code } = await p.lb.createGroup('Me');
  await p.lb.deleteMyData();
  assert.equal(p.Store.lb.deviceId, '');
  assert.equal(p.Store.lb.deviceKey, '');
  assert.equal(p.lb.isOptedIn(), false);
  assert.deepEqual([...p.Store.lb.groups], []);
  const board = await other.lb.board(WEEK);
  assert.deepEqual(board.entries.map((e) => e.name), ['Other']);
  assert.equal((await other.lb.groupBoard(code, WEEK)).members, 0);
});

test('a failed delete keeps the local identity so it can be retried', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  await p.lb.submit(run(12, 'Me'));
  const id = p.Store.lb.deviceId;
  p.state.offline = true;
  await assert.rejects(() => p.lb.deleteMyData(), (e) => e.code === 'network');
  assert.equal(p.Store.lb.deviceId, id, 'identity kept so delete can be retried');
  p.state.offline = false;
  await p.lb.deleteMyData();
  assert.equal(p.Store.lb.deviceId, '');
  assert.equal((await phone(s).lb.board(WEEK)).total, 0);
});

test('deleting without ever joining is a no-op that makes no request', async () => {
  const p = phone(server());
  await p.lb.deleteMyData();
  assert.equal(p.log.length, 0);
});


// ---- reporting and hiding (user-generated names) ----
test('the app learns its own ref from the server, so it can recognise its own row', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  await p.lb.submit(run(15, 'Me'));
  assert.equal(p.Store.lb.myRef, refOf(p.Store.lb.deviceId));
  const q = phone(s); q.lb.optIn();
  await q.lb.board(WEEK);
  assert.equal(q.Store.lb.myRef, '', 'no score yet, so no row to recognise');
});

test('three players reporting a name hides it from everyone; the reporters hid it at once', async () => {
  const s = server();
  const rude = phone(s); rude.lb.optIn();
  await rude.lb.submit(run(40, 'Rude'));
  const nice = phone(s); nice.lb.optIn();
  await nice.lb.submit(run(10, 'Nice'));
  const ref = rude.Store.lb.myRef;
  const reporters = [phone(s), phone(s), phone(s)];
  for (const r of reporters) r.lb.optIn();

  await reporters[0].lb.report(ref, WEEK, 'name');
  assert.equal(reporters[0].lb.isBlocked(ref), true, 'hidden on the reporter at once');
  assert.deepEqual((await reporters[1].lb.board(WEEK)).entries.map((e) => e.name), ['Rude', 'Nice'], 'one report does not hide for others');
  await reporters[1].lb.report(ref, WEEK, 'name');
  await reporters[2].lb.report(ref, WEEK, 'name');
  assert.deepEqual((await nice.lb.board(WEEK)).entries.map((e) => e.name), ['Nice'], 'three reporters hide it for everyone');
});

test('reporting while offline still hides the name on this device', async () => {
  const s = server();
  const rude = phone(s); rude.lb.optIn();
  await rude.lb.submit(run(40, 'Rude'));
  const p = phone(s); p.lb.optIn();
  p.state.offline = true;
  await assert.rejects(() => p.lb.report(rude.Store.lb.myRef, WEEK), (e) => e.code === 'network');
  assert.equal(p.lb.isBlocked(rude.Store.lb.myRef), true);
});

test('hiding is local, persists, accepts only valid refs, and can be undone', () => {
  const p = phone(server());
  p.lb.block('not-a-ref'); p.lb.block(''); p.lb.block(undefined);
  assert.deepEqual(plain(p.lb.blockedRefs()), []);
  p.lb.block('0123456789ab'); p.lb.block('0123456789ab'); p.lb.block('abcdefabcdef');
  assert.deepEqual(plain(p.lb.blockedRefs()), ['0123456789ab', 'abcdefabcdef'], 'no duplicates');
  const again = phone(server(), { storage: p.storage });
  assert.equal(again.lb.isBlocked('abcdefabcdef'), true, 'survives a restart');
  again.lb.unblockAll();
  assert.deepEqual(plain(again.lb.blockedRefs()), []);
  const many = phone(server());
  for (let i = 0; i < 230; i++) many.lb.block(i.toString(16).padStart(12, '0'));
  assert.equal(many.lb.blockedRefs().length, 200, 'the list is bounded to the 200 most recent');
  assert.equal(many.lb.isBlocked((229).toString(16).padStart(12, '0')), true, 'newest kept');
  assert.equal(many.lb.isBlocked((0).toString(16).padStart(12, '0')), false, 'oldest dropped');
});

test('deleting my data also clears the hidden list and my ref', async () => {
  const s = server();
  const p = phone(s); p.lb.optIn();
  await p.lb.submit(run(12, 'Me'));
  p.lb.block('0123456789ab');
  await p.lb.deleteMyData();
  assert.deepEqual(plain(p.lb.blockedRefs()), []);
  assert.equal(p.Store.lb.myRef, '');
});

test('which rows to show: own row is never reportable; hidden players are dropped and counted', () => {
  const { LeaderboardUI } = phone(server()).ctx;
  const data = { entries: [
    { rank: 1, name: 'Ann', score: 30, ref: 'aaaaaaaaaaaa' },
    { rank: 2, name: 'Me', score: 20, ref: 'bbbbbbbbbbbb' },
    { rank: 3, name: 'Rude', score: 10, ref: 'cccccccccccc' }
  ] };
  const view = LeaderboardUI.visibleEntries(data, ['cccccccccccc'], 'bbbbbbbbbbbb');
  assert.deepEqual(plain(view.rows.map((r) => [r.entry.name, r.mine, r.reportable])), [['Ann', false, true], ['Me', true, false]]);
  assert.equal(view.hiddenCount, 1);
  // the server's `you` is used when the app has not stored its ref yet
  const viaYou = LeaderboardUI.visibleEntries({ ...data, you: { ref: 'bbbbbbbbbbbb' } }, [], '');
  assert.equal(viaYou.rows[1].mine, true);
  // you cannot hide yourself, even if your own ref ended up in the list
  const self = LeaderboardUI.visibleEntries(data, ['bbbbbbbbbbbb'], 'bbbbbbbbbbbb');
  assert.equal(self.rows.some((r) => r.mine), true);
  assert.equal(LeaderboardUI.visibleEntries({ entries: [] }, [], '').rows.length, 0);
  assert.equal(LeaderboardUI.visibleEntries(null, [], '').hiddenCount, 0);
});

test('the safety UI exists in the page: name field, rules, report sheet, contact', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['lb-name-input', 'lb-rules-copy', 'lb-sheet', 'btn-sheet-report', 'btn-sheet-hide', 'btn-sheet-cancel', 'btn-lb-unhide', 'lb-contact']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /Offensive names are removed/);
  assert.match(html, /mailto:support@donttapthat\.com/);
});


test('the shipped config points at an https API, and enabling it requires the privacy disclosures', () => {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'leaderboard-config.js'), 'utf8'), ctx);
  const apiBase = ctx.LeaderboardConfig.apiBase;
  if (!apiBase) return; // feature off: nothing to disclose
  assert.match(apiBase, /^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/, 'an https API Gateway URL with no trailing slash');
  const root = path.join(__dirname, '..');
  const policy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
  assert.match(policy, /Optional weekly leaderboard and friend groups/, 'the privacy policy describes the leaderboard');
  assert.match(policy, /report/i);
  assert.match(policy, /Delete my leaderboard data/);
  const manifest = fs.readFileSync(path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
  assert.match(manifest, /NSPrivacyCollectedDataTypeUserID/, 'the privacy manifest declares the user id / display name');
  assert.match(manifest, /NSPrivacyCollectedDataTypeGameplayContent/, '...and the scores');
  const terraform = fs.readFileSync(path.join(root, 'server/terraform/variables.tf'), 'utf8');
  assert.ok(terraform.includes('capacitor://localhost'), 'the API allows the app origin');
});


test('every place that tells players how to reach us uses one address, on a domain we own', () => {
  const root = path.join(__dirname, '..');
  const files = ['index.html', 'privacy.html', 'server/README.md'];
  const found = new Set();
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)) found.add(m[0]);
  }
  assert.deepEqual([...found], ['support@donttapthat.com'], 'one contact address everywhere (tapthat.game is not a real domain)');
});
