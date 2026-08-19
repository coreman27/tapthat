/* audio.js — tiny WebAudio blips + haptics. No assets required. */
(function (global) {
  'use strict';

  var ctx = null;
  function ac() {
    if (!ctx) {
      try { ctx = new (global.AudioContext || global.webkitAudioContext)(); }
      catch (e) { ctx = null; }
    }
    return ctx;
  }

  function tone(freq, dur, type, vol, when) {
    if (Store.muted) return;
    var c = ac();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    var t0 = c.currentTime + (when || 0);
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function haptic(ms) {
    if (Store.muted) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  var Audio = {
    unlock: function () { var c = ac(); if (c && c.state === 'suspended') c.resume(); },
    good: function () { tone(660, 0.09, 'triangle', 0.16); haptic(8); },
    great: function () { tone(660, 0.07, 'triangle', 0.16); tone(990, 0.1, 'triangle', 0.16, 0.06); haptic(12); },
    bad: function () { tone(150, 0.35, 'sawtooth', 0.22); haptic([30, 40, 60]); },
    tick: function () { tone(1200, 0.03, 'square', 0.05); },
    ready: function () { tone(520, 0.05, 'sine', 0.12); },
    best: function () { tone(660, 0.1, 'triangle', 0.18); tone(880, 0.1, 'triangle', 0.18, 0.09); tone(1320, 0.16, 'triangle', 0.18, 0.18); haptic([10, 30, 10, 30, 20]); }
  };

  global.Sound = Audio;
})(window);
