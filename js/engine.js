/* engine.js — round loop, countdown timer, success/fail resolution */
(function (global) {
  'use strict';

  var field, instrEl, timerFill, notifLayer, screenGame, scoreEl;
  var score = 0, lastId = null, running = false;
  var cleanups = [];
  var raf = 0, timerStart = 0, timerLimit = 0, tickedAt = 0;
  var resolved = false;
  var onUpdate = function () {}, onGameOver = function () {};

  function init(refs) {
    field = refs.field;
    instrEl = refs.instruction;
    timerFill = refs.timerFill;
    notifLayer = refs.notifLayer;
    screenGame = refs.screenGame;
    scoreEl = refs.scoreEl;
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
    timerFill.style.background = 'linear-gradient(90deg, var(--green), var(--yellow))';
    function frame() {
      var elapsed = performance.now() - timerStart;
      var remain = Math.max(0, 1 - elapsed / limit);
      timerFill.style.transform = 'scaleX(' + remain + ')';
      if (remain < 0.35) timerFill.style.background = 'linear-gradient(90deg, var(--danger), var(--yellow))';
      // tick in final second
      if (remain < 0.5 && performance.now() - tickedAt > 200) { tickedAt = performance.now(); Sound.tick(); }
      if (elapsed >= limit) { onExpire(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function stopTimer() { cancelAnimationFrame(raf); }

  function resolve(result, reason, category) {
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
      setTimeout(function () {
        screenGame.classList.remove('flash-bad');
        onGameOver({ score: score, reason: reason || 'Game over.', category: category });
      }, 260);
    } else {
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
    var def = Adaptive.pickNext(score, lastId);
    lastId = def.id;
    Store.recordPlay(def.category);
    var limit = Adaptive.timeLimit(def, score);

    var env = {
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
      success: function () { resolve('success', null, def.category); },
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

  function start() {
    score = 0;
    lastId = null;
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

  function stop() { running = false; stopTimer(); clearField(); }

  global.Engine = {
    init: init,
    start: start,
    stop: stop,
    onUpdate: function (fn) { onUpdate = fn; },
    onGameOver: function (fn) { onGameOver = fn; },
    getScore: function () { return score; }
  };
})(window);
