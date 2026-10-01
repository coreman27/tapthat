'use strict';
/* replay.js — rebuilds a weekly run's challenge sequence on the server.
 * It loads the game's own weekly.js, challenges.js and adaptive.js (copied in by
 * build.js, so there is one source of truth) in a vm sandbox and replays the seeded
 * selection. This yields each round's challenge id and time limit, which the
 * plausibility check compares against the reaction times the client reports.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULES = ['weekly', 'challenges', 'adaptive'];

function defaultGameDir() {
  // Deployed bundle: <root>/src/replay.js with the game copied to <root>/game (see build.js).
  // From source (tests): the repo's js/ folder.
  const bundled = path.join(__dirname, '..', 'game');
  return fs.existsSync(path.join(bundled, 'weekly.js')) ? bundled : path.join(__dirname, '..', '..', 'js');
}

function loadGame(gameDir) {
  const dir = gameDir || defaultGameDir();
  const ctx = { console, Store: { stats: {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  MODULES.forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(dir, name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  });
  return ctx;
}

let cached;
function game(gameDir) {
  if (gameDir) return loadGame(gameDir);
  if (!cached) cached = loadGame();
  return cached;
}

/* Returns [{ id, category, limit }] for rounds 0..count-1, assuming every earlier
 * round succeeded (round r is played at score r). */
function sequence(weekId, count, gameDir) {
  const ctx = game(gameDir);
  const out = [];
  let last = null;
  for (let round = 0; round < count; round++) {
    const rng = ctx.Weekly.rngFor(weekId, round);
    const def = ctx.Adaptive.pickNext(round, last, { rand: rng, fixed: true });
    last = def.id;
    out.push({
      id: def.id,
      category: def.category,
      limit: ctx.Adaptive.timeLimit(def, round),
      timeoutResult: typeof def.timeoutResult === 'function' ? 'dynamic' : (def.timeoutResult || 'fail')
    });
  }
  return out;
}

/* The game's own week logic, so server and client always agree on week boundaries. */
function weekly(gameDir) { return game(gameDir).Weekly; }

module.exports = { sequence, loadGame, weekly };
