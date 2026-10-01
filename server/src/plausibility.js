'use strict';
/* plausibility.js — sanity-checks a submitted weekly run against the replayed sequence.
 *
 * Honest scope: the game runs on the player's device, so a determined cheater can
 * forge a run that passes these checks. This catches the cheap cases (made-up scores,
 * superhuman reaction times, rounds that couldn't have fit in the time limit) and keeps
 * the leaderboard fair for ordinary players. It is a plausibility check, not proof.
 */
const { sequence } = require('./replay');
const { MAX_SCORE } = require('./validate');

const MIN_REACTION_MS = 80;      // faster than this is not a human response
const EARLY_TOLERANCE_MS = 60;   // wait-it-out rounds finish at the limit, within jitter
const LATE_TOLERANCE_MS = 150;   // timer/frame jitter past the nominal limit
const MAX_LIMIT_MS = 10000;

/* rounds[i] = milliseconds from the start of round i to its success.
 * Returns { ok: true } or { ok: false, reason }. */
function checkRun({ weekId, score, rounds }, gameDir) {
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return fail('score out of range');
  if (!Array.isArray(rounds) || rounds.length !== score) return fail('round count does not match score');
  if (!rounds.every((t) => Number.isInteger(t) && t > 0 && t < MAX_LIMIT_MS * 2)) return fail('invalid round time');

  const plan = sequence(weekId, score, gameDir);
  for (let i = 0; i < score; i++) {
    const t = rounds[i];
    const { id, limit, timeoutResult } = plan[i];
    if (timeoutResult === 'success') {
      // won by waiting out the timer (e.g. DON'T tap): must take about the full limit
      if (t < limit - EARLY_TOLERANCE_MS) return fail('round ' + i + ' (' + id + ') finished too early');
    } else if (t < MIN_REACTION_MS) {
      return fail('round ' + i + ' (' + id + ') faster than human reaction');
    }
    if (t > limit + LATE_TOLERANCE_MS) return fail('round ' + i + ' (' + id + ') exceeded its time limit');
  }
  return { ok: true };
}

function fail(reason) { return { ok: false, reason }; }

module.exports = { checkRun, MIN_REACTION_MS, LATE_TOLERANCE_MS, EARLY_TOLERANCE_MS };
