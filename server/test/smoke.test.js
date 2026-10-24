'use strict';
/* The deployed-API smoke script, run against the real handler over real HTTP (in-process), so a
   failure against the live API means the deployment is wrong, not the script. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createHandler } = require('../src/handler');
const { createMemoryStore } = require('../src/store-memory');

function serve(store) {
  const handler = createHandler({ store, log() {}, allowedOrigins: ['capacitor://localhost', 'https://donttapthat.com'] });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url, 'http://localhost');
    const out = await handler({
      requestContext: { http: { method: req.method } }, rawPath: url.pathname, headers: req.headers,
      queryStringParameters: Object.fromEntries(url.searchParams), body: Buffer.concat(chunks).toString() || undefined
    });
    res.writeHead(out.statusCode, out.headers);
    res.end(out.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const run = (url) => new Promise((resolve) => {
  execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'smoke.js'), url], { timeout: 30000 },
    (error, stdout) => resolve({ code: error ? error.code : 0, stdout }));
});

test('smoke script passes against a correct API and leaves nothing behind', async () => {
  const store = createMemoryStore();
  const server = await serve(store);
  try {
    const { code, stdout } = await run('http://127.0.0.1:' + server.address().port);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /All checks passed/);
    assert.match(stdout, /cleanup: the test player and its data are deleted/);
    const week = require('../src/replay').weekly().weekId(Date.now());
    assert.equal(await store.countScores(week), 0, 'the throwaway player is gone');
  } finally { server.close(); }
});

test('smoke script fails loudly against a broken API', async () => {
  const store = createMemoryStore();
  store.putScore = async () => { throw new Error('table missing'); }; // simulates a misconfigured deployment
  const server = await serve(store);
  try {
    const { code, stdout } = await run('http://127.0.0.1:' + server.address().port);
    assert.equal(code, 1, 'non-zero exit');
    assert.match(stdout, /FAIL a valid run is accepted/);
    assert.match(stdout, /check\(s\) FAILED/);
  } finally { server.close(); }
});

test('smoke script refuses plain-http remote URLs', async () => {
  const { code, stdout } = await run('http://example.com');
  assert.equal(code, 2);
  assert.equal(stdout, '');
});
