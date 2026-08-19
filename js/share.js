/* share.js — challenge link encode/decode + native share sheet */
(function (global) {
  'use strict';

  function encodeChallenge(name, score) {
    var payload = { n: (name || 'A friend').slice(0, 14), s: score | 0 };
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
      return { name: obj.n || 'A friend', score: obj.s | 0 };
    } catch (e) {
      return null;
    }
  }

  function buildUrl(name, score) {
    var base = location.origin + location.pathname;
    return base + '#c=' + encodeChallenge(name, score);
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

  function share(name, score) {
    var url = buildUrl(name, score);
    var text = (name || 'I') + ' survived ' + score + ' commands in DON\u2019T TAP THAT. Can you beat that?';
    if (navigator.share) {
      return navigator.share({ title: 'DON\u2019T TAP THAT', text: text, url: url })
        .then(function () { return { ok: true, method: 'native' }; })
        .catch(function () { return { ok: false, url: url, text: text }; });
    }
    // Fallback: copy to clipboard
    var full = text + '\n' + url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(full)
        .then(function () { return { ok: true, method: 'clipboard', url: url }; })
        .catch(function () { return { ok: false, url: url, text: text }; });
    }
    return Promise.resolve({ ok: false, url: url, text: text });
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
