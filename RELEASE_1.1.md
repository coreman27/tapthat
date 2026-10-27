# DON'T TAP THAT 1.1.0 — release checklist

Branch `release/1.1`. Version **1.1.0** (build number goes up on every upload; see Submit), real AdMob app + interstitial IDs, test ads off.
A Release archive that still uses Google test IDs is refused by the build
(`MONETIZATION_REQUIRE_PRODUCTION_ADS`). Don't edit these IDs on any other branch: development
builds stay on test ads so the simulator never serves real ads.

## What ships in 1.1

| Feature | State |
|---|---|
| New glass UI; your name as a player card (tap to change, highlighted for editing) | On |
| Launch splash (animated, skippable, Reduce Motion aware) | On |
| **Game Center leaderboards**: all-time board on Home; weekly board on the Weekly Challenge screen | On, once both leaderboards are approved with this version |
| Weekly Challenge: its own screen (week, time left, your best, this week's board, Play); rolls over with Apple's recurring board every Monday | On |
| Existing high scores synced to Game Center on first launch (and retried until accepted) | On |
| Our own leaderboard server | **Not used** (replaced by Game Center; see "Shut down the old backend") |
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

- Company site deployed (app, privacy, support pages, `app-ads.txt`). The Game Center wording for the privacy and
  support pages is written; it goes live with the next `./redeploy.sh` (see step 2).
- 217 app tests (26 for Game Center against a fake that behaves like Apple's server) + 82 server tests.
- Both leaderboards created in App Store Connect: `com.coreyhall.donttapthat.best` (classic) and
  `com.coreyhall.donttapthat.weekly` (recurring). They match `js/gamecenter.js`.

## You must do, in this order

1. [ ] **Confirm `support@hallsoftwaresolutions.com` receives mail** (send yourself a test).
2. [ ] **Publish the Game Center wording on the company site**: in `~/Source/HallSoftwareSolutions`, commit the
       `dont-tap-that/` changes and run `./redeploy.sh`. (That repo also has unrelated uncommitted edits to the
       home, MustrHQ and SickSpot pages; decide on those first, since `redeploy.sh` uploads the working folder.)
3. [ ] **Check the weekly leaderboard's schedule** (App Store Connect > Game Center > Weekly Challenge):
       start on a **Monday**, duration **1 week**, repeating. The app follows whatever Apple reports, and the
       countdown shows it. A start of Monday 00:00 UTC matches the app's offline fallback exactly.
4. [ ] **App Store Connect**:
       - On the 1.1 version: tick **Game Center** and add both leaderboards (they are submitted with the version;
         Apple will not take a first leaderboard on its own).
       - *Support URL* and *Marketing URL* = the URLs above. *Privacy Policy URL* in App Information.
       - Paid Apps Agreement **Active**; **Remove Ads** complete; theme products if you sell themes.
5. [ ] **Retire the web version**: `AWS_PROFILE=corey ./scripts/retire-web.sh --dry-run`, read it, then run it
       without `--dry-run`.
6. [ ] AdMob: link the app to the App Store listing (App settings > Add store). Business payments: see below.

## Test it on your phone (Xcode ▶, development branch for test ads)

Game Center works on a real device signed in to Game Center (Settings > Game Center). Before the version is
approved, leaderboards work in development builds once they exist in App Store Connect.

- [ ] Launch: the splash plays, a tap skips it, Game Center's sign-in banner appears.
- [ ] Your 1.0 best score shows up on the all-time board (Home card, then the full board).
- [ ] Home card: top three plus "You are #N of M". Tap it: full board, Everyone/Friends tabs, *Open in Game Center*.
- [ ] Weekly Challenge card opens its own screen: week, "New commands in …", your best, this week's board.
      *Play this week's challenge* starts the run. After it, game over shows "Weekly rank #N".
- [ ] Friends tab asks for friends access once; saying no shows how to turn it on.
- [ ] Signed out of Game Center: the game still works, the cards say how to sign in, nothing breaks.
- [ ] Home: tap your name card; the name is highlighted; change it; see the greeting.
- [ ] Buy Remove Ads (test store): ads stop; reinstall + **Restore Purchases**: still removed.
- [ ] Ads appear only after Try Again / Home, never mid-round. Consent prompt shows in an EU region.
- [ ] Share a challenge: the link is the App Store URL. Tapping *Privacy Policy* opens the company page.

## Submit (App Store Connect)

1. **Upload** (same rules as Tableside: the build number goes up on every upload; builds come from pushed `main`):
   `cd ~/Source/tapthat && ./scripts/testflight.sh`. It bumps the build, runs the tests, syncs the web app into iOS,
   archives, uploads with the App Store Connect API key, then commits and pushes the bump. If App Store Connect
   already has that number, rerun with `--build <next>`. (App Store Connect is at build 26, uploaded 2026-10-27; the script now counts up from there.)
   No "Missing Compliance" question any more: Info.plist declares no non-exempt encryption.
2. Create **version 1.1.0**; select the newest build once processed.
3. **What's New**, description, keywords: `STORE_LISTING.md`. Mention the Game Center leaderboards and the weekly board.
4. **Screenshots**: `store-screenshots/6.9-inch/*.png` in order (the first is the iMessage link preview).
   Regenerate with `node scripts/store-screenshots.js` if you want the new home screen in them.
5. **In-App Purchases** on the version: attach **Remove Ads** (and themes if created).
6. **App Privacy**: the app itself no longer collects a user id or scores (Game Center is Apple's, under
   Apple's privacy policy). If you answered *User ID* / *Gameplay Content* for the old leaderboard, remove them.
   Keep what Google's AdMob SDK collects: <https://developers.google.com/admob/ios/privacy/data-disclosure>
   (device identifiers, product interaction, advertising data, diagnostics, coarse location from IP).
   `ios/App/App/PrivacyInfo.xcprivacy` now declares no collected data types of the app's own.
7. **Age rating questionnaire**: user-generated content: **No** (the app shows only Game Center nicknames and has
   no chat or player text of its own). Yes to ads / in-app purchases. Check the resulting rating.
8. **App Review notes** (paste):
   > Leaderboards use Game Center: an all-time board (Home > Leaderboard card) and a weekly recurring board
   > (Home > Weekly Challenge, shown before you play). Names are Game Center nicknames; the app has no chat and no
   > player-entered text visible to others. If the device is not signed in to Game Center, the game works and the
   > cards explain how to sign in. Remove Ads: Home > Remove ads & purchases (Restore Purchases is on that screen).
9. **EU trader status** (Business page): revisit. This version is commercial.

## After you release

- Watch AdMob fill after the store link is approved (can take a day or two).
- Confirm in the live app: your best on the all-time board; next Monday, the weekly board and commands reset.
- ~~Shut down the old backend~~ **Done 2026-10-27** (`terraform destroy`: API, Lambda, DynamoDB table, IAM role, logs; verified gone). The code stays in `server/`; `npm run test:server` still runs its tests.