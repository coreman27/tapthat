const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8');
const nativeState = (overrides = {}) => ({
  adsRemoved: false, productAvailable: true, price: '$4.99',
  privacyOptionsRequired: false, needsConsent: false, testAds: true, ...overrides
});

function setup(options = {}) {
  const saved = options.saved || new Map();
  const calls = { ads: 0, purchase: 0, restore: 0, listeners: 0 };
  let clock = options.clock || 1000000;
  let state = nativeState(options.state);
  let listener;
  const plugin = {
    async addListener(name, callback) {
      assert.equal(name, 'stateChanged');
      calls.listeners++;
      listener = callback;
      return { remove() {} };
    },
    async initialize() { return state; },
    async showInterstitial() { calls.ads++; return { shown: true }; },
    async purchaseRemoveAds() { calls.purchase++; return { status: 'purchased', adsRemoved: true }; },
    async restorePurchases() { calls.restore++; return nativeState({ adsRemoved: true }); },
    async showPrivacyOptions() { return nativeState({ privacyOptionsRequired: true }); },
    ...options.plugin
  };
  const warnings = [];
  const context = {
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
    Date: class extends Date { static now() { return clock; } },
    localStorage: {
      getItem: key => saved.has(key) ? saved.get(key) : null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key),
      ...options.storage
    },
    Capacitor: options.web ? undefined : {
      isNativePlatform: () => true, getPlatform: () => 'ios',
      Plugins: options.missingPlugin ? {} : { Monetization: plugin }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('ad-config'), context);
  if (!options.defaults) {
    context.AdConfig = {
      version: 'integration-test',
      variants: [{
        id: 'test', weight: 100, enabled: true, everyRuns: 4,
        onNewBest: false, onNearBest: false, nearBestRatio: 0.9, minBest: 10,
        minRunsBetween: 3, firstSessionGraceRuns: 0, minSessionSeconds: 0,
        minSecondsBetween: 1, maxAdsPerSession: 20,
        ...options.policy
      }]
    };
  }
  vm.runInContext(source('ad-policy'), context);
  vm.runInContext(source('monetization'), context);
  const client = context.Monetization;
  function end(overrides = {}) {
    const runId = client.startRun();
    clock += 1000;
    return client.recordLoss({
      runId, score: 1, previousBest: 20,
      assisted: false, rewardedOffered: false, rewardedUsed: false, ...overrides
    });
  }
  return {
    client, context, plugin, saved, calls, warnings, end,
    tick: ms => { clock += ms; },
    emit: value => listener(value),
    setNativeState: value => { state = value; }
  };
}

test('all HTML scripts are cached and policy loads before monetization/bootstrap', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cache = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  for (const script of scripts) {
    assert.ok(fs.existsSync(path.join(root, script)), script);
    assert.ok(cache.includes('./' + script), script);
  }
  for (const [first, second] of [
    ['ad-config', 'ad-policy'], ['ad-policy', 'monetization'], ['monetization', 'main']
  ]) assert.ok(scripts.indexOf(`js/${first}.js`) < scripts.indexOf(`js/${second}.js`));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('policy selects a break without immediately showing any ad', async () => {
  const f = setup();
  await f.client.initialize();
  for (let i = 1; i <= 12; i++) {
    const decision = f.end();
    assert.equal(decision.eligible, i % 4 === 0);
    assert.equal(f.calls.ads, Math.floor((i - 1) / 4));
    await f.client.presentBreak(decision);
    assert.equal(f.calls.ads, Math.floor(i / 4));
  }
});

test('purchase screen stays focused on removing ads; diagnostics live under how to play', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const store = html.match(/<section id="screen-store"[\s\S]*?<\/section>/)[0];
  const how = html.match(/<section id="screen-how"[\s\S]*?<\/section>/)[0];
  assert.ok(store.includes('<h2 class="chal-title">Remove Ads</h2>'));
  assert.ok(store.includes('One-time purchase. No subscription.'));
  assert.doesNotMatch(store, /score milestones|between runs|ad-diagnostics/);
  for (const id of ['btn-remove-ads', 'btn-restore', 'btn-privacy-options', 'btn-store-retry', 'purchase-status']) {
    assert.ok(store.includes(`id="${id}"`), id);
  }
  for (const id of ['ad-diagnostics-enabled', 'btn-ad-report', 'btn-ad-clear', 'ad-diagnostics-report']) {
    assert.ok(how.includes(`id="${id}"`), id);
  }
});

