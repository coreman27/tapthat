# DON'T TAP THAT - Monetization Roadmap

## Product goal

**Can we make people immediately want one more try?**

Retention comes before revenue per session. Keep the core game free, make retries
fast, and sell optional experiences rather than better scores. An ad placement
that earns more today but makes people stop playing is not a win.

Target model: **free-to-play + rewarded ads + occasional interstitials + a
one-time Remove Ads purchase**, followed by cosmetics and fair social competition.
Build one numbered story at a time. Later phases are opportunities, not promises
to launch everything at once.

## Where we are now

| Capability | Current implementation | Roadmap decision |
|---|---|---|
| Interstitial ads | Configurable cadence and new-best/near-best triggers, protected by time/run/session caps; attempted on leaving game over | Default cadence five, with score triggers; compare contextual, cadence-only, and holdout variants in deliberate playtests |
| Remove Ads | Same-app StoreKit non-consumable, verified entitlement, restore, and revocation handling | Target **$4.99 USD one-time**; actual price is configured in App Store Connect |
| Advertising setup | Development uses Google test IDs and consent handling | Real AdMob/UMP configuration and release validation still required |
| Purchase testing | Local StoreKit file has an illustrative $2.99 price | Local fixture is not the production price or proof of an approved product |
| Rewarded Continue | Not implemented | Add one optional continue per casual run |
| Themes, personalities, paid packs | Not implemented | Defer until the basic loop retains players |
| Competition | Share-link score challenges exist; no authoritative tournament service | Validate native links, then build fair friend and weekly competition |
| Retention measurement | Optional bounded on-device ad timing/replay reports; no remote upload or population retention pipeline | Gather playtest samples and establish a baseline; D1/D7 cohort collection still pending |

Status distinguishes implemented local code from future plans and live services.
Story 1.2 now replaces the fixed three-loss implementation with configurable
placement; no rewarded ads, Apple price change, or production deployment has
been completed by that work. "Monetization v1" below is a product milestone, not
an assertion about the current App Store version.

## Retention scorecard

Measure the behavior we want, not just ad impressions.

| Metric | Definition / use |
|---|---|
| One-more-try rate | Share of terminal runs followed by a **new run within 10 seconds** of retry becoming actionable; show counts and split by ad exposure and purchase status |
| Unadjusted replay rate | Also measure replay from the terminal loss timestamp, including ad/offer time, so excluding ad time cannot hide friction |
| Time to retry | Median and p90 terminal-loss-to-new-run time; include a separate count for players who never restart |
| D1 / D7 retention | Players returning 24-48 hours / 168-192 hours after their first session, divided by first-session players with a fully elapsed observation window |
| Runs per session | New runs per session; define a new session after 30 minutes of inactivity; a rewarded continuation is **not** a new run |
| Ad-break abandonment | Fraction of eligible ad breaks not followed by another run in the same session; compare with equivalent non-ad breaks |
| Rewarded Continue funnel | Offer shown, accepted, ad rewarded, run resumed, next failure, and eventual new run; distinguish no-fill and cancellation |
| Purchase health | Product-view-to-purchase conversion, restore success, refunds, and verification failures |
| Revenue guardrail | Net revenue per active player and ad impressions per session, interpreted alongside retention rather than maximized alone |

**Decision rule:** first establish an unmonetized/test-cohort baseline. Before
each experiment, define the minimum meaningful retention change, acceptable
downside, sample size, and observation period. Wait for complete D1/D7 cohorts.
Ship a variant only when it meets those predeclared guardrails; an inconclusive
small sample is not proof of safety. Investigate retention drops before adding
more monetization.

Minimum proposed events: `session_started`, `run_started`, `run_failed`,
`run_ended`, `retry_selected`, `ad_opportunity`, `ad_shown`, `ad_dismissed`,
`continue_offered`, `continue_rewarded`, `purchase_completed`, and
`purchase_restored`. Use a stable run ID to deduplicate resumptions and terminal
results. Record ad variant, app version, and assisted/unassisted status.

Start with local diagnostic counters and consented playtests. Any remote
measurement needs a separate privacy-reviewed design: collect only what is
necessary, avoid names, contacts, raw receipts, and precise location, define
retention/deletion periods, and update disclosures before enabling it. Google ad
diagnostics are not a substitute for this scorecard. Never make tracking consent
a condition for ordinary gameplay.

