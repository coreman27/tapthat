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

const { createHandler } = require('../server/src/handler');
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
  ['storage', 'leaderboard-config', 'weekly', 'leaderboard'].forEach((n) =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', n + '.js'), 'utf8'), ctx, { filename: n + '.js' }));
  if (opts.apiBase !== null) ctx.LeaderboardConfig.apiBase = opts.apiBase === undefined ? API : opts.apiBase;
  return { ctx, lb: ctx.Leaderboard, Store: ctx.Store, log, state, storage };
}

function server() {
  const store = createMemoryStore();
  const handler = createHandler({ store, now: () => NOW, log() {} });
  return { store, handler };
}

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
