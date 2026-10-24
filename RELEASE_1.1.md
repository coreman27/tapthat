# DON'T TAP THAT 1.1.0 — release checklist

Branch `release/1.1`. Version **1.1.0 (build 13)**, real AdMob app + interstitial IDs, test ads off.
A Release archive that still uses Google test IDs is refused by the build
(`MONETIZATION_REQUIRE_PRODUCTION_ADS`). Don't edit these IDs on any other branch: development
builds stay on test ads so the simulator never serves real ads.

## What ships in 1.1

| Feature | State |
|---|---|
| New glass UI; your name as a player card (tap to change, highlighted for editing) | On |
| Weekly Challenge (same seeded commands for everyone each week) | On |
| **Leaderboard shown on the home screen** and open to everyone to view (no joining to look) | On. Live API `https://wd3memk4x8.execute-api.us-east-1.amazonaws.com` |
| Posting a score, friend groups | On, after the player taps Join and picks a name |
| Report / hide names, three-report auto-hide, moderation tool | On (see `server/README.md`) |
| Interstitial ads (every 5th run or a new best; max 3 per session; never mid-round) | On |
| Remove Ads ($4.99) + free Continue for owners | On, once the product is attached to the version |
| Rewarded Continue for everyone else | **Off** until a rewarded ad unit is set in `MonetizationRewardedAdUnitID` |
| Themes (3) | **Hidden** until the App Store returns theme products |
| Web version | **Retired** (see `WEB_RETIREMENT.md`) |

## Where things live now

| What | Where |
|---|---|
| Privacy policy (App Store **Privacy Policy URL**) | https://hallsoftwaresolutions.com/dont-tap-that/privacy/ |
| Support page (App Store **Support URL**) | https://hallsoftwaresolutions.com/dont-tap-that/support/ |
| App page (App Store **Marketing URL**) | https://hallsoftwaresolutions.com/dont-tap-that/ |
| Contact | support@hallsoftwaresolutions.com |
| `app-ads.txt` (AdMob) | https://hallsoftwaresolutions.com/app-ads.txt |

Those pages are in the company-site repo, branch `dont-tap-that-1.1` (committed, **not yet deployed**).

## Already done and verified

- Backend deployed; deployed-API smoke test passes (CORS for the app, valid run accepted, cheating refused,
  names on the board, groups, report-and-hide with three reporters, impersonation refused, full clean-up).
- 214 app tests + 82 server tests. Release archive builds as 1.1.0 (13) with production ad IDs.
- Viewing the leaderboard creates no identity and sends no id (tested).

## You must do, in this order

1. [ ] **Confirm `support@hallsoftwaresolutions.com` receives mail** (send yourself a test). It is on your company
       site already, so this should only need a quick check.
2. [ ] **Deploy the company site**: in `~/Source/HallSoftwareSolutions`, merge `dont-tap-that-1.1` into `main`, then
       `./redeploy.sh`. This publishes the new app, privacy and support pages and `app-ads.txt`.
       Check the three URLs above load.
3. [ ] **Redeploy the server** (this applies two small changes: device records now expire, and only the app's
       origin is allowed now that the web version is going away):
       `cd server && npm run build && cd terraform && AWS_PROFILE=corey terraform apply -auto-approve`,
       then `node tools/smoke.js <api_url>` must say *All checks passed*.
4. [ ] **App Store Connect**:
       - *App Information > Privacy Policy URL* = the privacy URL above (can change now).
       - On the 1.1 version: *Support URL* and *Marketing URL* = the URLs above.
       - Paid Apps Agreement **Active**; **Remove Ads** product complete (price $4.99, localization,
         availability, review screenshot).
5. [ ] **Retire the web version** (after steps 2 and 4): `AWS_PROFILE=corey ./scripts/retire-web.sh --dry-run`,
       read it, then run it without `--dry-run`. It refuses to run if the new pages are not live.
6. [ ] AdMob: link the app to the App Store listing (App settings > Add store). *(Optional)* create a rewarded
       ad unit; theme products in App Store Connect.

## Test it on your phone (Xcode ▶, development branch for test ads)

- [ ] Home: tap your name card; the name is highlighted; change it; see the greeting; the card updates.
- [ ] Home shows this week's top three; tapping it opens the full board **without** a join screen.
- [ ] Join: pick a name, play the Weekly Challenge, see your rank; the home card updates.
- [ ] Create a friend group and join it from a second device or after reinstalling.
- [ ] Tap another player's name: **Report** and **Hide** both work, even before joining; *Show all* returns them.
- [ ] **Delete my leaderboard data** removes your entry.
- [ ] Buy Remove Ads (test store): ads stop; reinstall + **Restore Purchases**: still removed.
- [ ] Ads appear only after Try Again / Home, never mid-round. Consent prompt shows in an EU region.
- [ ] Share a challenge: the link is the App Store URL. Tapping *Privacy Policy* opens the company page.

## Submit (App Store Connect)

1. **Archive** in Xcode: scheme **App**, destination **Any iOS Device**, Product > Archive, Distribute App >
   App Store Connect > Upload.
2. Create **version 1.1.0**; select **build 13** once processed.
3. **What's New**, description, keywords: `STORE_LISTING.md`. Mention the weekly leaderboard.
4. **Screenshots**: `store-screenshots/6.9-inch/*.png` in order (the first is the iMessage link preview).
   Regenerate with `node scripts/store-screenshots.js` if you want the new home screen in them.
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
   > The weekly leaderboard shows player-chosen display names. Anyone can view it without joining; posting needs
   > the player to tap Join and pick a name. Safeguards (Guideline 1.2): names are limited to letters, digits and
   > spaces and filtered for inappropriate words; tapping another player's name offers **Report** or **Hide**
   > (available without joining); three distinct reports hide an entry for everyone automatically; we review
   > reports and can remove names and block devices; the join screen states the rules; contact is
   > support@hallsoftwaresolutions.com (also *Report a problem* in the app). No account or personal data is collected,
   > and *Delete my leaderboard data* is in the app. To see it: Home > the leaderboard card. Remove Ads: Home > Remove
   > ads & purchases (Restore Purchases is on that screen).
9. **EU trader status** (Business page): revisit. This version is commercial.

## After you release

- **Moderate**: `AWS_PROFILE=corey node server/tools/moderate.js reports`. Check daily for the first weeks and
  answer emails to support@hallsoftwaresolutions.com promptly (Apple expects timely responses).
- Watch AdMob fill after the store link is approved (can take a day or two).
- Confirm in the live app: your name card, the home leaderboard, join, play weekly, appear on the board.
