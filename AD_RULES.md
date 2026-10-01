# Ad Rules and Configuration Reference

This documents the implemented iOS interstitial policy. It controls **when an
ad is offered**, not personalized ad content. Score comparisons and timing
measurements stay on the device; no player scores are sent to Google.

For product strategy see [MONETIZATION_ROADMAP.md](MONETIZATION_ROADMAP.md).
For Apple/AdMob accounts, payments, consent, and release setup see
[APPSTORE.md](APPSTORE.md).

## Current rules

At the end of a run, choose at most one trigger, in this order:

1. **New best:** the score beats the previous best, and that previous best was
   at least 10.
2. **Near best (off by default):** the score is at least `ceil(previousBest * 0.9)`
   but does not exceed the previous best, which must be at least 10. Ties count.
   Disabled in the shipped config because it fires right after a near miss, when
   players are most likely to quit; enable `onNearBest` to compare it deliberately.
3. **Cadence:** every fifth completed run in the session (5, 10, 15, ...).
   Milestone opportunities do not shift this schedule.

The previous best is captured **before** saving the new score. The first-ever
personal best is not a score trigger. Disabled score triggers can still fall
back to the cadence trigger.

**A trigger is only a candidate, not a guaranteed impression.** All limits apply:

- No opportunities on the first three completed runs of the first session.
- No opportunities in the first 60 seconds of each session.
- At least three completed-run increments between selected opportunities and
  between attempts. For example, an opportunity on run 4 permits another on
  run 7, not run 5. Rejected milestones do not keep restarting this window.
- At least 90 seconds between attempts, even if the previous ad was unavailable.
- At most three shown ads per session. In-flight attempts reserve capacity.
- At most nine attempts per session (`maxAdsPerSession * 3`) to bound no-fill.
- No ads for verified Remove Ads owners, on the web, before monetization is
  ready, or for a run/break flagged as assisted or involving a rewarded offer.
  Rewarded Continue itself is not implemented yet.

A session rotates after **30 minutes without tracked activity**, not every app
launch. Closing and reopening within that window preserves the session limits.
Foreground events check expiry before renewing activity; an active native ad
is allowed to finish before session rotation. Time cooldowns survive rotation.

## When an ad actually appears

The game-over screen shows the score and a notice that an ad may appear.
It does **not** immediately open an ad over a new-best celebration.

The selected opportunity is attempted only when the player chooses **Try Again**
or **Home**. Sharing or opening the purchase screen does not trigger it.
Buying Remove Ads before leaving the result screen suppresses the pending ad.

The decision is one-shot, expires after two minutes, and is invalid after a new
run or session. Availability, ownership, foreground state, and caps are checked
again before presentation. Controls are locked through native dismissal.
Unavailable ads are skipped; there is no catch-up queue, timer, or delayed
ad-load callback that can interrupt a later round.

Consent recovery may use that same locked break, but does not also show an ad.

## Configuration knobs

Edit [`js/ad-config.js`](js/ad-config.js), not the generated `www/` copy.

| Field | Contextual default | Allowed value / purpose |
|---|---|---|
| `id` | `contextual` | Unique variant label |
| `weight` | `100` | Integer 0-10,000; relative assignment weight |
| `enabled` | `true` | Boolean; disables presentation for this variant when false |
| `everyRuns` | `5` | Integer 4-6; session cadence |
| `onNewBest` | `true` | Boolean; enable new-best trigger |
| `onNearBest` | `false` | Boolean; enable near-best trigger |
| `nearBestRatio` | `0.9` | Finite number 0-1; fraction of the previous best |
| `minBest` | `10` | Integer 1-1,000,000; minimum established best for score triggers |
| `minRunsBetween` | `3` | Integer 2-100; minimum run spacing |
| `firstSessionGraceRuns` | `3` | Integer 0-100; first-session protected runs |
| `minSessionSeconds` | `60` | Integer 0-3,600; warmup per session |
| `minSecondsBetween` | `90` | Integer 1-86,400; attempt cooldown |
| `maxAdsPerSession` | `3` | Integer 1-20; shown-ad cap |

Every field is required. The configuration contains a `version` and 1-16
variants whose weights have a positive total. Version and variant IDs use
1-64 letters, digits, underscores, or hyphens, beginning with a letter or digit.
IDs must be unique within a configuration.

