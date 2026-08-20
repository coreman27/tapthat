/* challenges.js — all challenge types.
 * Each definition:
 *   id, category, minScore (unlock), baseTime (ms @easy), minTime (ms @hard),
 *   timeoutResult: 'fail' | 'success'  (what happens if timer runs out),
 *   build(env): sets up DOM + handlers; may return/register cleanups.
 *
 * env = {
 *   field, notifLayer, fw, fh, difficulty(0..1), score,
 *   success(), fail(reason), setInstruction(html,{warn}),
 *   addCleanup(fn), makeBtn(opts), rint, pick, shuffle
 * }
 */
(function (global) {
  'use strict';

  var COLORS = [
    { name: 'BLUE', cls: 'blue' },
    { name: 'RED', cls: 'red' },
    { name: 'GREEN', cls: 'green' },
    { name: 'YELLOW', cls: 'yellow' },
    { name: 'PURPLE', cls: 'purple' }
  ];

  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // rectangle overlap test with padding
  function overlaps(r, list, pad) {
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (r.x < o.x + o.w + pad && r.x + r.w + pad > o.x &&
          r.y < o.y + o.h + pad && r.y + r.h + pad > o.y) return true;
    }
    return false;
  }

  // find non-overlapping positions for n boxes of given w/h
  function layout(env, n, w, h) {
    var placed = [];
    var pad = 12;
    for (var i = 0; i < n; i++) {
      var r = null;
      for (var tries = 0; tries < 200; tries++) {
        var cand = {
          x: rint(6, Math.max(6, env.fw - w - 6)),
          y: rint(6, Math.max(6, env.fh - h - 6)),
          w: w, h: h
        };
        if (!overlaps(cand, placed, pad)) { r = cand; break; }
      }
      if (!r) r = { x: rint(6, Math.max(6, env.fw - w - 6)), y: rint(6, Math.max(6, env.fh - h - 6)), w: w, h: h };
      placed.push(r);
    }
    return placed;
  }

  function tap(el, fn) {
    var handler = function (e) { e.preventDefault(); fn(e); };
    el.addEventListener('pointerdown', handler);
    return function () { el.removeEventListener('pointerdown', handler); };
  }

  // ---- Challenge definitions ----
  var DEFS = [];
  function def(d) { DEFS.push(d); }

  var BTN_COLORS = ['neutral', 'blue', 'red', 'green', 'yellow', 'purple'];

  // 1. TAP ME
  def({
    id: 'tapme', category: 'tap', minScore: 0, baseTime: 1900, minTime: 720,
    build: function (env) {
      var w = env.rint(140, 200), h = env.rint(90, 130);
      var p = layout(env, 1, w, h)[0];
      env.setInstruction('TAP ME');
      var cls = Math.random() < 0.4 ? env.pick(BTN_COLORS) : 'neutral';
      var b = env.makeBtn({ cls: cls, label: 'TAP ME', w: w, h: h, x: p.x, y: p.y, fs: 26 });
      env.addCleanup(tap(b, function () { env.success(); }));
    }
  });

  // 2. DON'T TAP ME  (survive the timer; touching it ends the run)
  def({
    id: 'donttap', category: 'wait', minScore: 1, baseTime: 1600, minTime: 900,
    timeoutResult: 'success',
    build: function (env) {
      var w = env.rint(150, 210), h = env.rint(100, 140);
      var p = layout(env, 1, w, h)[0];
      env.setInstruction('DON\u2019T TAP ME', { warn: true });
      var cls = Math.random() < 0.4 ? env.pick(BTN_COLORS) : 'red';
      var b = env.makeBtn({ cls: cls, label: 'DON\u2019T TAP ME', w: w, h: h, x: p.x, y: p.y, fs: 22 });
      env.addCleanup(tap(b, function () { env.fail('You tapped that.'); }));
    }
  });

  // 3. TAP <COLOR>
  def({
    id: 'tapcolor', category: 'color', minScore: 2, baseTime: 1800, minTime: 780,
    build: function (env) {
      var target = env.pick(COLORS);
      var n = Math.min(5, 2 + Math.round(env.difficulty * 3));
      var chosen = env.shuffle(COLORS).slice(0, n);
      if (chosen.indexOf(target) === -1) chosen[0] = target;
      env.setInstruction('TAP ' + target.name);
      var w = env.rint(90, 120), h = w;
      var pos = layout(env, chosen.length, w, h);
      chosen.forEach(function (c, i) {
        var b = env.makeBtn({ cls: c.cls, label: '', w: w, h: h, x: pos[i].x, y: pos[i].y });
        env.addCleanup(tap(b, function () {
          if (c === target) env.success(); else env.fail('Wrong color.');
        }));
      });
    }
  });

  // 4. DON'T TAP <COLOR>  (tap any button that is NOT that color)
  def({
    id: 'dontcolor', category: 'color', minScore: 5, baseTime: 1900, minTime: 850,
    build: function (env) {
      var bad = env.pick(COLORS);
      var pool = env.shuffle(COLORS).slice(0, Math.min(4, 3 + Math.round(env.difficulty)));
      if (pool.indexOf(bad) === -1) pool[0] = bad;
      // ensure at least one non-bad exists
      if (pool.every(function (c) { return c === bad; })) pool.push(env.pick(COLORS.filter(function (c) { return c !== bad; })));
      env.setInstruction('DON\u2019T TAP ' + bad.name, { warn: true });
      var w = env.rint(90, 120), h = w;
      var pos = layout(env, pool.length, w, h);
      pool.forEach(function (c, i) {
        var b = env.makeBtn({ cls: c.cls, label: '', w: w, h: h, x: pos[i].x, y: pos[i].y });
        env.addCleanup(tap(b, function () {
          if (c === bad) env.fail('You tapped ' + bad.name + '.'); else env.success();
        }));
      });
    }
  });

  // 5. TAP TWICE
  def({
    id: 'taptwice', category: 'sequence', minScore: 3, baseTime: 1700, minTime: 820,
    build: function (env) {
      var w = env.rint(150, 200), h = 120;
      var p = layout(env, 1, w, h)[0];
      env.setInstruction('TAP TWICE');
      var count = 0;
      var b = env.makeBtn({ cls: 'neutral', label: 'TAP TWICE', w: w, h: h, x: p.x, y: p.y, fs: 24 });
      env.addCleanup(tap(b, function () {
        count++;
        b.textContent = count === 1 ? 'ONCE MORE' : 'TAP TWICE';
        if (count >= 2) env.success();
      }));
    }
  });

  // 6. HOLD
  def({
    id: 'hold', category: 'sequence', minScore: 4, baseTime: 2200, minTime: 1400,
    build: function (env) {
      var w = 200, h = 140;
      var p = layout(env, 1, w, h)[0];
      var need = 400 + env.difficulty * 300; // ms to hold
      env.setInstruction('HOLD');
      var b = env.makeBtn({ cls: 'purple', label: 'HOLD', w: w, h: h, x: p.x, y: p.y, fs: 26 });
      var gauge = document.createElement('div');
      gauge.className = 'hold-gauge';
      b.appendChild(gauge);
      var startT = 0, raf = 0, done = false, holding = false;
      function frame() {
        if (!holding) return;
        var pct = Math.min(1, (performance.now() - startT) / need);
        gauge.style.width = (pct * 100) + '%';
        if (pct >= 1 && !done) { done = true; env.success(); return; }
        raf = requestAnimationFrame(frame);
      }
      function down(e) { e.preventDefault(); holding = true; startT = performance.now(); raf = requestAnimationFrame(frame); }
      function up() {
        if (done) return;
        holding = false;
        cancelAnimationFrame(raf);
        if (gauge.offsetWidth > 4) env.fail('Released too early.');
        gauge.style.width = '0%';
      }
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      env.addCleanup(function () {
        cancelAnimationFrame(raf);
        b.removeEventListener('pointerdown', down);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', up);
        b.removeEventListener('pointerleave', up);
      });
    }
  });

  // 7. SWIPE <dir>
  def({
    id: 'swipe', category: 'gesture', minScore: 6, baseTime: 1900, minTime: 900,
    build: function (env) {
      var dirs = [
        { name: 'LEFT', arrow: '\u2190', dx: -1, dy: 0 },
        { name: 'RIGHT', arrow: '\u2192', dx: 1, dy: 0 },
        { name: 'UP', arrow: '\u2191', dx: 0, dy: -1 },
        { name: 'DOWN', arrow: '\u2193', dx: 0, dy: 1 }
      ];
      var d = env.pick(dirs);
      env.setInstruction('SWIPE ' + d.name + ' ' + d.arrow);
      var w = 170, h = 170;
      var p = { x: (env.fw - w) / 2, y: (env.fh - h) / 2 };
      var b = env.makeBtn({ cls: 'neutral', label: d.arrow, w: w, h: h, x: p.x, y: p.y, fs: 64 });
      var sx = 0, sy = 0, tracking = false;
      function down(e) { e.preventDefault(); tracking = true; sx = e.clientX; sy = e.clientY; }
      function up(e) {
        if (!tracking) return; tracking = false;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) < 26 && Math.abs(dy) < 26) return; // too small, keep waiting
        var okX = d.dx !== 0 && (Math.abs(dx) > Math.abs(dy)) && Math.sign(dx) === d.dx;
        var okY = d.dy !== 0 && (Math.abs(dy) > Math.abs(dx)) && Math.sign(dy) === d.dy;
        if (okX || okY) env.success(); else env.fail('Wrong way.');
      }
      env.field.addEventListener('pointerdown', down);
      env.field.addEventListener('pointerup', up);
      env.addCleanup(function () {
        env.field.removeEventListener('pointerdown', down);
        env.field.removeEventListener('pointerup', up);
      });
    }
  });

  // 8. TAP THE SMALLER / BIGGER ONE
  def({
    id: 'tapsize', category: 'size', minScore: 4, baseTime: 1800, minTime: 800,
    build: function (env) {
      var smaller = Math.random() < 0.5;
      env.setInstruction('TAP THE ' + (smaller ? 'SMALLER' : 'BIGGER') + ' ONE');
      var big = env.rint(140, 180), small = env.rint(70, 95);
      var pos = layout(env, 2, big, big);
      var sizes = [big, small];
      // shuffle which index is big
      var bigFirst = Math.random() < 0.5;
      var arr = bigFirst ? [big, small] : [small, big];
      var winnerIdx = smaller ? arr.indexOf(small) : arr.indexOf(big);
      arr.forEach(function (sz, i) {
        var b = env.makeBtn({ cls: 'neutral', label: '', w: sz, h: sz, x: pos[i].x, y: pos[i].y });
        env.addCleanup(tap(b, function () {
          if (i === winnerIdx) env.success(); else env.fail('Wrong size.');
        }));
      });
    }
  });

  // 10. TAP AFTER IT TURNS GREEN
  def({
    id: 'tapgreen', category: 'reflex', minScore: 5, baseTime: 2400, minTime: 1500,
    build: function (env) {
      var w = 200, h = 150;
      var p = { x: (env.fw - w) / 2, y: (env.fh - h) / 2 };
      env.setInstruction('TAP AFTER IT TURNS GREEN');
      var b = env.makeBtn({ cls: 'red', label: 'WAIT', w: w, h: h, x: p.x, y: p.y, fs: 30 });
      var green = false;
      var delay = env.rint(500, 1100);
      var to = setTimeout(function () { green = true; b.className = 'gbtn green'; b.textContent = 'TAP!'; Sound.ready(); }, delay);
      env.addCleanup(tap(b, function () {
        if (green) env.success(); else env.fail('Too early!');
      }));
      env.addCleanup(function () { clearTimeout(to); });
    }
  });

  // 11. STROOP — TAP THE WORD "X"  (words are colored to mislead)
  def({
    id: 'stroop', category: 'stroop', minScore: 7, baseTime: 2100, minTime: 1000,
    build: function (env) {
      var target = env.pick(COLORS);
      var n = Math.min(4, 3 + Math.round(env.difficulty));
      var words = env.shuffle(COLORS).slice(0, n);
      if (words.indexOf(target) === -1) words[0] = target;
      env.setInstruction('TAP THE WORD \u201C' + target.name + '\u201D');
      var w = env.rint(120, 150), h = 90;
      var pos = layout(env, words.length, w, h);
      words.forEach(function (word, i) {
        // ink color deliberately different from the word
        var ink = env.pick(COLORS.filter(function (c) { return c !== word; }));
        var b = env.makeBtn({ cls: 'neutral', label: word.name, w: w, h: h, x: pos[i].x, y: pos[i].y, fs: 26 });
        b.style.background = '#1c1c2b';
        b.style.color = cssColor(ink.cls);
        env.addCleanup(tap(b, function () {
          if (word === target) env.success(); else env.fail('That word wasn\u2019t ' + target.name + '.');
        }));
      });
    }
  });

  // 12. TAP THE NUMBER N
  def({
    id: 'tapnumber', category: 'find', minScore: 6, baseTime: 1900, minTime: 900,
    build: function (env) {
      var n = Math.min(6, 3 + Math.round(env.difficulty * 3));
      var nums = env.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, n);
      var target = env.pick(nums);
      env.setInstruction('TAP ' + target);
      var w = 84, h = 84;
      var pos = layout(env, nums.length, w, h);
      nums.forEach(function (num, i) {
        var b = env.makeBtn({ cls: 'neutral', label: String(num), w: w, h: h, x: pos[i].x, y: pos[i].y, fs: 34 });
        env.addCleanup(tap(b, function () {
          if (num === target) env.success(); else env.fail('That was ' + num + '.');
        }));
      });
    }
  });

  // 13. RUNAWAY — catch the fleeing button
  def({
    id: 'runaway', category: 'distractor', minScore: 8, baseTime: 2600, minTime: 1500,
    build: function (env) {
      env.setInstruction('CATCH IT');
      var w = 110, h = 110;
      var x = (env.fw - w) / 2, y = (env.fh - h) / 2;
      var b = env.makeBtn({ cls: 'green', label: 'CATCH', w: w, h: h, x: x, y: y, fs: 22 });
      var vx = (Math.random() < 0.5 ? -1 : 1) * (2 + env.difficulty * 2);
      var vy = (Math.random() < 0.5 ? -1 : 1) * (2 + env.difficulty * 2);
      var px = -999, py = -999;
      function move(e) { px = e.clientX; py = e.clientY; }
      env.field.addEventListener('pointermove', move);
      var raf = 0;
      function frame() {
        var rect = env.field.getBoundingClientRect();
        var cx = rect.left + x + w / 2, cy = rect.top + y + h / 2;
        var dx = cx - px, dy = cy - py;
        var dist = Math.hypot(dx, dy);
        if (dist < 130) { // flee from finger
          x += (dx / (dist || 1)) * 6;
          y += (dy / (dist || 1)) * 6;
        }
        x += vx; y += vy;
        if (x < 0) { x = 0; vx = Math.abs(vx); }
        if (x > env.fw - w) { x = env.fw - w; vx = -Math.abs(vx); }
        if (y < 0) { y = 0; vy = Math.abs(vy); }
        if (y > env.fh - h) { y = env.fh - h; vy = -Math.abs(vy); }
        b.style.left = x + 'px'; b.style.top = y + 'px';
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      env.addCleanup(tap(b, function () { env.success(); }));
      env.addCleanup(function () { cancelAnimationFrame(raf); env.field.removeEventListener('pointermove', move); });
    }
  });

  // 14. MOVING TARGETS — TAP <COLOR> while buttons drift
  def({
    id: 'moving', category: 'distractor', minScore: 9, baseTime: 2400, minTime: 1300,
    build: function (env) {
      var target = env.pick(COLORS);
      var chosen = env.shuffle(COLORS).slice(0, 3);
      if (chosen.indexOf(target) === -1) chosen[0] = target;
      env.setInstruction('TAP ' + target.name + ' (moving)');
      var w = 96, h = 96;
      var pos = layout(env, chosen.length, w, h);
      var items = chosen.map(function (c, i) {
        var b = env.makeBtn({ cls: c.cls, label: '', w: w, h: h, x: pos[i].x, y: pos[i].y });
        env.addCleanup(tap(b, function () {
          if (c === target) env.success(); else env.fail('Wrong color.');
        }));
        return {
          el: b, x: pos[i].x, y: pos[i].y,
          vx: (Math.random() < 0.5 ? -1 : 1) * (1.5 + env.difficulty * 2.5),
          vy: (Math.random() < 0.5 ? -1 : 1) * (1.5 + env.difficulty * 2.5)
        };
      });
      var raf = 0;
      function frame() {
        items.forEach(function (it) {
          it.x += it.vx; it.y += it.vy;
          if (it.x < 0 || it.x > env.fw - w) it.vx *= -1;
          if (it.y < 0 || it.y > env.fh - h) it.vy *= -1;
          it.x = Math.max(0, Math.min(env.fw - w, it.x));
          it.y = Math.max(0, Math.min(env.fh - h, it.y));
          it.el.style.left = it.x + 'px'; it.el.style.top = it.y + 'px';
        });
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      env.addCleanup(function () { cancelAnimationFrame(raf); });
    }
  });

  // 15. FAKE NOTIFICATION — IGNORE IT (tapping the notif ends the run)
  def({
    id: 'notif', category: 'distractor', minScore: 8, baseTime: 1800, minTime: 1100,
    timeoutResult: 'success',
    build: function (env) {
      env.setInstruction('IGNORE THE NOTIFICATION', { warn: true });
      var samples = [
        { app: 'Messages', who: 'Mom', msg: 'Call me back please' },
        { app: 'Bank', who: 'Alerts', msg: 'Suspicious login detected' },
        { app: 'Instagram', who: 'someone', msg: 'tagged you in a photo' },
        { app: 'Mail', who: 'Boss', msg: 'Are you free right now?' },
        { app: 'Reminders', who: 'TODAY', msg: 'You forgot something' }
      ];
      var s = env.pick(samples);
      var n = document.createElement('div');
      n.className = 'fake-notif';
      n.innerHTML = '<div class="ic"></div><div class="tx"><b>' + s.who + '</b><span>' + s.msg + '</span></div><div class="tm">now</div>';
      env.notifLayer.appendChild(n);
      function down(e) { e.preventDefault(); env.fail('You checked your phone.'); }
      n.addEventListener('pointerdown', down);
      env.addCleanup(function () { n.removeEventListener('pointerdown', down); if (n.parentNode) n.parentNode.removeChild(n); });
    }
  });

  // 16. SCREEN ROTATES — TAP ME while rotated
  def({
    id: 'rotate', category: 'distractor', minScore: 10, baseTime: 2400, minTime: 1500,
    build: function (env) {
      env.setInstruction('TAP ME');
      var rot = env.pick(['rotate-90', 'rotate-180', 'rotate-270']);
      env.field.classList.add(rot);
      var w = 170, h = 110;
      var p = layout(env, 1, w, h)[0];
      var b = env.makeBtn({ cls: 'neutral', label: 'TAP ME', w: w, h: h, x: p.x, y: p.y, fs: 24 });
      env.addCleanup(tap(b, function () { env.success(); }));
      env.addCleanup(function () { env.field.classList.remove(rot); });
    }
  });

  // 17. BAIT & SWITCH — instruction changes at the last instant
  def({
    id: 'lastinstant', category: 'reflex', minScore: 12, baseTime: 2200, minTime: 1500,
    build: function (env) {
      // Starts looking like TAP ME, then flips to DON'T TAP (or a color)
      var w = 180, h = 120;
      var p = layout(env, 1, w, h)[0];
      env.setInstruction('TAP ME');
      var b = env.makeBtn({ cls: 'neutral', label: 'TAP ME', w: w, h: h, x: p.x, y: p.y, fs: 24 });
      var flipped = false;
      var handler = tap(b, function () {
        if (!flipped) env.success();
        else env.fail('It said DON\u2019T.');
      });
      env.addCleanup(handler);
      var to = setTimeout(function () {
        flipped = true;
        b.className = 'gbtn red';
        b.textContent = 'DON\u2019T TAP';
        env.setInstruction('DON\u2019T TAP', { warn: true });
        Sound.tick();
      }, env.rint(650, 1000));
      env.addCleanup(function () { clearTimeout(to); });
      // when flipped, doing nothing should succeed
      env._timeoutFlip = function () { return flipped; };
    },
    // dynamic timeout result: if flipped => success (you correctly didn't tap)
    timeoutResult: function (env) { return (env._timeoutFlip && env._timeoutFlip()) ? 'success' : 'fail'; }
  });

  function cssColor(cls) {
    switch (cls) {
      case 'blue': return '#3b82f6';
      case 'red': return '#ff3b46';
      case 'green': return '#22c55e';
      case 'yellow': return '#f5c518';
      case 'purple': return '#a855f7';
      default: return '#ffffff';
    }
  }

  global.Challenges = {
    DEFS: DEFS,
    rint: rint,
    pick: pick,
    shuffle: shuffle
  };
})(window);
