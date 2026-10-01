(function (global) {
  'use strict';

  var policy = global.AdPolicy.create({ config: global.AdConfig });
  var capacitor = global.Capacitor;
  var supported = !!(capacitor && capacitor.isNativePlatform() && capacitor.getPlatform() === 'ios');
  // This unbundled app uses the proxy injected by Capacitor's native bridge.
  var bridge = supported && capacitor.Plugins ? capacitor.Plugins.Monetization : null;
  var listeners = [];
  var nativeListener = null;
  var state = {
    supported: supported,
    ready: false,
    busy: false,
    adsRemoved: false,
    productAvailable: false,
    price: null,
    privacyOptionsRequired: false,
    needsConsent: false,
    testAds: false,
    rewardedReady: false, // a rewarded video is loaded and can be shown right now
    ownedThemes: [],   // cosmetic theme product keys the player owns (verified by StoreKit)
    themePrices: {},   // theme product id -> localized price string
    message: ''
  };

  function snapshot() { return Object.assign({}, state); }

  function publish() {
    listeners.forEach(function (listener) { listener(snapshot()); });
  }

  function applyNativeState(value) {
    if (!value || typeof value.adsRemoved !== 'boolean' ||
        typeof value.productAvailable !== 'boolean' ||
        !(value.price === null || typeof value.price === 'string') ||
        typeof value.privacyOptionsRequired !== 'boolean' ||
        typeof value.needsConsent !== 'boolean' ||
        typeof value.testAds !== 'boolean' ||
        (value.message !== undefined && typeof value.message !== 'string')) {
      throw new Error('The App Store returned an invalid purchase status. Try restoring purchases.');
    }
    state.adsRemoved = value.adsRemoved;
    state.productAvailable = value.productAvailable;
    state.price = value.price;
    state.privacyOptionsRequired = value.privacyOptionsRequired;
    state.needsConsent = value.needsConsent;
    state.testAds = value.testAds;
    state.message = value.message || '';
    state.rewardedReady = value.rewardedReady === true;
    // Themes are optional polish: malformed theme data must never break ads or Remove Ads.
    state.ownedThemes = Array.isArray(value.ownedThemes) && value.ownedThemes.every(isString) ? value.ownedThemes.slice() : [];
    state.themePrices = cleanPrices(value.themePrices);
    publish();
  }

  function isString(x) { return typeof x === 'string'; }

  function cleanPrices(prices) {
    var out = {};
    if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
      Object.keys(prices).forEach(function (id) { if (isString(prices[id])) out[id] = prices[id]; });
    }
    return out;
  }

  async function exclusive(action) {
    if (state.busy) throw new Error('Please finish the current ad or purchase first.');
    state.busy = true;
    publish();
    try {
      return await action();
    } finally {
      state.busy = false;
      publish();
    }
  }

  function requireReady() {
    if (!state.supported || !state.ready) {
      throw new Error('Purchases are not ready. Tap Retry Connection and try again.');
    }
  }

  async function initialize() {
    if (!supported) return snapshot();
    return exclusive(async function () {
      state.ready = false;
      if (!bridge) throw new Error('The native purchase plugin is missing. Please update the iOS app.');
      if (!nativeListener) {
        nativeListener = await bridge.addListener('stateChanged', function (value) {
          try {
            applyNativeState(value);
          } catch (error) {
            state.ready = false;
            state.message = error.message;
            console.error('Purchase status update rejected.', error);
            publish();
          }
        });
      }
      applyNativeState(await bridge.initialize());
      state.ready = true;
      publish();
      return snapshot();
    });
  }

  function startRun() {
    if (state.busy) throw new Error('Please finish the current ad or purchase first.');
    return policy.startRun();
  }

  function recordLoss(context) {
    if (state.busy) throw new Error('A game ended while another ad or purchase was active.');
    return policy.endRun(Object.assign({}, context, {
      supported: supported, adsRemoved: state.adsRemoved, ready: state.ready
    }));
  }

  async function presentBreak(decision) {
    if (!decision) return { shown: false, reason: 'no-break' };
    if (state.busy) throw new Error('Please finish the current ad or purchase first.');
    if (!supported || state.adsRemoved || !state.ready || !decision.eligible ||
        (global.document && global.document.hidden)) {
      policy.closeBreak(decision.runId);
      return { shown: false, reason: 'skipped' };
    }
    // Called only by explicit game-over navigation; never from a timer or ad-load callback.
    return exclusive(async function () {
      if (!policy.beginBreak(decision)) {
        policy.closeBreak(decision.runId);
        return { shown: false, reason: 'expired-or-capped' };
      }
      try {
        var result = await bridge.showInterstitial();
        if (!result || typeof result.shown !== 'boolean' ||
            (result.reason !== undefined && typeof result.reason !== 'string')) {
          throw new Error('The ad could not be displayed. You can keep playing.');
        }
        policy.finishBreak(decision.runId, result);
        return result;
      } catch (error) {
        policy.finishBreak(decision.runId, { shown: false, reason: 'error' });
        throw error;
      }
    });
  }

  async function purchase() {
    requireReady();
    if (state.adsRemoved) return { status: 'purchased', adsRemoved: true };
    if (!state.productAvailable || !state.price) {
      throw new Error('Remove Ads is unavailable in the App Store right now. Please try again later.');
    }
    return exclusive(async function () {
      var result = await bridge.purchaseRemoveAds();
      if (!result || ['purchased', 'cancelled', 'pending'].indexOf(result.status) === -1 ||
          typeof result.adsRemoved !== 'boolean' || (result.status === 'purchased' && !result.adsRemoved)) {
        throw new Error('The purchase could not be verified. Try Restore Purchases before buying again.');
      }
      state.adsRemoved = result.adsRemoved;
      publish();
      return result;
    });
  }

  /* Rewarded Continue. Resolves { rewarded: boolean, reason?: string }.
   * Remove Ads owners get the continue without a video (free: true). For everyone else the
   * reward is true only when the native SDK's reward callback fired, so closing early, load
   * failure, being offline or any error all resolve rewarded: false. */
  async function showRewarded() {
    requireReady();
    if (state.adsRemoved) return { rewarded: true, free: true };
    if (!state.rewardedReady) return { rewarded: false, reason: 'not_ready' };
    return exclusive(async function () {
      var result = await bridge.showRewarded();
      if (!result || typeof result.rewarded !== 'boolean' ||
          (result.reason !== undefined && typeof result.reason !== 'string')) {
        throw new Error('The video could not be shown. You can still try again.');
      }
      return { rewarded: result.rewarded, reason: result.reason };
    });
  }

  var THEME_PREFIX = 'com.coreyhall.donttapthat.theme.';

  // key is the short theme id used by the game, e.g. "arcade".
  function themeProductId(key) { return THEME_PREFIX + key; }
  function ownsTheme(key) { return state.ownedThemes.indexOf(themeProductId(key)) !== -1; }
  function themePrice(key) { return state.themePrices[themeProductId(key)] || null; }

  async function purchaseTheme(key) {
    requireReady();
    var id = themeProductId(key);
    if (state.ownedThemes.indexOf(id) !== -1) return { status: 'purchased', id: id };
    if (!state.themePrices[id]) throw new Error('That theme is unavailable in the App Store right now. Please try again later.');
    return exclusive(async function () {
      var result = await bridge.purchaseTheme({ id: id });
      if (!result || ['purchased', 'cancelled', 'pending'].indexOf(result.status) === -1 || result.id !== id ||
          !Array.isArray(result.ownedThemes) || !result.ownedThemes.every(isString) ||
          (result.status === 'purchased' && result.ownedThemes.indexOf(id) === -1)) {
        throw new Error('The purchase could not be verified. Try Restore Purchases before buying again.');
      }
      state.ownedThemes = result.ownedThemes.slice();
      publish();
      return result;
    });
  }

  async function restore() {
    requireReady();
    return exclusive(async function () {
      applyNativeState(await bridge.restorePurchases());
      return snapshot();
    });
  }

  async function privacy() {
    requireReady();
    return exclusive(async function () {
      applyNativeState(await bridge.showPrivacyOptions());
      return snapshot();
    });
  }

  global.Monetization = {
    initialize: initialize,
    startRun: startRun,
    recordLoss: recordLoss,
    presentBreak: presentBreak,
    touch: function () { policy.touch(); },
    getAdReport: function () { return policy.getReport(); },
    setDiagnosticsEnabled: function (enabled) { policy.setDiagnosticsEnabled(enabled); },
    clearDiagnostics: function () { policy.clearDiagnostics(); },
    purchase: purchase,
    showRewarded: showRewarded,
    purchaseTheme: purchaseTheme,
    ownsTheme: ownsTheme,
    themePrice: themePrice,
    restore: restore,
    privacy: privacy,
    getState: snapshot,
    onChange: function (listener) { listeners.push(listener); listener(snapshot()); }
  };
})(window);