The current helper `variant(id, weight, scoreMoments, enabled)` sets both score
switches from `scoreMoments`; other settings in its object are shared defaults
for all variants. To compare different cadences or thresholds between variants,
extend the helper with explicit per-variant arguments or define complete variant
objects. Do not accidentally change both experimental arms when editing a
shared default. Returned objects are frozen; edit their definitions rather than
mutating them at runtime.

Invalid configuration, corrupt/unavailable safety storage, or a backwards clock
disables ad presentation and exposes a diagnostic warning. The game remains
playable; there is no silent fallback to a more aggressive policy.

## Variants and controlled comparisons

| Variant | Weight | Score triggers | Interstitial presentation |
|---|---|---|---|
| `contextual` | 100 | New best and near best | Enabled |
| `cadence-5` | 0 | Neither | Enabled |
| `holdout` | 0 | Neither | Disabled |

Only contextual receives new assignments by default. Holdout prevents
interstitial presentation; it is **not** an advertising-SDK or consent kill switch.

Example: to compare contextual against cadence-only, change the factory calls to:

```js
variant('contextual', 50, true, true),
variant('cadence-5', 50, false, true),
variant('holdout', 0, false, false)
```

Also increment `version`, for example to `score-timing-v2`. Assignment is random
once per local configuration version and persists across launches, not per run.
Zero weight prevents new assignments but does not evict an existing assignment
within the same version. Version changes may reassign a device without clearing
cooldowns, session caps, or onboarding history.

Use a new version for every experiment-setting change so reports remain
interpretable. Define one hypothesis and change one factor at a time. Do not
choose a winner from a few sessions or optimize impressions at the expense of
players wanting another try.

## Local measurements

Open **How to play > Local ad timing diagnostics** and enable
recording. It is **off by default**. Use **Refresh report** and manually copy
the JSON to compare playtests.

Reports include:

- Active configuration, assigned variant, safety counters, and warnings.
- Selected/skipped triggers and actual native outcomes, such as not-ready,
  offline, consent recovery, or presentation error.
- Counts grouped by variant, configuration version, trigger, exposure, purchase
  status, and outcome. Do not mix configuration versions when comparing arms.
- Same-session replays and replays within 10 seconds, with adjusted and
  unadjusted timing, plus retry-latency median/p90 and sample size.
- Pending/censored observations separately from mature no-replay observations.
  Unknown native outcomes are not assumed to be confirmed impressions.

Unadjusted timing begins at the terminal result. Adjusted timing begins there
too unless an ad was actually shown, in which case it begins at dismissal.
Celebration time and waiting for an unshown ad still count as friction.
Only the most recent terminal break can be linked to a new run.

Records expire after 30 days, are limited to 300 ended runs, and are pruned when
accessed. They contain no nickname, raw score, contact details, or payment
receipts. Nothing uploads automatically. Opting out deletes measurements;
**Clear measurements** does not reset assignment or ad frequency protections.
Storage failures are surfaced in the report.

These are optional, single-device playtest reports, **not** population D1/D7
retention, actual revenue reports, or proof of causal improvement.

## Examples with defaults

Assume onboarding, time, spacing, and capacity requirements are satisfied:

| Previous best | Current score | Result |
|---|---|---|
| 0 | 8 | No score trigger; cadence may still apply |
| 9 | 12 | No score trigger; previous best is below 10 |
| 20 | 21 | New-best candidate |
| 20 | 18 or 20 | Near-best candidate |
| 20 | 17 | No score trigger; cadence may still apply |
| 11 | 10 | Near-best candidate (`ceil(9.9) = 10`) |

A new best during cooldown is skipped, not queued. A milestone opportunity on
run 4 can suppress the cadence candidate on run 5 through run-spacing protection.
A long ad-free result-screen pause does not cause an ad to pop up by itself.

## Code map and deployment

| File | Responsibility |
|---|---|
| `js/ad-config.js` | Versioned variants and settings |
| `js/ad-policy.js` | Decisions, session/cap persistence, local diagnostics |
| `js/monetization.js` | Ownership/readiness checks and native ad bridge |
| `js/main.js` | Previous-best context, result notice, explicit navigation |
| `scripts/ad-policy.test.js` | Policy thresholds, persistence, measurement tests |
| `scripts/monetization.test.js` | Bridge and UI race/purchase regression tests |

After editing:

```bash
npm test
npm run sync
```

Then create and test a new native build. There is **no remote configuration
service**: deploying the website does not change an already installed iOS app.
Continue using Google test ads for playtests. Ad timing settings do not supply
live AdMob IDs, configure Apple's purchase price, or complete payout onboarding.