## Phase 0 - Baseline and launch foundations

### Story 0.1 - Establish the retention baseline

- [ ] Define and implement the scorecard, with an explicit consent/data policy.
- [ ] Validate event deduplication across retry, backgrounding, and eventual
  rewarded continuation; do not inflate runs or count an ad as active play.
- [ ] Run playtests on iPhone and iPad, including offline and accessibility cases.
- [ ] Capture baseline replay, retry latency, and mature D1/D7 cohorts.

**Exit:** the team can tell whether an ad or offer harms the desire to replay.

### Story 0.2 - Finish existing monetization release setup

- [ ] Configure AdMob IDs, UMP messages, app readiness, and app-ads.txt.
- [ ] Configure the Apple non-consumable
  `com.coreyhall.donttapthat.removeads`, target price $4.99, and commercial agreements.
- [ ] Verify sandbox purchase, cancellation, pending approval, restore after
  reinstall, offline ownership, and refund/revocation.
- [ ] Publish the updated privacy policy and matching App Store disclosures.
- [ ] Verify development test ads cannot accidentally pass the production guard.

Use [APPSTORE.md](APPSTORE.md) for setup and release mechanics. Existing code is
not the same as live, approved monetization.

### Story 0.3 - Set up receiving money

**There are two separate payout pipelines.** Working ads or an approved app do
not, by themselves, mean our bank account is ready to receive earnings.

| Revenue source | Who collects payment | Who pays us |
|---|---|---|
| Remove Ads | Apple charges the customer's Apple Account | Apple sends eligible net proceeds to our registered bank account |
| Themes, personalities, and permanent challenge packs | Apple in-app purchases in the planned iOS app | Apple, through the same payout setup |
| Future season purchases | Apple, using the product type selected for that offering | Apple, through the same payout setup |
| Interstitial and rewarded ads | Google collects advertising revenue from advertisers; the player is not charged | Google pays finalized eligible AdMob earnings through its payments profile |

The current native plan does **not** require Stripe, PayPal checkout, a credit-card
form, or a custom payment server. Apple handles the digital-goods checkout and
StoreKit verifies access. A future web store or different regional distribution
model would need a separate payment/platform-policy assessment.

#### A. Establish the payee and prepare onboarding information

- [ ] Decide whether the seller/payee is the individual developer or a legal
  business. An LLC is not automatically required; use the appropriate account
  type and follow each provider's identity and organization requirements.
- [ ] Prepare the legal payee name, address, required identity/business documents,
  and tax information for the relevant country. A US tax interview may request
  an SSN or EIN and the applicable tax form; other countries have different requirements.
- [ ] Prepare an eligible bank account, account-holder name, routing/account
  information or IBAN/SWIFT as required, and a supported payout currency.
- [ ] Confirm the payee, tax, and banking details are consistent with the
  provider's requirements. Business ownership and a brand/support email are not
  interchangeable with a verified legal payee.
- [ ] Enable two-factor authentication and assign an owner for financial
  onboarding, payout alerts, and ongoing reconciliation.

**Enter sensitive details only in Apple's or Google's secure onboarding
portals. Never put actual tax IDs, identity documents, bank details, payment
credentials, or customer receipts in this repository, app configuration, or
support chat.** Public AdMob app/ad-unit IDs are not payout credentials.

#### B. Apple: enable paid sales and bank payouts

- [ ] Keep Apple Developer Program membership active and accept required
  agreements with the Account Holder or other appropriately authorized role.
- [ ] In **App Store Connect > Business**, complete the **Paid Apps Agreement**.
  A free download still needs this agreement to sell Remove Ads.
- [ ] Complete all required tax forms/interviews and banking information, resolve
  verification requests, and confirm the agreement and payment setup are active.
- [ ] Configure product pricing and sales territories, complete review metadata,
  and obtain approval for the app and its first in-app purchase.
- [ ] Confirm the production product is available for sale. Sandbox/TestFlight
  purchases and the local `.storekit` file do not produce real revenue.
- [ ] Review current Apple commissions, applicable taxes, withholding, currency
  conversion, refund adjustments, payout thresholds, and payment schedule.
  **A $4.99 customer price is not $4.99 deposited in our bank account.**
