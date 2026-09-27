const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', 'js', name), 'utf8');
const safetyKey = 'dtt.adPolicy.safety.v1';
const diagnosticKey = 'dtt.adPolicy.diagnostics.v1';
const optInKey = 'dtt.adPolicy.diagnosticsEnabled.v1';
const sessionMs = 30 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

for (const [nativeReason, result] of [
  ['not_ready', 'not-ready'], ['presentation_failed', 'error'], ['cannot_present', 'error'],
  ['offline', 'offline'], ['consent_updated', 'consent-updated'],
  ['consent_unavailable', 'consent-unavailable'], ['entitlement_unavailable', 'entitlement-unavailable'],
  ['not_foreground', 'not-foreground'], ['not_initialized', 'not-ready']
]) {
  test(`native ${nativeReason} remains distinguishable in local outcome reports`, () => {
    const f = setup({ fast: true });
    f.policy.setDiagnosticsEnabled(true);
    const decision = complete(f, 5);
    assert.ok(f.policy.beginBreak(decision));
    f.policy.finishBreak(decision.runId, { shown: false, reason: nativeReason });
    const report = f.policy.getReport();
    assert.equal(report.records.at(-1).result, result);
    assert.equal(report.groups.byResult[result].attempts, 1);
    assert.equal(f.restart().policy.getReport().records.at(-1).result, result);
  });
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

function setup(options = {}) {
  const storage = options.storage || memoryStorage();
  const clock = options.clock || { at: 1000000000 };
  const warnings = [];
  const context = vm.createContext({
    window: { localStorage: storage, console: { warn(message) { warnings.push(message); } } }
  });
  vm.runInContext(source('ad-config.js'), context);
  vm.runInContext(source('ad-policy.js'), context);
  const config = options.config === undefined ? JSON.parse(JSON.stringify(context.window.AdConfig)) : options.config;
  if (options.fast && config) {
    config.variants.forEach((variant) => {
      variant.firstSessionGraceRuns = 0;
      variant.minSessionSeconds = 0;
      variant.minSecondsBetween = 1;
    });
  }
  if (options.change) options.change(config);
  const policy = context.window.AdPolicy.create({
    config, storage, now: () => clock.at, random: options.random || (() => 0)
  });
  return {
    policy, storage, clock, config, warnings, context,
    advance(ms) { clock.at += ms; },
    end(input = {}) {
      const runId = policy.startRun();
      return policy.endRun({
        runId, score: 0, previousBest: 100, adsRemoved: false, ready: true, supported: true, ...input
      });
    },
    restart(extra = {}) { return setup({ storage, clock, config, ...extra }); }
  };
}

function complete(fixture, count, input = {}) {
  let decision;
  for (let index = 0; index < count; index += 1) {
    fixture.advance(1000);
    decision = fixture.end(input);
  }
  return decision;
}

test('defaults expose three explicit frozen variants and do not opt in to measurement', () => {
  const f = setup();
  assert.equal(f.config.version, 'score-timing-v1');
  assert.deepEqual(f.config.variants.map((variant) => [variant.id, variant.weight, variant.enabled]), [
    ['contextual', 100, true], ['cadence-5', 0, true], ['holdout', 0, false]
  ]);
  assert.ok(Object.isFrozen(f.context.window.AdConfig));
  const report = f.policy.getReport();
  assert.equal(report.variant, 'contextual');
  assert.equal(report.diagnosticsEnabled, false);
  assert.equal(report.warning, '');
  assert.ok(Object.isFrozen(report.activeConfig.variants[0]));
  assert.equal(f.storage.getItem(diagnosticKey), null);
});

for (const cadence of [4, 5, 6]) {
  test(`exact ${cadence}-run cadence consumes only terminal runs`, () => {
    const f = setup({ fast: true, change(config) {
      config.variants[0].everyRuns = cadence;
      config.variants[0].maxAdsPerSession = 20;
    } });
    const attempts = [];
    for (let run = 1; run <= cadence * 3; run += 1) {
      f.advance(1000);
      const decision = f.end();
      if (decision.eligible) {
        attempts.push(run);
        assert.equal(decision.trigger, 'cadence');
        assert.ok(f.policy.beginBreak(decision));
        f.policy.finishBreak(decision.runId, { shown: true });
      }
    }
    assert.deepEqual(attempts, [cadence, cadence * 2, cadence * 3]);
    assert.equal(f.policy.getReport().safety.sessionRuns, cadence * 3);
  });
}

test('new best requires an established previous best and wins over cadence', () => {
  const f = setup({ fast: true });
  assert.equal(f.end({ score: 1, previousBest: 0 }).trigger, 'none');
  assert.equal(f.end({ score: 10, previousBest: 9 }).trigger, 'none');
  complete(f, 2);
  const decision = f.end({ score: 11, previousBest: 10 });
  assert.equal(decision.trigger, 'new-best');
  assert.equal(decision.eligible, true);
});

for (const [score, previousBest, expected] of [[8, 10, 'none'], [9, 10, 'near-best'],
  [10, 10, 'near-best'], [9, 11, 'none'], [10, 11, 'near-best'], [9, 9, 'none']]) {
  test(`near-best threshold score ${score} previous ${previousBest} is ${expected}`, () => {
    const f = setup({ fast: true });
    assert.equal(f.end({ score, previousBest }).trigger, expected);
  });
}

test('high-score and near-best switches work independently', () => {
  const noNew = setup({ fast: true, change(config) { config.variants[0].onNewBest = false; } });
  assert.equal(noNew.end({ score: 11, previousBest: 10 }).trigger, 'none');
  assert.equal(noNew.end({ score: 9, previousBest: 10 }).trigger, 'near-best');
  const noNear = setup({ fast: true, change(config) { config.variants[0].onNearBest = false; } });
  assert.equal(noNear.end({ score: 9, previousBest: 10 }).trigger, 'none');
  assert.equal(noNear.end({ score: 11, previousBest: 10 }).trigger, 'new-best');
});

test('first-session first three terminal runs are protected even after wall-clock warmup', () => {
  const f = setup();
  f.advance(60000);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(f.end({ score: 11, previousBest: 10 }).reason, 'first-session-grace');
  }
  assert.equal(f.policy.getReport().safety.sessionRuns, 3);
});

