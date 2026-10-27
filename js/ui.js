/* ui.js — screen switching + toast */
(function (global) {
  'use strict';

  var screens = {};
  var toastEl, toastTimer;

  function register() {
    ['home', 'challenge', 'game', 'over', 'how', 'store', 'themes', 'weekly', 'lb'].forEach(function (id) {
      screens[id] = document.getElementById('screen-' + id);
    });
    toastEl = document.getElementById('toast');
  }

  function show(id) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === id);
    });
    if (typeof api.onShow === 'function') api.onShow(id);
  }

  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, ms || 2200);
  }

  var api = { register: register, show: show, toast: toast, onShow: null };
  global.UI = api;
})(window);