- [ ] Evaluate Apple's Small Business Program if eligible; enrollment and any
  reduced commission are not assumed or automatic.
- [ ] Verify access to **Payments and Financial Reports** and resolve any
  agreement, banking, or tax hold before expecting a transfer.

Apple's payout minimums and timing depend on the account, country/currency, and
current terms. Record the actual values shown in the account rather than
promising an immediate payment after each purchase.

#### C. Google: enable advertising payouts

- [ ] Activate AdMob and complete its linked Google payments profile using the
  intended individual or business payee.
- [ ] Complete identity verification, address/PIN verification if requested,
  applicable tax information, and any other payment-profile requirements.
- [ ] Add an eligible payment method when Google makes it available for the
  account and complete any bank verification it requires.
- [ ] Resolve account/payment holds and confirm the advertising account and app
  satisfy readiness, policy, consent, and app-ads.txt requirements.
- [ ] Use production ad units only for the live release. **Test ads earn no
  revenue**; never click our own live ads or ask others to generate artificial
  impressions/clicks.
- [ ] Record the account's payment threshold, payment currency, payment cycle,
  and any bank/foreign-exchange fees. Amounts and available methods vary by country.
- [ ] Distinguish estimated ad revenue from **finalized earnings**; invalid
  traffic and other adjustments can reduce the amount actually payable.

Google generally pays on a monthly cycle once finalized earnings reach the
applicable threshold and all payment conditions are satisfied. The payments
dashboard, not the ad impression counter, determines payout readiness.

#### D. Verify money reaches the bank and track profitability

- [ ] Assign a monthly reconciliation owner and set payout/verification alerts.
- [ ] Compare Apple financial reports and Google finalized earnings with their
  payment statements and actual bank deposits.
- [ ] Record gross sales/revenue, platform deductions, refunds, withholding,
  currency conversion, and net receipts without logging customer financial data.
- [ ] Budget for developer membership, hosting, domain/email, content production,
  customer support, and future tournament infrastructure/moderation.
- [ ] Set aside funds for applicable taxes and consult a qualified accountant
  about local reporting obligations; provider tax forms do not replace bookkeeping.
- [ ] Record the first successful Apple payout and first successful Google payout
  separately. Do not call the collection pipeline proven until the relevant
  provider's transfer is reconciled with the bank.

**Launch exit:** both intended revenue channels have active agreements/payment
profiles, completed currently required verification, no blocking holds, and a
documented payout path. Some Google verification/payment-method steps only become
available after earnings reach account thresholds: track those as pending actions,
not as already completed. A first payout is a later operational milestone, not a
prerequisite to publish an otherwise eligible app.

## Phase 1 - Simple monetization v1

**Scope ceiling: Rewarded Continue + occasional interstitials + $4.99 Remove Ads.**
No theme shop, season pass, account system, or tournament backend in this phase.

### Story 1.1 - One optional Rewarded Continue

- [ ] After a casual-run failure, offer **"Continue at 47?"** using the actual
  score, with an explicit **Watch ad to continue** label.
- [ ] Keep **TRY AGAIN** immediately available. Do not auto-open a rewarded ad,
  obscure the free choice, or force a purchase when an ad is unavailable.
- [ ] Allow **at most one successful continue per original run**. Resume at the
  existing score with a fresh challenge and a short ready countdown.
- [ ] Grant the continue only after the SDK's reward callback, exactly once.
  Closing early, load failure, or cancellation grants no reward.
- [ ] Preserve run identity, consumed-continue status, and score through the
  native ad presentation. Ignore duplicate/late callbacks; do not resume a
  different run or a run the player already abandoned.
- [ ] A failure remains an adaptive-learning failure, but the resumed run must
  not be double-counted as a new game or two terminal runs.
- [ ] Mark any resumed run **assisted**. Keep assisted bests separate from
  unassisted personal bests and exclude assisted runs from ranked competition.

**Remove Ads promise:** owners get the same one optional casual continue without
watching a video. They never need to watch an ad to access the equivalent feature.
The resumed run is still assisted; paying never improves a ranked score.

**Exit:** reward delivery is reliable, the free retry is obvious, and continue
offers do not measurably damage replay or retention under the agreed guardrails.

