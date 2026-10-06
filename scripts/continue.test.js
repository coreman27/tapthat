/* continue.test.js — Rewarded Continue, end to end through the real main.js, storage,
 * monetization client and ad policy. Only the DOM and the game engine are faked.
 * Run: node --test scripts/continue.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { setup, source, nativeState } = require('./helpers/monetization-harness');

async function game(options = {}) {
  const f = setup({ state: nativeState({ rewardedConfigured: true, rewardedReady: true, ...(options.state || {}) }), ...options.setup });
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(id === 'btn-continue' || /^(new-best|versus|over-mode|over-rank|btn-join-lb|ad-break-notice)$/.test(id) ? ['hidden'] : []);
      elements.set(id, {
        value: '', checked: false, textContent: '', disabled: false, innerHTML: '', listeners: {},
        classList: {
          add: (n) => classes.add(n), remove: (n) => classes.delete(n), contains: (n) => classes.has(n),
          toggle: (n, on) => (on === undefined ? !classes.has(n) : on) ? classes.add(n) : classes.delete(n)
        },
        addEventListener(event, handler) { this.listeners[event] = handler; },
        blur() {}
      });
    }
    return elements.get(id);
  }
  const hidden = (id) => element(id).classList.contains('hidden');

  // A fake engine with the same continue contract as js/engine.js.
  const engine = { starts: [], resumes: 0, canResume: false, handler: null, score: 0 };
  const calls = { recordLoss: [], toasts: [] };
  let screen = null;
  Object.assign(f.context, {
    document: { hidden: false, readyState: 'complete', getElementById: element, addEventListener() {}, removeEventListener() {} },
    UI: { register() {}, show(v) { screen = v; }, toast(m) { calls.toasts.push(m); } },
    Sound: { unlock() {}, best() {} },
    Engine: {
      init() {}, onUpdate() {}, onGameOver(h) { engine.handler = h; },
      start(opts) { engine.starts.push(opts || null); engine.canResume = false; },
      resume() { if (!engine.canResume) return false; engine.canResume = false; engine.resumes++; return true; },
      canResume: () => engine.canResume, isAssisted: () => false,
      getScore: () => engine.score, getRounds: () => []
    },
    Share: { readIncoming: () => null, share: () => Promise.resolve({ ok: true }) },
    Weekly: { weekId: () => '2026-W40', msUntilReset: () => 1e8, resetLabel: () => '1d', isWeekId: () => true },
    Themes: { LIST: [], enabled: () => false, available: () => false, previewAll: () => false, apply: (i) => i, applyTrusted: (i) => i,
      preview: (i) => i, resolve: (i) => i, canUse: () => true, find: () => null, ownership: () => 'free' },
    LeaderboardUI: { init() {}, afterWeeklyRun() {} },
    navigator: {}, location: { protocol: 'capacitor:' }
  });
  vm.runInContext(source('storage'), f.context);
  // spy on the ad policy hand-off without changing its behavior
  const realRecordLoss = f.context.Monetization.recordLoss;
  f.context.Monetization.recordLoss = (arg) => { const d = realRecordLoss(arg); calls.recordLoss.push({ arg, decision: d }); return d; };
  vm.runInContext(source('main'), f.context); // boot initializes monetization itself
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));

  const play = () => { element('btn-play').listeners.click(); f.tick(1000); };
  const fail = (score, extra = {}) => {
    engine.score = score;
    engine.canResume = !extra.weeklyId && !extra.assisted && score >= 1;
    engine.handler({ score, reason: 'Too slow.', rounds: [], ...extra });
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { f, element, hidden, engine, calls, play, fail, tick, screen: () => screen, Store: f.context.Store };
}

test('after a casual failure, a continue is offered with the real score and an explicit ad label', async () => {
  const g = await game();
  g.play(); g.fail(47);
  assert.equal(g.hidden('btn-continue'), false);
  assert.equal(g.element('continue-title').textContent, 'Continue at 47?');
  assert.equal(g.element('continue-sub').textContent, 'Watch ad to continue');
  assert.equal(g.element('btn-continue').disabled, false);
  assert.equal(g.element('btn-again').disabled, false, 'TRY AGAIN stays available');
  assert.equal(g.screen(), 'over');
});

test('no offer for low scores, weekly runs, or outside the iOS app', async () => {
  const low = await game(); low.play(); low.fail(4);
  assert.equal(low.hidden('btn-continue'), true, 'score below the minimum');
  const weekly = await game(); weekly.element('btn-weekly').listeners.click(); weekly.fail(30, { weeklyId: '2026-W40' });
  assert.equal(weekly.hidden('btn-continue'), true, 'weekly runs are never assisted');
  const web = await game({ setup: { web: true } }); web.play(); web.fail(30);
  assert.equal(web.hidden('btn-continue'), true, 'no ad system on the web build');
});

test('without a configured rewarded ad unit, non-owners see no offer; owners still get the free continue', async () => {
  const none = await game({ state: { rewardedConfigured: false, rewardedReady: false } });
  none.play(); none.fail(30);
  assert.equal(none.hidden('btn-continue'), true, 'no dead button when there is no video to offer');
  assert.equal(none.element('btn-again').disabled, false);
  assert.equal(none.calls.recordLoss[0].arg.rewardedOffered, false);
  const owner = await game({ state: { rewardedConfigured: false, rewardedReady: false, adsRemoved: true } });
  owner.play(); owner.fail(30);
  assert.equal(owner.hidden('btn-continue'), false, 'owners keep their free continue');
  assert.equal(owner.element('continue-sub').textContent, 'Free with Remove Ads');
});

test('an unavailable video disables the offer but never blocks the free retry', async () => {
  const g = await game({ state: { rewardedReady: false } });
  g.play(); g.fail(20);
  assert.equal(g.hidden('btn-continue'), false);
  assert.equal(g.element('continue-sub').textContent, 'Video unavailable right now');
  assert.equal(g.element('btn-continue').disabled, true);
  assert.equal(g.element('btn-again').disabled, false);
  assert.equal(g.calls.recordLoss[0].arg.rewardedOffered, false, 'an unusable offer does not suppress interstitials');
});

test('watching the video resumes the same run once, and it counts as one run', async () => {
  let nativeCalls = 0;
  const g = await game({ setup: { plugin: { async showRewarded() { nativeCalls++; return { rewarded: true }; } } } });
  g.play(); g.fail(47);
  assert.equal(g.Store.best, 47);
  assert.equal(g.Store.games, 1);
  g.element('btn-continue').listeners.click();
  await g.tick(); await g.tick();
  assert.equal(nativeCalls, 1);
  assert.equal(g.engine.resumes, 1);
  assert.equal(g.screen(), 'game');
  assert.equal(g.engine.starts.length, 1, 'continuing is not a new run');
  assert.equal(g.calls.recordLoss.length, 1);
  assert.equal(g.calls.recordLoss[0].arg.rewardedOffered, true, 'the ad policy is told a continue was offered');
  assert.equal(g.calls.recordLoss[0].decision.eligible, false, 'no interstitial is stacked on the break');
  assert.equal(g.calls.recordLoss[0].decision.reason, 'rewarded-excluded');

  g.fail(60, { assisted: true });
  assert.equal(g.screen(), 'over');
  assert.equal(g.Store.games, 1, 'the continued run is not a second game');
  assert.equal(g.Store.best, 47, 'the real best is not raised by assisted play');
  assert.equal(g.Store.assistedBest, 60, 'assisted results have their own best');
  assert.equal(g.element('final-best-label').textContent, 'ASSISTED BEST');
  assert.equal(g.element('final-best').textContent, 60);
  assert.equal(g.element('new-best').textContent, 'NEW ASSISTED BEST!');
  assert.equal(g.hidden('over-mode'), false);
  assert.equal(g.hidden('btn-continue'), true, 'only one continue per run');
  assert.equal(g.calls.recordLoss.length, 1, 'the run is not counted again at its final loss');
});

test('an assisted run never gets an interstitial or a friend comparison', async () => {
  const g = await game({ setup: { plugin: { async showRewarded() { return { rewarded: true }; } } } });
  g.play(); g.fail(30);
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  g.fail(40, { assisted: true });
  assert.equal(g.hidden('ad-break-notice'), true);
  assert.equal(g.hidden('versus'), true);
  assert.equal(g.f.calls.ads, 0);
  g.element('btn-again').listeners.click(); await g.tick(); await g.tick();
  assert.equal(g.f.calls.ads, 0, 'leaving an assisted run shows no ad');
  assert.equal(g.engine.starts.length, 2, 'Try Again starts a fresh run');
});

test('closing the video early grants nothing', async () => {
  const g = await game({ setup: { plugin: { async showRewarded() { return { rewarded: false, reason: 'dismissed' }; } } } });
  g.play(); g.fail(25);
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  assert.equal(g.engine.resumes, 0);
  assert.equal(g.screen(), 'over');
  assert.match(g.calls.toasts.join(' '), /No reward earned/);
  assert.equal(g.hidden('btn-continue'), false, 'the offer stays so the player can retry the video');
  assert.equal(g.element('btn-again').disabled, false);
});

test('a native error never resumes and never traps the player', async () => {
  for (const result of [null, {}, { rewarded: 'yes' }]) {
    const g = await game({ setup: { plugin: { async showRewarded() { return result; } } } });
    g.play(); g.fail(25);
    g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
    assert.equal(g.engine.resumes, 0, JSON.stringify(result));
    assert.equal(g.screen(), 'over');
    assert.equal(g.element('btn-again').disabled, false);
    assert.equal(g.f.client.getState().busy, false);
  }
});

test('double taps show one video and resume once', async () => {
  let nativeCalls = 0;
  let finish;
  const g = await game({ setup: { plugin: { showRewarded: () => new Promise((resolve) => { nativeCalls++; finish = () => resolve({ rewarded: true }); }) } } });
  g.play(); g.fail(25);
  g.element('btn-continue').listeners.click();
  g.element('btn-continue').listeners.click();
  g.element('btn-continue').listeners.click();
  await g.tick();
  assert.equal(nativeCalls, 1);
  assert.equal(g.element('btn-continue').disabled, true, 'locked while the video is up');
  assert.equal(g.element('btn-again').disabled, true, 'other choices are locked during the video');
  finish(); await g.tick(); await g.tick();
  assert.equal(g.engine.resumes, 1);
});

test('Remove Ads owners get the same continue free, with no video', async () => {
  let nativeCalls = 0;
  const g = await game({
    state: { adsRemoved: true, rewardedReady: false },
    setup: { plugin: { async showRewarded() { nativeCalls++; return { rewarded: true }; } } }
  });
  g.play(); g.fail(33);
  assert.equal(g.element('continue-sub').textContent, 'Free with Remove Ads');
  assert.equal(g.element('btn-continue').disabled, false);
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  assert.equal(nativeCalls, 0, 'no video for owners');
  assert.equal(g.engine.resumes, 1);
  g.fail(50, { assisted: true });
  assert.equal(g.Store.best, 33, 'paying never improves the real best');
  assert.equal(g.Store.assistedBest, 50);
});

test('leaving the game-over screen drops the offer; a new run starts clean', async () => {
  const g = await game();
  g.play(); g.fail(25);
  g.element('btn-home').listeners.click(); await g.tick(); await g.tick();
  assert.equal(g.engine.resumes, 0);
  g.element('btn-continue').listeners.click(); await g.tick();
  assert.equal(g.engine.resumes, 0, 'a stale tap cannot resume an abandoned run');
  g.play();
  assert.equal(g.engine.starts.length, 2);
  assert.equal(g.engine.canResume, false);
});

test('a continue cannot be used twice even if the engine were asked again', async () => {
  const g = await game({ setup: { plugin: { async showRewarded() { return { rewarded: true }; } } } });
  g.play(); g.fail(25);
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  g.fail(31, { assisted: true });
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  assert.equal(g.engine.resumes, 1);
});

test('sharing after an assisted run shares the real best, not the assisted score', async () => {
  let shared;
  const g = await game({ setup: { plugin: { async showRewarded() { return { rewarded: true }; } } } });
  g.f.context.Share.share = (name, score) => { shared = score; return Promise.resolve({ ok: true, method: 'native' }); };
  g.play(); g.fail(30);
  g.element('btn-continue').listeners.click(); await g.tick(); await g.tick();
  g.fail(80, { assisted: true });
  g.element('btn-share').listeners.click(); await g.tick();
  assert.equal(shared, 30);
});
