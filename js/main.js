/* main.js — bootstrap + wiring */
(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var challenger = null; // { name, score } if arriving from a friend link

  function playerName() {
    var n = (el('playerName').value || Store.name || '').trim();
    if (!n) n = 'Player';
    return n.slice(0, 14);
  }

  function refreshBest() {
    el('home-best').textContent = Store.best;
    el('hud-best').textContent = Store.best;
  }

  function startGame() {
    Sound.unlock();
    Store.setName((el('playerName').value || '').trim());
    UI.show('game');
    Engine.start();
  }

  function renderGameOver(payload) {
    Store.recordGame();
    var score = payload.score;
    var isBest = Store.setBest(score);
    refreshBest();

    el('over-reason').textContent = payload.reason || 'Game over.';
    el('final-score').textContent = score;
    el('final-best').textContent = Store.best;
    el('new-best').classList.toggle('hidden', !isBest);
    if (isBest && score > 0) Sound.best();

    var versus = el('versus');
    if (challenger) {
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
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function doShare() {
    var score = Engine.getScore();
    var name = playerName();
    Share.share(name, score).then(function (res) {
      if (res.method === 'clipboard') UI.toast('Challenge link copied \u2014 paste it in a text!');
      else if (!res.ok) UI.toast('Link ready: ' + res.url);
    });
  }

  function handleIncomingChallenge() {
    var incoming = Share.readIncoming();
    if (!incoming) return false;
    challenger = incoming;
    Share.clearIncoming();
    el('challenge-title').textContent = incoming.name + ' survived ' + incoming.score + ' commands.';
    UI.show('challenge');
    return true;
  }

  function wire() {
    el('btn-play').addEventListener('click', startGame);
    el('btn-again').addEventListener('click', startGame);
    el('btn-share').addEventListener('click', doShare);
    el('btn-home').addEventListener('click', function () { challenger = null; UI.show('home'); refreshBest(); });
    el('btn-how').addEventListener('click', function () { UI.show('how'); });
    el('btn-how-back').addEventListener('click', function () { UI.show('home'); });
    el('btn-accept').addEventListener('click', startGame);
    el('btn-skip-challenge').addEventListener('click', function () { challenger = null; UI.show('home'); });

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

    el('playerName').value = Store.name || '';
    refreshBest();
    wire();

    if (!handleIncomingChallenge()) UI.show('home');

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
