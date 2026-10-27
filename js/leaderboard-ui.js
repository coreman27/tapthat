/* leaderboard-ui.js — the leaderboard card on Home, the all-time leaderboard screen, and the
 * Weekly Challenge screen (its own board, your best, time left, and Play), all backed by
 * Game Center (js/gamecenter.js). Outside the iOS app the cards stay hidden. */
(function (global) {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var deps = { startWeekly: function () {} };
  var returnTo = 'home';
  var PREVIEW_ROWS = 3;
  var BOARD_ROWS = 25;

  /* ---- pure: what to show, so it is unit-tested ---- */

  // The home card (and any small preview) for a board, a failure, or a signed-out player.
  function previewModel(data, gc) {
    if (gc && !gc.checked) return { state: 'checking', rows: [], footer: 'Connecting to Game Center…' };
    if (gc && !gc.authenticated) return { state: 'signed_out', rows: [], footer: 'Sign in to Game Center to see the top players' };
    if (!data) return { state: 'error', rows: [], footer: 'Tap to see the leaderboard' };
    var rows = data.entries.slice(0, PREVIEW_ROWS);
    if (!rows.length) return { state: 'empty', rows: [], footer: 'No scores yet. Be the first!' };
    var footer = data.you ? 'You are #' + data.you.rank + ' of ' + data.total
      : 'Play a round to get on the board';
    return { state: 'ready', rows: rows, footer: footer };
  }

  // The full list. When the player is ranked below the rows shown, their own row is added at
  // the end so they can always find themselves.
  function boardRows(data) {
    var rows = data.entries.slice();
    if (data.you && !rows.some(function (r) { return r.mine; })) rows.push(Object.assign({ gap: true }, data.you, { mine: true }));
    return rows;
  }

  // "Mon, Nov 2" in the player's own language and time zone.
  function openingDay(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (e) { return new Date(ms).toDateString(); }
  }

  function boardStatus(data, scope, opens, notOpen) {
    if (opens && !data.entries.length) return 'The weekly leaderboard opens ' + openingDay(opens) + '. Runs from then on are ranked.';
    if (notOpen && !data.entries.length) return 'The weekly leaderboard isn\u2019t open yet. Runs are ranked once it opens.';
    if (!data.entries.length) return scope === 'friends' ? 'None of your Game Center friends have a score here yet.' : 'No scores yet. Be the first!';
    if (data.you) return 'You are #' + data.you.rank + ' of ' + data.total + '.';
    return 'Play a round to get on the board.';
  }

  function weekLine(id, msLeft) {
    return 'Week ' + parseInt(id.split('-W')[1], 10) + ' • New rounds in ' + global.Weekly.resetLabel(msLeft);
  }

  function failureText(error) {
    if (!error) return 'Can’t reach Game Center right now.';
    if (error.code === 'not_authenticated') return 'Sign in to Game Center in Settings to see the leaderboard.';
    if (error.code === 'friends_denied') return error.message;
    return 'Can’t reach Game Center right now. Check your connection.';
  }

  /* ---- drawing ---- */

  function row(r, tag, base) {
    var line = document.createElement(tag);
    line.className = [base, r.mine ? 'me' : '', r.gap ? 'gap' : ''].filter(Boolean).join(' ');
    [['rk', '#' + r.rank], ['nm', r.name], ['sc', String(r.score)]].forEach(function (pair) {
      var cell = document.createElement('span');
      cell.className = pair[0];
      cell.textContent = pair[1]; // other players' names: textContent only, never innerHTML
      line.appendChild(cell);
    });
    return line;
  }

  // One board on one screen: Everyone/Friends tabs, the list, and a status line.
  function boardView(ids, which) {
    var scope = 'global';
    var seq = 0;
    function setScope(next) {
      scope = next;
      el(ids.global).classList.toggle('active', scope === 'global');
      el(ids.friends).classList.toggle('active', scope === 'friends');
      return load();
    }
    function load() {
      var mine = ++seq;
      var list = el(ids.list);
      list.innerHTML = '';
      var gc = global.GameCenter.getState();
      if (!gc.authenticated) {
        el(ids.status).textContent = gc.checked ? 'Sign in to Game Center in Settings to see the leaderboard.' : 'Connecting to Game Center…';
        return Promise.resolve();
      }
      el(ids.status).textContent = 'Loading…';
      return global.GameCenter.board(which, scope, BOARD_ROWS).then(function (data) {
        if (mine !== seq) return;
        boardRows(data).forEach(function (r) { list.appendChild(row(r, 'li')); });
        el(ids.status).textContent = which === 'weekly'
          ? boardStatus(data, scope, global.Weekly.upcoming(), global.GameCenter.notOpen(data))
          : boardStatus(data, scope);
      }, function (error) {
        if (mine !== seq) return;
        el(ids.status).textContent = failureText(error);
      });
    }
    el(ids.global).addEventListener('click', function () { setScope('global'); });
    el(ids.friends).addEventListener('click', function () { setScope('friends'); });
    return { load: load, reset: function () { return setScope('global'); } };
  }

  var allTime, weekly;

  /* ---- home card: the top of the all-time board ---- */
  var previewAt = 0;
  var previewBusy = false;
  var previewAgain = false; // a forced refresh asked for while one was loading

  function renderPreview(model) {
    var list = el('lbp-list');
    list.innerHTML = '';
    model.rows.forEach(function (r) { list.appendChild(row(r, 'span', 'lbp-row')); });
    el('lbp-footer').textContent = model.footer;
  }

  // Throttled: at most one request a minute unless forced (after a run, or on sign-in).
  function refreshPreview(force) {
    var gc = global.GameCenter.getState();
    el('btn-lb').classList.toggle('hidden', !gc.supported);
    if (!gc.supported) return;
    if (!gc.authenticated) { renderPreview(previewModel(null, gc)); return; }
    if (previewBusy) { if (force) previewAgain = true; return; }
    if (!force && previewAt && Date.now() - previewAt < 60000) return;
    previewBusy = true;
    if (!previewAt) el('lbp-footer').textContent = 'Loading the leaderboard…';
    global.GameCenter.board('best', 'global', PREVIEW_ROWS).then(function (data) {
      previewAt = Date.now();
      renderPreview(previewModel(data, gc));
    }, function () {
      renderPreview(previewModel(null, gc));
    }).then(function () {
      previewBusy = false;
      // e.g. the saved best finished posting while the card was loading: load once more
      if (previewAgain) { previewAgain = false; refreshPreview(true); }
    });
  }

  /* ---- the screens ---- */

  function openAllTime(from) {
    returnTo = from || 'home';
    UI.show('lb');
    allTime.reset();
  }

  function renderWeeklyInfo() {
    var id = global.Weekly.weekId();
    el('wk-when').textContent = weekLine(id, global.Weekly.msUntilReset());
    var best = global.Store.weeklyBest(id);
    var plays = global.Store.weeklyPlays(id);
    el('wk-best').textContent = best ? String(best) : '—';
    el('wk-plays').textContent = plays ? plays + (plays === 1 ? ' run' : ' runs') + ' this week' : 'Not played yet';
  }

  function openWeekly() {
    UI.show('weekly');
    renderWeeklyInfo();
    // Loading the weekly board also refreshes Apple's period, so the week line is re-drawn after.
    weekly.reset().then(renderWeeklyInfo);
  }

  function showInGameCenter(which) {
    global.GameCenter.show(which).catch(function (error) { UI.toast(failureText(error), 3500); });
  }

  /* After any finished (not assisted) run: post and show the player's standing. */
  function afterRun(run) {
    var line = el('over-rank');
    var which = run.weeklyId ? 'weekly' : 'best';
    var gc = global.GameCenter.getState();
    line.classList.add('hidden');
    if (!gc.supported || !(run.score >= 1)) return Promise.resolve();
    line.classList.remove('hidden');
    if (!gc.authenticated) { line.textContent = 'Sign in to Game Center to get ranked.'; return Promise.resolve(); }
    line.textContent = 'Posting your score…';
    return global.GameCenter.afterRun(which).then(function (result) {
      if (result.status === 'ranked') line.textContent = (which === 'weekly' ? 'Weekly rank #' : 'All-time rank #') + result.rank + ' of ' + result.total;
      else if (result.status === 'not_open') line.textContent = result.opens ? 'The weekly leaderboard opens ' + openingDay(result.opens) + '.' : 'The weekly leaderboard isn\u2019t open yet.';
      else line.textContent = 'Saved. It posts to Game Center when you’re back online.';
      previewAt = 0; // the home card shows the new standing when you get back
    });
  }

  function init(options) {
    deps = Object.assign(deps, options || {});
    allTime = boardView({ global: 'lb-tab-global', friends: 'lb-tab-friends', list: 'lb-list', status: 'lb-status' }, 'best');
    weekly = boardView({ global: 'wk-tab-global', friends: 'wk-tab-friends', list: 'wk-list', status: 'wk-status' }, 'weekly');
    el('btn-lb').addEventListener('click', function () { openAllTime('home'); });
    el('btn-lb-back').addEventListener('click', function () { UI.show(returnTo); });
    el('btn-lb-gc').addEventListener('click', function () { showInGameCenter('best'); });
    el('btn-wk-play').addEventListener('click', function () { deps.startWeekly(); });
    el('btn-wk-gc').addEventListener('click', function () { showInGameCenter('weekly'); });
    el('btn-wk-back').addEventListener('click', function () { UI.show('home'); });
    global.GameCenter.onChange(function () { refreshPreview(true); });
    global.document.addEventListener('visibilitychange', function () { if (!global.document.hidden) refreshPreview(); });
    refreshPreview();
  }

  global.LeaderboardUI = {
    init: init, afterRun: afterRun, openWeekly: openWeekly, openAllTime: openAllTime, refreshPreview: refreshPreview,
    renderWeeklyInfo: renderWeeklyInfo, openingDay: openingDay, previewModel: previewModel, boardRows: boardRows, boardStatus: boardStatus, weekLine: weekLine
  };
})(window);
