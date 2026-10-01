'use strict';
/* build.js — assembles dist/ for deployment:
 *   dist/index.js        Lambda entry (re-exports src/index.js)
 *   dist/src/*.js        server code (no test-only stores needed at runtime, but harmless)
 *   dist/game/*.js       the game's own weekly.js, challenges.js, adaptive.js, so the server
 *                        replays exactly the logic the app ships.
 * Terraform zips dist/. Run:  npm run build   (from server/)
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const GAME_FILES = ['weekly.js', 'challenges.js', 'adaptive.js'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'src'), { recursive: true });
fs.mkdirSync(path.join(dist, 'game'), { recursive: true });

for (const file of fs.readdirSync(path.join(root, 'src'))) {
  fs.copyFileSync(path.join(root, 'src', file), path.join(dist, 'src', file));
}
for (const file of GAME_FILES) {
  fs.copyFileSync(path.join(root, '..', 'js', file), path.join(dist, 'game', file));
}
fs.writeFileSync(path.join(dist, 'index.js'), "'use strict';\nmodule.exports = require('./src/index');\n");
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify({ name: 'tapthat-leaderboard', private: true, main: 'index.js' }, null, 2) + '\n');

console.log('Built dist/ with server code and game files:', GAME_FILES.join(', '));
