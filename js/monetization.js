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
    publish();
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
    restore: restore,
    privacy: privacy,
    getState: snapshot,
    onChange: function (listener) { listeners.push(listener); listener(snapshot()); }
  };
})(window);
