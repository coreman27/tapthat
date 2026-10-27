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

  // iPhone has no navigator.vibrate: use Capacitor's native Haptics plugin (the Taptic Engine) there.
  // kind: 'light' | 'medium' | 'error' | 'success'. The pattern is the fallback for other browsers.
  var nativeHaptics = null;
  function hapticsPlugin() {
    if (nativeHaptics !== null) return nativeHaptics;
    var C = global.Capacitor;
    nativeHaptics = (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.Haptics) || false;
    return nativeHaptics;
  }

  function haptic(kind, pattern) {
    if (Store.muted) return;
    var h = hapticsPlugin();
    try {
      if (h) {
        var call = kind === 'error' ? h.notification({ type: 'ERROR' })
          : kind === 'success' ? h.notification({ type: 'SUCCESS' })
          : h.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
        if (call && typeof call.catch === 'function') call.catch(function () {});
      } else if (global.navigator && global.navigator.vibrate) {
        global.navigator.vibrate(pattern);
      }
    } catch (e) { /* haptics are a nicety */ }
  }

  var Audio = {
    unlock: function () { var c = ac(); if (c && c.state === 'suspended') c.resume(); },
    good: function () { tone(660, 0.09, 'triangle', 0.16); haptic('light', 8); },
    great: function () { tone(660, 0.07, 'triangle', 0.16); tone(990, 0.1, 'triangle', 0.16, 0.06); haptic('medium', 12); },
    bad: function () { tone(150, 0.35, 'sawtooth', 0.22); haptic('error', [30, 40, 60]); },
    tick: function () { tone(1200, 0.03, 'square', 0.05); },
    ready: function () { tone(520, 0.05, 'sine', 0.12); },
    best: function () { tone(660, 0.1, 'triangle', 0.18); tone(880, 0.1, 'triangle', 0.18, 0.09); tone(1320, 0.16, 'triangle', 0.18, 0.18); haptic('success', [10, 30, 10, 30, 20]); }
  };

  global.Sound = Audio;
})(window);
