#!/usr/bin/env node
'use strict';
/* smoke.js — end-to-end check of a DEPLOYED leaderboard API, the way a phone would use it.
 *
 *   node tools/smoke.js https://abc123.execute-api.us-east-1.amazonaws.com
 *
 * It creates a throwaway player, posts a valid run for the current week, reads the board and
 * a friend group back, files and rejects reports, checks that bad requests are refused, then
 * deletes everything it created (even when a check fails). Exit code 1 if anything is wrong.
 */
const crypto = require('crypto');
const { sequence, weekly } = require('../src/replay');

const base = (process.argv[2] || process.env.API_URL || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error('Usage: node tools/smoke.js https://<api-id>.execute-api.<region>.amazonaws.com');
  process.exit(2);
}

const deviceId = crypto.randomUUID();
const deviceKey = crypto.randomBytes(32).toString('base64url');
const me = { deviceId, deviceKey };
const newPlayer = () => ({ deviceId: crypto.randomUUID(), deviceKey: crypto.randomBytes(32).toString('base64url') });
const reporters = [newPlayer(), newPlayer(), newPlayer()];
const week = weekly().weekId(Date.now());
const SCORE = 8;
const rounds = sequence(week, SCORE).map((r) => (r.timeoutResult === 'success' ? r.limit : 320));

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || !detail ? '' : '  -> ' + detail));
};

async function call(method, path, body, query, extraHeaders) {
  const url = base + path + (query ? '?' + new URLSearchParams(query) : '');
  const res = await fetch(url, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(extraHeaders || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
  return { status: res.status, body: json, headers: res.headers };
}

(async () => {
  console.log('Smoke test: ' + base + '  (week ' + week + ')');
  try {
    const health = await call('GET', '/v1/health');
    check(health.status === 200 && health.body.ok === true, 'health endpoint');

    // The iOS app runs at capacitor://localhost; without these headers it could not read any response.
    const pre = await call('OPTIONS', '/v1/scores', null, null, { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' });
    check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'capacitor://localhost', 'CORS preflight allows the iOS app', 'status ' + pre.status + ', header ' + pre.headers.get('access-control-allow-origin'));
    const withOrigin = await call('GET', '/v1/health', null, null, { origin: 'capacitor://localhost' });
    check(withOrigin.headers.get('access-control-allow-origin') === 'capacitor://localhost', 'responses carry the allow-origin header for the app');
    const evil = await call('OPTIONS', '/v1/scores', null, null, { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
    check(evil.status !== 204 && !evil.headers.get('access-control-allow-origin'), 'other origins are not allowed', 'status ' + evil.status);

    const unknown = await call('GET', '/v1/definitely-not-a-route');
    check(unknown.status === 404, 'unknown route is 404', 'got ' + unknown.status);

    const bad = await call('POST', '/v1/scores', { deviceId: 'nope', deviceKey: 'short' });
    check(bad.status === 400, 'malformed identity is rejected', 'got ' + bad.status);

    const cheat = await call('POST', '/v1/scores', { ...me, name: 'Smoke', weekId: week, score: SCORE, rounds: rounds.map(() => 5) });
    check(cheat.status === 422, 'superhuman reaction times are rejected', 'got ' + cheat.status);

    const posted = await call('POST', '/v1/scores', { ...me, name: 'Smoke Test', weekId: week, score: SCORE, rounds });
    check(posted.status === 200 && posted.body.ok, 'a valid run is accepted', 'got ' + posted.status + ' ' + JSON.stringify(posted.body));
    const myRef = posted.body.ref;
    check(/^[0-9a-f]{12}$/.test(myRef || ''), 'the response includes an opaque ref');

    const board = await call('GET', `/v1/weeks/${week}/leaderboard`, null, { deviceId });
    const row = (board.body.entries || []).find((e) => e.ref === myRef);
    check(board.status === 200 && !!row && row.name === 'Smoke Test' && row.score === SCORE, 'the board shows the name and score', JSON.stringify(board.body).slice(0, 200));
    check(board.body.you && board.body.you.ref === myRef, 'the board reports your own row');
    check(!JSON.stringify(board.body).includes(deviceId), 'no device id appears in responses');
    check(board.headers.get('cache-control') === 'no-store', 'responses are not cached');

    const group = await call('POST', '/v1/groups', { ...me, name: 'Smoke Test' });
    check(group.status === 201 && /^[A-HJ-NP-Z2-9]{6}$/.test(group.body.code || ''), 'a friend group can be created');
    if (group.body.code) {
      const gb = await call('GET', `/v1/groups/${group.body.code}/weeks/${week}`);
      check(gb.status === 200 && (gb.body.entries || []).some((e) => e.ref === myRef), 'the group board shows the player');
    }

    const selfReport = await call('POST', '/v1/report', { ...me, ref: myRef });
    check(selfReport.status === 400, 'you cannot report yourself', 'got ' + selfReport.status);

    const first = await call('POST', '/v1/report', { ...reporters[0], ref: myRef, reason: 'name', weekId: week });
    check(first.status === 200, 'another player can report an entry', 'got ' + first.status);
    const again = await call('POST', '/v1/report', { ...reporters[0], ref: myRef });
    check(again.status === 200, 'the same player reporting again is accepted but counts once');
    const afterOne = await call('GET', `/v1/weeks/${week}/leaderboard`);
    check((afterOne.body.entries || []).some((e) => e.ref === myRef), 'one reporter alone does not hide the entry');

    await call('POST', '/v1/report', { ...reporters[1], ref: myRef });
    const afterTwo = await call('GET', `/v1/weeks/${week}/leaderboard`);
    check((afterTwo.body.entries || []).some((e) => e.ref === myRef), 'two reporters do not hide it yet');

    await call('POST', '/v1/report', { ...reporters[2], ref: myRef });
    const afterThree = await call('GET', `/v1/weeks/${week}/leaderboard`);
    check(!(afterThree.body.entries || []).some((e) => e.ref === myRef), 'three different reporters hide the entry for everyone');
    const groupAfter = group.body.code ? await call('GET', `/v1/groups/${group.body.code}/weeks/${week}`) : { body: {} };
    check(!(groupAfter.body.entries || []).some((e) => e.ref === myRef), 'it is hidden on the friend group board too');
    const repost = await call('POST', '/v1/scores', { ...me, name: 'Smoke Test', weekId: week, score: SCORE + 1, rounds: sequence(week, SCORE + 1).map((r) => (r.timeoutResult === 'success' ? r.limit : 320)) });
    const afterRepost = await call('GET', `/v1/weeks/${week}/leaderboard`);
    check(repost.status === 200 && !(afterRepost.body.entries || []).some((e) => e.ref === myRef), 'a hidden player stays hidden when they post again');

    const thief = await call('POST', '/v1/scores', { deviceId, deviceKey: crypto.randomBytes(32).toString('base64url'), name: 'x', weekId: week, score: SCORE, rounds });
    check(thief.status === 401, 'someone else cannot post as this device', 'got ' + thief.status);
  } catch (error) {
    failures++;
    console.log('  FAIL unexpected error: ' + error.message);
  } finally {
    for (const r of reporters) await call('POST', '/v1/delete', r).catch(() => null);
    const del = await call('POST', '/v1/delete', me).catch(() => ({ status: 0 }));
    check(del.status === 200, 'cleanup: the test player and its data are deleted', 'got ' + del.status);
    const after = await call('GET', `/v1/weeks/${week}/leaderboard`).catch(() => ({ body: {} }));
    check(!(after.body.entries || []).some((e) => e.name === 'Smoke Test'), 'cleanup: the entry is gone from the board');
  }
  console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