test('session warmup uses wall clock and skipped grace candidates are not caught up', () => {
  const f = setup();
  complete(f, 4);
  assert.equal(f.end().reason, 'session-warmup');
  f.advance(60000);
  assert.equal(f.end().reason, 'not-due');
  const tenth = complete(f, 4);
  assert.equal(tenth.eligible, true);
});

test('new session removes first-session grace but retains normal session warmup', () => {
  const f = setup({ change(config) { config.variants[0].minSecondsBetween = 1; } });
  complete(f, 1);
  f.advance(sessionMs);
  const decision = f.end({ score: 11, previousBest: 10 });
  assert.equal(f.policy.getReport().safety.session, 2);
  assert.equal(decision.reason, 'session-warmup');
  f.advance(60000);
  complete(f, 2);
  assert.equal(f.end({ score: 11, previousBest: 10 }).eligible, true);
});

test('selected score opportunities are spaced without rejected milestones moving the window', () => {
  const f = setup({ fast: true });
  const first = f.end({ score: 11, previousBest: 10 });
  assert.equal(first.eligible, true);
  f.policy.closeBreak(first.runId);
  assert.equal(f.end({ score: 12, previousBest: 11 }).reason, 'run-spacing');
  assert.equal(f.end({ score: 13, previousBest: 12 }).reason, 'run-spacing');
  f.end();
  const fifth = f.end();
  assert.equal(fifth.eligible, true);
  f.policy.closeBreak(fifth.runId);
  complete(f, 2);
  assert.equal(f.end({ score: 14, previousBest: 13 }).eligible, true);
});

test('consecutive near-best runs still produce fresh opportunities after grace and spacing', () => {
  const f = setup();
  const selected = [];
  for (let run = 1; run <= 10; run++) {
    f.advance(100000);
    const decision = f.end({ score: 90, previousBest: 100 });
    if (decision.eligible) {
      selected.push(run);
      assert.ok(f.policy.beginBreak(decision));
      f.policy.finishBreak(decision.runId, { shown: true });
    }
  }
  assert.deepEqual(selected, [4, 7, 10]);
});

