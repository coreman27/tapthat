# Shipping DON'T TAP THAT to the App Store

The native iOS project already exists in `ios/`, builds cleanly, and runs in the Simulator. This guide takes it from here to a live App Store listing.

**App identity (already configured):**
- App name / display name: **DON'T TAP THAT**
- Bundle ID: **com.coreyhall.donttapthat** (`capacitor.config.json` + Xcode)
- Orientation: portrait only • Status bar hidden • Icons + splash generated

---

## 0. One-time prerequisites

1. **Apple Developer Program** membership — https://developer.apple.com/programs/ ($99/year). Required to ship to the Store.
2. Xcode signed in with your Apple ID: **Xcode ▸ Settings ▸ Accounts ▸ +**.
3. Confirm the bundle ID `com.coreyhall.donttapthat` is available (or change it — see step 5).

---

## 1. Rebuild web assets into the native app

Any time you change the game (`index.html`, `js/`, `css/`), re-sync:

```bash
cd tapthat
npm run ios        # builds www/, runs cap sync ios, opens Xcode
```

To regenerate icons/splash after an art change:

```bash
npm run assets     # regenerates icons + splash and injects the iOS asset catalog
npm run sync
```

---

## 2. Open the project in Xcode

`npm run ios` opens `ios/App/App.xcworkspace`. **Always use the `.xcworkspace`, not `.xcodeproj`** (CocoaPods).

Select the **App** target ▸ **Signing & Capabilities**:
- Check **Automatically manage signing**
- Choose your **Team**
- Xcode provisions a signing certificate + profile automatically

---

## 3. Set version & build number

App target ▸ **General**:
- **Version** (`CFBundleShortVersionString`): `1.0.0`
- **Build** (`CFBundleVersion`): `1` (increment every upload)

Deployment target: **iOS 15.0** for both Debug and Release. The Podfile also
enforces a minimum of iOS 15.0 on generated Pods targets because the Xcode Cloud
toolchain no longer supports the original iOS 13.0 target. Run `npm run sync`
after changing the Podfile; do not edit the generated Pods project manually.
This app now requires iOS 15 or later.

The game keeps portrait-only orientations on iPhone and portrait/upside-down on
iPad. `UIRequiresFullScreen` is enabled to opt into iPad compatibility mode rather
than declare support for all four orientations required for multitasking
(App Store validation error `ITMS-90474`). This key is deprecated as of iPadOS 26,
but remains supported; newer windowing modes may scale the app in a window rather
than display it full screen. Supporting native iPad window resizing in the future
requires adapting and testing the game layout before removing this flag.

---

## 4. Test on a real device (recommended before submitting)

1. Plug in your iPhone, trust the Mac.
2. Pick your device in the Xcode toolbar, press **▶ Run**.
3. First run: on the iPhone, **Settings ▸ General ▸ VPN & Device Management** ▸ trust your developer cert.
4. Play a full run, trigger game over, tap **CHALLENGE A FRIEND**, confirm the share sheet works.

---

## 5. (Optional) Change the bundle ID or app name

- **Bundle ID:** edit `appId` in `capacitor.config.json`, then in Xcode set **Bundle Identifier** under Signing. Use reverse-DNS you control, e.g. `com.yourname.donttapthat`.
- **App name on the Home Screen:** `CFBundleDisplayName` in `ios/App/App/Info.plist`.

---

## 6. Create the app record in App Store Connect

1. Go to https://appstoreconnect.apple.com ▸ **Apps ▸ +** ▸ **New App**.
2. Platform **iOS**, pick the **bundle ID**, set the **SKU** (any unique string, e.g. `donttapthat001`), primary language.
3. Fill in the listing. **Ready-to-paste AI-positioned copy is in [`STORE_LISTING.md`](STORE_LISTING.md).**
   - **Name:** DON'T TAP THAT (must be unique on the Store; have a backup like "Don't Tap That!" ready)
   - **Subtitle:** `The AI that learns to beat you`
   - **Category:** Games ▸ Arcade / Puzzle
   - **Promotional text, Description, Keywords, support URL, marketing URL** — see [`STORE_LISTING.md`](STORE_LISTING.md)
   - **Privacy Policy URL** (required — even a simple page) — **live now:** https://d10kns7njmuyxo.cloudfront.net/privacy.html
   - **Age rating** questionnaire
