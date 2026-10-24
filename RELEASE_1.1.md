# DON'T TAP THAT 1.1.0 — release checklist

Branch `release/1.1`. Version **1.1.0 (build 13)**, real AdMob app + interstitial IDs, test ads off.
A Release archive that still uses Google test IDs is refused by the build
(`MONETIZATION_REQUIRE_PRODUCTION_ADS`). Don't edit these IDs on any other branch: development
builds stay on test ads so the simulator never serves real ads.

## What ships in 1.1

| Feature | State |
|---|---|
| New glass UI | On |
| Weekly Challenge (same seeded commands for everyone each week) | On |
| **Weekly leaderboard with player names + friend groups** | **On.** Live backend: `https://wd3memk4x8.execute-api.us-east-1.amazonaws.com` |
| Report / hide names, three-report auto-hide, moderation tool | On (see `server/README.md`) |
| Interstitial ads (every 5th run or a new best; max 3 per session; never mid-round) | On |
| Remove Ads ($4.99) + free Continue for owners | On, once the product is attached to the version |
| Rewarded Continue for everyone else | **Off** until a rewarded ad unit is set in `MonetizationRewardedAdUnitID` |
| Themes (3) | **Hidden** until the App Store returns theme products |

## Already done and verified

- Backend deployed (DynamoDB + Lambda + HTTP API). The deployed-API smoke test passes **26/26**:
  CORS for the app, valid run accepted, cheating refused, names on the board, groups, report-and-hide
  with three reporters, hidden stays hidden, impersonation refused, full clean-up.
- 186 app tests + 82 server tests. Release archive builds as 1.1.0 (13) with production ad IDs.

## You must do before submitting

- [ ] **Create the `support@donttapthat.com` mailbox/alias** and confirm mail arrives. The app and the
      privacy policy tell players to write there, and Apple expects a working contact for
      user-generated content. (The old `support@tapthat.game` is not a real domain.)
      Namecheap > Domain List > donttapthat.com > Manage > **Email Forwarding** > add `support`
      forwarding to your inbox. Send yourself a test.
- [ ] **Redeploy the server once more** (small change: device key records now expire):
      `cd server && npm run build && cd terraform && AWS_PROFILE=corey terraform apply -auto-approve`,
      then `node tools/smoke.js <api_url>` must say *All checks passed*.
- [ ] **Paid Apps Agreement is Active**; **Remove Ads** product complete (price $4.99, localization,
      availability, review screenshot).
- [ ] *(Optional)* rewarded ad unit in AdMob, then its ID in Info.plist; theme products in App Store Connect.
- [ ] Link AdMob to the App Store listing (AdMob > App settings > Add store).

## Test it on your phone (Xcode ▶, development branch for test ads)

- [ ] Weekly Challenge twice: same commands both times.
- [ ] **Join the leaderboard**: pick a name, play the weekly challenge, see your rank and your name.
- [ ] Create a friend group, share the code, join from a second device or reinstall, compare scores.
- [ ] Tap another player's name: **Report** and **Hide** both work; hidden players disappear; *Show all* returns them.
- [ ] **Delete my leaderboard data** removes your entry (check the board afterwards).
- [ ] Buy Remove Ads (test store): ads stop; delete + reinstall + **Restore Purchases**: still removed.
- [ ] Ads appear only after Try Again / Home, never mid-round. Consent prompt shows in an EU region.
- [ ] Share a challenge: the link is the App Store URL.

## Submit (App Store Connect)

1. **Archive** in Xcode: scheme **App**, destination **Any iOS Device**, Product > Archive, Distribute App >
   App Store Connect > Upload.
2. Create **version 1.1.0**; select **build 13** once processed.
3. **What's New**, description, keywords: `STORE_LISTING.md`. Add a line about the weekly leaderboard.
4. **Screenshots**: `store-screenshots/6.9-inch/*.png` in order (the first is the iMessage link preview).
   Consider adding a leaderboard screenshot.
5. **In-App Purchases** on the version: attach **Remove Ads** (and themes if created).
6. **App Privacy** (the leaderboard changes the answers):
   - *Identifiers > User ID* (the display name and random anonymous id): App Functionality, linked, **not** used for tracking.
   - *User Content > Gameplay Content* (weekly scores and reaction times): App Functionality, linked, **not** used for tracking.
   - Plus what Google's AdMob SDK collects: <https://developers.google.com/admob/ios/privacy/data-disclosure>
     (device identifiers, product interaction, advertising data, diagnostics, coarse location from IP).
     The app asks for non-personalized ads and does not request tracking permission.
   - `ios/App/App/PrivacyInfo.xcprivacy` already declares the two leaderboard types; keep them in step.
7. **Age rating questionnaire**: answer **Yes** to user-generated content (limited: player-chosen display names
   and scores, no chat or free text) and to ads / in-app purchases. Check the resulting rating.
8. **App Review notes** (paste):
   > The weekly leaderboard shows player-chosen display names. Safeguards (Guideline 1.2): names are limited
   > to letters, digits and spaces and filtered for inappropriate words; players tap any other player's name to
   > **Report** it or **Hide** the player; three distinct reports hide an entry for everyone automatically; we review
   > reports and can remove names and block devices; the join screen states the rules; contact is
   > support@donttapthat.com (also *Report a problem* in the app). No account or personal data is collected, and
   > *Delete my leaderboard data* is in the app. To see it: Home > Weekly leaderboard > Join > play the Weekly Challenge.
   > Remove Ads: Home > Remove ads & purchases (Restore Purchases is on that screen).
9. **EU trader status** (Business page): revisit. This version is commercial.
10. **Deploy the updated `privacy.html` and `app-ads.txt` before you click Submit** (the policy must describe
    ads and the leaderboard at the live URL). Ask me and I will run the deploy script.

## After you release

- **Moderate**: `AWS_PROFILE=corey node server/tools/moderate.js reports`. Check daily for the first weeks and
  answer emails to support@donttapthat.com promptly (Apple expects timely responses).
- Watch AdMob fill after the store link is approved (can take a day or two).
- Confirm in the live app: join, play weekly, appear on the board.
