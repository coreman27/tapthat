const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
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


module.exports = { setup, source, nativeState, root };