test('nofill attempts enforce cross-restart cooldown without consuming shown cap', () => {
  let f = setup({ fast: true, change(config) { config.variants[0].minSecondsBetween = 90; } });
  const first = complete(f, 5);
  assert.ok(f.policy.beginBreak(first));
  f.policy.finishBreak(first.runId, { shown: false, reason: 'not-ready' });
  f = f.restart();
  const next = complete(f, 5);
  assert.equal(next.reason, 'cooldown');
  assert.equal(f.policy.getReport().safety.sessionShown, 0);
  f.advance(90000);
  assert.equal(f.end().reason, 'not-due');
  assert.equal(complete(f, 4).eligible, true);
});

test('session shown cap plus persisted in-flight reservation cannot be reset by relaunch', () => {
  let f = setup({ fast: true, change(config) { config.variants[0].maxAdsPerSession = 2; } });
  const first = complete(f, 5);
  assert.ok(f.policy.beginBreak(first));
  f.policy.finishBreak(first.runId, { shown: true });
  const second = complete(f, 5);
  assert.ok(f.policy.beginBreak(second));
  f = f.restart();
  assert.equal(complete(f, 5).reason, 'session-cap');
  assert.equal(f.policy.getReport().safety.reservedAttempts, 1);
  f.policy.finishBreak(second.runId, { shown: false });
  assert.equal(f.policy.getReport().safety.sessionShown, 1);
  assert.equal(complete(f, 5).eligible, true);
});

test('nofill safety has a bounded per-session attempt cap', () => {
  const f = setup({ fast: true, change(config) { config.variants[0].maxAdsPerSession = 1; } });
  for (let index = 0; index < 3; index += 1) {
    const decision = complete(f, 5);
    assert.ok(f.policy.beginBreak(decision));
    f.policy.finishBreak(decision.runId, { shown: false });
  }
  assert.equal(complete(f, 5).reason, 'attempt-cap');
});

for (const [flags, reason] of [
  [{ adsRemoved: true }, 'purchased'], [{ supported: false }, 'web'],
  [{ ready: false }, 'not-ready'], [{ rewardedOffered: true }, 'rewarded-excluded'],
  [{ rewardedUsed: true }, 'rewarded-excluded'], [{ assisted: true }, 'rewarded-excluded']
]) {
  test(`${reason} skips and consumes a due opportunity without catch-up`, () => {
    const f = setup({ fast: true });
    complete(f, 4);
    const decision = f.end(flags);
    assert.equal(decision.reason, reason);
    assert.equal(decision.trigger, 'cadence');
    assert.equal(f.policy.beginBreak(decision), false);
    assert.equal(f.end().reason, 'not-due');
    assert.equal(complete(f, 4).eligible, true);
  });
}

test('eligible decisions are frozen, identity-owned, one-shot and expire after two minutes', () => {
  const f = setup({ fast: true });
  const first = complete(f, 5);
  assert.ok(Object.isFrozen(first));
  assert.equal(f.policy.beginBreak({ ...first }), false);
  assert.equal(f.policy.beginBreak({ ...first, runId: 'run-4' }), false);
  assert.equal(f.policy.beginBreak(first), true);
  assert.equal(f.policy.beginBreak(first), false);
  f.policy.finishBreak(first.runId, { shown: false });
  const second = complete(f, 5);
  f.advance(120001);
  assert.equal(f.policy.beginBreak(second), false);
  assert.equal(f.policy.getReport().safety.sessionAttempts, 1);
});

test('beginBreak persists reservation before allowing native work', () => {
  const f = setup({ fast: true });
  const decision = complete(f, 5);
  assert.ok(f.policy.beginBreak(decision));
  const state = JSON.parse(f.storage.getItem(safetyKey));
  assert.equal(state.reservations[0].runId, decision.runId);
  assert.equal(state.sessionAttempts, 1);
  assert.equal(state.lastAttemptAt, f.clock.at);
});

test('new run, closeBreak, and relaunch each cancel pending opportunities', () => {
  const f = setup({ fast: true });
  const first = complete(f, 5);
  f.policy.startRun();
  assert.equal(f.policy.beginBreak(first), false);
  f.end();
  const second = complete(f, 4);
  f.policy.closeBreak(second.runId);
  assert.equal(f.policy.beginBreak(second), false);
  const third = complete(f, 5);
  assert.equal(f.restart().policy.beginBreak(third), false);
});

