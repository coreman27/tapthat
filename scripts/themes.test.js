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
const CORE = ['--bg', '--bg2', '--fg', '--muted', '--accent', '--on-accent', '--link', '--accent2',
  '--bg-glow', '--blob2', '--line', '--line2', '--panel', '--panel2', '--title-glow', '--font'];

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
    assert.ok(contrast(t['--on-accent'], t['--accent']) >= 4.5, id + ': text on the accent button >= 4.5:1');
    assert.ok(contrast(t['--link'], t['--bg']) >= 4.5, id + ': accent text on the background >= 4.5:1');
    GAMEPLAY.forEach((k) =>
      assert.ok(contrast(t[k], t['--bg']) >= 3, id + ': ' + k + ' distinguishable from the background (>= 3:1)'));
  });
});

test('default theme tokens: quiet dark base, one solid accent', () => {
  const t = rootTokens();
  assert.equal(t['--bg'], '#0a0b0f');
  assert.equal(t['--accent'], '#0b6ff0');
  assert.equal(t['--on-accent'], '#ffffff');
  assert.equal(t['--panel'], '#14161c');
  GAMEPLAY.forEach((k) => assert.ok(t[k], k + ' is defined in the base tokens'));
  assert.equal(t['--blue'], '#3b82f6');
  assert.equal(t['--red'], '#ff3b46');
});

// ---- design system guards: keep the interface professional, not decorative ----
test('controls use solid fills: no gradients except the fake notification icon', () => {
  const gradients = css.match(/linear-gradient\([^)]*\)/g) || [];
  assert.ok(gradients.length <= 1, 'found: ' + gradients.join(' | '));
  assert.match(css, /\.fake-notif \.ic \{[^}]*linear-gradient/, 'the only gradient is the decorative iOS-style icon');
  assert.doesNotMatch(css, /\.big-btn\.primary \{[^}]*gradient/);
  assert.doesNotMatch(css, /\.logo-accent \{[^}]*gradient/);
});

test('no colored glows: every accent-colored shadow layer is an inset ring, never an outer glow', () => {
  const layers = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].flatMap((m) => m[1].split(/,(?![^()]*\))/).map((x) => x.trim()));
  assert.ok(layers.length > 5, 'found the shadows to check');
  layers.forEach((layer) => {
    if (/var\(--(accent|accent2|blue|purple|link)\)/.test(layer)) {
      assert.match(layer, /^inset /, 'colored outer shadow (glow): ' + layer);
    }
  });
  assert.doesNotMatch(css, /\.big-btn\.primary \{[^}]*0 10px 30px -10px/, 'the old button glow is gone');
});

