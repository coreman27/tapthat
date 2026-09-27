(function (global) {
  'use strict';

  function variant(id, weight, scoreMoments, enabled) {
    return Object.freeze({
      id: id,
      weight: weight,
      enabled: enabled,
      everyRuns: 5,
      onNewBest: scoreMoments,
      onNearBest: scoreMoments,
      nearBestRatio: 0.9,
      minBest: 10,
      minRunsBetween: 3,
      firstSessionGraceRuns: 3,
      minSessionSeconds: 60,
      minSecondsBetween: 90,
      maxAdsPerSession: 3
    });
  }

  // Every field is required. Validation fails closed rather than repairing invalid settings.
  // everyRuns: 4..6; minRunsBetween: 2..100; minSecondsBetween: 1..86400;
  // firstSessionGraceRuns: 0..100; minSessionSeconds: 0..3600; maxAdsPerSession: 1..20.
  // Weights are integers 0..10000 with a positive sum; ratios are finite values in [0, 1].
  // Change the version when changing assignment weights or removing a variant.
  global.AdConfig = Object.freeze({
    version: 'score-timing-v1',
    variants: Object.freeze([
      variant('contextual', 100, true, true),
      variant('cadence-5', 0, false, true),
      variant('holdout', 0, false, false)
    ])
  });
})(window);
