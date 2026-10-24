'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, GROUP_MAX_MEMBERS, REPORT_HIDE_THRESHOLD, refOf } = require('../src/handler');
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


// ---- reporting, hiding and bans (user-generated-content safety) ----
const report = (s, who, ref, extra) => s.call('POST', '/v1/report', { ...identity(who), ref, ...(extra || {}) });
const names = async (s) => (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body.entries.map((e) => e.name);

test('leaderboard rows carry an opaque ref, never a device id; it is stable and one-way', async () => {
  const s = setup();
  await submit(s, 'alice', 'Alice', 20);
  const board = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`, undefined, { deviceId: identity('alice').deviceId })).body;
  const ref = board.entries[0].ref;
  assert.match(ref, /^[0-9a-f]{12}$/);
  assert.equal(ref, refOf(identity('alice').deviceId));
  assert.equal(board.you.ref, ref);
  assert.equal(JSON.stringify(board).includes(identity('alice').deviceId), false);
  assert.notEqual(refOf(identity('bob').deviceId), ref);
});

test('three different reporters hide an entry automatically; fewer do not', async () => {
  const s = setup();
  await submit(s, 'rude', 'Rude', 50);
  await submit(s, 'fine', 'Fine', 10);
  const ref = refOf(identity('rude').deviceId);
  assert.equal(REPORT_HIDE_THRESHOLD, 3);
  assert.equal((await report(s, 'r1', ref)).status, 200);
  assert.equal((await report(s, 'r2', ref)).status, 200);
  assert.deepEqual(await names(s), ['Rude', 'Fine'], 'two reports are not enough');
  assert.equal((await report(s, 'r3', ref)).status, 200);
  assert.deepEqual(await names(s), ['Fine'], 'the third distinct reporter hides it');
  const total = (await s.call('GET', `/v1/weeks/${WEEK}/leaderboard`)).body.total;
  assert.equal(total, 1);
});

test('one reporter filing repeatedly counts once', async () => {
  const s = setup();
  await submit(s, 'rude', 'Rude', 50);
  const ref = refOf(identity('rude').deviceId);
  for (let i = 0; i < 6; i++) assert.equal((await report(s, 'spammer', ref)).status, 200);
  assert.deepEqual(await names(s), ['Rude'], 'a single reporter cannot hide someone alone');
});

test('report validation: identity, ref format, self-reports, unknown entries, reasons', async () => {
  const s = setup();
  await submit(s, 'rude', 'Rude', 50);
  const ref = refOf(identity('rude').deviceId);
  assert.equal((await s.call('POST', '/v1/report', { ref })).status, 400, 'needs identity');
  assert.equal((await s.call('POST', '/v1/report', { ...identity('x'), ref: 'nope' })).status, 400);
  assert.equal((await s.call('POST', '/v1/report', { ...identity('x'), ref: 'A'.repeat(12) })).status, 400, 'uppercase is not a ref');
  assert.equal((await report(s, 'rude', ref)).body.error, 'self_report');
  assert.equal((await report(s, 'x', 'abcdef012345')).status, 404, 'unknown entry');
  assert.equal((await report(s, 'x', ref, { reason: 'something-made-up', weekId: 'garbage' })).status, 200, 'bad reason/week fall back safely');
  const thief = await s.call('POST', '/v1/report', { deviceId: identity('x').deviceId, deviceKey: identity('eve').deviceKey, ref });
  assert.equal(thief.status, 401, 'cannot report with someone else\'s device id');
});

test('a hidden player stays hidden when they post again, and their friend-group row is hidden too', async () => {
  const s = setup();
  const code = (await s.call('POST', '/v1/groups', { ...identity('host'), name: 'Host' })).body.code;
  await s.call('POST', `/v1/groups/${code}/join`, { ...identity('rude'), name: 'Rude' });
  await submit(s, 'host', 'Host', 10);
  await submit(s, 'rude', 'Rude', 30);
  const ref = refOf(identity('rude').deviceId);
  for (const who of ['a', 'b', 'c']) await report(s, who, ref);
  assert.deepEqual((await s.call('GET', `/v1/groups/${code}/weeks/${WEEK}`)).body.entries.map((e) => e.name), ['Host']);
  await submit(s, 'rude', 'Rude', 45); // posts a better score after being hidden
  assert.deepEqual(await names(s), ['Host']);
});

test('banned devices cannot post, create or join groups, but can still delete their data', async () => {
  const s = setup();
  const code = (await s.call('POST', '/v1/groups', { ...identity('host'), name: 'Host' })).body.code;
  await submit(s, 'bad', 'Bad', 5);
  await s.store.banDevice(identity('bad').deviceId);
  assert.equal((await submit(s, 'bad', 'Bad', 9)).status, 403);
  assert.equal((await s.call('POST', '/v1/groups', { ...identity('bad'), name: 'Bad' })).status, 403);
  assert.equal((await s.call('POST', `/v1/groups/${code}/join`, { ...identity('bad'), name: 'Bad' })).status, 403);
  assert.equal((await s.call('POST', '/v1/delete', identity('bad'))).status, 200, 'privacy: deletion is always allowed');
  assert.equal((await submit(s, 'good', 'Good', 5)).status, 200, 'other players are unaffected');
});


// ---- CORS (handled in the Lambda: API Gateway cannot allow the iOS app's capacitor://localhost) ----
const APP_ORIGIN = 'capacitor://localhost';
function corsSetup() {
  const store = createMemoryStore();
  const handler = createHandler({ store, now: () => MID_WEEK, log() {}, allowedOrigins: [APP_ORIGIN, 'https://donttapthat.com'] });
  return (method, path, origin, body, headerName) => handler({
    requestContext: { http: { method } }, rawPath: path, body: body ? JSON.stringify(body) : undefined,
    headers: origin ? { [headerName || 'origin']: origin } : {}
  });
}

test('CORS: the iOS app origin is allowed on normal responses', async () => {
  const call = corsSetup();
  const res = await call('GET', '/v1/health', APP_ORIGIN);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], APP_ORIGIN);
  assert.equal(res.headers.vary, 'Origin');
  assert.equal((await call('GET', '/v1/health', 'https://donttapthat.com')).headers['access-control-allow-origin'], 'https://donttapthat.com');
});

test('CORS: the header is added to errors too (otherwise the app could not even read the error)', async () => {
  const call = corsSetup();
  for (const [method, path, body, status] of [
    ['GET', '/v1/nope', null, 404],
    ['POST', '/v1/scores', { deviceId: 'bad' }, 400],
    ['POST', '/v1/report', { deviceId: 'bad' }, 400]
  ]) {
    const res = await call(method, path, APP_ORIGIN, body);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers['access-control-allow-origin'], APP_ORIGIN, path);
  }
});

test('CORS: other origins and requests without an Origin get no allow header', async () => {
  const call = corsSetup();
  assert.equal((await call('GET', '/v1/health', 'https://evil.example')).headers['access-control-allow-origin'], undefined);
  assert.equal((await call('GET', '/v1/health', 'capacitor://other')).headers['access-control-allow-origin'], undefined);
  assert.equal((await call('GET', '/v1/health')).headers['access-control-allow-origin'], undefined, 'curl / server-to-server');
  assert.equal((await call('GET', '/v1/health', 'null')).headers['access-control-allow-origin'], undefined);
  assert.equal((await call('GET', '/v1/health', 'https://donttapthat.com.evil.example')).headers['access-control-allow-origin'], undefined, 'no prefix tricks');
});

test('CORS: preflight is answered for allowed origins and refused for others', async () => {
  const call = corsSetup();
  const ok = await call('OPTIONS', '/v1/scores', APP_ORIGIN);
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.body, '');
  assert.equal(ok.headers['access-control-allow-origin'], APP_ORIGIN);
  assert.match(ok.headers['access-control-allow-methods'], /POST/);
  assert.match(ok.headers['access-control-allow-headers'], /content-type/);
  assert.ok(Number(ok.headers['access-control-max-age']) > 0);
  const refused = await call('OPTIONS', '/v1/scores', 'https://evil.example');
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.headers['access-control-allow-origin'], undefined);
  assert.equal((await call('OPTIONS', '/v1/scores')).statusCode, 403, 'no origin, no preflight');
});

test('CORS: the Origin header is found whatever its capitalization', async () => {
  const call = corsSetup();
  assert.equal((await call('GET', '/v1/health', APP_ORIGIN, null, 'Origin')).headers['access-control-allow-origin'], APP_ORIGIN);
  assert.equal((await call('GET', '/v1/health', APP_ORIGIN, null, 'ORIGIN')).headers['access-control-allow-origin'], APP_ORIGIN);
});

test('CORS: with no allow-list configured nothing is allowed', async () => {
  const handler = createHandler({ store: createMemoryStore(), now: () => MID_WEEK, log() {} });
  const res = await handler({ requestContext: { http: { method: 'GET' } }, rawPath: '/v1/health', headers: { origin: APP_ORIGIN } });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('Terraform passes the same origins to the Lambda that the app needs', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'terraform', 'main.tf'), 'utf8');
  const vars = fs.readFileSync(path.join(__dirname, '..', 'terraform', 'variables.tf'), 'utf8');
  assert.match(main, /ALLOWED_ORIGINS\s*=\s*join\(",", var\.allowed_origins\)/);
  assert.doesNotMatch(main, /cors_configuration/, 'API Gateway rejects capacitor://localhost, so CORS lives in the Lambda');
  assert.ok(vars.includes('"capacitor://localhost"'), 'the iOS app origin is on the list');
});
