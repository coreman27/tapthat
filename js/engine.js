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

  /* Tap discipline. A tap round is cleared by one clean tap on the right button:
     - a tap that isn't on a button (missing it) fails, in rounds that ask for a tap;
     - a press longer than HOLD_MS is a hold, not a tap, and fails;
     - another tap within EXTRA_TAP_MS of letting go is a double tap, and fails.
     The round counts the moment the right button is touched (instant point, sound and buzz).
     Then a short "guard" runs until the finger lifts plus EXTRA_TAP_MS: that gap is also the pause
     before the next command, so the rules cost no extra time. A hold or second tap during the
     guard ends the run (the round already cleared still counts). */
  var HOLD_MS = 450;
  var EXTRA_TAP_MS = 150;
  var currentDef = null, currentEnv = null;
  var pointerDown = false, downAt = 0;
  var guarding = false, guardCategory = null, guardTimer = 0;

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
    if (guarding) { failDuringGuard('Double tap. One tap only.'); return; }
    if (resolved) return;
    // Anywhere on the game screen that isn't a button counts: the play area, the command, the score, the timer.
    if (missFails() && !isButton(e.target)) {
      resolve('fail', 'Missed the button.', currentDef.category);
    }
  }

  function onScreenUp() {
    pointerDown = false;
    if (!guarding) return;
    clearTimeout(guardTimer);
    guardTimer = setTimeout(endGuard, EXTRA_TAP_MS);
  }

  // After a cleared tap round: wait for a clean release, then the next command.
  function startGuard(category) {
    guarding = true;
    guardCategory = category;
    if (pointerDown) {
      var left = Math.max(0, HOLD_MS - (performance.now() - downAt));
      guardTimer = setTimeout(function () { failDuringGuard('That was a hold. Just tap.'); }, left);
    } else {
      guardTimer = setTimeout(endGuard, EXTRA_TAP_MS);
    }
  }

  function endGuard() {
    if (!guarding) return;
    guarding = false;
    if (running) nextRound();
  }

  function failDuringGuard(reason) {
    if (!guarding) return;
    clearTimeout(guardTimer);
    guarding = false;
    resolved = false; // the cleared round stays counted; this ends the run
    resolve('fail', reason, guardCategory);
  }

  function cancelGuard() {
    clearTimeout(guardTimer);
    guarding = false;
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

  function resolve(result, reason, category, viaTap) {
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
      rounds.push(Math.max(1, Math.round(performance.now() - timerStart)));
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
      // A tap round goes on after a clean release (the guard); anything else after a short beat.
      if (viaTap) startGuard(category);
      else setTimeout(function () { if (running) nextRound(); }, 170);
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
      // Counts at once; tap rounds then guard against a double tap or hold (see tap discipline above).
      success: function () { resolve('success', null, def.category, !!def.tap); },
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
    cancelGuard();
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

  function stop() { running = false; canResume = false; cancelGuard(); stopTimer(); clearField(); Challenges.setRng(null); }

  // Rewarded Continue: pick up a failed casual run at its current score with a fresh
  // challenge after a short ready beat. Allowed once per run; the run is then "assisted".
  function resume() {
    if (!canResume || running) return false;
    canResume = false;
    assisted = true;
    cancelGuard();
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
