/* adaptive.js — picks the next challenge.
 * Unlock by score, then weight selection toward categories the player fails most.
 * This is the "it learns what you're bad at" engine.
 */
(function (global) {
  'use strict';

  function unlocked(score) {
    return Challenges.DEFS.filter(function (d) { return score >= d.minScore; });
  }

  // weight for a def based on the player's fail rate in its category
  function weightFor(def) {
    var s = Store.stats[def.category] || { plays: 0, fails: 0 };
    var rate = s.plays > 0 ? s.fails / s.plays : 0;
    // base 1, plus up to ~4x for high fail-rate categories, plus a nudge per raw fail
    return 1 + rate * 4 + Math.min(s.fails, 6) * 0.35;
  }

  function pickNext(score, lastId) {
    var pool = unlocked(score);
    if (pool.length === 0) pool = [Challenges.DEFS[0]];

    // avoid immediate repeat when we can
    var candidates = pool.filter(function (d) { return d.id !== lastId; });
    if (candidates.length === 0) candidates = pool;

    // Early game: keep it gentle & mostly the basics so players learn the loop
    if (score < 3) {
      var basics = candidates.filter(function (d) {
        return d.category === 'tap' || d.category === 'wait' || d.category === 'color';
      });
      if (basics.length) candidates = basics;
    }

    var weights = candidates.map(weightFor);
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var r = Math.random() * total;
    for (var i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // difficulty ramps 0 -> 1 as score climbs; hits ~1 around score 45
  function difficulty(score) {
    return Math.max(0, Math.min(1, score / 45));
  }

  // time limit in ms for a given def + score
  function timeLimit(def, score) {
    var t = difficulty(score);
    var ms = def.baseTime + (def.minTime - def.baseTime) * t;
    return Math.round(ms);
  }

  global.Adaptive = {
    pickNext: pickNext,
    difficulty: difficulty,
    timeLimit: timeLimit
  };
})(window);
