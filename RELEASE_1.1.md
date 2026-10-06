# DON'T TAP THAT 1.1.0 — release checklist

Branch `release/1.1`. Version **1.1.0 (build 13)**, real AdMob app + interstitial IDs, test ads
off. A Release archive that still uses Google test IDs is refused by the build
(`MONETIZATION_REQUIRE_PRODUCTION_ADS`). Don't edit these IDs on any other branch: development
builds stay on test ads so the simulator never serves real ads.

## What ships in 1.1

| Feature | Notes |
|---|---|
| New glass UI | iOS-style materials, one solid accent, no gradients/glows |
| Weekly Challenge | Same seeded commands for everyone each week; share a score link |
| Interstitial ads | Every 5th run or a new best; max 3 per session; never mid-round |
| Remove Ads ($4.99) | One-time, restorable; also gives the free Continue |
| Rewarded Continue | **Off for non-owners** until a rewarded ad unit is set (see below); owners get it free |
| Themes (3) | **Hidden** until the App Store returns theme products |
| Online leaderboard | **Off** (`js/leaderboard-config.js` `apiBase` is empty): nothing is shown or sent |

## Before you build (you)

- [ ] **Paid Apps Agreement is Active** (App Store Connect > Business).
- [ ] **Remove Ads product** (`com.coreyhall.donttapthat.removeads`): price $4.99, localization,
      availability, and review screenshot set. It must be attached to this version (below).
- [ ] *(Optional)* **Rewarded ad unit** in AdMob. Put its ID in `MonetizationRewardedAdUnitID`
      (Info.plist) to turn Rewarded Continue on for everyone. Leave empty to ship without it.
- [ ] *(Optional)* **3 theme products** (non-consumable): `com.coreyhall.donttapthat.theme.arcade`,
      `.terminal`, `.space`. Create them and they appear in the app; skip them and the Themes
      entry stays hidden.
- [ ] Link AdMob to the App Store listing (AdMob > App settings > Add store).

## Test it (you, Xcode ▶ with the local StoreKit file or TestFlight sandbox)

- [ ] Buy Remove Ads: ads stop immediately; kill and relaunch: still removed.
- [ ] Delete the app, reinstall, **Restore Purchases**: ads removed again.
- [ ] Play 5+ runs: an ad appears only after **Try Again/Home**, never mid-round.
- [ ] Weekly Challenge: play twice; the commands match both times.
- [ ] Consent prompt appears (EU/UK simulator region) and "Do not consent" still lets you play.
- [ ] Owners: a failed run at score >= 5 offers **Continue** free (no video).
- [ ] Share a challenge: the share sheet opens and the link is the App Store URL.

## Submit (App Store Connect)

1. **Archive** in Xcode: scheme **App**, destination **Any iOS Device**, Product > Archive, then
   Distribute App > App Store Connect > Upload.
2. Create **version 1.1.0** (the + next to iOS App). Select **build 13** once processed.
3. **What's New**, description, and keywords: copy from `STORE_LISTING.md`.
4. **Screenshots**: upload `store-screenshots/6.9-inch/*.png` in order. The first one becomes
   the iMessage link preview.
5. **In-App Purchases and Subscriptions** section on the version: add **Remove Ads** (and the
   themes, if created) so they are reviewed with this build.
6. **App Privacy**: update the answers; "Data Not Collected" is no longer accurate with ads.
   Declare what Google's AdMob SDK collects per Google's page
   <https://developers.google.com/admob/ios/privacy/data-disclosure>
   (device identifiers, product interaction, advertising data, diagnostics, coarse location
   derived from IP). Used for third-party advertising; not used for tracking across apps (the app
   requests non-personalized ads and does not ask for tracking permission).
7. **Age rating**: re-answer the questionnaire for ads and in-app purchases.
8. **App Review notes**: how to find Remove Ads and Restore (see the note at the end of
   `STORE_LISTING.md`). Add that the leaderboard is not part of this version.
9. **EU trader status** (Business page): revisit; this version is commercial.
10. **Before you click Submit for Review**: deploy `privacy.html` and `app-ads.txt` (they describe
    ads and must be live at the privacy URL; ask me and I'll run the deploy script).

## After approval

- Confirm ads and purchases on the live build; watch AdMob for fill after the store link is
  approved (can take a day or two).
- Leaderboard (v1.2): `terraform apply` per `server/README.md`, set `apiBase`, update App
  Privacy again, and decide the age-gate question first.