test('policy cadence survives relaunch rather than reverting to a new three-loss counter', async () => {
  const first = setup();
  await first.client.initialize();
  first.end(); first.end(); first.end();
  const second = setup({ saved: first.saved, clock: 1004000 });
  await second.client.initialize();
  await second.client.presentBreak(second.end());
  assert.equal(second.calls.ads, 1);
});

test('browser, not-ready state, and verified owners never invoke native ads', async () => {
  for (const options of [{ web: true }, { state: { adsRemoved: true } }, { unready: true }]) {
    const f = setup(options);
    if (!options.unready) await f.client.initialize();
    for (let i = 0; i < 9; i++) await f.client.presentBreak(f.end());
    assert.equal(f.calls.ads, 0);
  }
});

test('missing plugin surfaces error and unlocks normal gameplay', async () => {
  const { client } = setup({ missingPlugin: true });
  await assert.rejects(client.initialize(), /native purchase plugin is missing/);
  assert.equal(client.getState().busy, false);
});

test('purchase made on result screen cancels already selected interstitial', async () => {
  const f = setup();
  await f.client.initialize();
  f.end(); f.end(); f.end();
  const pending = f.end();
  assert.equal(pending.eligible, true);
  await f.client.purchase();
  await f.client.presentBreak(pending);
  assert.equal(f.calls.ads, 0);
});

test('ad or consent presentation locks replay and duplicate presentation until dismissal', async () => {
  let finish;
  const f = setup({ plugin: {
    showInterstitial: () => new Promise(resolve => { finish = resolve; })
  } });
  await f.client.initialize();
  f.end(); f.end(); f.end();
  const decision = f.end();
  const pending = f.client.presentBreak(decision);
  assert.equal(f.client.getState().busy, true);
  assert.throws(() => f.client.startRun(), /finish the current/);
  await assert.rejects(f.client.presentBreak(decision), /finish the current/);
  finish({ shown: false, reason: 'consent_updated' });
  await pending;
  assert.equal(f.client.getState().busy, false);
});

test('new run invalidates old pending opportunity; returning from background cannot play it late', async () => {
  const f = setup();
  await f.client.initialize();
  f.end(); f.end(); f.end();
  const stale = f.end();
  f.client.startRun();
  await f.client.presentBreak(stale);
  assert.equal(f.calls.ads, 0);
});

test('hidden result screen skips opportunity', async () => {
  const f = setup();
  await f.client.initialize();
  f.end(); f.end(); f.end();
  const decision = f.end();
  f.context.document = { hidden: true };
  await f.client.presentBreak(decision);
  assert.equal(f.calls.ads, 0);
});

test('presentation failure unlocks game and consumes only this opportunity', async () => {
  const f = setup({ plugin: {
    showInterstitial: async () => { throw new Error('Presentation failed'); }
  } });
  await f.client.initialize();
  f.end(); f.end(); f.end();
  await assert.rejects(f.client.presentBreak(f.end()), /Presentation failed/);
  assert.equal(f.client.getState().busy, false);
  assert.equal(f.end().eligible, false);
});

test('no-fill cannot trigger a catch-up ad on the next run', async () => {
  const f = setup({ plugin: {
    showInterstitial: async () => ({ shown: false, reason: 'not_ready' })
  } });
  await f.client.initialize();
  f.end(); f.end(); f.end();
  assert.equal((await f.client.presentBreak(f.end())).shown, false);
  assert.equal(f.end().eligible, false);
});

for (const status of ['cancelled', 'pending', 'purchased']) {
  test(`${status} purchase only removes ads with verified ownership`, async () => {
    const f = setup({ plugin: {
      purchaseRemoveAds: async () => ({ status, adsRemoved: status === 'purchased' })
    } });
    await f.client.initialize();
    assert.equal((await f.client.purchase()).status, status);
    assert.equal(f.client.getState().adsRemoved, status === 'purchased');
  });
}

test('unverified purchase cannot grant paid access', async () => {
  const f = setup({ plugin: {
    purchaseRemoveAds: async () => ({ status: 'purchased', adsRemoved: false })
  } });
  await f.client.initialize();
  await assert.rejects(f.client.purchase(), /could not be verified/);
  assert.equal(f.client.getState().adsRemoved, false);
});

