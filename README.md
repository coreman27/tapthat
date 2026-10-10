# DON'T TAP THAT

**Obey the command. Or don't. That's the game.**

**🎮 Play live: https://d10kns7njmuyxo.cloudfront.net** (AWS S3 + CloudFront — see [`DEPLOY.md`](DEPLOY.md))

A one-thumb, reflex + psychology game for iPhone. The screen shows a command — `TAP ME`, `DON'T TAP BLUE`, `HOLD`, `SWIPE →`, `TAP AFTER IT TURNS GREEN` — and you have about **0.7–2 seconds** to do the right thing. One mistake ends the run. Then you try again. Forever.

The game quietly **learns what you're bad at** and gives you more of it. Two players at score 30 are not playing the same game.

Built as a **web core wrapped in Capacitor** so it ships as a real native iPhone app *and* keeps the killer feature: **send a friend a link, they tap it and instantly play** — no account, no install.

---

## Play it right now (fastest path)

```bash
cd tapthat
npm run serve
```

Then open `http://localhost:5173` on your Mac, or `http://<your-mac-ip>:5173` on your **iPhone** (same Wi-Fi) in Safari. Tap the **Share** icon → **Add to Home Screen** to install it like a native app (fullscreen, offline, its own icon).

> No build step, no dependencies required just to play — it's plain HTML/CSS/JS.

---

## Build the native iPhone app (App Store path)

Requires macOS with **Xcode** and **CocoaPods**.

```bash
cd tapthat
npm install              # installs Capacitor
npm run ios:add          # creates the native ios/ Xcode project (first time only)
npm run ios              # syncs the web build and opens Xcode
```

In Xcode: pick your device/simulator and press ▶. To submit to the App Store, set your Team + bundle id (`com.coreyhall.donttapthat`) and Archive.

`npm run ios` runs `sync-www` (assembles `www/`) → `cap sync ios` → `cap open ios`.

📱 **Full step-by-step App Store submission guide: [`APPSTORE.md`](APPSTORE.md)** — signing, App Store Connect setup, privacy, screenshots, archive & upload, and a review-readiness checklist. The `ios/` project is already created, configured (portrait-locked, status bar hidden, icons + splash generated), and verified building and running in the Simulator.

---

## How the game works