test('glass surfaces: blur, hairline border, and solid fallbacks for Reduce Transparency / no blur', () => {
  assert.match(css, /--glass-blur: blur\(\d+px\) saturate\(/);
  assert.match(css, /-webkit-backdrop-filter: var\(--glass-blur\)/, 'WebKit prefix present');
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // every surface that is glass is in the shared rule, so the fallbacks cover all of them
  const rule = css.match(/\.glass,([\s\S]*?)\{/)[1];
  ['.big-btn.ghost', '.name-row', '.card-btn', '.glass-list', '.instruction', '.score-block', '.toast', '.theme-card', '.lb-list li']
    .forEach((sel) => assert.ok(rule.includes(sel), sel + ' uses the shared glass material'));
});

test('the neutral game button is clearly distinct from the blue gameplay color', () => {
  const m = css.match(/\.gbtn\.neutral \{[^}]*background:\s*(#[0-9a-f]{6})/i);
  assert.ok(m, 'neutral button has a solid background');
  assert.ok(contrast(m[1], rootTokens()['--blue']) >= 2.5, 'neutral vs blue contrast');
  assert.ok(contrast('#0b0d12', m[1]) >= 7, 'dark label on the neutral button');
});

test('buttons use sentence case and the home screen groups navigation as a list', () => {
  const html = read('index.html');
  const labels = [...html.matchAll(/<button[^>]*class="big-btn[^"]*"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  assert.ok(labels.length >= 8);
  labels.forEach((label) => assert.notEqual(label, label.toUpperCase(), 'not ALL CAPS: ' + label));
  assert.match(html, /<div class="glass-list">/);
  ['btn-how', 'btn-themes', 'btn-lb', 'btn-store'].forEach((id) =>
    assert.match(html, new RegExp('<button id="' + id + '" class="row')));
  assert.match(html, /<button id="btn-weekly" class="card-btn">/);
  assert.doesNotMatch(read('css/styles.css'), /text-decoration:\s*underline/, 'no underlined web-style links');
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

// A Themes instance whose ownership comes from a fake Monetization, like the real app.
function themesWith(owned) {
  const document = fakeDocument();
  const monetization = { ownsTheme: (id) => owned.has(id) };
  const ctx = load(['themes'], { document, Monetization: monetization });
  return { T: ctx.Themes, document, owned };
}

test('ownership: default is free; others are locked until StoreKit says they are owned', () => {
  const { T, owned } = themesWith(new Set());
  assert.equal(T.ownership('default'), 'free');
  assert.equal(T.ownership('nope'), 'locked');
  ids.forEach((id) => assert.equal(T.ownership(id), 'locked', id));
  owned.add('terminal');
  assert.equal(T.ownership('terminal'), 'owned');
  assert.equal(T.ownership('arcade'), 'locked', 'owning one theme does not unlock another');
  assert.equal(T.previewAll(), false, 'the dev preview switch must be off in the shipped code');
});

test('apply only applies themes the player may use; locked ones fall back to default', () => {
  const { T, document, owned } = themesWith(new Set());
  assert.equal(T.apply('arcade'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
  owned.add('arcade');
  assert.equal(T.apply('arcade'), 'arcade');
  assert.equal(document.attrs['data-theme'], 'arcade');
  assert.equal(T.apply('does-not-exist'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
  assert.equal(T.apply('default'), 'default');
  assert.equal(T.apply(undefined), 'default');
});

test('applyTrusted shows a saved theme before ownership is known (no flash for paying players)', () => {
  const { T, document } = themesWith(new Set()); // StoreKit has not reported anything yet
  assert.equal(T.applyTrusted('terminal'), 'terminal');
  assert.equal(document.attrs['data-theme'], 'terminal');
  assert.equal(T.applyTrusted('garbage'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
});

test('a refunded theme reverts for display once ownership is known, and returns if re-owned', () => {
  const { T, document, owned } = themesWith(new Set(['space']));
  assert.equal(T.apply('space'), 'space');
  owned.delete('space'); // refund / revocation
  assert.equal(T.apply('space'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
  owned.add('space'); // repurchased or restored
  assert.equal(T.apply('space'), 'space');
});

test('preview shows any known theme without owning or saving it', () => {
  const { T, document } = themesWith(new Set());
  assert.equal(T.preview('arcade'), 'arcade');
  assert.equal(document.attrs['data-theme'], 'arcade');
  assert.equal(T.ownership('arcade'), 'locked', 'previewing grants nothing');
  assert.equal(T.canUse('arcade'), false);
  assert.equal(T.preview('nope'), 'default');
  // leaving the picker restores the real selection
  assert.equal(T.apply('default'), 'default');
  assert.equal(document.attrs['data-theme'], undefined);
});

test('themes work without a Monetization object (web build): only Classic is usable', () => {
  const document = fakeDocument();
  const ctx = load(['themes'], { document });
  assert.equal(ctx.Themes.apply('arcade'), 'default');
  assert.equal(ctx.Themes.ownership('arcade'), 'locked');
  assert.equal(ctx.Themes.preview('arcade'), 'arcade');
});

test('theme product ids line up across JS, Info.plist, StoreKit file and validator', () => {
  const plist = read('ios/App/App/Info.plist');
  const storekit = JSON.parse(read('ios/App/RemoveAds.storekit'));
  const storekitIds = storekit.products.map((p) => p.productID);
  ids.forEach((id) => {
    const productId = 'com.coreyhall.donttapthat.theme.' + id;
    assert.ok(plist.includes('<string>' + productId + '</string>'), id + ' in Info.plist');
    assert.ok(storekitIds.includes(productId), id + ' in the local StoreKit file');
    const product = storekit.products.find((p) => p.productID === productId);
    assert.equal(product.type, 'NonConsumable', id + ' is non-consumable (permanent, restorable)');
  });
  const plistThemes = [...plist.matchAll(/<string>(com\.coreyhall\.donttapthat\.theme\.[a-z0-9]+)<\/string>/g)].map((m) => m[1]);
  assert.equal(plistThemes.length, ids.length, 'every product in Info.plist is a listed theme');
  const manager = read('ios/App/App/MonetizationManager.swift');
  assert.match(manager, /MonetizationThemeProductIDs/);
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