### Story 1.2 - Tune occasional interstitials

- [x] Replace the fixed three-loss cadence with a versioned, testable local policy.
- [x] Add configurable new-best and near-best score opportunities. Compare against
  the previous best before saving the current result. Default near-best is 90%
  of a previous best of at least 10; the first-ever best is not a milestone trigger.
- [x] Preserve the high-score celebration and sharing: select and announce an
  opportunity at game over, but attempt it only on **Try Again** or **Home**.
- [x] Add first-session grace, minimum session time, run spacing, persistent
  attempt cooldown, per-session cap, and stale-opportunity rejection.
- [x] Add opt-in local, bounded reports of decisions, actual ad exposure, and
  replay timing; preserve frequency state when measurements are cleared.
- [ ] Start the candidate policy at **every 5 terminal runs**, comparing 4 and 6
  where sample size permits, and collect evidence before choosing a winner.
  Five-run cadence is configured; testing outcomes are not yet known.
  A resumed run counts once, at its final ending.
- [x] Never show an interstitial before the first run or in active gameplay.
  Protect the first-session learning flow and add a wall-clock frequency cap.
- [ ] Do not stack an interstitial onto the same break as a rewarded ad or
  rewarded offer. A run that used Rewarded Continue gets no interstitial at its
  final loss; skip the opportunity instead of queuing a catch-up ad.
- [x] Skip unavailable ads; consent recovery may occur only at a locked safe
  boundary. Never surprise the player with a late ad after play resumes.
- [x] Keep zero interstitials for verified Remove Ads owners.