test('duplicate run starts, terminal callbacks, and finishes are idempotent', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const runId = f.policy.startRun();
  assert.equal(f.policy.startRun(), runId);
  assert.equal(f.restart().policy.startRun(), runId);
  const first = f.end({ score: 11, previousBest: 10 });
  const duplicate = f.policy.endRun({
    runId, score: 11, previousBest: 10, adsRemoved: false, ready: true, supported: true
  });
  assert.equal(duplicate.reason, 'duplicate-run');
  assert.equal(f.policy.getReport().totals.endedRuns, 1);
  assert.ok(f.policy.beginBreak(first));
  f.policy.finishBreak(runId, { shown: true });
  f.policy.finishBreak(runId, { shown: true });
  f.policy.finishBreak('run-999', { shown: true });
  assert.equal(f.policy.getReport().safety.sessionShown, 1);
  assert.equal(f.policy.getReport().totals.shown, 1);
});

test('unfinished runs are not terminal results and inactive sessions rotate exactly at thirty minutes', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const old = f.policy.startRun();
  f.advance(sessionMs - 1);
  assert.equal(f.restart().policy.startRun(), old);
  f.advance(sessionMs);
  const next = f.policy.startRun();
  assert.notEqual(next, old);
  const report = f.policy.getReport();
  assert.equal(report.safety.session, 2);
  assert.equal(report.safety.runsEnded, 0);
  assert.equal(report.totals.endedRuns, 0);
});

test('touch preserves active session and rotates an actually idle session', () => {
  const f = setup({ fast: true });
  f.advance(sessionMs - 1);
  f.policy.touch();
  f.advance(sessionMs - 1);
  f.policy.startRun();
  assert.equal(f.policy.getReport().safety.session, 1);
  f.advance(sessionMs);
  f.policy.touch();
  assert.equal(f.policy.getReport().safety.session, 2);
  assert.equal(f.policy.getReport().safety.activeRunId, 'run-1');
});

test('weighted assignment uses boundaries, honors holdout/control, and is stable despite weight changes', () => {
  function weights(config) { config.variants.forEach((variant, index) => { variant.weight = [25, 25, 50][index]; }); }
  for (const [sample, expected] of [[0, 'contextual'], [0.24999, 'contextual'],
    [0.25, 'cadence-5'], [0.5, 'holdout'], [0.99999, 'holdout']]) {
    const f = setup({ fast: true, random: () => sample, change: weights });
    assert.equal(f.policy.getReport().variant, expected);
    const restart = f.restart({ random: () => { throw new Error('must not reroll'); } });
    assert.equal(restart.policy.getReport().variant, expected);
    assert.equal(restart.policy.getReport().warning, '');
    if (expected === 'holdout') assert.equal(complete(f, 5).reason, 'variant-disabled');
    if (expected === 'cadence-5') assert.equal(f.end({ score: 11, previousBest: 10 }).trigger, 'none');
  }
});

test('version changes reroll only assignment, preserving all safety and first-session state', () => {
  const f = setup({ fast: true, change(config) { config.variants[0].maxAdsPerSession = 1; } });
  const decision = complete(f, 5);
  assert.ok(f.policy.beginBreak(decision));
  f.policy.finishBreak(decision.runId, { shown: true });
  const config = JSON.parse(JSON.stringify(f.config));
  config.version = 'score-timing-v2';
  const restarted = f.restart({ config });
  assert.equal(restarted.policy.getReport().safety.sessionShown, 1);
  assert.equal(restarted.policy.getReport().safety.session, 1);
  assert.equal(restarted.policy.getReport().safety.lastAttemptAt, f.clock.at);
  assert.equal(complete(restarted, 5).reason, 'session-cap');
  assert.equal(JSON.parse(f.storage.getItem(safetyKey)).assignment.version, 'score-timing-v2');
});

test('same-version weights do not reroll and missing assigned variants fail closed', () => {
  const f = setup({ fast: true });
  const changed = JSON.parse(JSON.stringify(f.config));
  changed.variants[0].weight = 0;
  changed.variants[1].weight = 100;
  assert.equal(f.restart({ config: changed }).policy.getReport().variant, 'contextual');
  changed.variants.shift();
  const missing = f.restart({ config: changed });
  assert.equal(complete(missing, 5).eligible, false);
  assert.match(missing.policy.getReport().warning, /assigned variant is missing/);
});

