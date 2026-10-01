/* main.js — bootstrap + wiring */
(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var challenger = null; // { name, score } if arriving from a friend link
  var gameActive = false;
  var storeReturnScreen = 'home';
  var lastMonetizationMessage = '';
  var runId = null;
  var pendingBreak = null;
  var transitioning = false;

  function playerName() {
    var n = (el('playerName').value || Store.name || '').trim();
    if (!n) n = 'Player';
    return n.slice(0, 14);
  }

  function refreshBest() {
    el('home-best').textContent = Store.best;
    el('hud-best').textContent = Store.best;
  }

  var runOpts = null; // { weeklyId } for the current/last run; null means a normal run

  function weeklyStatus() {
    var id = Weekly.weekId();
    var best = Store.weeklyBest(id);
    return 'Week ' + parseInt(id.split('-W')[1], 10) + ' • ' +
      (best ? 'your best ' + best : 'not played yet') + ' • new commands in ' +
      Weekly.resetLabel(Weekly.msUntilReset());
  }

  function refreshWeekly() {
    el('weekly-line').textContent = weeklyStatus();
  }

  var TAGS = { free: '', preview: 'PREVIEW', owned: 'OWNED', locked: 'LOCKED' };

  function renderThemes() {
    var list = el('theme-list');
    list.innerHTML = '';
    Themes.LIST.forEach(function (theme) {
      var state = Themes.ownership(theme.id);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card' + (theme.id === Store.theme || (theme.id === 'default' && !Themes.find(Store.theme)) ? ' selected' : '');
      card.disabled = state === 'locked';
      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      theme.swatch.forEach(function (color) {
        var chip = document.createElement('i');
        chip.style.background = color;
        swatch.appendChild(chip);
      });
      var meta = document.createElement('span');
      meta.className = 'meta';
      var name = document.createElement('strong');
      name.textContent = theme.name;
      var blurb = document.createElement('span');
      blurb.textContent = theme.blurb;
      meta.appendChild(name);
      meta.appendChild(blurb);
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = card.classList.contains('selected') ? 'IN USE' : TAGS[state];
      card.appendChild(swatch);
      card.appendChild(meta);
      card.appendChild(tag);
      card.addEventListener('click', function () { chooseTheme(theme.id); });
      list.appendChild(card);
    });
    el('themes-note').textContent = Themes.previewAll()
      ? 'Preview: every theme is free to try for now. Looks only — commands, timing and colors never change.'
      : 'Looks only. Commands, timing and colors never change.';
  }

  function chooseTheme(id) {
    var applied = Themes.apply(id);
    Store.setTheme(applied);
    renderThemes();
  }

  function startGame() { beginRun(null); }
  function startWeekly() { beginRun({ weeklyId: Weekly.weekId() }); }
  // Try Again keeps the current mode; a weekly run rolls over to the new week if it changed.
  function replay() { if (runOpts && runOpts.weeklyId) startWeekly(); else startGame(); }

  function beginRun(opts) {
    if (gameActive || transitioning || Monetization.getState().busy) return;
    runOpts = opts || null;
    try {
      runId = Monetization.startRun();
    } catch (error) {
      runId = null;
      reportMonetizationError(error, 'Ad timing is unavailable. You can still play.');
    }
    pendingBreak = null;
    gameActive = true;
    Sound.unlock();
    Store.setName((el('playerName').value || '').trim());
    // Dismiss the keyboard; iOS restores the viewport when dismissal completes.
    var nameInput = el('playerName');
    if (nameInput) nameInput.blur();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    UI.show('game');
    Engine.start(runOpts);
  }

  function renderGameOver(payload) {
    if (!gameActive) return;
    gameActive = false;
    Store.recordGame();
    var score = payload.score;
    var weeklyId = payload.weeklyId || null;
    var previousBest, isBest;
    if (weeklyId) {
      previousBest = Store.weeklyBest(weeklyId);
      isBest = Store.recordWeekly(weeklyId, score) && score > 0;
    } else {
      previousBest = Store.best;
      isBest = Store.setBest(score);
    }
    refreshBest();
    refreshWeekly();

    el('over-reason').textContent = payload.reason || 'Game over.';
    el('final-score').textContent = score;
    el('final-best').textContent = weeklyId ? Store.weeklyBest(weeklyId) : Store.best;
    el('over-mode').textContent = weeklyId ? 'Weekly challenge • week ' + parseInt(weeklyId.split('-W')[1], 10) : '';
    el('over-mode').classList.toggle('hidden', !weeklyId);
    el('new-best').textContent = weeklyId ? 'NEW WEEKLY BEST!' : 'NEW BEST!';
    el('new-best').classList.toggle('hidden', !isBest);
    if (isBest && score > 0) Sound.best();

    var versus = el('versus');
    // A friend's weekly score only compares against a run of that same week's sequence.
    var comparable = challenger && (challenger.weekId || null) === weeklyId;
    if (comparable) {
      var you = score, them = challenger.score;
      var html;
      if (you > them) {
        html = '<div class="win">You beat ' + esc(challenger.name) + '!</div>' +
               'You: ' + you + ' &nbsp;\u2022&nbsp; ' + esc(challenger.name) + ': ' + them;
      } else if (you === them) {
        html = 'Tied with ' + esc(challenger.name) + ' at ' + you + '. Break the tie.';
      } else {
        html = '<div class="lose">' + esc(challenger.name) + ' still leads.</div>' +
               esc(challenger.name) + ': ' + them + ' &nbsp;\u2022&nbsp; You: ' + you +
               '<br><b>TAKE BACK THE LEAD</b>';
      }
      versus.innerHTML = html;
      versus.classList.remove('hidden');
    } else {
      versus.classList.add('hidden');
    }

    UI.show('over');
    try {
      pendingBreak = runId ? Monetization.recordLoss({
        runId: runId, score: score, previousBest: previousBest,
        assisted: false, rewardedOffered: false, rewardedUsed: false
      }) : null;
    } catch (error) {
      pendingBreak = null;
      reportMonetizationError(error, 'Ad timing is unavailable. You can still play.');
    }
    renderBreakNotice();
  }

  function renderBreakNotice() {
    el('ad-break-notice').classList.toggle('hidden',
      !pendingBreak || !pendingBreak.eligible || Monetization.getState().adsRemoved);
  }

  async function leaveGameOver(next) {
    if (transitioning || Monetization.getState().busy || gameActive) return;
    transitioning = true;
    renderMonetization(Monetization.getState());
    var decision = pendingBreak;
    pendingBreak = null;
    try {
      await Monetization.presentBreak(decision);
    } catch (error) {
      reportMonetizationError(error, 'The ad could not be displayed. You can keep playing.');
    } finally {
      transitioning = false;
      renderMonetization(Monetization.getState());
    }
    next();
  }

  function renderAdDiagnostics() {
    var report = Monetization.getAdReport();
    el('ad-diagnostics-enabled').checked = report.diagnosticsEnabled;
    el('ad-diagnostics-report').value = JSON.stringify(report, null, 2);
    if (report.warning) UI.toast(report.warning, 5000);
  }

  function reportMonetizationError(error, fallback) {
    console.error('Monetization operation failed.', error);
    var message = error && typeof error.message === 'string' ? error.message : fallback;
    el('purchase-status').textContent = message;
    UI.toast(message, 5000);
  }

  function renderMonetization(state) {
    el('btn-store').classList.toggle('hidden', !state.supported);
    el('btn-over-store').classList.toggle('hidden', !state.supported || state.adsRemoved);
    [
      'btn-play', 'btn-weekly', 'btn-again', 'btn-share', 'btn-home', 'btn-how', 'btn-how-back',
      'btn-accept', 'btn-skip-challenge', 'btn-store', 'btn-over-store', 'btn-store-back'
    ].forEach(function (id) { el(id).disabled = state.busy || transitioning; });
    el('btn-remove-ads').disabled = state.busy || transitioning || !state.ready || state.adsRemoved ||
      !state.productAvailable || !state.price;
    el('btn-remove-ads').textContent = state.adsRemoved ? 'ADS REMOVED' :
      (state.ready && state.productAvailable && state.price ? 'Remove Ads - ' + state.price :
        (state.ready ? 'Purchase unavailable' : 'Checking App Store...'));
    el('btn-restore').disabled = state.busy || transitioning || !state.ready;
    el('btn-privacy-options').classList.toggle('hidden', !state.privacyOptionsRequired);
    el('btn-privacy-options').disabled = state.busy || !state.ready;
    el('btn-store-retry').classList.toggle('hidden', state.ready && state.productAvailable && !state.needsConsent);
    el('btn-store-retry').disabled = state.busy;
    el('purchase-status').textContent = state.message || (state.busy ? 'Please wait...' :
      (state.adsRemoved ? 'Ads removed.' : ''));
    if (state.message && state.message !== lastMonetizationMessage) UI.toast(state.message, 5000);
    lastMonetizationMessage = state.message;
    renderBreakNotice();
  }

  function initializeMonetization() {
    return Monetization.initialize().catch(function (error) {
      reportMonetizationError(error, 'Purchases and ads are unavailable. You can still play.');
    });
  }

  function showStore(from) {
    storeReturnScreen = from;
    UI.show('store');
  }

  function purchaseAdsRemoval() {
    Monetization.purchase().then(function (result) {
      if (result.status === 'purchased') UI.toast('Ads removed. Thank you!');
      else if (result.status === 'pending') UI.toast('Purchase awaiting approval. Ads stop once Apple confirms it.', 5000);
      else UI.toast('Purchase cancelled. You have not been charged.');
    }).catch(function (error) {
      reportMonetizationError(error, 'Purchase failed. Please try again.');
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function doShare() {
    var weeklyId = runOpts && runOpts.weeklyId ? runOpts.weeklyId : null;
    var score = Math.max((weeklyId ? Store.weeklyBest(weeklyId) : Store.best) | 0, Engine.getScore() | 0);
    var name = playerName();
    Share.share(name, score, weeklyId).then(function (res) {
      if (res.canceled) return;
      if (res.method === 'clipboard') UI.toast('Challenge link copied \u2014 paste it in a text!');
      else if (!res.ok) UI.toast('Link ready: ' + res.url);
    });
  }

  function handleIncomingChallenge() {
    var incoming = Share.readIncoming();
    if (!incoming) return false;
    Share.clearIncoming();
    if (incoming.weekId && incoming.weekId !== Weekly.weekId()) {
      // That weekly sequence is over; scores from it can't be matched this week.
      UI.show('home');
      UI.toast('That weekly challenge has ended. This week has new commands!', 5000);
      return true;
    }
    challenger = incoming;
    el('challenge-title').textContent = incoming.weekId
      ? incoming.name + ' survived ' + incoming.score + ' commands in this week’s challenge.'
      : incoming.name + ' survived ' + incoming.score + ' commands.';
    UI.show('challenge');
    return true;
  }

  function wire() {
    el('btn-play').addEventListener('click', startGame);
    el('btn-again').addEventListener('click', function () { leaveGameOver(replay); });
    el('btn-weekly').addEventListener('click', startWeekly);
    el('btn-share').addEventListener('click', doShare);
    el('btn-home').addEventListener('click', function () {
      leaveGameOver(function () { challenger = null; UI.show('home'); refreshBest(); });
    });
    el('btn-how').addEventListener('click', function () {
      UI.show('how');
      renderAdDiagnostics();
    });
    el('btn-how-back').addEventListener('click', function () { UI.show('home'); });
    el('btn-themes').addEventListener('click', function () { renderThemes(); UI.show('themes'); });
    el('btn-themes-back').addEventListener('click', function () { UI.show('home'); });
    el('btn-accept').addEventListener('click', function () {
      if (challenger && challenger.weekId) startWeekly(); else startGame();
    });
    el('btn-skip-challenge').addEventListener('click', function () { challenger = null; UI.show('home'); });
    el('btn-store').addEventListener('click', function () { showStore('home'); });
    el('btn-over-store').addEventListener('click', function () { showStore('over'); });
    el('btn-store-back').addEventListener('click', function () { UI.show(storeReturnScreen); });
    el('btn-remove-ads').addEventListener('click', purchaseAdsRemoval);
    el('btn-restore').addEventListener('click', function () {
      Monetization.restore().then(function (state) {
        UI.toast(state.adsRemoved ? 'Purchase restored. Ads are removed.' :
          'No Remove Ads purchase was found for this Apple Account.', 5000);
      }).catch(function (error) {
        reportMonetizationError(error, 'Restore failed. Please try again.');
      });
    });
    el('btn-privacy-options').addEventListener('click', function () {
      Monetization.privacy().catch(function (error) {
        reportMonetizationError(error, 'Privacy choices could not be opened. Please try again.');
      });
    });
    el('btn-store-retry').addEventListener('click', initializeMonetization);
    el('ad-diagnostics-enabled').addEventListener('change', function () {
      Monetization.setDiagnosticsEnabled(this.checked);
      renderAdDiagnostics();
    });
    el('btn-ad-report').addEventListener('click', renderAdDiagnostics);
    el('btn-ad-clear').addEventListener('click', function () {
      Monetization.clearDiagnostics();
      renderAdDiagnostics();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { Monetization.touch(); refreshWeekly(); }
    });

    // keep name in sync
    el('playerName').addEventListener('change', function () { Store.setName(this.value.trim()); });

    // Unlock audio on first interaction (iOS requirement)
    document.addEventListener('pointerdown', function once() {
      Sound.unlock();
      document.removeEventListener('pointerdown', once);
    }, { once: true });
  }

  function boot() {
    UI.register();
    Engine.init({
      field: el('playfield'),
      instruction: el('instruction'),
      timerFill: el('timerbar-fill'),
      notifLayer: el('notif-layer'),
      screenGame: el('screen-game'),
      scoreEl: el('score')
    });
    Engine.onUpdate(function (s) { el('score').textContent = s; });
    Engine.onGameOver(renderGameOver);

    var appliedTheme = Themes.apply(Store.theme);
    if (appliedTheme !== Store.theme) Store.setTheme(appliedTheme);
    el('btn-themes').classList.toggle('hidden', !Themes.enabled());

    el('playerName').value = Store.name || '';
    refreshBest();
    refreshWeekly();
    wire();

    if (!handleIncomingChallenge()) UI.show('home');
    Monetization.onChange(renderMonetization);
    initializeMonetization().then(renderAdDiagnostics);

    // Register service worker for PWA/offline (ignored under file://)
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
