/* leaderboard.js — optional weekly leaderboard + friend groups (client for server/).
 *
 * Privacy design:
 *  - Disabled unless LeaderboardConfig.apiBase is an https URL.
 *  - Opt-in: no identifier is created and nothing is sent until the player joins.
 *  - Identity is a random device id + secret key kept on the device. No accounts.
 *  - What is sent: display name, weekly score, per-round reaction times, the random id.
 *  - deleteMyData() removes everything on the server and locally.
 * The game works fully offline; every call here may fail and callers must cope.
 */
(function (global) {
  'use strict';

  var TIMEOUT_MS = 8000;
  var MAX_LOCAL_GROUPS = 5;

  function config() { return global.LeaderboardConfig || {}; }
  function enabled() { return typeof config().apiBase === 'string' && /^https:\/\//.test(config().apiBase); }
  function base() { return config().apiBase.replace(/\/+$/, ''); }
  function isOptedIn() { return enabled() && !!Store.lb.optIn && !!Store.lb.deviceId; }

  // ---- identity ----
  function randomBytes(n) {
    var bytes = new Uint8Array(n);
    global.crypto.getRandomValues(bytes);
    return bytes;
  }
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    var b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function secret() {
    var b = randomBytes(32), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return global.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function optIn() {
    if (!enabled()) return false;
    var lb = Store.lb;
    if (!lb.deviceId || !lb.deviceKey) Store.setLb({ deviceId: uuid(), deviceKey: secret() });
    Store.setLb({ optIn: true });
    return true;
  }
  function credentials() {
    var lb = Store.lb;
    return { deviceId: lb.deviceId, deviceKey: lb.deviceKey };
  }

  // ---- transport ----
  function request(method, path, body, query) {
    if (!enabled()) return Promise.reject(makeError('disabled', 0, 'Leaderboard is not available.'));
    var url = base() + path;
    if (query) {
      var qs = Object.keys(query).filter(function (k) { return query[k] != null; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
      if (qs) url += '?' + qs;
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : 0;
    return global.fetch(url, {
      method: method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) throw makeError(data.error || 'http_' + res.status, res.status, data.message || 'Request failed.');
        return data;
      });
    }, function (err) {
      clearTimeout(timer);
      throw makeError('network', 0, 'You appear to be offline.', err);
    });
  }

  function makeError(code, status, message, cause) {
    var e = new Error(message);
    e.code = code; e.status = status; e.cause = cause;
    return e;
  }
  // Worth retrying later: offline, timeouts, throttling, server trouble.
  function isTransient(e) { return e.code === 'network' || e.status === 429 || e.status >= 500; }

  // ---- scores ----
  function submit(run) {
    if (!isOptedIn()) return Promise.reject(makeError('not_opted_in', 0, 'Join the leaderboard first.'));
    if (!(run.score >= 1)) return Promise.reject(makeError('no_score', 0, 'Nothing to submit.'));
    var body = Object.assign(credentials(), { name: run.name, weekId: run.weekId, score: run.score, rounds: run.rounds });
    return request('POST', '/v1/scores', body).then(function (res) {
      var pending = Store.lb.pending;
      if (pending && pending.weekId === run.weekId && pending.score <= run.score) Store.setLb({ pending: null });
      return res;
    }, function (e) {
      if (isTransient(e)) rememberPending(run);   // try again later
      else Store.setLb({ pending: null });        // rejected for good (week closed, implausible...)
      throw e;
    });
  }

  function rememberPending(run) {
    var pending = Store.lb.pending;
    if (pending && pending.weekId === run.weekId && pending.score >= run.score) return;
    Store.setLb({ pending: { weekId: run.weekId, score: run.score, rounds: run.rounds, name: run.name } });
  }

  // Retry a run that could not be sent earlier. Never throws.
  function flushPending() {
    var pending = Store.lb.pending;
    if (!isOptedIn() || !pending) return Promise.resolve(null);
    return submit(pending).catch(function () { return null; });
  }

  function board(weekId) {
    return request('GET', '/v1/weeks/' + encodeURIComponent(weekId) + '/leaderboard',
      null, { limit: 25, deviceId: isOptedIn() ? Store.lb.deviceId : null });
  }

  // ---- friend groups ----
  function normalizeCode(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
  function rememberGroup(code) {
    var groups = Store.lb.groups.filter(function (c) { return c !== code; });
    groups.unshift(code);
    Store.setLb({ groups: groups.slice(0, MAX_LOCAL_GROUPS) });
  }

  function createGroup(name) {
    if (!isOptedIn()) return Promise.reject(makeError('not_opted_in', 0, 'Join the leaderboard first.'));
    return request('POST', '/v1/groups', Object.assign(credentials(), { name: name })).then(function (res) {
      rememberGroup(res.code);
      return res;
    });
  }
  function joinGroup(code, name) {
    var c = normalizeCode(code);
    if (c.length !== 6) return Promise.reject(makeError('bad_code', 400, 'Group codes are 6 letters and numbers.'));
    if (!isOptedIn()) return Promise.reject(makeError('not_opted_in', 0, 'Join the leaderboard first.'));
    return request('POST', '/v1/groups/' + c + '/join', Object.assign(credentials(), { name: name })).then(function (res) {
      rememberGroup(c);
      return res;
    });
  }
  function groupBoard(code, weekId) {
    return request('GET', '/v1/groups/' + normalizeCode(code) + '/weeks/' + encodeURIComponent(weekId));
  }

  // ---- privacy: delete everything ----
  function deleteMyData() {
    var lb = Store.lb;
    if (!lb.deviceId || !lb.deviceKey) {
      Store.setLb({ optIn: false, groups: [], pending: null });
      return Promise.resolve({ ok: true });
    }
    return request('POST', '/v1/delete', credentials()).then(function (res) {
      // only forget locally once the server confirmed, so a failed delete can be retried
      Store.setLb({ optIn: false, deviceId: '', deviceKey: '', groups: [], pending: null });
      return res;
    });
  }

  global.Leaderboard = {
    enabled: enabled,
    isOptedIn: isOptedIn,
    optIn: optIn,
    submit: submit,
    flushPending: flushPending,
    board: board,
    createGroup: createGroup,
    joinGroup: joinGroup,
    groupBoard: groupBoard,
    normalizeCode: normalizeCode,
    deleteMyData: deleteMyData,
    isTransient: isTransient
  };
})(window);
