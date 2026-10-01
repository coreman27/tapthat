'use strict';
const crypto = require('crypto');
const { sequence } = require('../src/replay');

/* A run of `score` successful rounds that passes the plausibility check. */
function validRounds(weekId, score) {
  return sequence(weekId, score).map((r) => (r.timeoutResult === 'success' ? r.limit : 300));
}

function identity(seed) {
  const bytes = crypto.createHash('sha256').update(String(seed)).digest();
  const hex = bytes.toString('hex');
  // v4-shaped UUID derived from the seed so tests are deterministic
  const deviceId = [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
  const deviceKey = bytes.toString('base64url').padEnd(43, 'x');
  return { deviceId, deviceKey };
}

/* API Gateway HTTP API (v2) event */
function event(method, path, body, query) {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    queryStringParameters: query || undefined,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

module.exports = { validRounds, identity, event };
