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
  var CONTINUE_MIN_SCORE = 5;  // below this a continue is not worth offering (also keeps interstitial inventory)
  var continueOffer = null;    // { token, score } while a continue is offered on the game-over screen
  var gameOverToken = 0;       // identifies one game-over screen so stale callbacks cannot resume a different run
  var continuing = false;      // a continue (rewarded video) is in progress
  var lastRunAssisted = false;

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

  var previewing = null; // a locked theme being tried; never saved
  var themesOpen = false;

  function savedThemeInUse() { return Themes.resolve(Store.theme); }

  function themeTag(theme, inUse) {
    if (inUse) return 'IN USE';
    var state = Themes.ownership(theme.id);
    if (state === 'owned') return 'OWNED';
    if (state === 'locked') return Monetization.themePrice(theme.id) || 'LOCKED';
    return state === 'preview' ? 'PREVIEW' : '';
  }

  function renderThemes() {
    var list = el('theme-list');
    list.innerHTML = '';
    var inUse = previewing ? null : savedThemeInUse();
    Themes.LIST.forEach(function (theme) {
      var card = document.createElement('button');
      card.type = 'button';
      var selected = theme.id === inUse || theme.id === previewing;
      card.className = 'theme-card' + (selected ? ' selected' : '');
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
      tag.textContent = theme.id === previewing ? 'PREVIEW' : themeTag(theme, theme.id === inUse);
      card.appendChild(swatch);
      card.appendChild(meta);
      card.appendChild(tag);
      card.addEventListener('click', function () { chooseTheme(theme.id); });
      list.appendChild(card);
    });
    renderThemeBuy();
  }

  function renderThemeBuy() {
    var bar = el('theme-buy');
    bar.classList.toggle('hidden', !previewing);
    if (!previewing) return;
    var theme = Themes.find(previewing);
    var state = Monetization.getState();
    var price = Monetization.themePrice(previewing);
    el('theme-buy-note').textContent = theme.name + ' is a preview. Unlock it to keep it \u2014 a one-time purchase, looks only.';
    var button = el('btn-theme-buy');
    if (!state.supported) {
      button.textContent = 'Available in the iOS app';
      button.disabled = true;
    } else if (!state.ready || !price) {
      button.textContent = state.ready ? 'Unavailable right now' : 'Checking App Store...';
      button.disabled = true;
    } else {
      button.textContent = 'UNLOCK - ' + price;
      button.disabled = state.busy || transitioning;
    }
  }

  function chooseTheme(id) {
    if (Themes.canUse(id)) {
      previewing = null;
      Store.setTheme(id);
      Themes.apply(id);
    } else {
      previewing = id; // try before you buy; reverts when leaving the screen
      Themes.preview(id);
    }
    renderThemes();
  }

  function leaveThemes() {
    previewing = null;
    themesOpen = false;
    Themes.apply(Store.theme);
    UI.show('home');
  }

  function buyPreviewedTheme() {
    var id = previewing;
    if (!id) return;
    Monetization.purchaseTheme(id).then(function (result) {
      if (result.status === 'purchased') { UI.toast('Theme unlocked. Thank you!'); chooseTheme(id); }
      else if (result.status === 'pending') UI.toast('Purchase awaiting approval. The theme unlocks once Apple confirms it.', 5000);
      else UI.toast('Purchase cancelled. You have not been charged.');
    }).catch(function (error) {
      reportMonetizationError(error, 'Purchase failed. Please try again.');
    });
  }

  // Once StoreKit has reported what the player owns, show their saved theme if they still
  // own it (a refund drops them to Classic for display but keeps the saved choice, so a
  // re-purchase or a late entitlement restores it). Never run before ownership is known.
  function reconcileTheme(state) {
    if (!state.ready && state.supported) return;
    if (!previewing) Themes.apply(Store.theme);
    if (themesOpen) renderThemes();
  }

  function startGame() { beginRun(null); }
  function startWeekly() { beginRun({ weeklyId: Weekly.weekId() }); }
  // Try Again keeps the current mode; a weekly run rolls over to the new week if it changed.
  function replay() { if (runOpts && runOpts.weeklyId) startWeekly(); else startGame(); }

  function beginRun(opts) {
    if (gameActive || transitioning || Monetization.getState().busy) return;
    runOpts = opts || null;
    continueOffer = null;
    lastRunAssisted = false;
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
    var assisted = !!payload.assisted;
    var score = payload.score;
    var weeklyId = payload.weeklyId || null;
    gameOverToken += 1;
    lastRunAssisted = assisted;
    var previousBest, isBest;
    if (assisted) {
      // This run already ended once (and was counted) before its continue: it is not a new
      // game, and its score never touches the real best or any ranking.
      previousBest = Store.assistedBest;
      isBest = Store.setAssistedBest(score);
    } else {
      Store.recordGame();
      if (weeklyId) {
        previousBest = Store.weeklyBest(weeklyId);
        isBest = Store.recordWeekly(weeklyId, score) && score > 0;
      } else {
        previousBest = Store.best;
        isBest = Store.setBest(score);
      }
    }
    refreshBest();
    refreshWeekly();

    el('over-reason').textContent = payload.reason || 'Game over.';
    el('final-score').textContent = score;
    el('final-best-label').textContent = assisted ? 'ASSISTED BEST' : 'BEST';
    el('final-best').textContent = assisted ? Store.assistedBest : (weeklyId ? Store.weeklyBest(weeklyId) : Store.best);
    el('over-mode').textContent = assisted ? 'Assisted run \u2022 continued once' :
      (weeklyId ? 'Weekly challenge \u2022 week ' + parseInt(weeklyId.split('-W')[1], 10) : '');
    el('over-mode').classList.toggle('hidden', !weeklyId && !assisted);
    el('new-best').textContent = assisted ? 'NEW ASSISTED BEST!' : (weeklyId ? 'NEW WEEKLY BEST!' : 'NEW BEST!');
    el('new-best').classList.toggle('hidden', !isBest);
    if (isBest && score > 0) Sound.best();

    var versus = el('versus');
    // A friend's weekly score only compares against a run of that same week's sequence.
    // An assisted run is never compared with a friend's score.
    var comparable = !assisted && challenger && (challenger.weekId || null) === weeklyId;
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

    if (weeklyId && !assisted) {
      LeaderboardUI.afterWeeklyRun({ weekId: weeklyId, score: score, rounds: payload.rounds || [], name: playerName() });
    } else {
      el('over-rank').classList.add('hidden');
      el('btn-join-lb').classList.add('hidden');
    }

    var offer = assisted ? null : continueOfferFor(score, weeklyId);
    continueOffer = offer ? { token: gameOverToken, score: score } : null;
    renderContinue();

    UI.show('over');
    pendingBreak = null;
    if (!assisted) {
      try {
        pendingBreak = runId ? Monetization.recordLoss({
          runId: runId, score: score, previousBest: previousBest,
          // A usable continue offer shares the break with the free retry, so no interstitial
          // is stacked on it (the policy skips it rather than queuing a catch-up ad).
          assisted: false, rewardedOffered: !!(offer && offer.enabled), rewardedUsed: false
        }) : null;
      } catch (error) {
        pendingBreak = null;
        reportMonetizationError(error, 'Ad timing is unavailable. You can still play.');
      }
    }
    renderBreakNotice();
  }

  // Rewarded Continue: offered once after a casual run fails, never in the weekly challenge.
  function continueOfferFor(score, weeklyId) {
    var state = Monetization.getState();
    if (weeklyId || score < CONTINUE_MIN_SCORE || !state.supported || !state.ready || !Engine.canResume()) return null;
    return { enabled: state.adsRemoved || state.rewardedReady };
  }

  function renderContinue() {
    var button = el('btn-continue');
    var state = Monetization.getState();
    var visible = !!continueOffer && !gameActive;
    button.classList.toggle('hidden', !visible);
    if (!visible) return;
    var free = state.adsRemoved;
    var ready = free || state.rewardedReady;
    el('continue-title').textContent = 'Continue at ' + continueOffer.score + '?';
    el('continue-sub').textContent = free ? 'Free with Remove Ads' :
      (ready ? 'Watch ad to continue' : 'Video unavailable right now');
    button.disabled = !ready || state.busy || transitioning || continuing;
  }

  function doContinue() {
    var offer = continueOffer;
    if (!offer || offer.token !== gameOverToken || gameActive || transitioning || continuing) return;
    continuing = true;
    renderContinue();
    Monetization.showRewarded().then(function (result) {
      // The player may have left this game-over screen while the ad was up: never resume then.
      if (offer.token !== gameOverToken || gameActive || continueOffer !== offer) return;
      if (!result.rewarded) {
        UI.toast('No reward earned, so no continue. You can still try again.', 3500);
        return;
      }
      if (!Engine.resume()) { UI.toast('That run can no longer be continued.'); continueOffer = null; return; }
      continueOffer = null;
      pendingBreak = null;
      gameActive = true;
      UI.show('game');
    }).catch(function (error) {
      reportMonetizationError(error, 'The video could not be shown. You can still try again.');
    }).then(function () {
      continuing = false;
      renderContinue();
    });
  }

  function renderBreakNotice() {
    el('ad-break-notice').classList.toggle('hidden',
      !pendingBreak || !pendingBreak.eligible || Monetization.getState().adsRemoved);
  }

  async function leaveGameOver(next) {
    if (transitioning || continuing || Monetization.getState().busy || gameActive) return;
    continueOffer = null;
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
      'btn-play', 'btn-weekly', 'btn-again', 'btn-continue', 'btn-theme-buy', 'btn-theme-restore', 'btn-share', 'btn-home', 'btn-how', 'btn-how-back',
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
    renderContinue();
    reconcileTheme(state);
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
    var base = (weeklyId ? Store.weeklyBest(weeklyId) : Store.best) | 0;
    // An assisted run's score is never shared as a challenge.
    var score = lastRunAssisted ? base : Math.max(base, Engine.getScore() | 0);
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
    el('btn-continue').addEventListener('click', doContinue);
    el('btn-share').addEventListener('click', doShare);
    el('btn-home').addEventListener('click', function () {
      leaveGameOver(function () { challenger = null; UI.show('home'); refreshBest(); });
    });
    el('btn-how').addEventListener('click', function () {
      UI.show('how');
      renderAdDiagnostics();
    });
    el('btn-how-back').addEventListener('click', function () { UI.show('home'); });
    el('btn-themes').addEventListener('click', function () { themesOpen = true; renderThemes(); UI.show('themes'); });
    el('btn-themes-back').addEventListener('click', leaveThemes);
    el('btn-theme-buy').addEventListener('click', buyPreviewedTheme);
    el('btn-theme-restore').addEventListener('click', function () { el('btn-restore').click(); });
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

    // Ownership is unknown until StoreKit reports it, so show the saved theme on trust and
    // reconcile later. Never rewrite the saved choice here: that would downgrade paying players.
    Themes.applyTrusted(Store.theme);
    el('btn-themes').classList.toggle('hidden', !Themes.enabled());
    LeaderboardUI.init({ playerName: playerName });

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