- **Read the command at the top**, then do exactly what it says before the timer bar empties.
- Sometimes the command is a **DON'T** — the win condition is to *not* act (survive the timer).
- Success = **+1**. Any mistake (wrong action, wrong target, too slow, or acting when you shouldn't) = **game over**.
- Score, Best, `TRY AGAIN` — quick retries. The free iOS app schedules occasional
  interstitials using run cadence and score milestones, with frequency limits.
  Selected ads appear only when leaving game over, never during a round.
  An unavailable ad is skipped.

### Ads and Remove Ads (iOS)

The same app offers a one-time **Remove Ads** in-app purchase, not a separate
paid download or subscription. Open **Remove ads & purchases** on the home
screen to buy it, restore a purchase, or manage available ad privacy choices.
Only verified Apple entitlements disable ads; pending/cancelled purchases do not.
The browser game remains ad-free and does not expose native purchase controls.

**Development defaults to test advertising.** Live AdMob IDs, consent messages,
the non-consumable App Store product, privacy declarations, and sandbox checks
must be configured before release. See the monetization section in
[`APPSTORE.md`](APPSTORE.md). Do not submit the old "Data Not Collected" declaration
with the advertising-enabled iOS build.

Ad timing is configurable in `js/ad-config.js`: cadence, new-best/near-best
triggers, onboarding grace, minimum spacing, cooldown, and per-session caps.
Optional on-device reports are available under **How to play > Local
ad timing diagnostics**. There is no remote analytics or remote configuration
service. See **[AD_RULES.md](AD_RULES.md)** for the rules, configuration knobs,
examples, variant setup, and report interpretation; `APPSTORE.md` covers release setup.

### Challenge types (17 mechanics, many variations)

| Command | You must… | Timeout |
|---|---|---|
| `TAP ME` | tap the button | fail |
| `DON'T TAP ME` | not touch it | **survive** |
| `TAP <COLOR>` | tap the matching color | fail |
| `TAP ANYTHING BUT <COLOR>` | tap any *other* color | fail |
| `TAP TWICE` | double-tap | fail |
| `HOLD` | press & hold until full | fail |
| `SWIPE <DIR>` | swipe that direction | fail |
| `TAP THE SMALLER/BIGGER ONE` | pick by size | fail |
| `DON'T DO ANYTHING` | don't touch the screen | **survive** |
| `TAP AFTER IT TURNS GREEN` | wait for green, then tap | fail |
| `TAP THE WORD "RED"` (Stroop) | read the word, ignore its ink color | fail |
| `TAP <N>` | tap that number | fail |
| `CATCH IT` | catch a button that flees your finger | fail |
| `TAP <COLOR>` (moving) | tap the color while buttons drift | fail |
| `IGNORE THE NOTIFICATION` | don't tap the fake iOS banner | **survive** |
| Screen rotates | still `TAP ME`, now disoriented | fail |
| Bait & switch | command flips to `DON'T TAP` at the last instant | dynamic |

New challenge types unlock as your score climbs (see `minScore` in `js/challenges.js`).

### Weekly challenge

`WEEKLY CHALLENGE` on the home screen plays a fixed sequence that is the same for
every player that week (`js/weekly.js`). Weeks are ISO-8601 in UTC, so everyone
resets at the same moment (Monday 00:00 UTC). Fairness rules:

- Each round gets its own seeded generator (`weekId + round number`), so a round's
  values never depend on how many random numbers an earlier round used.
- Adaptive weighting is off (`Adaptive.pickNext(..., { fixed: true })`); difficulty
  depends only on score, not on personal fail history.
- All gameplay randomness must go through `Challenges.rand()`. Do not add
  `Math.random()` to challenge code; `scripts/weekly.test.js` fails if you do.
- The weekly best is stored separately (`Store.weeklyBest`) and resets each week.
  Layout positions scale to the screen size, but the commands and timing match.

Optional online leaderboards and friend groups live in `server/` (Lambda + DynamoDB,
see `server/README.md`) with an opt-in client in `js/leaderboard.js` and
`js/leaderboard-ui.js`. The feature is **off** while `LeaderboardConfig.apiBase` in
`js/leaderboard-config.js` is empty, so nothing is shown or sent until the backend is
deployed and the URL is set. Enabling it requires updated privacy answers (see the
server README).

Sharing a weekly score uses the same `#c=` link with an extra `w` field. A friend
who opens it in the same week plays that sequence and gets a head-to-head result;
after the week ends the link just says it has ended. Scores are local and shared by
link only, so they are not verified. Shared leaderboards need a backend (roadmap Phase 4).

### Design system

The UI follows iOS-style materials rather than decorative effects (`css/styles.css`):

- **Glass:** one shared material (`--glass`, `--glass-blur`, hairline border, faint top
  highlight, neutral shadow) used by cards, the grouped list, inputs, the command pill,
  toasts and secondary buttons. Two soft lights in `#app` give it something to blur.
- **One solid accent** (`--accent` fill with `--on-accent` text, `--link` for accent text).
  No gradients on controls and no colored glows; `scripts/themes.test.js` fails if either
  comes back.
- **Structure:** a primary action, a tappable summary card (weekly challenge), and a grouped
  list with chevrons for navigation; sentence-case buttons; no underlined web-style links.
  Game commands stay uppercase because they are the game's voice.
- **Game buttons** are solid for legibility. The five gameplay colors never change; the plain
  ("neutral") button is a distinct light button so it can never be mistaken for blue.
- **Fallbacks:** solid panels under *Reduce Transparency* or without `backdrop-filter`, and
  animations off under *Reduce Motion*.

### Themes (purchasable)

`Themes` on the home screen opens a picker with Classic plus three cosmetic themes:
Neon Arcade, Hacker Terminal and Space Station (`js/themes.js`, token blocks at the
end of `css/styles.css`). Rules, enforced by `scripts/themes.test.js`:

- Presentation only: a theme sets `data-theme` on `<html>` and changes backdrop,
  text, panels, accent colors and font. It must not change hitboxes or timing.
- The five gameplay colors (`--red`, `--green`, `--blue`, `--yellow`, `--purple`)
  are never overridden, so "TAP RED" means the same thing in every theme.
- Every theme must keep body text at 7:1 contrast, muted text at 4.5:1, and every
  gameplay color at 3:1 against its background.

**Purchases.** Each non-default theme is its own non-consumable StoreKit product
(`com.coreyhall.donttapthat.theme.arcade|terminal|space`), permanent and restorable. The
native side (`MonetizationManager.swift`, theme section) is deliberately separate from
the Remove Ads logic and never touches ad state; ownership is derived from verified
StoreKit transactions only. Locked themes can be previewed live and are not saved
unless bought. `Themes.PREVIEW_ALL` is a dev-only switch and must stay `false`.

Two launch behaviors worth knowing:

- At launch the saved theme is shown **on trust** (`Themes.applyTrusted`) and reconciled
  once StoreKit reports ownership. Launch never rewrites the saved choice, so a paying
  player is never downgraded to Classic by a slow StoreKit response.
- A refund drops the theme for display but keeps the saved choice, so restoring or
  re-buying brings it back.

**To sell them (App Store Connect, one per theme):** create a Non-Consumable with the
product ID above, a price (the local StoreKit file uses $0.99 as a placeholder; the real
price is whatever you set in App Store Connect), localization, availability, and a review
screenshot of the theme picker. Submit them with the app version. Until a product exists
in App Store Connect, that theme shows "Unavailable right now" and can still be previewed.

### Touch input

The game screen owns touch gestures (`touch-action: none`) so WebKit does not
take over swipes/holds for browser panning or zooming. This is scoped to gameplay,
not the home screen/name input. Cancelled swipes reset their tracking state.
The native WebView disables scrolling and automatic content insets; CSS owns
safe-area padding. On `keyboardDidHide`, the app clears the WebView's retained
content inset and scroll offset so editing the name cannot leave gameplay shifted.
When checking an iOS build, test repeated taps, TAP TWICE, HOLD, and SWIPE across
multiple rounds, including immediately after editing the name. Also dismiss the
keyboard without starting a game and repeat name editing: the background should
return to both screen edges and targets should respond at their visible positions.

### It gets personally evil

`js/adaptive.js` tracks your fail rate per category in `localStorage` and weights the next challenge toward whatever you keep blowing. Bad at color? You'll drown in color. Bad at `WAIT`? Enjoy. Difficulty (time pressure, decoy count, movement speed) ramps from score 0 → ~45.

### Challenge a friend (the reason you reopen the app)

After a run, **CHALLENGE A FRIEND** generates a link containing your name + score (`#c=<base64>`). Your friend taps it → lands on `Bill survived 51 commands. Can you beat them?` → plays instantly. Their game-over screen compares scores and shows **TAKE BACK THE LEAD** if they lost. Uses the native share sheet (`navigator.share`) with clipboard fallback.

---

## Project layout

```
tapthat/
├── index.html              # screens: home / challenge / game / game-over / how
├── css/styles.css          # dark, iOS-safe, safe-area aware
├── js/
│   ├── storage.js          # best score, name, adaptive stats (localStorage)
│   ├── audio.js            # WebAudio blips + haptics (no assets)
│   ├── share.js            # challenge link encode/decode + share sheet
│   ├── challenges.js       # all 17 challenge definitions
│   ├── adaptive.js         # unlock gating + fail-weighted selection + difficulty
│   ├── engine.js           # round loop, countdown timer, resolution
│   ├── ui.js               # screen switching + toast
│   ├── ad-config.js        # versioned ad timing variants and weights
│   ├── ad-policy.js        # score-aware placement, caps, local opt-in measurements
│   ├── monetization.js     # native bridge, deferred ad breaks, purchase state
│   └── main.js             # bootstrap + wiring
├── icons/                  # app icons (SVG + generated PNGs)
├── manifest.webmanifest    # PWA (installable, standalone, portrait)
├── sw.js                   # offline cache
├── capacitor.config.json   # native wrapper config (webDir: www)
├── package.json
└── scripts/
    ├── generate-icons.js   # zero-dep PNG icon generator
    ├── sync-www.js         # assembles www/ for Capacitor
    ├── serve.js            # zero-dep dev server for iPhone testing
    └── smoke-test.js       # headless logic tests
```

## Develop & verify

```bash
npm run icons        # regenerate app icons
npm run www          # assemble the www/ build (used by Capacitor)
npm test          # game smoke tests, ad policy boundaries, diagnostics, purchase/UI integration
```

See [`GAME_SPEC.md`](GAME_SPEC.md) for the full design: first 5 minutes, scoring, progression, screens, sounds, monetization, and the 100+ challenge roadmap.

## Roadmap

**Monetization strategy and release gates:**
[`MONETIZATION_ROADMAP.md`](MONETIZATION_ROADMAP.md). Retention first: can players
immediately want one more try? The planned first milestone is Rewarded Continue,
less frequent interstitials, and a $4.99 one-time Remove Ads purchase. Configurable
score-aware timing is implemented; Rewarded Continue is still planned.

- [x] Core loop, 17 challenge mechanics, adaptive difficulty
- [x] Best score, instant retry, friend-challenge links
- [x] PWA (installable + offline) and Capacitor native scaffold
- [ ] Special challenge packs (optional new game modes)
- [ ] Compass challenge: point your phone the right way, with a theme-matched dial (planned v1.2; spec in `GAME_SPEC.md` 9a, starts with a real-phone spike)
- [x] iOS interstitial cadence and one-time Remove Ads purchase integration
- [ ] Live AdMob / App Store product setup and monetization release validation
- [ ] Retention baseline and one-more-try measurement
- [ ] One optional Rewarded Continue per casual run
- [x] Configurable score-aware ad timing and opt-in local replay diagnostics
- [ ] Retention-tested interstitial cadence (candidate: every 4-6 terminal runs)
- [ ] Cosmetic theme shop and game personality packs
- [ ] Game Center / cloud best scores
- [x] Weekly challenge: seeded sequence, weekly best, share-link head-to-head (no backend)
- [x] Weekly leaderboards and friend groups: backend, client and UI built and tested; **not deployed** (needs `terraform apply`, the API URL in config, and updated privacy answers)
- [ ] Seasonal tournaments & family competitions
- [ ] Season Pass evaluation after fair weekly events prove retention