**Implementation notes:** `js/ad-config.js` controls weights, cadence, milestone
switches/threshold, and frequency limits. Defaults select only `contextual`;
cadence-only and holdout are available but weight zero. No server or silent remote
configuration exists. See [APPSTORE.md](APPSTORE.md#tune-placement-and-measure-the-next-try)
for knobs, local diagnostics, and the test/release workflow. Rewarded-break
exclusion inputs are implemented, but the combined rewarded flow still needs
Story 1.1 before its end-to-end checklist can be completed.

**Exit:** choose cadence from retention evidence, not whichever variant produces
the most impressions. Keep a rollback path to the least disruptive policy.

### Story 1.3 - Launch and explain $4.99 Remove Ads

- [ ] Use localized StoreKit pricing, a one-time purchase, and Restore Purchases.
- [ ] Explain exactly what ownership includes: no interstitials and, after Story
  1.1 ships, the ad-free equivalent of its single casual continue.
- [ ] Preserve the entitlement for earlier buyers regardless of what they paid.
  Changing the price is not a reason to create a new product or charge them again.
- [ ] Align purchase copy, review notes, screenshots, and production price.
- [ ] Validate the complete offer on real sandbox/TestFlight builds before release.

**Phase exit:** prove that people still want another run and come back later.
Do not build the larger store to compensate for an unproven game loop.

## Phase 2 - Cosmetic themes and game personalities

### Story 2.1 - A small, readable theme shop

Candidate themes: **1980s Arcade, Hacker Terminal, Grandma's Phone, Corporate
Hell, Kindergarten, Vegas, Horror, Retro iPhone, Game Show, and Space Station.**
These are concept names; final names, artwork, and sound must be original or
properly licensed, with no implied third-party endorsement.

- [ ] Ship only 2-3 initial themes, with previews and an easy return to the default.
- [ ] Sell individual permanent unlocks or clearly priced bundles; keep a good
  free default and some earnable cosmetics.
- [ ] Change presentation only. Preserve hitboxes, timing, semantic challenge
  colors, and legibility; test color-vision and reduced-motion settings.
- [ ] Use verified, restorable non-consumable entitlements; no paid random loot boxes.
- [ ] Review ad targeting, age-rating, and child-audience implications before
  marketing childlike, horror, or gambling-themed artwork.

### Story 2.2 - Personality packs

Candidates: **Drill Sergeant Mode, Sarcastic AI Mode, Sweet Grandma Mode,
Evil Genius Mode, and Sports Announcer Mode**.

- [ ] Add curated dialogue, animations, and sound effects, with previews.
- [ ] Keep the same game rules, response windows, and command clarity. Provide
  mute/reduced-motion options and avoid dialogue obscuring the next challenge.
- [ ] Keep ranked presentation standardized wherever a pack could change readability.
- [ ] Start with authored on-device content, not a new cloud AI dependency.

**Phase exit:** buyers enjoy variety without non-buyers being disadvantaged,
and presentation changes preserve the replay/retention guardrails.

## Phase 3 - Special challenge packs

### Story 3.1 - Optional new ways to play

Candidates: **Emoji Chaos, Math Mode, Rhythm, Memory Tricks, and Gesture Lab**.

- [ ] Offer a free sample and a clearly described permanent pack unlock.
- [ ] Build on the existing challenge contract; ship small, cohesive sets rather
  than hundreds of untested variations.
- [ ] Keep the core adaptive mode complete and free. Put paid pack content in
  separate modes; do not insert unavailable paid challenges into a common ranked event.
- [ ] Version challenge definitions, distinguish mode-specific bests, and test
  every new mechanic, timing limit, and input path.

**Phase exit:** packs generate returning play, not just first-day purchases.

## Phase 4 - Family/friend competition and weekly tournaments

### Story 4.1 - Reliable private rematches

- [ ] First verify native share links use the public HTTPS game URL rather than
  the Capacitor internal origin. Existing links are not authoritative score proof.
- [ ] Add private invite-based friend/family groups and rematch history, with a
  deliberate identity, privacy, and moderation design.
- [ ] Keep basic invitations and participation free. Optional purchases may
  customize rooms, team badges, or host presentation, not boost scores.
- [ ] Minimize personal data, support blocking/reporting and deletion as needed,
  and evaluate children's privacy before positioning this as a family service.

### Story 4.2 - Fair weekly tournaments

- [ ] Give everyone the **same seeded challenge sequence**, rules, and difficulty.
  Disable per-player adaptive weighting in ranked play.
- [ ] Seed all relevant randomness, not just challenge selection; version the
  rules and keep input difficulty comparable across screen sizes.
- [ ] Add global and friends leaderboards with defined scoring/tie-break rules,
  event windows, attempt limits, and authoritative validation/anti-cheat.
- [ ] Disable continues for everyone in ranked mode. Do not sell extra ranked
  attempts, easier commands, multipliers, or priority leaderboard placement.
- [ ] Reject unauthenticated client-submitted score claims; plan the service,
  identity, reconciliation, abuse handling, and operational costs before launch.

**Phase exit:** results are credible, free players can compete on equal terms,
and weekly events create measurable return visits.

## Phase 5 - Seasonal tournaments and a possible Season Pass

### Story 5.1 - Prove a sustainable season

- [ ] Run a limited seasonal pilot with free ranked events and transparent dates.
- [ ] Offer optional cosmetics, commemorative badges, and historical-stat views.
- [ ] A pass may add **extra exhibition tournaments** and themed experiences,
  but not extra attempts or advantages in shared ranked standings.
- [ ] Preserve a meaningful free route. No cash prizes, wagering, or paid random
  rewards in this roadmap; those need a separate legal and platform assessment.
- [ ] Publish the season's deliverables, price, end date, and what remains owned
  afterward. Avoid misleading scarcity or punitive streak-loss mechanics.

### Story 5.2 - Decide whether a pass earns its complexity

- [ ] Validate demand, retention, and the team's ability to deliver content every season.
- [ ] Start with an explicitly purchased, non-renewing season entitlement if
  pursuing a pass; choose the appropriate StoreKit product design before coding.
- [ ] Consider a subscription only after recurring value is demonstrated, with
  clear renewal/cancellation terms and no changes to existing permanent purchases.

**Phase exit:** seasons improve long-term retention enough to justify content,
support, infrastructure, and moderation costs. Otherwise, stay with permanent packs.

## Prioritization and next story

**Next: Story 0.1 - Establish the retention baseline.** Complete release-account
setup in Story 0.2 and currently available payout onboarding in Story 0.3 before
production monetization. Then deliver Stories 1.1-1.3 as the deliberately small
first monetization milestone; track first bank payouts separately.

Promote later phases only when the preceding retention gate is met. Record
experiment results and decisions here as they become available; there are no
measured retention results or confirmed live revenue claims in this plan yet.