const invalidConfigs = [
  (config) => { delete config.variants[0].enabled; },
  (config) => { config.variants[0].weight = NaN; },
  (config) => { config.variants.forEach((variant) => { variant.weight = 0; }); },
  (config) => { config.variants[0].weight = -1; },
  (config) => { config.variants[0].everyRuns = 3; },
  (config) => { config.variants[0].everyRuns = 5.5; },
  (config) => { config.variants[0].minRunsBetween = 1; },
  (config) => { config.variants[0].nearBestRatio = Infinity; },
  (config) => { config.variants[0].nearBestRatio = 1.1; },
  (config) => { config.variants[0].nearBestRatio = -0.1; },
  (config) => { config.variants[0].minSecondsBetween = 0; },
  (config) => { config.variants[0].minBest = -1; },
  (config) => { config.variants[0].maxAdsPerSession = 21; },
  (config) => { config.variants[0].onNearBest = 'true'; },
  (config) => { config.variants[0].id = '__proto__'; },
  (config) => { config.variants[0].id = config.variants[1].id; },
  (config) => { config.version = ''; },
  (config) => { config.variants[0].surprise = true; }
];
invalidConfigs.forEach((change, index) => {
  test(`invalid configuration ${index + 1} fails closed with warning and no fallback`, () => {
    const f = setup({ change });
    assert.equal(complete(f, 5).reason, 'policy-disabled');
    assert.match(f.policy.getReport().warning, /invalid configuration/);
    assert.ok(f.warnings.length);
    assert.equal(f.storage.getItem(safetyKey), null);
  });
});

test('storage read, initial write, and reservation write failures fail closed without throwing', () => {
  const unreadable = memoryStorage();
  unreadable.getItem = () => { throw new Error('unavailable'); };
  const read = setup({ storage: unreadable, fast: true });
  assert.equal(complete(read, 5).reason, 'policy-disabled');
  const unwritable = memoryStorage();
  unwritable.setItem = () => { throw new Error('quota'); };
  const write = setup({ storage: unwritable, fast: true });
  assert.equal(complete(write, 5).reason, 'policy-disabled');
  const f = setup({ fast: true });
  const decision = complete(f, 5);
  f.storage.setItem = () => { throw new Error('quota'); };
  assert.equal(f.policy.beginBreak(decision), false);
  assert.match(f.policy.getReport().warning, /could not be saved/);
});

for (const mutate of [
  (state) => { state.sessionShown = -1; },
  (state) => { state.sessionAttempts = 61; },
  (state) => { state.session = 0; },
  (state) => { state.lastClockAt += 1000; },
  (state) => { state.lastAttemptAt = 'yesterday'; },
  (state) => { state.reservations = [{ runId: 'bad' }]; },
  (state) => { state.activeRun = { runId: 'run-99', session: 1 }; }
]) {
  test(`corrupt saved safety rejects ${mutate.toString()}`, () => {
    const f = setup({ fast: true });
    const state = JSON.parse(f.storage.getItem(safetyKey));
    mutate(state);
    f.storage.setItem(safetyKey, JSON.stringify(state));
    const restarted = f.restart();
    assert.equal(complete(restarted, 5).eligible, false);
    assert.match(restarted.policy.getReport().warning, /saved safety state/);
  });
}

test('backwards clock before native attempt fails closed and invalid RNG never assigns', () => {
  const f = setup({ fast: true });
  const decision = complete(f, 5);
  f.advance(-1);
  assert.equal(f.policy.beginBreak(decision), false);
  assert.match(f.policy.getReport().warning, /clock/);
  for (const sample of [-1, 1, NaN, Infinity]) {
    const invalid = setup({ random: () => sample });
    assert.equal(complete(invalid, 5).eligible, false);
    assert.match(invalid.policy.getReport().warning, /random value/);
  }
});

test('programmer errors throw, without consuming the active run', () => {
  const f = setup({ fast: true });
  const runId = f.policy.startRun();
  const input = { runId, score: 0, previousBest: 1, adsRemoved: false, ready: true, supported: true };
  for (const invalid of [{ score: -1 }, { score: 0.5 }, { score: NaN },
    { previousBest: Infinity }, { ready: 'yes' }, { rewardedUsed: 'yes' }]) {
    assert.throws(() => f.policy.endRun({ ...input, ...invalid }), /endRun requires/);
  }
  assert.equal(f.policy.startRun(), runId);
  assert.throws(() => f.policy.endRun({ ...input, runId: 'run-999' }), /Unknown run/);
  assert.throws(() => f.policy.finishBreak(runId, {}), /boolean shown/);
  assert.throws(() => f.policy.setDiagnosticsEnabled('true'), /boolean/);
});

