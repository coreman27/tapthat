/* sync-www.js — assemble the static web build into www/ for Capacitor.
 * The project source lives at the repo root (so it's easy to serve as a PWA);
 * Capacitor needs a clean webDir with no node_modules, which this produces.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');

const ITEMS = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'icons'
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copy(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).forEach(function (name) { copy(path.join(src, name), path.join(dst, name)); });
  } else {
    fs.copyFileSync(src, dst);
  }
}

rmrf(out);
fs.mkdirSync(out, { recursive: true });
ITEMS.forEach(function (item) {
  const src = path.join(root, item);
  if (fs.existsSync(src)) copy(src, path.join(out, item));
});
console.log('Built www/ with:', ITEMS.join(', '));
