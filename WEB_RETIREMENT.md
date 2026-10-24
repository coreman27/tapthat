# Retiring the web version

DON'T TAP THAT is an iPhone app. The browser version (`donttapthat.com`, `www.donttapthat.com`, and the
CloudFront site behind them) is retired. The company site is the home for everything public:

| What | URL |
|---|---|
| App page (App Store **Marketing URL**) | https://hallsoftwaresolutions.com/dont-tap-that/ |
| Privacy policy (App Store **Privacy Policy URL**; linked from the app) | https://hallsoftwaresolutions.com/dont-tap-that/privacy/ |
| Support and FAQ (App Store **Support URL**) | https://hallsoftwaresolutions.com/dont-tap-that/support/ |
| Support email | support@hallsoftwaresolutions.com |
| AdMob `app-ads.txt` | https://hallsoftwaresolutions.com/app-ads.txt |

These pages live in the company-site repo (`hallsoftwaresolutions-site`, deployed with its `./redeploy.sh`).
The privacy policy is edited **there**; this repo no longer bundles a copy, so there is nothing to drift.

## Order of operations

1. **Deploy the company site** (`./redeploy.sh` in `hallsoftwaresolutions-site`). The new app, privacy and
   support pages and `app-ads.txt` go live. The policy wording is scoped to "version 1.1 and later", so it is
   accurate while 1.0 is still the live version.
2. **App Store Connect:** set the three URLs above.
   - *Privacy Policy URL* (App Information) can change at any time. Do it now.
   - *Support URL* and *Marketing URL* belong to a version: set them on 1.1 when you submit it.
3. **Retire the web version:** `AWS_PROFILE=corey ./scripts/retire-web.sh --dry-run`, read the plan, then run it
   without `--dry-run`. It checks the new pages are live first, so it cannot strand the live listing's privacy link.
4. Afterwards, check on a phone: `https://donttapthat.com`, `https://donttapthat.com/privacy.html` and an old
   shared challenge link all land on the company pages.

## What the script does

- Replaces `/sw.js` in the old bucket with a **kill-switch** service worker. Anyone who installed the old game
  to their home screen would otherwise keep a working offline copy forever; the kill-switch clears their caches
  and unregisters itself.
- Installs a CloudFront Function that 301-redirects every other URL to the company pages
  (`/privacy.html` goes to the privacy page, `/support` to the support page). Old links, including the
  privacy URL printed in the current App Store listing, keep working. A `#c=...` fragment is preserved by browsers.
- Waits for CloudFront, clears its cache, and **verifies the redirects over HTTPS** before deleting anything.
- Deletes the old game files from the bucket (except `sw.js`). The source is in git.

Keep the domain registration and the CloudFront distribution: they are what makes the old links redirect.
To undo, check out an earlier commit, run `npm run www`, and upload `www/` to the bucket.

## In the app

- Share links use the App Store URL (no web fallback).
- The in-app privacy links open the company page in Safari.
- The leaderboard API only allows the app's own origin (`capacitor://localhost`).
- `npm run serve` still serves the game locally for development.