test('diagnostics opt-in, clear and opt-out leave assignment and frequency state intact', () => {
  const f = setup({ fast: true });
  complete(f, 2);
  assert.equal(f.policy.getReport().records.length, 0);
  f.policy.setDiagnosticsEnabled(true);
  assert.equal(f.storage.getItem(optInKey), 'true');
  complete(f, 3);
  assert.equal(f.policy.getReport().totals.endedRuns, 3);
  const safety = f.storage.getItem(safetyKey);
  f.policy.clearDiagnostics();
  assert.equal(f.policy.getReport().totals.endedRuns, 0);
  assert.equal(f.storage.getItem(safetyKey), safety);
  assert.equal(f.policy.getReport().diagnosticsEnabled, true);
  f.end();
  f.policy.setDiagnosticsEnabled(false);
  assert.equal(f.policy.getReport().records.length, 0);
  assert.equal(f.storage.getItem(diagnosticKey), null);
  assert.equal(f.restart().policy.getReport().diagnosticsEnabled, false);
  assert.equal(f.policy.getReport().safety.runsEnded, 6);
});

test('diagnostics retain at most 300 terminal runs and expire at thirty days', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  complete(f, 305);
  let report = f.policy.getReport();
  assert.equal(report.totals.endedRuns, 300);
  assert.equal(report.records[0].runId, 'run-6');
  assert.equal(JSON.parse(f.storage.getItem(diagnosticKey)).records.length, 300);
  f.advance(30 * dayMs);
  report = f.policy.getReport();
  assert.equal(report.totals.endedRuns, 0);
  assert.equal(JSON.parse(f.storage.getItem(diagnosticKey)).records.length, 0);
});

test('same-session replay metrics include adjusted and unadjusted latency plus purchase splits', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = f.end({ score: 11, previousBest: 10 });
  f.advance(5000);
  assert.ok(f.policy.beginBreak(decision));
  f.advance(20000);
  f.policy.finishBreak(decision.runId, { shown: true });
  f.advance(9000);
  f.policy.startRun();
  f.end({ adsRemoved: true });
  f.advance(10000);
  f.policy.startRun();
  const report = f.policy.getReport();
  assert.equal(report.totals.sameSessionReplays, 2);
  assert.equal(report.totals.replaysWithin10SecondsAdjusted, 2);
  assert.equal(report.totals.replaysWithin10SecondsUnadjusted, 1);
  assert.equal(report.groups.byExposure.shown.attempts, 1);
  assert.equal(report.groups.byPurchase.paid.sameSessionReplays, 1);
  assert.equal(report.retryLatencyMs.median, 22000);
  assert.equal(report.retryLatencyMs.p90, 34000);
  assert.equal(report.groups.byTrigger['new-best'].shown, 1);
  assert.equal(report.groups.byVariant.contextual.endedRuns, 2);
});

test('no-ad celebration and nofill waiting remain in adjusted latency', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = f.end({ score: 11, previousBest: 10 });
  f.advance(11000);
  assert.ok(f.policy.beginBreak(decision));
  f.policy.finishBreak(decision.runId, { shown: false });
  f.policy.closeBreak(decision.runId);
  f.policy.startRun();
  const report = f.policy.getReport();
  assert.equal(report.totals.replaysWithin10SecondsAdjusted, 0);
  assert.equal(report.records[0].actionableAt, report.records[0].terminalAt);
  assert.equal(report.records[0].retryAt - report.records[0].terminalAt, 11000);
});

test('pending measurements never become abandonment until session inactivity is mature', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  f.end();
  assert.equal(f.policy.getReport().totals.pending, 1);
  f.advance(sessionMs - 1);
  assert.equal(f.policy.getReport().totals.matureNoReplay, 0);
  f.advance(1);
  assert.equal(f.policy.getReport().totals.matureNoReplay, 1);
  f.policy.startRun();
  const report = f.policy.getReport();
  assert.equal(report.totals.matureNoReplay, 1);
  assert.equal(report.totals.sameSessionReplays, 0);
});

test('unconfirmed native outcomes are censored with unknown exposure, not abandonment', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = f.end({ score: 11, previousBest: 10 });
  assert.ok(f.policy.beginBreak(decision));
  f.advance(sessionMs);
  const report = f.policy.getReport();
  assert.equal(report.totals.censored, 1);
  assert.equal(report.totals.matureNoReplay, 0);
  assert.equal(report.groups.byExposure.unknown.endedRuns, 1);
});

