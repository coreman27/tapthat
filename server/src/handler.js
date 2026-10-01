'use strict';
/* handler.js — HTTP API for weekly leaderboards and friend groups.
 * Framework-free: createHandler({ store }) returns an async function that takes an
 * API Gateway HTTP API (v2) event and returns { statusCode, headers, body }.
 *
 * Identity is anonymous: the app generates a random device id and a secret device key.
 * The server remembers a hash of the first key it sees per device id; later requests
 * must present the same key. No accounts, emails, or real names are involved.
 */
const crypto = require('crypto');
const v = require('./validate');
const { checkRun } = require('./plausibility');
const { weekly } = require('./replay');

const MAX_BODY_BYTES = 16 * 1024;
const GROUP_MAX_MEMBERS = 50;
const LEADERBOARD_DEFAULT = 25;
const LEADERBOARD_MAX = 100;
const ROLLOVER_GRACE_MS = 6 * 60 * 60 * 1000; // a run started just before reset may still post

function createHandler(deps) {
  const store = deps.store;
  const now = deps.now || Date.now;
  const randomInt = deps.randomInt || ((n) => crypto.randomInt(n));
  const gameDir = deps.gameDir;
  const log = deps.log || ((...args) => console.error(...args));

  const respond = (statusCode, payload) => ({
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(payload)
  });
  const bad = (status, error, message) => respond(status, { ok: false, error, message });

  const keyHash = (key) => crypto.createHash('sha256').update(key).digest('hex');

  // The week a score may be posted to: this week, or last week for a short grace period.
  function acceptedWeeks() {
    const W = weekly(gameDir);
    const t = now();
    return new Set([W.weekId(t), W.weekId(t - ROLLOVER_GRACE_MS)]);
  }

  async function authenticate(body) {
    if (!v.isDeviceId(body.deviceId) || !v.isDeviceKey(body.deviceKey)) {
      return bad(400, 'bad_identity', 'Missing or malformed device credentials.');
    }
    const ok = await store.authDevice(body.deviceId, keyHash(body.deviceKey));
    return ok ? null : bad(401, 'unauthorized', 'Device key does not match.');
  }

  function parseBody(event) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { error: bad(413, 'too_large', 'Request body too large.') };
    if (!raw) return { value: {} };
    try {
      const value = JSON.parse(raw);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
      return { value };
    } catch (e) {
      return { error: bad(400, 'bad_json', 'Body must be a JSON object.') };
    }
  }

  async function postScore(body) {
    const denied = await authenticate(body);
    if (denied) return denied;
    if (!v.isWeekId(body.weekId)) return bad(400, 'bad_week', 'Invalid week.');
    if (!acceptedWeeks().has(body.weekId)) return bad(409, 'week_closed', 'That week is not open for scores.');
    if (!v.isScore(body.score)) return bad(400, 'bad_score', 'Invalid score.');

    const verdict = checkRun({ weekId: body.weekId, score: body.score, rounds: body.rounds }, gameDir);
    if (!verdict.ok) return bad(422, 'implausible_run', 'This run could not be verified.');

    const name = v.sanitizeName(body.name, body.deviceId);
    const result = await store.putScore({
      weekId: body.weekId, deviceId: body.deviceId, name, score: body.score, ts: now()
    });
    const [rank, total] = await Promise.all([
      store.rankOf(body.weekId, result.best),
      store.countScores(body.weekId)
    ]);
    return respond(200, { ok: true, improved: result.improved, best: result.best, rank, total, name });
  }

  async function getLeaderboard(weekId, query) {
    if (!v.isWeekId(weekId)) return bad(400, 'bad_week', 'Invalid week.');
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || LEADERBOARD_DEFAULT, 1), LEADERBOARD_MAX);
    const [top, total] = await Promise.all([store.topScores(weekId, limit), store.countScores(weekId)]);
    const entries = top.map((e, i) => ({ rank: rankFor(top, i), name: e.name, score: e.score }));
    const payload = { ok: true, weekId, total, entries };
    if (v.isDeviceId(query.deviceId)) {
      const mine = await store.getScore(weekId, query.deviceId);
      if (mine) payload.you = { name: mine.name, score: mine.score, rank: await store.rankOf(weekId, mine.score) };
    }
    return respond(200, payload);
  }

  // Ties share a rank (competition ranking): [9,7,7,5] -> 1,2,2,4
  function rankFor(sorted, index) {
    let first = index;
    while (first > 0 && sorted[first - 1].score === sorted[index].score) first--;
    return first + 1;
  }

  async function postGroup(body) {
    const denied = await authenticate(body);
    if (denied) return denied;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = v.randomGroupCode(randomInt);
      if (await store.createGroup({ code, owner: body.deviceId, createdAt: now() })) {
        await store.addMember({
          code, deviceId: body.deviceId, name: v.sanitizeName(body.name, body.deviceId), joinedAt: now()
        });
        return respond(201, { ok: true, code });
      }
    }
    return bad(503, 'busy', 'Could not create a group. Try again.');
  }

  async function joinGroup(code, body) {
    const denied = await authenticate(body);
    if (denied) return denied;
    if (!v.isGroupCode(code)) return bad(400, 'bad_code', 'Invalid group code.');
    if (!(await store.getGroup(code))) return bad(404, 'no_group', 'No group with that code.');
    const members = await store.listMembers(code);
    const already = members.some((m) => m.deviceId === body.deviceId);
    if (!already && members.length >= GROUP_MAX_MEMBERS) return bad(409, 'group_full', 'That group is full.');
    await store.addMember({
      code, deviceId: body.deviceId, name: v.sanitizeName(body.name, body.deviceId), joinedAt: now()
    });
    return respond(200, { ok: true, members: already ? members.length : members.length + 1 });
  }

  async function getGroupBoard(code, weekId) {
    if (!v.isGroupCode(code)) return bad(400, 'bad_code', 'Invalid group code.');
    if (!v.isWeekId(weekId)) return bad(400, 'bad_week', 'Invalid week.');
    if (!(await store.getGroup(code))) return bad(404, 'no_group', 'No group with that code.');
    const [scores, members] = await Promise.all([store.groupScores(code, weekId), store.listMembers(code)]);
    const entries = scores.map((e, i) => ({ rank: rankFor(scores, i), name: e.name, score: e.score }));
    return respond(200, { ok: true, code, weekId, members: members.length, entries });
  }

  async function postDelete(body) {
    const denied = await authenticate(body);
    if (denied) return denied;
    await store.deleteDevice(body.deviceId);
    return respond(200, { ok: true });
  }

  return async function handler(event) {
    try {
      const method = ((event.requestContext && event.requestContext.http && event.requestContext.http.method) || event.httpMethod || '').toUpperCase();
      const path = (event.rawPath || event.path || '').replace(/\/+$/, '') || '/';
      const query = event.queryStringParameters || {};

      if (method === 'GET' && path === '/v1/health') return respond(200, { ok: true });

      let m;
      if (method === 'GET' && (m = path.match(/^\/v1\/weeks\/([^/]+)\/leaderboard$/))) {
        return await getLeaderboard(decodeURIComponent(m[1]), query);
      }
      if (method === 'GET' && (m = path.match(/^\/v1\/groups\/([^/]+)\/weeks\/([^/]+)$/))) {
        return await getGroupBoard(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      }
      if (method === 'POST') {
        const parsed = parseBody(event);
        if (parsed.error) return parsed.error;
        if (path === '/v1/scores') return await postScore(parsed.value);
        if (path === '/v1/groups') return await postGroup(parsed.value);
        if (path === '/v1/delete') return await postDelete(parsed.value);
        if ((m = path.match(/^\/v1\/groups\/([^/]+)\/join$/))) return await joinGroup(decodeURIComponent(m[1]), parsed.value);
      }
      return bad(404, 'not_found', 'Unknown route.');
    } catch (error) {
      log('leaderboard handler error', error);
      return bad(500, 'server_error', 'Something went wrong.');
    }
  };
}

module.exports = { createHandler, GROUP_MAX_MEMBERS };
