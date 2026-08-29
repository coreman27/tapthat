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

In Xcode: pick your device/simulator and press ▶. To submit to the App Store, set your Team + bundle id (`com.tapthat.game`) and Archive.

`npm run ios` runs `sync-www` (assembles `www/`) → `cap sync ios` → `cap open ios`.

📱 **Full step-by-step App Store submission guide: [`APPSTORE.md`](APPSTORE.md)** — signing, App Store Connect setup, privacy, screenshots, archive & upload, and a review-readiness checklist. The `ios/` project is already created, configured (portrait-locked, status bar hidden, icons + splash generated), and verified building and running in the Simulator.

---

## How the game works

- **Read the command at the top**, then do exactly what it says before the timer bar empties.
- Sometimes the command is a **DON'T** — the win condition is to *not* act (survive the timer).
- Success = **+1**. Any mistake (wrong action, wrong target, too slow, or acting when you shouldn't) = **game over**.
- Score, Best, `TRY AGAIN` — instant retry loop, no interruptions.

### Challenge types (17 mechanics, many variations)

| Command | You must… | Timeout |
|---|---|---|
| `TAP ME` | tap the button | fail |
| `DON'T TAP ME` | not touch it | **survive** |
| `TAP <COLOR>` | tap the matching color | fail |
| `DON'T TAP <COLOR>` | tap any *other* color | fail |
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
node scripts/smoke-test.js   # headless tests: builds every challenge, checks resolution, adaptive, share
```

See [`GAME_SPEC.md`](GAME_SPEC.md) for the full design: first 5 minutes, scoring, progression, screens, sounds, monetization, and the 100+ challenge roadmap.

## Roadmap

- [x] Core loop, 17 challenge mechanics, adaptive difficulty
- [x] Best score, instant retry, friend-challenge links
- [x] PWA (installable + offline) and Capacitor native scaffold
- [ ] Cosmetic themes & challenge packs (monetization)
- [ ] Game Center / cloud best scores
- [ ] Seasonal tournaments & family competitions
