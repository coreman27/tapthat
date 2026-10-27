/* engine.js — round loop, countdown timer, success/fail resolution */
(function (global) {
  'use strict';

  var field, instrEl, timerFill, notifLayer, screenGame, scoreEl;
  var score = 0, lastId = null, running = false;
  var weeklyId = null, round = 0; // weeklyId set => seeded weekly run
  var rounds = [];                // ms from round start to success, one per cleared round
  var canResume = false;          // last run failed and has not used its one continue yet
  var assisted = false;           // this run was continued once (Rewarded Continue)
  var cleanups = [];
  var raf = 0, timerStart = 0, timerLimit = 0, tickedAt = 0;
  var resolved = false;
  var onUpdate = function () {}, onGameOver = function () {};

  /* Tap discipline. A tap round is only cleared by one clean tap on the right button:
     - a tap on empty space (missing the button) fails, in rounds that ask for a tap;
     - a press longer than HOLD_MS is a hold, not a tap, and fails;
     - another tap within EXTRA_TAP_MS of letting go is a double tap, and fails.
     So a correct tap "settles" (finger up, then a short quiet window) before it counts.
     The reaction time still counts from the moment the button was touched. */
  var HOLD_MS = 450;
  var EXTRA_TAP_MS = 180;
  var currentDef = null, currentEnv = null;
  var pointerDown = false, downAt = 0;
  var settling = false, settleCategory = null, settleElapsed = 0, settleTimer = 0;

  function init(refs) {
    field = refs.field;
    instrEl = refs.instruction;
    timerFill = refs.timerFill;
    notifLayer = refs.notifLayer;
    screenGame = refs.screenGame;
    scoreEl = refs.scoreEl;
    // Capture phase: this sees every touch on the game screen before the buttons do.
    screenGame.addEventListener('pointerdown', onScreenDown, true);
    screenGame.addEventListener('pointerup', onScreenUp, true);
    screenGame.addEventListener('pointercancel', onScreenUp, true);
  }

  function isButton(target) {
    for (var node = target; node; node = node.parentNode) {
      if (node.classList && node.classList.contains('gbtn')) return true;
    }
    return false;
  }

  function missFails() {
    if (!currentDef || !currentDef.miss) return false;
    return typeof currentDef.miss === 'function' ? !!currentDef.miss(currentEnv) : true;
  }

  function onScreenDown(e) {
    pointerDown = true;
    downAt = performance.now();
    if (!running) return;
    if (settling) { finishSettle('fail', 'Double tap. One tap only.'); return; }
    if (resolved) return;
    // Anywhere on the game screen that isn't a button counts: the play area, the command, the score, the timer.
    if (missFails() && !isButton(e.target)) {
      resolve('fail', 'Missed the button.', currentDef.category);
    }
  }

  function onScreenUp() {
    pointerDown = false;
    if (!settling) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { finishSettle('success'); }, EXTRA_TAP_MS);
  }

  // A correct tap landed: stop the clock, clear the board, and wait for a clean release.
  function beginSettle(category) {
    if (resolved) return;
    resolved = true;
    settling = true;
    settleCategory = category;
    settleElapsed = performance.now() - timerStart;
    stopTimer();
    clearField();
    if (pointerDown) {
      var left = Math.max(0, HOLD_MS - (performance.now() - downAt));
      settleTimer = setTimeout(function () { finishSettle('fail', 'That was a hold. Just tap.'); }, left);
    } else {
      settleTimer = setTimeout(function () { finishSettle('success'); }, EXTRA_TAP_MS);
    }
  }

  function finishSettle(result, reason) {
    if (!settling) return;
    clearTimeout(settleTimer);
    settling = false;
    resolved = false;
    resolve(result, reason, settleCategory, settleElapsed);
  }

  function cancelSettle() {
    clearTimeout(settleTimer);
    settling = false;
  }

  function clearField() {
    cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    cleanups = [];
    field.className = 'playfield';
    field.innerHTML = '';
    notifLayer.innerHTML = '';
  }

  function makeBtn(o) {
    var b = document.createElement('button');
    b.className = 'gbtn ' + (o.cls || 'neutral');
    b.style.width = o.w + 'px';
    b.style.height = o.h + 'px';
    b.style.left = o.x + 'px';
    b.style.top = o.y + 'px';
    if (o.fs) b.style.fontSize = o.fs + 'px';
    if (o.label) b.textContent = o.label;
    field.appendChild(b);
    return b;
  }

  function setInstruction(text, opts) {
    instrEl.textContent = text;
    instrEl.classList.toggle('warn', !!(opts && opts.warn));
  }

  function startTimer(limit, onExpire) {
    timerLimit = limit;
    timerStart = performance.now();
    tickedAt = 0;
    timerFill.style.transform = 'scaleX(1)';
    timerFill.style.background = 'var(--green)';
    function frame() {
      var elapsed = performance.now() - timerStart;
      var remain = Math.max(0, 1 - elapsed / limit);
      timerFill.style.transform = 'scaleX(' + remain + ')';
      if (remain < 0.35) timerFill.style.background = 'var(--danger)';
      // tick in final second
      if (remain < 0.5 && performance.now() - tickedAt > 200) { tickedAt = performance.now(); Sound.tick(); }
      if (elapsed >= limit) { onExpire(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function stopTimer() { cancelAnimationFrame(raf); }

  function resolve(result, reason, category, elapsed) {
    if (resolved) return;
    resolved = true;
    stopTimer();
    if (result === 'fail') {
      Store.recordFail(category);
      clearField();
      Sound.bad();
      screenGame.classList.remove('flash-good');
      screenGame.classList.add('flash-bad');
      running = false;
      var finished = weeklyId;
      // One continue per run, casual runs only: the weekly sequence is never assisted.
      canResume = !weeklyId && !assisted && score >= 1;
      Challenges.setRng(null);
      setTimeout(function () {
        screenGame.classList.remove('flash-bad');
        onGameOver({ score: score, reason: reason || 'Game over.', category: category, weeklyId: finished, rounds: rounds.slice(), assisted: assisted });
      }, 260);
    } else {
      rounds.push(Math.max(1, Math.round(elapsed === undefined ? performance.now() - timerStart : elapsed)));
      score += 1;
      onUpdate(score);
      scoreEl.classList.remove('score-bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('score-bump');
      if (score % 10 === 0) Sound.great(); else Sound.good();
      screenGame.classList.remove('flash-bad');
      screenGame.classList.add('flash-good');
      setTimeout(function () { screenGame.classList.remove('flash-good'); }, 220);
      clearField();
      setTimeout(function () { if (running) nextRound(); }, 170);
    }
  }

  function nextRound() {
    resolved = false;
    var rng = null;
    if (weeklyId) {
      rng = Weekly.rngFor(weeklyId, round);
      Challenges.setRng(rng);
    }
    round += 1;
    var def = Adaptive.pickNext(score, lastId, weeklyId ? { rand: rng, fixed: true } : null);
    lastId = def.id;
    currentDef = def;
    Store.recordPlay(def.category);
    var limit = Adaptive.timeLimit(def, score);

    var env = currentEnv = {
      field: field,
      notifLayer: notifLayer,
      fw: field.clientWidth,
      fh: field.clientHeight,
      difficulty: Adaptive.difficulty(score),
      score: score,
      rint: Challenges.rint,
      pick: Challenges.pick,
      shuffle: Challenges.shuffle,
      makeBtn: makeBtn,
      setInstruction: setInstruction,
      addCleanup: function (fn) { cleanups.push(fn); },
      // Tap rounds settle first (see tap discipline above); others count at once.
      success: function () { if (def.tap) beginSettle(def.category); else resolve('success', null, def.category); },
      fail: function (reason) { resolve('fail', reason, def.category); }
    };

    try {
      def.build(env);
    } catch (e) {
      // if a challenge blows up, don't punish the player
      console.error('challenge error', def.id, e);
      resolve('success', null, def.category);
      return;
    }

    startTimer(limit, function () {
      var tr = typeof def.timeoutResult === 'function' ? def.timeoutResult(env) : (def.timeoutResult || 'fail');
      if (tr === 'success') resolve('success', null, def.category);
      else resolve('fail', 'Too slow.', def.category);
    });
  }

  // opts.weeklyId: play the deterministic sequence for that week (e.g. "2026-W40").
  function start(opts) {
    score = 0;
    lastId = null;
    round = 0;
    rounds = [];
    canResume = false;
    assisted = false;
    weeklyId = (opts && opts.weeklyId) || null;
    Challenges.setRng(null);
    cancelSettle();
    currentDef = null;
    running = true;
    resolved = false;
    onUpdate(0);
    Sound.unlock();
    clearField();
    // short "ready" beat before first command
    setInstruction('GET READY');
    timerFill.style.transform = 'scaleX(1)';
    setTimeout(function () { if (running) nextRound(); }, 550);
  }

  function stop() { running = false; canResume = false; cancelSettle(); stopTimer(); clearField(); Challenges.setRng(null); }

  // Rewarded Continue: pick up a failed casual run at its current score with a fresh
  // challenge after a short ready beat. Allowed once per run; the run is then "assisted".
  function resume() {
    if (!canResume || running) return false;
    canResume = false;
    assisted = true;
    cancelSettle();
    currentDef = null;
    running = true;
    resolved = false;
    Sound.unlock();
    clearField();
    setInstruction('GET READY');
    timerFill.style.transform = 'scaleX(1)';
    setTimeout(function () { if (running) nextRound(); }, 900);
    return true;
  }

  global.Engine = {
    init: init,
    start: start,
    stop: stop,
    onUpdate: function (fn) { onUpdate = fn; },
    onGameOver: function (fn) { onGameOver = fn; },
    resume: resume,
    canResume: function () { return canResume && !running; },
    isAssisted: function () { return assisted; },
    getScore: function () { return score; },
    getRounds: function () { return rounds.slice(); },
    HOLD_MS: HOLD_MS,
    EXTRA_TAP_MS: EXTRA_TAP_MS
  };
})(window);