4. **App Privacy:** adaptive gameplay stays on-device, but the monetized iOS build
   includes Google Mobile Ads and Apple in-app purchases. **Do not declare "Data
   Not Collected" for this build.** Complete the monetization release checklist
   below and publish the updated privacy policy before submitting it.
5. **Screenshots** (required): 6.9"/6.7" iPhone is the required slot. A ready-to-upload
   6.9" hero shot (1320×2868, iPhone 17 Pro Max) is already captured at
   `store-screenshots/01-home.png`. Capture more gameplay shots from the Simulator
   (play a run, hit game over, etc.):
   ```bash
   # the app is already built + installed on the booted iPhone 17 Pro Max sim;
   # tap through the game, then grab another state:
   xcrun simctl io booted screenshot store-screenshots/02-gameplay.png
   ```
   Any earlier size (6.5" 1284×2778) can be captured the same way from an iPhone 11/XS Max sim.

---

## 7. Archive & upload

In Xcode:
1. Toolbar destination ▸ **Any iOS Device (arm64)**.
2. **Product ▸ Archive** (this Release-builds and signs).
3. When the Organizer opens: **Distribute App ▸ App Store Connect ▸ Upload**.
4. Keep the defaults (upload symbols, manage signing automatically). Xcode uploads the build.

*(CLI alternative, once signing is set up:)*
```bash
cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -archivePath build/App.xcarchive archive
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportPath build/ipa -exportOptionsPlist ExportOptions.plist
xcrun altool --upload-app -f build/ipa/App.ipa --type ios \
  --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
```

---

## 8. Submit for review

1. In App Store Connect, the uploaded build appears under **TestFlight** in a few minutes (processing).
2. (Optional) Test via **TestFlight** on your device/friends first.
3. On the app's **App Store** tab, select the build, complete metadata, then **Add for Review ▸ Submit**.
4. Review typically takes 24–48h. Fix any rejections and resubmit.

---

## Review-readiness checklist

- [x] Portrait-locked, status bar hidden, safe-area aware (no notch clipping)
- [x] App icon 1024×1024, opaque, no alpha (Apple rejects transparency)
- [x] Launch screen present
- [x] Builds & runs on device/Simulator
- [ ] Advertising and purchase privacy disclosures completed and published
- [ ] Age-rating questionnaire updated: Advertising = Yes
- [ ] Live AdMob setup and Remove Ads product ready; test ads disabled for release
- [ ] Apple Developer account + signing team selected  *(account enrolled ✅ — select your Team in Xcode ▸ Signing & Capabilities)*
- [x] Privacy Policy URL live → https://d10kns7njmuyxo.cloudfront.net/privacy.html
- [~] Screenshots captured *(6.9" hero shot ready in `store-screenshots/`; add gameplay shots)*
- [x] Version 1.0.0 / build 1 set *(MARKETING_VERSION=1.0.0, CURRENT_PROJECT_VERSION=1)*

## Common rejection pitfalls (already handled or easy)
- **Transparent/rounded 1024 icon** → we ship an opaque full-bleed icon. ✅
- **Crashes on launch** → verified launches in Simulator. ✅
- **Outdated privacy policy** → publish the revised `privacy.html` to
  https://d10kns7njmuyxo.cloudfront.net/privacy.html before shipping ads. Confirm
  its support email is an active, monitored inbox; the existing address is not
  verified by this repository.
- **"App is just a website"** → this is a self-contained game (all logic bundled, works offline), not a web viewer, which satisfies guideline 4.2.

## Monetization: configurable between-run ads + Remove Ads

This is **one free app with a non-consumable in-app purchase**, not two separate
App Store listings. `js/ad-config.js` configures run-count and score-milestone
triggers; `js/ad-policy.js` enforces placement, persistence, and frequency limits.
The result screen remains visible for celebration and sharing. A selected break
is announced there, then attempted only on **Try Again** or **Home**.
Gameplay controls remain disabled until an ad is dismissed. No-fill, offline,
or consent-unavailable breaks are skipped, not queued for the next round.
If consent failed at startup or becomes necessary after a revoked purchase,
the app can retry it at a later eligible break with gameplay locked, or through
**Retry Connection**. That recovery break does not also display an ad. Network
and foreground callbacks never present a consent form over an active round.
The browser/PWA version does not load the native ad SDK or offer Apple purchases.

**The checked-in configuration is for development, not a ready-to-submit
monetized release.** Complete all steps below before uploading that release.

### Tune placement and measure the next try

Dedicated reference: **[AD_RULES.md](AD_RULES.md)** includes trigger examples,
configuration ranges, variant assignment behavior, and diagnostic interpretation.

This changes **when** an ad appears, not the audience data sent to Google. Scores
and best-score comparisons stay local; Google's requests remain non-personalized.

Edit `js/ad-config.js`. Its default `contextual` variant combines a five-run
cadence with score moments; `cadence-5` removes score triggers, and `holdout`
disables interstitial presentation. Only contextual has nonzero weight by
default, so the app is **not silently running a three-arm experiment**.

| Setting | Default contextual value | Meaning |
|---|---|---|
| `everyRuns` | `5` | Cadence opportunity every fifth terminal run in the session; milestones do not shift that schedule |
| `onNewBest` | `true` | Consider beating an established personal best |
| `onNearBest` | `true` | Consider a score near an established personal best, including a tie |
| `nearBestRatio` | `0.9` | Near-best threshold: at least `ceil(previousBest * 0.9)` |
| `minBest` | `10` | Ignore score milestones until the **previous** best is at least 10 |
| `minRunsBetween` | `3` | Minimum spacing between selected opportunities and attempts; rejected milestones do not restart the spacing window |
| `firstSessionGraceRuns` | `3` | No ads on the first three completed runs of the first session |
| `minSessionSeconds` | `60` | No opportunity during the first minute of a session |
| `minSecondsBetween` | `90` | At least 90 seconds between attempts, including no-fill/error attempts |
| `maxAdsPerSession` | `3` | Maximum shown interstitials per session |
| `weight` | `100` | Relative assignment weight for this variant; `0` means no new assignments |
| `enabled` | `true` | Interstitial kill switch for that variant |

Validated ranges: cadence 4-6 runs, minimum run spacing 2-100, near-best ratio
0-1, minimum established best 1-1,000,000, first-session grace 0-100 runs,
session warmup 0-3,600 seconds, attempt cooldown 1-86,400 seconds, and shown-ad
cap 1-20 per session. Weights are integers 0-10,000 with a positive total.
These bounds reject malformed configuration instead of silently changing it.
There is also a safety ceiling of `maxAdsPerSession * 3` attempts per session,
so persistent no-fill cannot cause unlimited network presentation attempts.

All eligibility checks still apply: no ad for paid users, before initialization,
on the web, during a round, or on a break/run marked as using or offering a
rewarded continue. Rewarded Continue itself is not implemented yet. An eligible
decision expires after two minutes and cannot be replayed after a new run.
A session ends after 30 minutes of inactivity, not simply closing/reopening the app.
Missing/corrupt policy state or invalid configuration disables ad presentation
and surfaces a diagnostic warning rather than silently resetting frequency limits.

The local variant assignment persists. Use a new configuration `version` when
changing experiment settings/weights; keep variant IDs descriptive. Existing
frequency protection must not be reset by a reassignment. No remote config is
installed: native changes require `npm run sync` and a new iOS build; a website
deployment does not update a previously installed app.

For a controlled playtest:

1. Choose one hypothesis, for example contextual timing versus cadence-only.
   Configure weights (for example 50/50/0), increment the config version, and
   leave all other settings the same. Use a holdout only deliberately.
2. On each test device, open **How to play > Local ad timing
   diagnostics** and enable recording. It is optional and off by default.
3. Play realistic sessions with Google test ads, including new bests, near misses,
   ordinary losses, skipped ads, purchases, and app background/reopen.
4. Refresh and copy the JSON report. It records placement reason, actual outcome,
   and adjusted/unadjusted replay timing grouped by variant, trigger, and exposure.
   No automatic upload or external analytics account is involved.
5. Compare mature observations; report pending/censored runs rather than treating
   every unfinished observation as abandonment. Check sample counts and no-fill.
   These local opt-in samples are not population D1/D7 retention, revenue, or
   proof of a causal improvement. Define sample size and retention guardrails
   before deciding a winner.

Reports contain at most 300 finished runs from the last 30 days, pruned when
accessed. Disabling diagnostics deletes its records; clearing measurements does
not reset ad caps or variant assignment. Do not send reports anywhere without
the tester's choice. Remote analytics, population retention measurement, and
rewarded-ad revenue remain separate future work.

### What still requires action outside this repository

1. **Apple:** complete Business agreements/tax/banking; create the matching
   non-consumable, choose its $4.99 target price and availability, supply review
   metadata, and attach the first purchase to the app review submission.
2. **AdMob:** create the app/interstitial IDs, complete payments/readiness setup,
   publish consent messages, and obtain the exact publisher line for app-ads.txt.
   No fake publisher ID is provided. Include that file in `scripts/sync-www.js`
   before deploying it so the AWS sync cannot later remove it.
3. **Release configuration:** replace test IDs and disable test mode together;
   enable the production guard in Xcode Cloud. Complete real-device test-ad and
   Apple sandbox/restore checks before production approval.
4. **Public disclosures:** activate the support inbox, update its address in the
   policy, deploy the policy, and update App Store advertising/privacy answers
   for the same binary. Confirm any custom-domain URLs resolve over HTTPS.
5. **Distribution:** review and commit the intended changes, push, run a new
   TestFlight/App Store archive, and submit the matching binary and purchase.
   Local diagnostic measurement does not require an analytics account, but
   representative retention results require actual opted-in playtests.

### Apple: create the one-time purchase

1. In App Store Connect, complete the Paid Apps Agreement, tax, and banking
   requirements even though the app download itself is free.
2. Open this app's **Monetization > In-App Purchases > +**.
3. Choose **Non-Consumable**, reference name **Remove Ads**, product ID
   **`com.coreyhall.donttapthat.removeads`**. The identifier must exactly match
   the native configuration; do not create a subscription or consumable.
4. Add English display name **Remove Ads** and description
   **Remove all interstitial ads with a one-time purchase.**
5. Choose price and territory availability. The monetization roadmap targets
   **US$4.99 one-time**, but this is a business setting in App Store Connect, not a
   hardcoded app price. The button displays Apple's localized product price.
6. Provide the required purchase-review screenshot of the in-app purchase
   screen and review notes explaining how to open **Remove ads & purchases**.
7. Attach the first in-app purchase to the app version's review submission.
   Creating a product alone does not approve it for production sale.

The local review capture is `store-screenshots/remove-ads-review.png`
(1320 x 2868, iPhone 17 Pro Max). Upload it under the purchase's **Review
Information > Screenshot**, not the optional square promotional image.
It shows the simplified purchase screen with $4.99 loaded from a temporary
local StoreKit configuration, not a hardcoded UI price. This verifies product
display only: the separate simulator purchase-completion attempt failed with
a StoreKit `original-transaction-id` error, so purchase/restore validation is
still required. Screenshot captures are gitignored; keep this local file for
submission or regenerate it after changing the purchase screen.

Purchase cancellation and Ask to Buy/pending approval do not grant ad-free
access. Only verified Apple transactions do. **Restore Purchases** explicitly
synchronizes the same Apple Account's purchases. Transaction updates handle
subsequent approval, refunds, and revocations. Purchase state is not granted by
a JavaScript/local-storage boolean.

### Google: advertising and consent

1. Create the iOS app in **AdMob**, with this app's bundle ID and App Store record.
2. Create an **Interstitial** ad unit. This implementation does not use rewarded
   ads, banners, or mediation.
3. Replace the development IDs using the native configuration described below,
   and disable test mode only for the production release. App IDs contain `~`;
   ad-unit IDs contain `/`. These are public configuration identifiers, not API
   keys. Never put an AdMob account credential in the app.
4. In **Privacy & messaging**, configure and publish the applicable European
   regulations and US state regulations messages for this app. Verify UMP's
   consent form and privacy-options entry point with the relevant test settings.
5. Complete AdMob app readiness, ownership/app-ads.txt verification, and account
   requirements shown in its console. Creating IDs does not guarantee ad fill.
6. Do not click live ads during testing. Use Google's test IDs or registered test
   devices. No-fill must leave the game playable.

The app requests non-personalized ads, does not request ATT authorization, and
does not supply your player's nickname or gameplay stats to Google. This does
**not** mean Google's SDK processes no data. The game is not configured as a
Kids Category app, and a G-rated ad request is not a substitute for child-privacy
compliance or an age-verification system.

### Native configuration

Edit `ios/App/App/Info.plist`, not the generated Pods project:

| Key | Development default | Production |
|---|---|---|
| `MonetizationAdsEnabled` | `true` | `true` for this ad-supported release |
| `MonetizationTestAds` | `true` | `false` |
| `GADApplicationIdentifier` | Google's sample iOS app ID | Your AdMob iOS app ID |
| `MonetizationInterstitialAdUnitID` | Google's test interstitial ID | Your AdMob interstitial unit ID |
| `MonetizationRemoveAdsProductID` | `com.coreyhall.donttapthat.removeads` | Same identifier as the approved non-consumable |

The CocoaPods lockfile pins Google Mobile Ads and Google UMP. The native plugin
is registered by `Main.storyboard`'s custom Capacitor bridge controller; do not
change it back to the generic `CAPBridgeViewController`. This unbundled web app
accesses `window.Capacitor.Plugins.Monetization`, not an npm-generated proxy.

Set **`MONETIZATION_REQUIRE_PRODUCTION_ADS=YES`** in the Xcode Cloud distribution
workflow's environment variables (or pass that build setting to a local
distribution archive). Its build phase rejects disabled/test advertising or
sample IDs. Keep this guard enabled for production distribution; ordinary local
test archives intentionally permit the safe test configuration.

For local purchases, in **Product > Scheme > Edit Scheme > Run > Options >
StoreKit Configuration**, select `ios/App/RemoveAds.storekit`. It contains an
illustrative **$2.99** test product; no real money is charged by local StoreKit
testing. The shared scheme intentionally does not enable this file, and it is
not bundled in the app. Switch back to **None** for actual sandbox/product
validation. Local simulated purchases do not create an App Store Connect product.

### Update the listing and policy before submission

- Change **Age Ratings > Advertising** to **Yes** and reassess the questionnaire
  for content supplied by the ad network.
- Remove old **no ads**, **no in-app purchases**, and **Data Not Collected**
  claims. Use the updated `STORE_LISTING.md`.
- Publish the updated `privacy.html`. Changes in this repository do not
  automatically update the public policy URL. Verify the support address works;
  replace the old address with the new support mailbox only once it is active.
- Complete App Store privacy disclosures using Google's
  [data-disclosure guidance](https://developers.google.com/admob/ios/privacy/data-disclosure)
  and the archived app's privacy report. Review coarse location/IP-derived
  location, device/app identifiers, advertising/product interaction data, and
  crash/performance diagnostics, including purposes, linkage, and tracking.
  Do not assume non-personalized ads eliminate these disclosures.
- Review purchase data processing separately: Apple handles billing, and the
  app verifies entitlement locally. Do not disclose card collection by the game
  when it does not receive card information.
- If the earlier ad-free binary is already in review, do not silently change its
  listing to describe an ad-enabled version. Submit the matching new binary and
  purchase together, or release monetization as a subsequent version.

### Required release checks

Run `npm test` for game logic, score thresholds, cadence/caps, restart persistence,
blocked restart during ads, skipped ad breaks, purchase outcomes, restore,
revocation events, and browser behavior. These use a mock native bridge and do
not prove that external Apple or Google services are configured.

Before a monetized release, exercise the native build on iPhone and iPad:

- Exercise the configured cadence and score milestones after onboarding grace.
  Confirm the result stays visible until **Try Again** or **Home**, then a ready
  test ad appears. Dismiss it and confirm the next run starts normally.
- Close and reopen within 30 minutes: cooldown and session limits must persist.
- Beat the previous high score or finish within the configured near-best ratio:
  verify this can select an opportunity but never bypass frequency limits.
- Try airplane mode, no-fill, consent refusal, and privacy-choice changes: gameplay
  stays usable and no ad suddenly appears after a new run begins.
- With StoreKit local testing and then an Apple sandbox/TestFlight purchase,
  check localized price, purchase, cancellation, pending approval, restoration
  after reinstall, offline reopening as an owner, and refund/revocation.
- An owner must receive no new ad requests. Unavailable product metadata must
  show **Purchase unavailable**, not a fabricated price or a successful purchase.
- Confirm test mode is off and the actual App Store product is available for
  the production submission. Do not treat an unsigned local archive as proof
  that App Store purchase or AdMob delivery works.