test('relaunch links only the last same-session terminal result to a new run', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  f.end();
  f.advance(9000);
  const restarted = f.restart();
  restarted.policy.startRun();
  const report = restarted.policy.getReport();
  assert.equal(report.totals.sameSessionReplays, 1);
  assert.equal(report.totals.replaysWithin10SecondsAdjusted, 1);
  assert.equal(report.records[0].retryAt, f.clock.at);
});

test('diagnostics storage corruption and write failure warn without disabling ads', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  f.storage.setItem(diagnosticKey, '{bad json');
  const restarted = f.restart();
  assert.match(restarted.policy.getReport().warning, /diagnostics could not be restored/);
  assert.equal(complete(restarted, 5).eligible, true);
  const write = restarted.storage.setItem.bind(restarted.storage);
  restarted.storage.setItem = (key, value) => {
    if (key === diagnosticKey) throw new Error('quota');
    write(key, value);
  };
  const decision = complete(restarted, 5);
  assert.equal(decision.eligible, true);
  assert.equal(restarted.policy.beginBreak(decision), true);
  assert.match(restarted.policy.getReport().warning, /diagnostics could not be saved/);
  assert.equal(restarted.policy.getReport().safety.disabled, false);
});

test('retained diagnostic schema contains no raw score, native text, or external identity', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = f.end({ score: 123456, previousBest: 10 });
  assert.ok(f.policy.beginBreak(decision));
  f.policy.finishBreak(decision.runId, { shown: false, reason: 'arbitrary sensitive native error text' });
  const text = f.storage.getItem(diagnosticKey);
  assert.doesNotMatch(text, /123456|previousBest|nickname|receipt|arbitrary sensitive/);
  assert.equal(f.policy.getReport().records[0].moment, 'new-best');
  assert.doesNotThrow(() => JSON.stringify(f.policy.getReport()));
});

test('unknown ad outcome does not fabricate adjusted replay latency on restart', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = f.end({ score: 11, previousBest: 10 });
  assert.ok(f.policy.beginBreak(decision));
  f.advance(9000);
  const restarted = f.restart();
  restarted.policy.startRun();
  const report = restarted.policy.getReport();
  assert.equal(report.totals.sameSessionReplays, 1);
  assert.equal(report.totals.adjustedReplayCensored, 1);
  assert.equal(report.totals.replaysWithin10SecondsAdjusted, 0);
  assert.equal(report.totals.replaysWithin10SecondsUnadjusted, 1);
});

test('known outcome diagnostics restore after both shown and no-fill results', () => {
  for (const outcome of [{ shown: true }, { shown: false, reason: 'no-fill' }]) {
    const f = setup({ fast: true });
    f.policy.setDiagnosticsEnabled(true);
    const decision = f.end({ score: 11, previousBest: 10 });
    assert.ok(f.policy.beginBreak(decision));
    f.advance(20000);
    f.policy.finishBreak(decision.runId, outcome);
    const report = f.restart().policy.getReport();
    assert.equal(report.warning, '');
    assert.equal(report.records[0].result, outcome.shown ? 'shown' : 'no-fill');
    assert.equal(report.safety.sessionShown, outcome.shown ? 1 : 0);
  }
});

test('new-session rotation does not bypass a longer wall-clock cooldown', () => {
  const f = setup({ fast: true, change(config) { config.variants[0].minSecondsBetween = 3600; } });
  const decision = complete(f, 5);
  assert.ok(f.policy.beginBreak(decision));
  f.policy.finishBreak(decision.runId, { shown: true });
  f.advance(sessionMs);
  assert.equal(complete(f, 5).reason, 'cooldown');
  assert.equal(f.policy.getReport().safety.session, 2);
  assert.equal(f.policy.getReport().safety.sessionShown, 0);
});

test('opt-out falls back to removing persisted consent when preference writes fail', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  f.end();
  const write = f.storage.setItem.bind(f.storage);
  f.storage.setItem = (key, value) => {
    if (key === optInKey) throw new Error('quota');
    write(key, value);
  };
  f.policy.setDiagnosticsEnabled(false);
  assert.equal(f.storage.getItem(optInKey), null);
  assert.equal(f.storage.getItem(diagnosticKey), null);
  assert.equal(f.restart().policy.getReport().diagnosticsEnabled, false);
  assert.match(f.policy.getReport().warning, /preference could not be saved/);
});

