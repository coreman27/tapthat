/* share.js — challenge link encode/decode + native share sheet */
(function (global) {
  'use strict';

  function encodeChallenge(name, score, weekId) {
    var payload = { n: (name || 'A friend').slice(0, 14), s: score | 0 };
    if (weekId && global.Weekly && global.Weekly.isWeekId(weekId)) payload.w = weekId;
    var json = JSON.stringify(payload);
    // URL-safe base64
    var b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return b64;
  }

  function decodeChallenge(code) {
    try {
      var b64 = code.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = decodeURIComponent(escape(atob(b64)));
      var obj = JSON.parse(json);
      if (typeof obj.s !== 'number') return null;
      var weekId = global.Weekly && global.Weekly.isWeekId(obj.w) ? obj.w : null;
      return { name: obj.n || 'A friend', score: obj.s | 0, weekId: weekId };
    } catch (e) {
      return null;
    }
  }

  // Temporary web home for challenge links (branded domain). Used for the web
  // build and as a fallback on native until the App Store Apple ID is set below.
  var PUBLIC_BASE = 'https://donttapthat.com/';

  // ===== App Store link =====
  // The native app should send friends to the App Store, NOT the web build.
  // Paste your app's numeric Apple ID here (App Store Connect ▸ your app ▸
  // App Information ▸ "Apple ID", e.g. '6480001234'). Leave '' until you have it.
  var APP_STORE_APPLE_ID = '6806714287';

  function appStoreUrl() {
    return APP_STORE_APPLE_ID ? ('https://apps.apple.com/app/id' + APP_STORE_APPLE_ID) : '';
  }

  function shareBase() {
    var proto = (location.protocol || '').toLowerCase();
    if (proto === 'http:' || proto === 'https:') {
      return location.origin + location.pathname;
    }
    return PUBLIC_BASE;
  }

  function buildUrl(name, score, weekId) {
    return shareBase() + '#c=' + encodeChallenge(name, score, weekId);
  }

  function readIncoming() {
    var h = location.hash || '';
    var m = h.match(/[#&]c=([^&]+)/);
    if (!m) return null;
    return decodeChallenge(m[1]);
  }

  function clearIncoming() {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }

  // On native, Capacitor.Plugins is populated only by registerPlugin(); a
  // no-bundler app must register the plugin itself to reach the native impl.
  var _sharePlugin;
  function getSharePlugin() {
    if (_sharePlugin !== undefined) return _sharePlugin;
    _sharePlugin = null;
    var C = global.Capacitor;
    if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) {
      if (C.Plugins && C.Plugins.Share) {
        _sharePlugin = C.Plugins.Share;
      } else if (typeof C.registerPlugin === 'function') {
        try { _sharePlugin = C.registerPlugin('Share'); } catch (e) { _sharePlugin = null; }
      }
    }
    return _sharePlugin;
  }

  function isUserCancel(e) {
    // Capacitor Share (iOS) and Web Share API both reject with AbortError on cancel.
    var msg = (e && (e.message || e.errorMessage || '')) + '';
    return (e && e.name === 'AbortError') || /cancel|abort|dismiss/i.test(msg);
  }

  function share(name, score, weekId) {
    var webUrl = buildUrl(name, score, weekId);
    var text = weekId
      ? (name || 'I') + ' survived ' + score + ' commands in the DON\u2019T TAP THAT weekly challenge (' + weekId + '). Same commands for everyone \u2014 can you beat that?'
      : (name || 'I') + ' survived ' + score + ' commands in DON\u2019T TAP THAT. Can you beat that?';

    // Native iOS/Android: open the real system share sheet (Copy, Messages, etc.).
    // Send friends to the App Store (never the web build). The App Store URL can't
    // carry the #c= challenge payload, so the challenger's name/score lives in the
    // message text. Falls back to the web link only until an Apple ID is set.
    var sharePlugin = getSharePlugin();
    if (sharePlugin) {
      var nativeUrl = appStoreUrl() || webUrl;
      return sharePlugin.share({
        title: 'DON\u2019T TAP THAT',
        text: text,
        url: nativeUrl,
        dialogTitle: 'Challenge a friend'
      })
        .then(function () { return { ok: true, method: 'native' }; })
        .catch(function (e) {
          if (isUserCancel(e)) return { ok: true, method: 'native', canceled: true };
          return { ok: false, url: nativeUrl, text: text };
        });
    }

    // Web browsers that support the Web Share API (e.g. mobile Safari).
    if (navigator.share) {
      return navigator.share({ title: 'DON\u2019T TAP THAT', text: text, url: webUrl })
        .then(function () { return { ok: true, method: 'native' }; })
        .catch(function (e) {
          if (isUserCancel(e)) return { ok: true, method: 'native', canceled: true };
          return { ok: false, url: webUrl, text: text };
        });
    }

    // Fallback: copy to clipboard.
    var full = text + '\n' + webUrl;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(full)
        .then(function () { return { ok: true, method: 'clipboard', url: webUrl }; })
        .catch(function () { return { ok: false, url: webUrl, text: text }; });
    }
    return Promise.resolve({ ok: false, url: webUrl, text: text });
  }

  global.Share = {
    encodeChallenge: encodeChallenge,
    decodeChallenge: decodeChallenge,
    buildUrl: buildUrl,
    readIncoming: readIncoming,
    clearIncoming: clearIncoming,
    share: share
  };
})(window);
