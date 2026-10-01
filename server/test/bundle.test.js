'use strict';
/* The deployed bundle must work standalone: no repo js/ folder, no node_modules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { validRounds, identity, event } = require('./helpers');

test('dist bundle replays the game logic from its own copy and accepts a valid run', async () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'build.js')], { stdio: 'pipe' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapthat-bundle-'));
  fs.cpSync(path.join(__dirname, '..', 'dist'), tmp, { recursive: true });
  try {
    // handler and store come from the copy, so a missing ../js would throw
    const { createHandler } = require(path.join(tmp, 'src', 'handler'));
    const { createMemoryStore } = require(path.join(tmp, 'src', 'store-memory'));
    const now = Date.parse('2026-09-30T12:00:00Z');
    const handler = createHandler({ store: createMemoryStore(), now: () => now, log() {} });
    const res = await handler(event('POST', '/v1/scores', {
      ...identity('bundle'), name: 'Bundle', weekId: '2026-W40', score: 25, rounds: validRounds('2026-W40', 25)
    }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).rank, 1);
    assert.ok(fs.existsSync(path.join(tmp, 'game', 'weekly.js')), 'game files are bundled');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bundled game files are byte-identical to the app\'s files (no drift)', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', 'build.js')], { stdio: 'pipe' });
  for (const f of ['weekly.js', 'challenges.js', 'adaptive.js']) {
    assert.equal(
      fs.readFileSync(path.join(__dirname, '..', 'dist', 'game', f), 'utf8'),
      fs.readFileSync(path.join(__dirname, '..', '..', 'js', f), 'utf8'), f);
  }
});