test('restore errors preserve verified entitlement and revocation updates remove it', async () => {
  const f = setup();
  await f.client.initialize();
  await f.client.restore();
  assert.equal(f.client.getState().adsRemoved, true);
  f.plugin.restorePurchases = async () => { throw new Error('offline'); };
  await assert.rejects(f.client.restore(), /offline/);
  assert.equal(f.client.getState().adsRemoved, true);
  f.emit(nativeState({ adsRemoved: false }));
  assert.equal(f.client.getState().adsRemoved, false);
});

test('missing products have no fake price and retry does not duplicate listener', async () => {
  const f = setup({ state: { productAvailable: false, price: null } });
  await f.client.initialize();
  await assert.rejects(f.client.purchase(), /unavailable/);
  f.setNativeState(nativeState());
  await f.client.initialize();
  assert.equal(f.client.getState().productAvailable, true);
  assert.equal(f.calls.listeners, 1);
});

test('invalid native state fails closed; privacy options refresh state', async () => {
  const f = setup();
  await f.client.initialize();
  await f.client.privacy();
  assert.equal(f.client.getState().privacyOptionsRequired, true);
  f.emit({ adsRemoved: false });
  assert.equal(f.client.getState().ready, false);
  assert.match(f.client.getState().message, /invalid purchase status/);
});

test('broken frequency storage disables ads and report surfaces the failure', async () => {
  const f = setup({ storage: { setItem() { throw new Error('Storage full'); } } });
  await f.client.initialize();
  for (let i = 0; i < 6; i++) await f.client.presentBreak(f.end());
  assert.equal(f.calls.ads, 0);
  assert.ok(f.client.getAdReport().warning);
});

test('UI preserves celebration, passes previous best, and prevents double-tap replay during ads', async () => {
  const f = setup({ policy: { onNewBest: true, minRunsBetween: 2 } });
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', checked: false, textContent: '', disabled: false, innerHTML: '',
        listeners: {},
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name),
          toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
        },
        addEventListener(event, handler) { this.listeners[event] = handler; },
        blur() {}
      });
    }
    return elements.get(id);
  }
  let finishGame, starts = 0, records = 0, screen;
  Object.assign(f.context, {
    document: {
      hidden: false, readyState: 'complete', getElementById: element,
      addEventListener() {}, removeEventListener() {}
    },
    Store: {
      name: '', best: 20, setName() {},
      setBest(score) { const isBest = score > this.best; if (isBest) this.best = score; return isBest; },
      recordGame() { records++; }
    },
    UI: { register() {}, show(value) { screen = value; }, toast() {} },
    Sound: { unlock() {}, best() {} },
    Engine: {
      init() {}, onUpdate() {}, onGameOver(handler) { finishGame = handler; },
      start() { starts++; }
    },
    Share: { readIncoming: () => null },
    navigator: {}, location: { protocol: 'capacitor:' }
  });
  vm.runInContext(source('main'), f.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('purchase-status').textContent, '', 'no development ad explanation on the purchase screen');
  assert.equal(element('btn-remove-ads').textContent, 'Remove Ads - $4.99');
  element('btn-how').listeners.click();
  assert.equal(screen, 'how');
  assert.equal(JSON.parse(element('ad-diagnostics-report').value).diagnosticsEnabled, false);
  element('btn-how-back').listeners.click();
  assert.equal(screen, 'home');
  element('btn-play').listeners.click();
  f.tick(1000);
  finishGame({ score: 1 });
  element('btn-again').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  f.tick(1000);
  finishGame({ score: 21 });
  finishGame({ score: 21 });
  assert.equal(records, 2);
  assert.equal(f.context.Store.best, 21);
  assert.equal(screen, 'over');
  assert.equal(f.calls.ads, 0, 'no automatic ad over new-best celebration');
  assert.equal(element('ad-break-notice').classList.contains('hidden'), false, 'compared against old best 20, not new best 21');
  assert.equal(element('btn-again').disabled, false);
  let dismiss;
  f.plugin.showInterstitial = () => new Promise(resolve => { dismiss = resolve; });
  element('btn-again').listeners.click();
  assert.equal(element('btn-again').disabled, true);
  element('btn-again').listeners.click();
  assert.equal(starts, 2);
  dismiss({ shown: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 3);
  assert.equal(screen, 'game');
  assert.equal(element('btn-again').disabled, false);
});
