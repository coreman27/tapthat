/* weekly.js — deterministic weekly challenge: week ids, seeded randomness, reset timing.
 * Everyone who plays the same week id gets the same challenge sequence.
 * Weeks follow ISO-8601 (Monday start) in UTC so the reset moment is identical worldwide.
 * Each round gets its own generator (weekId + round number), so a round's values never
 * depend on how many random numbers an earlier round happened to consume.
 */
(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ISO week id like "2026-W40" for the given instant (ms since epoch).
  function weekId(now) {
    var d = new Date(now === undefined ? Date.now() : now);
    var date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = date.getUTCDay() || 7;             // Mon=1 .. Sun=7
    date.setUTCDate(date.getUTCDate() + 4 - dayNum); // Thursday of this week decides the year
    var yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    var week = Math.ceil(((date - yearStart) / DAY_MS + 1) / 7);
    return date.getUTCFullYear() + '-W' + pad(week);
  }

  // Milliseconds until the next Monday 00:00 UTC.
  function msUntilReset(now) {
    var t = now === undefined ? Date.now() : now;
    var d = new Date(t);
    var today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var dayNum = new Date(today).getUTCDay() || 7;
    return today + (8 - dayNum) * DAY_MS - t;
  }

  function isWeekId(value) {
    return typeof value === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value);
  }

  // 32-bit FNV-1a string hash.
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: small, fast, well-distributed 32-bit seeded generator returning [0, 1).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFor(id, round) {
    return mulberry32(hash('dtt-weekly:' + id + ':' + round));
  }

  function resetLabel(ms) {
    var days = Math.floor(ms / DAY_MS);
    var hours = Math.floor((ms % DAY_MS) / 3600000);
    if (days >= 1) return days + 'd ' + hours + 'h';
    var minutes = Math.max(1, Math.floor((ms % 3600000) / 60000));
    return hours >= 1 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
  }

  global.Weekly = {
    weekId: weekId,
    msUntilReset: msUntilReset,
    isWeekId: isWeekId,
    rngFor: rngFor,
    resetLabel: resetLabel
  };
})(window);
