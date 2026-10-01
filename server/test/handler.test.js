'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, GROUP_MAX_MEMBERS } = require('../src/handler');
const { createMemoryStore } = require('../src/store-memory');
const { validRounds, identity, event } = require('./helpers');

const WEEK = '2026-W40';
const MID_WEEK = Date.parse('2026-09-30T12:00:00Z');   // Wednesday of W40
const MONDAY_3AM = Date.parse('2026-10-05T03:00:00Z'); // W41, 3h after reset
const MONDAY_9AM = Date.parse('2026-10-05T09:00:00Z'); // W41, 9h after reset

function setup(nowMs) {
  const clock = { now: nowMs || MID_WEEK };
  const store = createMemoryStore();
  let n = 0;
  const handler = createHandler({ store, now: () => clock.now, randomInt: (max) => (n++ * 7) % max, log() {} });
  const call = async (method, path, body, query) => {
    const res = await handler(event(method, path, body, query));
    return { status: res.statusCode, body: JSON.parse(res.body), headers: res.headers };
  };
  return { call, clock, store };
}

const submit = (s, who, name, score, week) => s.call('POST', '/v1/scores', {
  ...identity(who), name, weekId: week || WEEK, score, rounds: validRounds(week || WEEK, score)
});

test('health check and unknown routes', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/v1/health')).status, 200);
  assert.equal((await s.call('GET', '/v1/nope')).status, 404);
  assert.equal((await s.call('DELETE', '/v1/scores')).status, 404);
});

test('submitting a valid score returns rank and total', async () => {
  const s = setup();
  const a = await submit(s, 'alice', 'Alice', 20);
  assert.equal(a.status, 200);
  assert.deepEqual({ ok: a.body.ok, improved: a.body.improved, best: a.body.best, rank: a.body.rank, total: a.body.total },
    { ok: true, improved: true, best: 20, rank: 1, total: 1 });
  const b = await submit(s, 'bob', 'Bob', 30);
  assert.equal(b.body.rank, 1);
  assert.equal(b.body.total, 2);
  const a2 = await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`, undefined, { deviceId: identity('alice').deviceId });
  assert.equal(a2.body.you.rank, 2, 'alice dropped to second');
  assert.equal(a2.headers['cache-control'], 'no-store');
});

test('only a device\'s best score counts; lower scores do not replace it', async () => {
  const s = setup();
  await submit(s, 'alice', 'Alice', 25);
  const worse = await submit(s, 'alice', 'Alice', 10);
  assert.equal(worse.body.improved, false);
  assert.equal(worse.body.best, 25);
  const better = await submit(s, 'alice', 'Alice', 26);
  assert.equal(better.body.improved, true);
  assert.equal((await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body.total, 1);
});

test('leaderboard orders by score, shares ranks on ties, and hides device ids', async () => {
  const s = setup();
  await submit(s, 'a', 'Ann', 30);
  await submit(s, 'b', 'Ben', 20);
  await submit(s, 'c', 'Cat', 20);
  await submit(s, 'd', 'Dan', 10);
  const board = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body;
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score]),
    [[1, 'Ann', 30], [2, 'Ben', 20], [2, 'Cat', 20], [4, 'Dan', 10]]);
  assert.equal(board.total, 4);
  assert.equal(JSON.stringify(board).includes(identity('a').deviceId), false, 'no device ids in responses');
  const limited = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`, undefined, { limit: '2' })).body;
  assert.equal(limited.entries.length, 2);
});