test('diagnostic schema corruption is discarded without resetting safety', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  f.end();
  const stored = JSON.parse(f.storage.getItem(diagnosticKey));
  stored.records[0].actionableAt = -1;
  f.storage.setItem(diagnosticKey, JSON.stringify(stored));
  const report = f.restart().policy.getReport();
  assert.equal(report.records.length, 0);
  assert.equal(report.safety.runsEnded, 1);
  assert.equal(report.safety.disabled, false);
  assert.match(report.warning, /diagnostics could not be restored/);
});

test('foreground after inactivity preserves a live run while rotating its session before renewal', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const runId = f.policy.startRun();
  f.advance(sessionMs);
  f.policy.touch();
  assert.equal(f.policy.getReport().safety.session, 2);
  assert.equal(f.policy.startRun(), runId);
  f.end();
  f.advance(1000);
  f.policy.startRun();
  const report = f.policy.getReport();
  assert.equal(report.records[0].session, 2);
  assert.equal(report.totals.endedRuns, 1);
  assert.equal(report.totals.sameSessionReplays, 1);
});

test('foreground during expired modal defers rotation without erasing inactivity', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = complete(f, 5);
  assert.ok(f.policy.beginBreak(decision));
  const lastActivity = f.policy.getReport().safety.lastActivityAt;
  f.advance(sessionMs);
  f.policy.touch();
  assert.equal(f.policy.getReport().safety.session, 1);
  assert.equal(f.policy.getReport().safety.lastActivityAt, lastActivity);
  assert.equal(f.policy.getReport().safety.reservedAttempts, 1);
  f.policy.finishBreak(decision.runId, { shown: true });
  const report = f.policy.getReport();
  assert.equal(report.safety.session, 2);
  assert.equal(report.safety.reservedAttempts, 0);
  assert.equal(report.totals.shown, 1);
  assert.equal(report.records[4].actionableAt, f.clock.at);
  assert.equal(f.restart().policy.getReport().warning, '');
});

test('modal dismissal beyond decision freshness still records the confirmed result exactly once', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  const decision = complete(f, 5);
  assert.ok(f.policy.beginBreak(decision));
  f.advance(180000);
  f.policy.touch();
  f.policy.finishBreak(decision.runId, { shown: true });
  const dismissal = f.clock.at;
  f.advance(1000);
  f.policy.finishBreak(decision.runId, { shown: true });
  f.policy.startRun();
  const report = f.policy.getReport();
  assert.equal(report.safety.session, 1);
  assert.equal(report.safety.sessionShown, 1);
  assert.equal(report.records[4].actionableAt, dismissal);
  assert.equal(report.groups.byExposure.shown.replaysWithin10SecondsAdjusted, 1);
});

test('minimum two-run spacing supports separated score moments', () => {
  const f = setup({ fast: true, change(config) { config.variants[0].minRunsBetween = 2; } });
  assert.equal(f.policy.getReport().warning, '');
  const first = f.end({ score: 11, previousBest: 10 });
  assert.equal(first.eligible, true);
  f.policy.closeBreak(first.runId);
  f.end();
  const second = f.end({ score: 12, previousBest: 11 });
  assert.equal(second.eligible, true);
  assert.equal(second.trigger, 'new-best');
});

test('diagnostics deletion failures remain nonthrowing, warn honestly, and preserve safety', () => {
  const f = setup({ fast: true });
  f.policy.setDiagnosticsEnabled(true);
  complete(f, 3);
  const safety = f.storage.getItem(safetyKey);
  f.storage.removeItem = () => { throw new Error('storage inaccessible'); };
  assert.doesNotThrow(() => f.policy.setDiagnosticsEnabled(false));
  assert.doesNotThrow(() => JSON.stringify(f.policy.getReport()));
  assert.doesNotThrow(() => f.policy.clearDiagnostics());
  const report = f.policy.getReport();
  assert.equal(report.diagnosticsEnabled, false);
  assert.equal(report.records.length, 0);
  assert.equal(report.safety.disabled, false);
  assert.match(report.warning, /could not be deleted/);
  assert.equal(f.storage.getItem(safetyKey), safety);
  assert.equal(f.restart().policy.getReport().diagnosticsEnabled, false);
});
