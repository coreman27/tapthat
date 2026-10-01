'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRun } = require('../src/plausibility');
const { sequence } = require('../src/replay');
const { validRounds } = require('./helpers');

const WEEK = '2026-W40';

test('a legitimate run passes', () => {
  [1, 5, 30, 80].forEach((score) => {
    assert.deepEqual(checkRun({ weekId: WEEK, score, rounds: validRounds(WEEK, score) }), { ok: true }, 'score ' + score);
  });
});

test('score and round count must agree', () => {
  const rounds = validRounds(WEEK, 10);
  assert.equal(checkRun({ weekId: WEEK, score: 11, rounds }).ok, false);
  assert.equal(checkRun({ weekId: WEEK, score: 9, rounds }).ok, false);
  assert.equal(checkRun({ weekId: WEEK, score: 10, rounds: undefined }).ok, false);
  assert.equal(checkRun({ weekId: WEEK, score: 0, rounds: [] }).ok, false);
  assert.equal(checkRun({ weekId: WEEK, score: 501, rounds: new Array(501).fill(300) }).ok, false);
});

test('superhuman reaction times are rejected', () => {
  const rounds = validRounds(WEEK, 12);
  const plan = sequence(WEEK, 12);
  const tapRound = plan.findIndex((r) => r.timeoutResult !== 'success');
  rounds[tapRound] = 20;
  const verdict = checkRun({ weekId: WEEK, score: 12, rounds });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /human/);
});

test('rounds slower than their time limit are rejected', () => {
  const rounds = validRounds(WEEK, 12);
  const plan = sequence(WEEK, 12);
  const i = plan.findIndex((r) => r.timeoutResult !== 'success');
  rounds[i] = plan[i].limit + 1000;
  const verdict = checkRun({ weekId: WEEK, score: 12, rounds });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /time limit/);
});

test('wait-it-out rounds that finish instantly are rejected', () => {
  const plan = sequence(WEEK, 40);
  const i = plan.findIndex((r) => r.timeoutResult === 'success');
  assert.ok(i >= 0, 'the week has a wait-it-out round to test');
  const rounds = validRounds(WEEK, 40);
  rounds[i] = 150;
  const verdict = checkRun({ weekId: WEEK, score: 40, rounds });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /too early/);
});

test('non-integer or absurd round values are rejected', () => {
  const base = validRounds(WEEK, 5);
  [[-1], [0], [1.5], ['300'], [null], [999999]].forEach(([bad]) => {
    const rounds = base.slice(); rounds[2] = bad;
    assert.equal(checkRun({ weekId: WEEK, score: 5, rounds }).ok, false, String(bad));
  });
});

test('a run recorded for one week does not validate for another', () => {
  const rounds = validRounds(WEEK, 40);
  const other = checkRun({ weekId: '2026-W41', score: 40, rounds });
  // times are tied to that week's specific challenge limits; across 40 rounds a mismatch is certain
  assert.equal(other.ok, false);
});
