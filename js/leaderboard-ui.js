/* leaderboard-ui.js — screens and wiring for the optional weekly leaderboard.
 * Everything here is inert unless Leaderboard.enabled() (an https API URL is configured). */
(function (global) {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var deps = { playerName: function () { return 'Player'; }, onNameChanged: function () {} };
  var tab = 'global';
  var activeGroup = null;
  var returnTo = 'home';
  var busy = false;

  function init(options) {
    deps = Object.assign(deps, options || {});
    refreshEntry();
    el('btn-lb').addEventListener('click', function () { open('home'); });
    el('btn-lb-joinbar').addEventListener('click', function () { goJoin(); });
    el('btn-lb-friends-join').addEventListener('click', function () { goJoin(); });
    global.document.addEventListener('visibilitychange', function () { if (!global.document.hidden) refreshPreview(); });
    refreshPreview();
    el('btn-join-lb').addEventListener('click', function () { open('over'); });
    el('btn-lb-nothanks').addEventListener('click', function () { UI.show(returnTo); });
    el('btn-lb-join').addEventListener('click', join);
    el('btn-lb-back').addEventListener('click', function () { UI.show(returnTo); });
    el('lb-tab-global').addEventListener('click', function () { setTab('global'); });
    el('lb-tab-friends').addEventListener('click', function () { setTab('friends'); });
    el('btn-lb-create').addEventListener('click', createGroup);
    el('btn-lb-joincode').addEventListener('click', joinWithCode);
    el('btn-lb-share-code').addEventListener('click', shareGroup);
    el('btn-lb-delete').addEventListener('click', deleteData);
    el('btn-sheet-report').addEventListener('click', reportTarget);
    el('btn-sheet-hide').addEventListener('click', hideTarget);
    el('btn-sheet-cancel').addEventListener('click', closeSheet);
    el('btn-lb-unhide').addEventListener('click', unhideAll);
    global.addEventListener('online', function () { Leaderboard.flushPending(); });
    Leaderboard.flushPending();
  }

  function refreshEntry() {
    el('btn-lb').classList.toggle('hidden', !Leaderboard.enabled());
  }

  function weekLabel() {
    var id = Weekly.weekId();
    return 'Week ' + parseInt(id.split('-W')[1], 10) + ' • resets in ' + Weekly.resetLabel(Weekly.msUntilReset());
  }

  /* The board is public: anyone can look without joining. Joining is only needed to post a
     score, make or join friend groups. */
  function open(from) {
    returnTo = from || 'home';
    UI.show('lb');
    setTab(tab);
  }

  function goJoin() {
    el('lb-name-input').value = Store.name || '';
    UI.show('lb-optin');
  }

  function renderJoinState() {
    var joined = Leaderboard.isOptedIn();
    el('lb-join-banner').classList.toggle('hidden', joined);
    el('btn-lb-delete').classList.toggle('hidden', !Store.lb.deviceId);
  }

  function join() {
    // The player picks how they appear. It is also their name on the home screen.
    var chosen = (el('lb-name-input').value || '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!chosen) { UI.toast('Pick a name to show on the leaderboard.'); return; }
    Store.setName(chosen);
    deps.onNameChanged();
    Leaderboard.optIn();
    Leaderboard.flushPending();
    el('btn-join-lb').classList.add('hidden');
    UI.show('lb');
    setTab('global');
    refreshPreview(true);
  }

  function setStatus(text) { el('lb-status').textContent = text || ''; }

  function setTab(next) {
    tab = next;
    el('lb-tab-global').classList.toggle('active', tab === 'global');
    el('lb-tab-friends').classList.toggle('active', tab === 'friends');
    var joined = Leaderboard.isOptedIn();
    el('lb-friends').classList.toggle('hidden', tab !== 'friends' || !joined);
    el('lb-friends-join').classList.toggle('hidden', tab !== 'friends' || joined);
    el('lb-week').textContent = weekLabel();
    renderJoinState();
    if (tab === 'friends' && joined) {
      activeGroup = activeGroup || Store.lb.groups[0] || null;
      renderGroupCode();
    }
    refresh();
  }

  function renderGroupCode() {
    el('lb-group-code').textContent = activeGroup ? 'Group code: ' + activeGroup : 'Create a group or join one with a code.';
    el('btn-lb-share-code').classList.toggle('hidden', !activeGroup);
  }

  function refresh() {
    var weekId = Weekly.weekId();
    var list = el('lb-list');
    list.innerHTML = '';
    if (tab === 'friends' && (!activeGroup || !Leaderboard.isOptedIn())) { setStatus(''); return; }
    setStatus('Loading…');
    var request = tab === 'global' ? Leaderboard.board(weekId) : Leaderboard.groupBoard(activeGroup, weekId);
    request.then(function (data) {
      renderEntries(data);
    }, function (error) {
      setStatus(error.code === 'network' ? 'Can’t reach the leaderboard. Check your connection.' : error.message);
    });
  }

  /* ---- home screen preview: the top of this week's board, shown without joining ---- */
  var previewAt = 0;
  var previewBusy = false;

  /* Pure: what the home card shows for a board response (or a failure). */
  function previewModel(data, blocked, myRef) {
    if (!data) return { state: 'error', rows: [], footer: 'Tap to see this week\u2019s leaderboard' };
    var view = visibleEntries(data, blocked, myRef);
    var rows = view.rows.slice(0, 3).map(function (r) { return { rank: r.entry.rank, name: r.entry.name, score: r.entry.score, mine: r.mine }; });
    if (!rows.length) return { state: 'empty', rows: [], footer: 'No scores yet. Be the first this week!' };
    var you = data.you || null;
    var footer = you ? 'You are #' + you.rank + ' of ' + data.total : (data.total > rows.length ? data.total + ' players this week' : '');
    return { state: 'ready', rows: rows, footer: footer };
  }

  function renderPreview(model) {
    var list = el('lbp-list');
    list.innerHTML = '';
    model.rows.forEach(function (row) {
      var line = document.createElement('span');
      line.className = 'lbp-row' + (row.mine ? ' me' : '');
      [['rk', '#' + row.rank], ['nm', row.name], ['sc', String(row.score)]].forEach(function (pair) {
        var cell = document.createElement('span');
        cell.className = pair[0];
        cell.textContent = pair[1]; // names are user content: textContent only
        line.appendChild(cell);
      });
      list.appendChild(line);
    });
    el('lbp-footer').textContent = model.footer;
  }

  // Throttled: at most one request a minute unless forced (e.g. right after joining or posting).
  function refreshPreview(force) {
    if (!Leaderboard.enabled() || previewBusy) return;
    if (!force && previewAt && Date.now() - previewAt < 60000) return;
    previewBusy = true;
    if (!previewAt) el('lbp-footer').textContent = 'Loading this week\u2019s scores\u2026';
    Leaderboard.board(Weekly.weekId()).then(function (data) {
      previewAt = Date.now();
      renderPreview(previewModel(data, Leaderboard.blockedRefs(), Store.lb.myRef));
    }, function () {
      renderPreview(previewModel(null));
    }).then(function () { previewBusy = false; });
  }

  /* Which rows to show: drops players this device has hidden, and marks the player's own
     row (which can be neither reported nor hidden). Pure, so it is unit-tested. */
  function visibleEntries(data, blocked, myRef) {
    var set = {};
    (blocked || []).forEach(function (ref) { set[ref] = true; });
    var you = data && data.you ? data.you : null;
    var own = myRef || (you && you.ref) || '';
    var rows = [];
    var hiddenCount = 0;
    ((data && data.entries) || []).forEach(function (entry) {
      var mine = !!own && entry.ref === own;
      if (!mine && entry.ref && set[entry.ref]) { hiddenCount += 1; return; }
      rows.push({ entry: entry, mine: mine, reportable: !mine && !!entry.ref });
    });
    return { rows: rows, hiddenCount: hiddenCount };
  }

  var lastData = null;
  var sheetTarget = null;

  function renderEntries(data) {
    lastData = data;
    var list = el('lb-list');
    list.innerHTML = '';
    var view = visibleEntries(data, Leaderboard.blockedRefs(), Store.lb.myRef);
    var you = data.you || null;
    view.rows.forEach(function (row) {
      var li = document.createElement('li');
      var cls = [];
      if (row.mine) cls.push('me');
      if (row.reportable) cls.push('tappable');
      li.className = cls.join(' ');
      [['rk', '#' + row.entry.rank], ['nm', row.entry.name], ['sc', String(row.entry.score)]].forEach(function (pair) {
        var span = document.createElement('span');
        span.className = pair[0];
        span.textContent = pair[1]; // names are user content: textContent only, never innerHTML
        li.appendChild(span);
      });
      if (row.reportable) li.addEventListener('click', function () { openSheet(row.entry); });
      list.appendChild(li);
    });
    el('lb-hidden-count').textContent = view.hiddenCount;
    el('lb-hidden-note').classList.toggle('hidden', view.hiddenCount === 0);
    if (!view.rows.length) setStatus((data.entries || []).length ? 'Everyone here is hidden.' : 'No scores yet this week. Be the first!');
    else if (tab === 'global' && you) setStatus('You are #' + you.rank + ' of ' + data.total + '.');
    else setStatus('');
  }

  function openSheet(entry) {
    sheetTarget = entry;
    el('lb-sheet-title').textContent = entry.name;
    el('lb-sheet').classList.remove('hidden');
  }

  function closeSheet() {
    sheetTarget = null;
    el('lb-sheet').classList.add('hidden');
  }

  function reportTarget() {
    var target = sheetTarget;
    closeSheet();
    if (!target) return;
    // Hidden on this device at once; the server hides it for everyone after enough reports.
    Leaderboard.report(target.ref, Weekly.weekId(), 'name').then(function () {
      UI.toast('Thanks. We will review it, and the name is hidden for you.', 3500);
    }, function (error) {
      UI.toast(Leaderboard.isTransient(error) ? 'Hidden for you. The report will not reach us while offline.' : 'Hidden for you.', 3500);
    });
    if (lastData) renderEntries(lastData);
    refreshPreview(true);
  }

  function hideTarget() {
    var target = sheetTarget;
    closeSheet();
    if (!target) return;
    Leaderboard.block(target.ref);
    UI.toast('Hidden. You can show everyone again below.', 3000);
    if (lastData) renderEntries(lastData);
    refreshPreview(true);
  }

  function unhideAll() {
    Leaderboard.unblockAll();
    if (lastData) renderEntries(lastData);
    refreshPreview(true);
  }

  function guard(fn) {
    if (busy) return;
    busy = true;
    Promise.resolve().then(fn).catch(function (error) {
      setStatus(error && error.message ? error.message : 'Something went wrong.');
    }).then(function () { busy = false; });
  }

  function createGroup() {
    guard(function () {
      return Leaderboard.createGroup(deps.playerName()).then(function (res) {
        activeGroup = res.code;
        renderGroupCode();
        refresh();
      });
    });
  }

  function joinWithCode() {
    guard(function () {
      var code = Leaderboard.normalizeCode(el('lb-code-input').value);
      return Leaderboard.joinGroup(code, deps.playerName()).then(function () {
        activeGroup = code;
        el('lb-code-input').value = '';
        renderGroupCode();
        refresh();
      });
    });
  }

  function shareGroup() {
    if (!activeGroup) return;
    Share.shareText('Join my DON’T TAP THAT friend group! Code: ' + activeGroup).then(function (res) {
      if (res && res.method === 'clipboard') UI.toast('Group invite copied.');
    });
  }

  function deleteData() {
    if (!global.confirm('Delete your name, scores and friend groups from the leaderboard? This cannot be undone.')) return;
    guard(function () {
      return Leaderboard.deleteMyData().then(function () {
        activeGroup = null;
        UI.toast('Your leaderboard data was deleted.', 3500);
        UI.show('home');
      });
    });
  }

  /* Called after a weekly run ends. Shows rank when joined, or an invitation to join. */
  function afterWeeklyRun(run) {
    var rank = el('over-rank');
    var joinBtn = el('btn-join-lb');
    rank.classList.add('hidden');
    joinBtn.classList.add('hidden');
    if (!Leaderboard.enabled() || !(run.score >= 1)) return;
    if (!Leaderboard.isOptedIn()) { joinBtn.classList.remove('hidden'); return; }
    rank.textContent = 'Sending your score…';
    rank.classList.remove('hidden');
    Leaderboard.submit(run).then(function (res) {
      rank.textContent = 'Weekly rank #' + res.rank + ' of ' + res.total;
      refreshPreview(true); // the home card shows the new standing when you get back
    }, function (error) {
      if (Leaderboard.isTransient(error)) rank.textContent = 'Saved. It will post when you’re back online.';
      else rank.classList.add('hidden');
    });
  }

  global.LeaderboardUI = {
    init: init, afterWeeklyRun: afterWeeklyRun, refreshEntry: refreshEntry,
    visibleEntries: visibleEntries, previewModel: previewModel, refreshPreview: refreshPreview
  };
})(window);
