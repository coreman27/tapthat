/* themes.test.js — cosmetic themes stay presentation-only and legible.
 * Run: node --test scripts/themes.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const css = read('css/styles.css');

function load(names, extra) {
  const ctx = Object.assign({ console }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  names.forEach((n) => vm.runInContext(read('js/' + n + '.js'), ctx, { filename: n + '.js' }));
  return ctx;
}

// ---- CSS helpers ----
function tokens(block) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}
function rootTokens() {
  const m = css.match(/:root\s*\{([^}]*)\}/);
  return tokens(m[1]);
}
function themeTokens(id) {
  const m = css.match(new RegExp(':root\\[data-theme="' + id + '"\\]\\s*\\{([^}]*)\\}'));
  return m ? tokens(m[1]) : null;
}

// ---- WCAG contrast ----
function lum(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GAMEPLAY = ['--red', '--green', '--blue', '--yellow', '--purple'];
const CORE = ['--bg', '--bg2', '--fg', '--muted', '--accent', '--accent2', '--bg-glow',
  '--line', '--line2', '--panel', '--panel2', '--title-glow', '--font'];

const { Themes } = load(['themes']);
const ids = Themes.LIST.filter((t) => t.id !== 'default').map((t) => t.id);

test('every listed theme has a complete CSS token block', () => {
  assert.ok(ids.length >= 2 && ids.length <= 3, 'ship only 2-3 initial themes');
  ids.forEach((id) => {
    const t = themeTokens(id);
    assert.ok(t, id + ' has a CSS block');
    CORE.forEach((k) => assert.ok(t[k], id + ' defines ' + k));
  });
});

test('no theme overrides the gameplay colors or unlisted themes exist', () => {
  ids.forEach((id) => {
    const t = themeTokens(id);
    GAMEPLAY.forEach((k) => assert.equal(t[k], undefined, id + ' must not override ' + k));
  });
  const declared = [...css.matchAll(/:root\[data-theme="([a-z0-9-]+)"\]\s*\{/g)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...ids].sort(), 'CSS themes match the registry');
});

test('text, accents and gameplay colors stay legible on every theme background', () => {
  const base = rootTokens();
  const all = [{ id: 'default', t: base }].concat(ids.map((id) => ({ id, t: Object.assign({}, base, themeTokens(id)) })));
  all.forEach(({ id, t }) => {
    assert.ok(contrast(t['--fg'], t['--bg']) >= 7, id + ': body text contrast >= 7:1');
    assert.ok(contrast(t['--muted'], t['--bg']) >= 4.5, id + ': muted text contrast >= 4.5:1');
    assert.ok(contrast(t['--accent'], t['--bg']) >= 3, id + ': accent contrast >= 3:1');
    assert.ok(contrast(t['--fg'], t['--panel']) >= 7, id + ': text on panels >= 7:1');
    GAMEPLAY.forEach((k) =>
      assert.ok(contrast(t[k], t['--bg']) >= 3, id + ': ' + k + ' distinguishable from the background (>= 3:1)'));
  });
});

test('default theme tokens keep the original look', () => {
  const t = rootTokens();
  assert.equal(t['--bg'], '#0b0b12');
  assert.equal(t['--bg-glow'], '#1c1c2e');
  assert.equal(t['--line'], '#2a2a3d');
  assert.equal(t['--panel'], '#1d1d2b');
});

function fakeDocument() {
  const attrs = {};
  return {
    attrs,
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; }
    }
  };
}

test('apply sets data-theme, falls back to default for unknown ids, clears for default', () => {
  const document = fakeDocument();
  const { Themes: T } = load(['themes'], { document });
  assert.equal(T.apply('arcade'), 'arcade');
  assert.equal(document.attrs['data-theme'], 'arcade');
  assert.equal(T.apply('does-not-exist'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
  assert.equal(T.apply('terminal'), 'terminal');
  assert.equal(T.apply('default'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
  assert.equal(T.apply(undefined), 'default');
});

test('ownership: default is free, others are preview until purchases exist', () => {
  assert.equal(Themes.ownership('default'), 'free');
  assert.equal(Themes.ownership('nope'), 'locked');
  ids.forEach((id) => {
    assert.equal(Themes.ownership(id), Themes.previewAll() ? 'preview' : 'locked');
  });
  // a locked theme can never be applied
  const document = fakeDocument();
  const ctx = load(['themes'], { document });
  assert.equal(ctx.Themes.resolve('missing'), 'default');
});

test('selected theme persists in storage', () => {
  const data = new Map();
  const localStorage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
  let { Store } = load(['storage'], { localStorage });
  assert.equal(Store.theme, 'default');
  Store.setTheme('terminal');
  ({ Store } = load(['storage'], { localStorage }));
  assert.equal(Store.theme, 'terminal');
});

test('themes are wired into the page and the offline cache', () => {
  assert.match(read('index.html'), /src="js\/themes\.js"/);
  assert.match(read('sw.js'), /\.\/js\/themes\.js/);
  assert.match(read('js/ui.js'), /'themes'/);
});
