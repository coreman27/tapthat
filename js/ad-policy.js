(function (global) {
  'use strict';

  var SAFETY_KEY = 'dtt.adPolicy.safety.v1';
  var OPT_IN_KEY = 'dtt.adPolicy.diagnosticsEnabled.v1';
  var DIAGNOSTICS_KEY = 'dtt.adPolicy.diagnostics.v1';
  var SESSION_MS = 30 * 60 * 1000;
  var FRESH_MS = 2 * 60 * 1000;
  var RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  var COUNTER_MAX = 1000000000;
  var SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
  var RUN_ID = /^run-([1-9][0-9]{0,9})$/;
  var TRIGGERS = ['none', 'new-best', 'near-best', 'cadence'];
  var RESULTS = ['not-attempted', 'pending', 'shown', 'not-shown', 'no-fill', 'not-ready',
    'cancelled', 'error', 'offline', 'consent-updated', 'consent-unavailable',
    'entitlement-unavailable', 'not-foreground'];
  var REASONS = ['not-due', 'policy-disabled', 'variant-disabled', 'purchased', 'web', 'not-ready',
    'rewarded-excluded', 'first-session-grace', 'session-warmup', 'cooldown', 'session-cap',
    'attempt-cap', 'run-spacing', 'eligible'];

  function integer(value, min, max) {
    return Number.isSafeInteger(value) && value >= min && value <= max;
  }

  function timestamp(value) { return integer(value, 0, Number.MAX_SAFE_INTEGER); }
  function nullableTime(value) { return value === null || timestamp(value); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function id(value) { return typeof value === 'string' && SAFE_ID.test(value); }
  function runId(value) { return typeof value === 'string' && RUN_ID.test(value); }
  function bool(value) { return typeof value === 'boolean'; }

  function exactKeys(value, keys) {
    return object(value) && Object.keys(value).length === keys.length &&
      keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
  }

  function freeze(value) {
    if (object(value) || Array.isArray(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }

  function validateConfig(config) {
    if (!exactKeys(config, ['version', 'variants']) || !id(config.version) ||
        !Array.isArray(config.variants) || config.variants.length < 1 || config.variants.length > 16) return false;
    var ids = [];
    var total = 0;
    var valid = config.variants.every(function (variant) {
      if (!exactKeys(variant, ['id', 'weight', 'enabled', 'everyRuns', 'onNewBest', 'onNearBest',
        'nearBestRatio', 'minBest', 'minRunsBetween', 'firstSessionGraceRuns',
        'minSessionSeconds', 'minSecondsBetween', 'maxAdsPerSession'])) return false;
      if (!id(variant.id) || ids.indexOf(variant.id) !== -1 ||
          !integer(variant.weight, 0, 10000) || !bool(variant.enabled) ||
          !bool(variant.onNewBest) || !bool(variant.onNearBest) ||
          !integer(variant.everyRuns, 4, 6) ||
          !Number.isFinite(variant.nearBestRatio) || variant.nearBestRatio < 0 || variant.nearBestRatio > 1 ||
          !integer(variant.minBest, 1, 1000000) ||
          !integer(variant.minRunsBetween, 2, 100) ||
          !integer(variant.firstSessionGraceRuns, 0, 100) ||
          !integer(variant.minSessionSeconds, 0, 3600) ||
          !integer(variant.minSecondsBetween, 1, 86400) ||
          !integer(variant.maxAdsPerSession, 1, 20)) return false;
      ids.push(variant.id);
      total += variant.weight;
      return true;
    });
    return valid && total > 0;
  }

  // startRun resumes an unfinished local run until session expiry; endRun alone is terminal.
  // A decision is an opaque, frozen, one-shot token: pass the original to beginBreak at Retry/Home.
  // The owner must recheck entitlement, availability, foreground and busy state before beginBreak.
  // touch marks foreground/background activity and rotates only after 30 minutes without activity.
  // No-ad actionableAt is terminalAt (including celebration); shown ads move it to finishBreak.
  // finishBreak is idempotent; unresolved persisted attempts reserve capacity for their session.
  function create(options) {
    if (!object(options)) throw new TypeError('AdPolicy.create requires options.');
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('now must be a function.');
    if (options.random !== undefined && typeof options.random !== 'function') throw new TypeError('random must be a function.');
    var now = options.now || Date.now;
    var random = options.random || Math.random;
    var storage;
    var warnings = [];
    var disabled = false;
    var config = null;
    var variant = null;
    var state;
    var pending = null;
    var liveBreak = null;
    var diagnosticsEnabled = false;
    var records = [];
    var clock = 0;

    function warn(message, fatal) {
      if (fatal) disabled = true;
      if (warnings.indexOf(message) !== -1) return;
      warnings.push(message);
      if (global.console && typeof global.console.warn === 'function') global.console.warn(message);
    }

    function time() {
      var value;
      try { value = now(); } catch (error) { value = NaN; }
      if (!timestamp(value) || value < clock) {
        warn('Ad policy disabled: the local clock is invalid or moved backwards.', true);
        return clock;
      }
      clock = value;
      if (state) state.lastClockAt = value;
      return value;
    }

    var initialTime = time();
    try {
      storage = options.storage === undefined ? global.localStorage : options.storage;
      if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' ||
          typeof storage.removeItem !== 'function') throw new Error('storage');
    } catch (error) {
      warn('Ad policy disabled: local safety storage is unavailable.', true);
    }
    try {
      if (!validateConfig(options.config)) throw new Error('config');
      config = freeze(clone(options.config));
    } catch (error) {
      warn('Ad policy disabled: invalid configuration; no fallback policy was selected.', true);
    }

    function newState(at) {
      return {
        schema: 1, assignment: null, session: 1, sessionStartedAt: at, lastActivityAt: at,
        lastClockAt: at, runsStarted: 0, runsEnded: 0, sessionRuns: 0,
        lastCandidateRun: null, lastAttemptRun: null, lastAttemptAt: null,
        sessionAttempts: 0, sessionShown: 0, reservations: [], activeRun: null, lastEnded: null
      };
    }

    function validState(value) {
      if (!exactKeys(value, Object.keys(newState(0))) || value.schema !== 1 ||
          !integer(value.session, 1, COUNTER_MAX) ||
          !integer(value.runsStarted, 0, COUNTER_MAX) ||
          !integer(value.runsEnded, 0, value.runsStarted) ||
          !integer(value.sessionRuns, 0, value.runsEnded) ||
          !integer(value.sessionAttempts, 0, Math.min(60, value.sessionRuns)) ||
          !integer(value.sessionShown, 0, Math.min(20, value.sessionAttempts)) ||
          (value.session === 1 && value.sessionRuns !== value.runsEnded) ||
          !timestamp(value.sessionStartedAt) || !timestamp(value.lastActivityAt) ||
          !timestamp(value.lastClockAt) || value.sessionStartedAt > value.lastActivityAt ||
          value.lastActivityAt > value.lastClockAt || value.lastClockAt > initialTime ||
          !nullableTime(value.lastAttemptAt) ||
          (value.lastAttemptAt !== null && value.lastAttemptAt > value.lastActivityAt) ||
          !(value.lastCandidateRun === null || integer(value.lastCandidateRun, 1, value.runsEnded)) ||
          !(value.lastAttemptRun === null || integer(value.lastAttemptRun, 1, value.runsEnded)) ||
          ((value.lastAttemptRun === null) !== (value.lastAttemptAt === null)) ||
          (value.sessionAttempts > 0 && value.lastAttemptAt === null) ||
          (value.sessionAttempts > 0 && value.lastAttemptAt < value.sessionStartedAt) ||
          (value.lastAttemptRun !== null && (value.lastCandidateRun === null ||
            value.lastAttemptRun > value.lastCandidateRun)) ||
          !Array.isArray(value.reservations) || value.reservations.length > 20 ||
          value.reservations.length + value.sessionShown > value.sessionAttempts) return false;
      if (!exactKeys(value.assignment, ['version', 'id']) ||
          !id(value.assignment.version) || !id(value.assignment.id)) return false;
      function knownRun(valueId) {
        return runId(valueId) && Number(valueId.slice(4)) <= value.runsStarted;
      }
      if (value.activeRun !== null && (!exactKeys(value.activeRun, ['runId', 'session']) ||
          !knownRun(value.activeRun.runId) || value.activeRun.session !== value.session ||
          Number(value.activeRun.runId.slice(4)) !== value.runsStarted ||
          value.runsEnded >= value.runsStarted)) return false;
      if (value.lastEnded !== null && (!exactKeys(value.lastEnded, ['runId', 'session', 'terminalAt']) ||
          !knownRun(value.lastEnded.runId) || !integer(value.lastEnded.session, 1, value.session) ||
          !timestamp(value.lastEnded.terminalAt) || value.lastEnded.terminalAt > value.lastActivityAt ||
          value.runsEnded === 0 ||
          (value.activeRun && value.activeRun.runId === value.lastEnded.runId))) return false;
      if ((value.lastEnded === null) !== (value.runsEnded === 0)) return false;
      var seen = [];
      return value.reservations.every(function (reservation) {
        if (!exactKeys(reservation, ['runId', 'session', 'at']) || !knownRun(reservation.runId) ||
            reservation.session !== value.session || !timestamp(reservation.at) ||
            reservation.at < value.sessionStartedAt || reservation.at > value.lastActivityAt ||
            seen.indexOf(reservation.runId) !== -1) return false;
        seen.push(reservation.runId);
        return true;
      });
    }

    state = newState(initialTime);
    if (storage) {
      try {
        var saved = storage.getItem(SAFETY_KEY);
        if (saved !== null) {
          var restored = JSON.parse(saved);
          if (!validState(restored)) throw new Error('state');
          state = restored;
          state.lastClockAt = initialTime;
        }
      } catch (error) {
        warn('Ad policy disabled: saved safety state is corrupt, unreadable, or ahead of the clock.', true);
      }
    }

    function saveSafety() {
      if (disabled) return false;
      try {
        storage.setItem(SAFETY_KEY, JSON.stringify(state));
        return true;
      } catch (error) {
        warn('Ad policy disabled: safety state could not be saved; no ad will be attempted.', true);
        pending = null;
        return false;
      }
    }

    if (config && !disabled) {
      if (state.assignment && state.assignment.version === config.version) {
        variant = config.variants.find(function (item) { return item.id === state.assignment.id; }) || null;
        if (!variant) warn('Ad policy disabled: the assigned variant is missing; change the config version.', true);
      } else {
        var sample;
        try { sample = random(); } catch (error) { sample = NaN; }
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
          warn('Ad policy disabled: assignment random value must be in [0, 1).', true);
        } else {
          var totalWeight = config.variants.reduce(function (sum, item) { return sum + item.weight; }, 0);
          var target = sample * totalWeight;
          config.variants.some(function (item) {
            target -= item.weight;
            if (target < 0) { variant = item; return true; }
            return false;
          });
          state.assignment = { version: config.version, id: variant.id };
        }
      }
      saveSafety();
    }

    function validRecord(record) {
      return exactKeys(record, ['configVersion', 'variant', 'session', 'runId', 'terminalAt', 'trigger',
        'moment', 'reason', 'paid', 'rewardedOffered', 'rewardedUsed', 'assisted', 'attempted',
        'shown', 'result', 'retryAt', 'actionableAt']) &&
        (record.configVersion === null || id(record.configVersion)) &&
        (record.variant === null || id(record.variant)) &&
        integer(record.session, 1, state.session) && runId(record.runId) &&
        Number(record.runId.slice(4)) <= state.runsStarted &&
        timestamp(record.terminalAt) && record.terminalAt <= clock &&
        TRIGGERS.indexOf(record.trigger) !== -1 &&
        ['ordinary', 'new-best', 'near-best'].indexOf(record.moment) !== -1 &&
        REASONS.indexOf(record.reason) !== -1 &&
        ['paid', 'rewardedOffered', 'rewardedUsed', 'assisted', 'attempted', 'shown'].every(function (key) {
          return bool(record[key]);
        }) && RESULTS.indexOf(record.result) !== -1 &&
        (!record.shown || record.attempted) &&
        (record.result === 'shown') === record.shown &&
        (record.result !== 'not-attempted') === record.attempted &&
        nullableTime(record.retryAt) && timestamp(record.actionableAt) &&
        record.actionableAt >= record.terminalAt && record.actionableAt <= clock &&
        (record.retryAt === null || (record.retryAt >= record.actionableAt && record.retryAt <= clock));
    }

    if (storage) {
      try {
        var optIn = storage.getItem(OPT_IN_KEY);
        if (optIn !== null && optIn !== 'true' && optIn !== 'false') throw new Error('opt-in');
        diagnosticsEnabled = optIn === 'true';
        if (diagnosticsEnabled) {
          var diagnosticText = storage.getItem(DIAGNOSTICS_KEY);
          if (diagnosticText !== null) {
            var diagnosticData = JSON.parse(diagnosticText);
            var diagnosticIds = [];
            if (!exactKeys(diagnosticData, ['schema', 'records']) || diagnosticData.schema !== 1 ||
                !Array.isArray(diagnosticData.records) || diagnosticData.records.length > 300 ||
                !diagnosticData.records.every(function (record) {
                  if (!validRecord(record) || diagnosticIds.indexOf(record.runId) !== -1) return false;
                  diagnosticIds.push(record.runId);
                  return true;
                })) throw new Error('diagnostics');
            records = diagnosticData.records;
          }
        }
      } catch (error) {
        warn('Local ad diagnostics could not be restored; retained measurements may be incomplete.', false);
        records = [];
      }
    }

    function prune(at) {
      records = records.filter(function (record) { return at - record.terminalAt < RETENTION_MS; }).slice(-300);
    }

    function saveDiagnostics(at) {
      prune(at);
      if (!diagnosticsEnabled) return;
      try {
        storage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ schema: 1, records: records }));
      } catch (error) {
        warn('Local ad diagnostics could not be saved; measurements may not survive a restart.', false);
      }
    }

    function recordFor(value) {
      return records.find(function (record) { return record.runId === value; });
    }

    function rotateSession(at, preserveActiveRun) {
      if (at - state.lastActivityAt < SESSION_MS) return;
      var activeRun = preserveActiveRun ? state.activeRun : null;
      if (state.session >= COUNTER_MAX) warn('Ad policy disabled: the session counter limit was reached.', true);
      else state.session += 1;
      state.sessionStartedAt = at;
      state.sessionRuns = 0;
      state.sessionAttempts = 0;
      state.sessionShown = 0;
      state.reservations = [];
      // An interrupted run is not a terminal result, and a result never survives as an ad opportunity.
      state.activeRun = activeRun;
      if (activeRun) activeRun.session = state.session;
      pending = null;
    }

    function touch() {
      var at = time();
      // Foregrounding must not invalidate a still-running native modal or hide its expired session.
      if (liveBreak && at - state.lastActivityAt >= SESSION_MS) {
        saveSafety();
        saveDiagnostics(at);
        return;
      }
      rotateSession(at, true);
      state.lastActivityAt = at;
      saveSafety();
      saveDiagnostics(at);
    }

    function startRun() {
      var at = time();
      rotateSession(at);
      pending = null;
      if (state.activeRun) {
        state.lastActivityAt = at;
        saveSafety();
        return state.activeRun.runId;
      }
      if (state.runsStarted >= COUNTER_MAX) throw new RangeError('The local run counter limit was reached.');
      var previous = state.lastEnded && recordFor(state.lastEnded.runId);
      if (previous && previous.session === state.session && previous.retryAt === null) {
        previous.retryAt = at;
      }
      state.runsStarted += 1;
      state.activeRun = { runId: 'run-' + state.runsStarted, session: state.session };
      state.lastActivityAt = at;
      saveSafety();
      saveDiagnostics(at);
      return state.activeRun.runId;
    }

    function decision(value, eligible, reason, trigger) {
      return Object.freeze({ eligible: eligible, reason: reason, trigger: trigger, runId: value });
    }

    function safetyReason(at) {
      if (disabled || !variant) return 'policy-disabled';
      if (!variant.enabled) return 'variant-disabled';
      if (state.session === 1 && state.sessionRuns <= variant.firstSessionGraceRuns) return 'first-session-grace';
      if (at - state.sessionStartedAt < variant.minSessionSeconds * 1000) return 'session-warmup';
      if (state.lastAttemptAt !== null && at - state.lastAttemptAt < variant.minSecondsBetween * 1000) return 'cooldown';
      if (state.sessionShown + state.reservations.length >= variant.maxAdsPerSession) return 'session-cap';
      if (state.sessionAttempts >= variant.maxAdsPerSession * 3) return 'attempt-cap';
      if (state.lastAttemptRun !== null && state.runsEnded - state.lastAttemptRun < variant.minRunsBetween) return 'run-spacing';
      return null;
    }

    function endRun(input) {
      if (!object(input) || !runId(input.runId) ||
          !integer(input.score, 0, Number.MAX_SAFE_INTEGER) ||
          !integer(input.previousBest, 0, Number.MAX_SAFE_INTEGER) ||
          !bool(input.adsRemoved) || !bool(input.ready) || !bool(input.supported) ||
          ['rewardedOffered', 'rewardedUsed', 'assisted'].some(function (key) {
            return input[key] !== undefined && !bool(input[key]);
          })) throw new TypeError('endRun requires a run ID, nonnegative integer scores, and boolean availability flags.');
      if (Number(input.runId.slice(4)) > state.runsStarted) throw new RangeError('Unknown run ID.');
      if (!state.activeRun || state.activeRun.runId !== input.runId) {
        return decision(input.runId, false, 'duplicate-run', 'none');
      }
      var at = time();
      state.runsEnded += 1;
      state.sessionRuns += 1;
      state.activeRun = null;
      state.lastActivityAt = at;
      state.lastEnded = { runId: input.runId, session: state.session, terminalAt: at };
      pending = null;
      var moment = 'ordinary';
      if (variant && input.previousBest >= variant.minBest) {
        if (input.score > input.previousBest) moment = 'new-best';
        else if (input.score >= Math.ceil(input.previousBest * variant.nearBestRatio)) moment = 'near-best';
      }
      var trigger = 'none';
      if (variant) {
        if (variant.onNewBest && moment === 'new-best') trigger = 'new-best';
        else if (variant.onNearBest && moment === 'near-best') trigger = 'near-best';
        else if (state.sessionRuns % variant.everyRuns === 0) trigger = 'cadence';
      }
      var reason = 'not-due';
      if (disabled || !variant) reason = 'policy-disabled';
      else if (!variant.enabled) reason = 'variant-disabled';
      else if (input.adsRemoved) reason = 'purchased';
      else if (!input.supported) reason = 'web';
      else if (!input.ready) reason = 'not-ready';
      else if (input.rewardedOffered || input.rewardedUsed || input.assisted) reason = 'rewarded-excluded';
      else if (trigger !== 'none') {
        reason = safetyReason(at);
        if (!reason && state.lastCandidateRun !== null &&
            state.runsEnded - state.lastCandidateRun < variant.minRunsBetween) {
          reason = 'run-spacing';
        }
        reason = reason || 'eligible';
      }
      // Space selected opportunities, not rejected milestones: repeated near-bests
      // must not keep moving the spacing window forever.
      if (reason === 'eligible') state.lastCandidateRun = state.runsEnded;
      if (!saveSafety()) reason = 'policy-disabled';
      var result = decision(input.runId, reason === 'eligible', reason, trigger);
      if (result.eligible) pending = { decision: result, session: state.session, terminalAt: at };
      if (diagnosticsEnabled) {
        records.push({
          configVersion: config ? config.version : null, variant: variant ? variant.id : null,
          session: state.session, runId: input.runId, terminalAt: at, trigger: trigger, moment: moment,
          reason: reason, paid: input.adsRemoved, rewardedOffered: !!input.rewardedOffered,
          rewardedUsed: !!input.rewardedUsed, assisted: !!input.assisted,
          attempted: false, shown: false, result: 'not-attempted', retryAt: null, actionableAt: at
        });
        saveDiagnostics(at);
      }
      return result;
    }

    function beginBreak(value) {
      var at = time();
      // Identity, not caller-supplied fields, owns an opportunity.
      if (!pending || pending.decision !== value) return false;
      var owned = pending;
      pending = null;
      if (owned.session !== state.session || state.activeRun ||
          !state.lastEnded || state.lastEnded.runId !== owned.decision.runId ||
          at - owned.terminalAt > FRESH_MS || at - state.lastActivityAt >= SESSION_MS ||
          safetyReason(at)) return false;
      state.lastAttemptAt = at;
      state.lastAttemptRun = state.runsEnded;
      state.sessionAttempts += 1;
      state.reservations.push({ runId: value.runId, session: state.session, at: at });
      state.lastActivityAt = at;
      // Persist the reservation before the owner is allowed to enter the native bridge.
      if (!saveSafety()) return false;
      liveBreak = value.runId;
      var record = recordFor(value.runId);
      if (record) { record.attempted = true; record.result = 'pending'; }
      saveDiagnostics(at);
      return true;
    }

    function finishBreak(value, outcome) {
      if (!runId(value) || !object(outcome) || !bool(outcome.shown) ||
          (outcome.reason !== undefined && typeof outcome.reason !== 'string')) {
        throw new TypeError('finishBreak requires a run ID and a boolean shown outcome.');
      }
      var at = time();
      var index = state.reservations.findIndex(function (reservation) { return reservation.runId === value; });
      if (index === -1) return;
      state.reservations.splice(index, 1);
      if (liveBreak === value) liveBreak = null;
      if (outcome.shown) state.sessionShown += 1;
      rotateSession(at, true);
      state.lastActivityAt = at;
      saveSafety();
      var record = recordFor(value);
      if (record) {
        record.shown = outcome.shown;
        var nativeReasons = {
          noFill: 'no-fill', not_ready: 'not-ready', not_initialized: 'not-ready',
          presentation_failed: 'error', cannot_present: 'error',
          consent_updated: 'consent-updated', consent_unavailable: 'consent-unavailable',
          entitlement_unavailable: 'entitlement-unavailable', not_foreground: 'not-foreground'
        };
        var result = Object.prototype.hasOwnProperty.call(nativeReasons, outcome.reason) ?
          nativeReasons[outcome.reason] : outcome.reason;
        record.result = outcome.shown ? 'shown' :
          (RESULTS.indexOf(result) !== -1 && ['pending', 'shown', 'not-attempted'].indexOf(result) === -1 ?
            result : 'not-shown');
        // No-ad failures retain terminal latency; only a displayed ad resets the actionable clock.
        if (outcome.shown && record.retryAt === null) record.actionableAt = at;
      }
      saveDiagnostics(at);
    }

    function closeBreak(value) {
      if (!runId(value)) throw new TypeError('closeBreak requires a run ID.');
      var at = time();
      if (pending && pending.decision.runId === value) pending = null;
      // Retry is already actionable at the terminal screen. Closing without an ad must not
      // erase time spent celebrating, considering a purchase, or waiting for an unavailable ad.
      if (state.lastEnded && state.lastEnded.runId === value && !state.activeRun) {
        rotateSession(at);
        state.lastActivityAt = at;
        saveSafety();
      }
      saveDiagnostics(at);
    }

    function clearDiagnostics() {
      records = [];
      try { storage.removeItem(DIAGNOSTICS_KEY); }
      catch (error) { warn('Local ad diagnostics could not be deleted from storage.', false); }
    }

    function setDiagnosticsEnabled(value) {
      if (!bool(value)) throw new TypeError('Diagnostics opt-in must be boolean.');
      diagnosticsEnabled = value;
      try { storage.setItem(OPT_IN_KEY, value ? 'true' : 'false'); }
      catch (error) {
        warn('Local diagnostics preference could not be saved.', false);
        if (!value) {
          try { storage.removeItem(OPT_IN_KEY); }
          catch (removeError) { warn('Local diagnostics opt-out could not be persisted.', false); }
        }
      }
      if (!value) clearDiagnostics();
    }

    function emptyCounts() {
      return {
        endedRuns: 0, attempts: 0, shown: 0, sameSessionReplays: 0,
        replaysWithin10SecondsAdjusted: 0, replaysWithin10SecondsUnadjusted: 0,
        matureNoReplay: 0, pending: 0, censored: 0, adjustedReplayCensored: 0
      };
    }

    function getReport() {
      var at = time();
      saveDiagnostics(at);
      var totals = emptyCounts();
      var groups = { byVariant: {}, byTrigger: {}, byExposure: {}, byPurchase: {}, byConfigVersion: {}, byResult: {} };
      var annotated = [];
      var latencies = [];
      records.forEach(function (record) {
        var status = record.retryAt !== null ? 'replayed' :
          (record.session < state.session || at - state.lastActivityAt >= SESSION_MS ? 'mature-no-replay' : 'pending');
        // An unconfirmed bridge attempt has unknown ad exposure, even after the session matures.
        if (record.result === 'pending' && record.retryAt === null && status === 'mature-no-replay') status = 'censored';
        var exposure = record.shown ? 'shown' : (record.attempted ? 'attempted-not-shown' : 'no-ad');
        if (record.result === 'pending') exposure = 'unknown';
        var buckets = [totals];
        [
          ['byVariant', record.variant || 'unassigned'], ['byTrigger', record.trigger],
          ['byExposure', exposure], ['byPurchase', record.paid ? 'paid' : 'free'],
          ['byConfigVersion', record.configVersion || 'invalid'], ['byResult', record.result]
        ].forEach(function (entry) {
          var map = groups[entry[0]];
          if (!Object.prototype.hasOwnProperty.call(map, entry[1])) {
            Object.defineProperty(map, entry[1], { value: emptyCounts(), enumerable: true });
          }
          buckets.push(map[entry[1]]);
        });
        buckets.forEach(function (counts) {
          counts.endedRuns += 1;
          if (record.attempted) counts.attempts += 1;
          if (record.shown) counts.shown += 1;
          if (status === 'replayed') {
            counts.sameSessionReplays += 1;
            if (record.result === 'pending') counts.adjustedReplayCensored += 1;
            else if (record.retryAt - record.actionableAt <= 10000) counts.replaysWithin10SecondsAdjusted += 1;
            if (record.retryAt - record.terminalAt <= 10000) counts.replaysWithin10SecondsUnadjusted += 1;
          } else if (status === 'mature-no-replay') counts.matureNoReplay += 1;
          else counts[status] += 1;
        });
        if (record.retryAt !== null) latencies.push(record.retryAt - record.terminalAt);
        var copy = clone(record);
        copy.observation = status;
        annotated.push(copy);
      });
      latencies.sort(function (a, b) { return a - b; });
      return {
        activeConfig: config ? freeze(clone(config)) : null,
        variant: variant ? variant.id : null, selectedVariant: variant ? freeze(clone(variant)) : null,
        diagnosticsEnabled: diagnosticsEnabled, warning: warnings.join(' '), warnings: warnings.slice(),
        safety: {
          disabled: disabled, session: state.session, firstSession: state.session === 1,
          sessionStartedAt: state.sessionStartedAt, lastActivityAt: state.lastActivityAt,
          runsStarted: state.runsStarted, runsEnded: state.runsEnded, sessionRuns: state.sessionRuns,
          sessionAttempts: state.sessionAttempts, sessionShown: state.sessionShown,
          reservedAttempts: state.reservations.length, lastAttemptAt: state.lastAttemptAt,
          lastCandidateRun: state.lastCandidateRun, lastAttemptRun: state.lastAttemptRun,
          activeRunId: state.activeRun ? state.activeRun.runId : null,
          pendingRunId: pending ? pending.decision.runId : null
        },
        retention: { maxDays: 30, maxEndedRuns: 300 },
        totals: totals, groups: groups, records: annotated,
        retryLatencyMs: {
          sampleSize: latencies.length,
          median: latencies.length ? (latencies[Math.floor((latencies.length - 1) / 2)] +
            latencies[Math.ceil((latencies.length - 1) / 2)]) / 2 : null,
          p90: latencies.length ? latencies[Math.ceil(latencies.length * 0.9) - 1] : null
        },
        limitations: [
          'Optional local diagnostics only; no remote analytics or behavioral data sent to Google.',
          'Retained ended runs only, not population D1/D7 retention or causal evidence.',
          'Replay counts are same-session new runs; unfinished runs are not terminal results.',
          'Pending and unknown-exposure censored results are not counted as abandonment.',
          'Replays after an unconfirmed ad attempt have censored adjusted latency, but known unadjusted latency.',
          'Adjusted latency starts at terminal time unless an ad is shown, then at dismissal.',
          'Unadjusted latency includes celebration, purchase consideration, and the complete ad break.',
          'Only the most recent same-session terminal break can be linked to the next new run.'
        ]
      };
    }

    saveDiagnostics(initialTime);
    return Object.freeze({
      startRun: startRun, endRun: endRun, beginBreak: beginBreak, finishBreak: finishBreak,
      closeBreak: closeBreak, touch: touch, setDiagnosticsEnabled: setDiagnosticsEnabled,
      getReport: getReport, clearDiagnostics: clearDiagnostics
    });
  }

  global.AdPolicy = Object.freeze({ create: create });
})(window);