test('implausible runs are rejected and never stored', async () => {
  const s = setup();
  const rounds = validRounds(WEEK, 15);
  rounds[3] = 5;
  const cheat = await s.call('POST', '/v1/scores', { ...identity('mallory'), name: 'Mal', weekId: WEEK, score: 15, rounds });
  assert.equal(cheat.status, 422);
  assert.equal(cheat.body.error, 'implausible_run');
  const noProof = await s.call('POST', '/v1/scores', { ...identity('mallory'), name: 'Mal', weekId: WEEK, score: 500 });
  assert.equal(noProof.status, 422);
  assert.equal((await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body.total, 0);
});

test('a stolen device id without the key cannot post or overwrite', async () => {
  const s = setup();
  await submit(s, 'alice', 'Alice', 20);
  const thief = await s.call('POST', '/v1/scores', {
    deviceId: identity('alice').deviceId, deviceKey: identity('eve').deviceKey,
    name: 'Eve', weekId: WEEK, score: 20, rounds: validRounds(WEEK, 20)
  });
  assert.equal(thief.status, 401);
  assert.equal((await s.call('POST', '/v1/delete', { deviceId: identity('alice').deviceId, deviceKey: identity('eve').deviceKey })).status, 401);
});

test('malformed identity, week, score and bodies are rejected', async () => {
  const s = setup();
  const good = { ...identity('x'), name: 'X', weekId: WEEK, score: 5, rounds: validRounds(WEEK, 5) };
  assert.equal((await s.call('POST', '/v1/scores', { ...good, deviceId: 'nope' })).status, 400);
  assert.equal((await s.call('POST', '/v1/scores', { ...good, deviceKey: 'short' })).status, 400);
  assert.equal((await s.call('POST', '/v1/scores', { ...good, weekId: 'last-week' })).status, 400);
  assert.equal((await s.call('POST', '/v1/scores', { ...good, score: -3 })).status, 400);
  const raw = await createHandler({ store: s.store, now: () => MID_WEEK, log() {} })({
    requestContext: { http: { method: 'POST' } }, rawPath: '/v1/scores', body: '{not json'
  });
  assert.equal(raw.statusCode, 400);
  const huge = await createHandler({ store: s.store, now: () => MID_WEEK, log() {} })({
    requestContext: { http: { method: 'POST' } }, rawPath: '/v1/scores', body: 'x'.repeat(20000)
  });
  assert.equal(huge.statusCode, 413);
});

test('only the current week is open, with a short grace after the Monday reset', async () => {
  const s = setup();
  assert.equal((await submit(s, 'a', 'Ann', 5, '2026-W41')).status, 409, 'future week is closed');
  assert.equal((await submit(s, 'a', 'Ann', 5, '2026-W39')).status, 409, 'old week is closed');
  s.clock.now = MONDAY_3AM;
  assert.equal((await submit(s, 'a', 'Ann', 5, WEEK)).status, 200, 'previous week accepted in the grace window');
  assert.equal((await submit(s, 'a', 'Ann', 5, '2026-W41')).status, 200);
  s.clock.now = MONDAY_9AM;
  assert.equal((await submit(s, 'b', 'Ben', 5, WEEK)).status, 409, 'grace window over');
});

test('display names are sanitized before they are stored', async () => {
  const s = setup();
  await submit(s, 'a', '<b>Ann</b>', 5);
  await submit(s, 'b', 'f.u.c.k', 6);
  const entries = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body.entries;
  assert.deepEqual(entries.map((e) => e.name).filter((n) => n === 'bAnnb'), ['bAnnb']);
  assert.ok(entries.some((e) => /^Player\d{4}$/.test(e.name)));
});

test('friend groups: create, join, compare, and capacity', async () => {
  const s = setup();
  const created = await s.call('POST', '/v1/groups', { ...identity('host'), name: 'Host' });
  assert.equal(created.status, 201);
  const code = created.body.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);

  assert.equal((await s.call('POST', `/v1/groups/${code}/join`, { ...identity('guest'), name: 'Guest' })).body.members, 2);
  assert.equal((await s.call('POST', `/v1/groups/${code}/join`, { ...identity('guest'), name: 'Guest' })).body.members, 2, 'rejoining is idempotent');
  assert.equal((await s.call('POST', '/v1/groups/ZZZZZZ/join', { ...identity('guest'), name: 'G' })).status, 404);
  assert.equal((await s.call('POST', '/v1/groups/bad/join', { ...identity('guest'), name: 'G' })).status, 400);

  await submit(s, 'host', 'Host', 12);
  await submit(s, 'guest', 'Guest', 18);
  await submit(s, 'stranger', 'Stranger', 99); // not in the group
  const board = (await s.call('GET', `/v1/groups/${code}/weeks/${WEEK}`)).body;
  assert.deepEqual(board.entries.map((e) => [e.rank, e.name, e.score]), [[1, 'Guest', 18], [2, 'Host', 12]]);
  assert.equal(board.members, 2);
  assert.equal((await s.call('GET', `/v1/groups/ZZZZZZ/weeks/${WEEK}`)).status, 404);
});

test('groups cap membership', async () => {
  const s = setup();
  const code = (await s.call('POST', '/v1/groups', { ...identity('host'), name: 'Host' })).body.code;
  for (let i = 1; i < GROUP_MAX_MEMBERS; i++) {
    assert.equal((await s.call('POST', `/v1/groups/${code}/join`, { ...identity('m' + i), name: 'M' + i })).status, 200);
  }
  const overflow = await s.call('POST', `/v1/groups/${code}/join`, { ...identity('late'), name: 'Late' });
  assert.equal(overflow.status, 409);
  assert.equal(overflow.body.error, 'group_full');
  // existing members can still rejoin at capacity
  assert.equal((await s.call('POST', `/v1/groups/${code}/join`, { ...identity('m1'), name: 'M1' })).status, 200);
});

test('deleting a device removes its scores and memberships', async () => {
  const s = setup();
  const code = (await s.call('POST', '/v1/groups', { ...identity('host'), name: 'Host' })).body.code;
  await submit(s, 'host', 'Host', 12);
  await submit(s, 'other', 'Other', 8);
  const del = await s.call('POST', '/v1/delete', identity('host'));
  assert.equal(del.status, 200);
  const board = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body;
  assert.deepEqual(board.entries.map((e) => e.name), ['Other']);
  assert.equal((await s.call('GET', `/v1/groups/${code}/weeks/${WEEK}`)).body.members, 0);
});

test('unexpected store failures return a generic 500 without leaking details', async () => {
  const store = createMemoryStore();
  store.authDevice = async () => { throw new Error('secret table name: prod-scores'); };
  const handler = createHandler({ store, now: () => MID_WEEK, log() {} });
  const res = await handler(event('POST', '/v1/scores', { ...identity('x'), weekId: WEEK, score: 5, rounds: validRounds(WEEK, 5) }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.includes('secret'), false);
});
