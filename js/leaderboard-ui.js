/* leaderboard-ui.js — screens and wiring for the optional weekly leaderboard.
 * Everything here is inert unless Leaderboard.enabled() (an https API URL is configured). */
(function (global) {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var deps = { playerName: function () { return 'Player'; } };
  var tab = 'global';
  var activeGroup = null;
  var returnTo = 'home';
  var busy = false;

  function init(options) {
    deps = Object.assign(deps, options || {});
    refreshEntry();
    el('btn-lb').addEventListener('click', function () { open('home'); });
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

  function open(from) {
    returnTo = from || 'home';
    if (!Leaderboard.isOptedIn()) { UI.show('lb-optin'); return; }
    UI.show('lb');
    setTab(tab);
  }

  function join() {
    Leaderboard.optIn();
    Leaderboard.flushPending();
    el('btn-join-lb').classList.add('hidden');
    UI.show('lb');
    setTab('global');
  }

  function setStatus(text) { el('lb-status').textContent = text || ''; }

  function setTab(next) {
    tab = next;
    el('lb-tab-global').classList.toggle('active', tab === 'global');
    el('lb-tab-friends').classList.toggle('active', tab === 'friends');
    el('lb-friends').classList.toggle('hidden', tab !== 'friends');
    el('lb-week').textContent = weekLabel();
    if (tab === 'friends') {
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
    if (tab === 'friends' && !activeGroup) { setStatus(''); return; }
    setStatus('Loading…');
    var request = tab === 'global' ? Leaderboard.board(weekId) : Leaderboard.groupBoard(activeGroup, weekId);
    request.then(function (data) {
      renderEntries(data);
    }, function (error) {
      setStatus(error.code === 'network' ? 'Can’t reach the leaderboard. Check your connection.' : error.message);
    });
  }

  function renderEntries(data) {
    var list = el('lb-list');
    list.innerHTML = '';
    var you = data.you || null;
    (data.entries || []).forEach(function (entry) {
      var li = document.createElement('li');
      if (you && entry.rank === you.rank && entry.name === you.name && entry.score === you.score) li.className = 'me';
      [['rk', '#' + entry.rank], ['nm', entry.name], ['sc', String(entry.score)]].forEach(function (pair) {
        var span = document.createElement('span');
        span.className = pair[0];
        span.textContent = pair[1]; // names are user content: textContent only, never innerHTML
        li.appendChild(span);
      });
      list.appendChild(li);
    });
    if (!(data.entries || []).length) setStatus('No scores yet this week. Be the first!');
    else if (tab === 'global' && you) setStatus('You are #' + you.rank + ' of ' + data.total + '.');
    else setStatus('');
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
    }, function (error) {
      if (Leaderboard.isTransient(error)) rank.textContent = 'Saved. It will post when you’re back online.';
      else rank.classList.add('hidden');
    });
  }

  global.LeaderboardUI = { init: init, afterWeeklyRun: afterWeeklyRun, refreshEntry: refreshEntry };
})(window);
