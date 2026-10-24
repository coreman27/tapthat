/* profile.js — the player's name: normalizing what they type, the monogram, and the friendly
 * line under their name. Pure functions; the screens live in main.js. */
(function (global) {
  'use strict';

  var MAX_LENGTH = 14;

  // Collapse whitespace, drop control characters, trim, and cap at 14 characters without ever
  // splitting an emoji or accented letter in half.
  function normalize(raw) {
    var clean = String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(clean).slice(0, MAX_LENGTH).join('').trim();
  }

  // First character, upper-cased, for the round monogram. '' when there is no name.
  function initial(name) {
    var chars = Array.from(String(name == null ? '' : name).trim());
    return chars.length ? chars[0].toUpperCase() : '';
  }

  // The line under the name: personal and a little encouraging.
  function subtitle(name, best) {
    if (!name) return 'Tap to set how you appear';
    return best > 0 ? 'Best ' + best : 'Ready when you are';
  }

  // What the toast says after saving: a welcome the first time, a compliment after a change.
  function greeting(name, wasEmpty) {
    return wasEmpty ? 'Nice to meet you, ' + name : 'Looking good, ' + name;
  }

  global.Profile = { MAX_LENGTH: MAX_LENGTH, normalize: normalize, initial: initial, subtitle: subtitle, greeting: greeting };
})(window);
