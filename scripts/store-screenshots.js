/* store-screenshots.js — renders App Store screenshots from the real game UI.
 * Output: store-screenshots/6.9-inch/*.png at 1320x2868 (iPhone 6.9"), file order = store order.
 * The FIRST screenshot is also what Apple uses for the iMessage link preview, so it is a
 * bold game round that stays readable at thumbnail size.
 * Needs Google Chrome (macOS). Run: node scripts/store-screenshots.js
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'store-screenshots', '6.9-inch');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dtt-shots-'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 440, H = 956, SCALE = 3; // 1320 x 2868

// A command with several colored buttons reads well even as a small thumbnail.
const pick = (id) => 'Adaptive.pickNext=function(){return Challenges.DEFS.find(function(d){return d.id==="' + id + '"})};';
const scenes = [
  { file: '01-game.png', budget: 1250, js: pick('tapcolor') + 'Store.setName("Corey");document.getElementById("btn-play").click();' +
      'setTimeout(function(){document.getElementById("score").textContent=14;document.getElementById("hud-best").textContent=52;},400);' },
  { file: '02-home.png', js: 'Store.setName("Corey");' },
  { file: '03-game-over.png', js:
      'document.getElementById("final-score").textContent=47;document.getElementById("final-best").textContent=47;' +
      'document.getElementById("over-reason").textContent="Too slow.";' +
      'var nb=document.getElementById("new-best");nb.classList.remove("hidden");UI.show("over");' },
  { file: '04-challenge-a-friend.png', js:
      'document.getElementById("challenge-title").textContent="Sam survived 31 commands.";UI.show("challenge");' }
];

fs.mkdirSync(outDir, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const scene of scenes) {
  const base = '<base href="file://' + root + '/">';
  const safe = '<style>:root{--safe-t:59px;--safe-b:34px}</style>';
  const page = html.replace('<head>', '<head>' + base + safe)
    .replace('</body>', '<script>setTimeout(function(){' + scene.js + '},120)</script></body>');
  const inner = path.join(tmp, scene.file + '.html');
  const outer = path.join(tmp, scene.file + '.outer.html');
  fs.writeFileSync(inner, page);
  fs.writeFileSync(outer, '<body style="margin:0;background:#000;display:flex;justify-content:center"><iframe src="file://' + inner +
    '" style="width:' + W + 'px;height:' + H + 'px;border:0;display:block"></iframe></body>');
  const raw = path.join(tmp, scene.file);
  cp.spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--force-device-scale-factor=' + SCALE, '--window-size=' + Math.max(W, 500) + ',' + H,
    '--virtual-time-budget=' + (scene.budget || 2800), '--screenshot=' + raw, 'file://' + outer], { stdio: 'ignore' });
  // Chrome enforces a minimum window width, so the page is wider than the phone. The phone is
  // centered in it, and sips crops from the center, so a plain center crop is the phone exactly.
  cp.spawnSync('sips', ['--cropToHeightWidth', String(H * SCALE), String(W * SCALE), raw, '--out', path.join(outDir, scene.file)], { stdio: 'ignore' });
}
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of fs.readdirSync(outDir)) {
  const dims = cp.spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(outDir, f)]).stdout.toString().match(/\d+/g);
  console.log(f, dims.slice(-2).join('x'));
}
