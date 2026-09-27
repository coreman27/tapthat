# App Store Listing Copy — AI Positioning

Ready-to-paste copy for App Store Connect. Positioning: **an AI-powered reflex game
that learns about *you* and applies the exact failure pattern that beats you.** All of
it is backed by the real on-device adaptive engine (`js/adaptive.js`), so it stays
truthful for App Review — no server-side "AI" claims that don't exist.

## Name
```
DON'T TAP THAT
```

## Subtitle (max 30 chars)
```
The AI that learns to beat you
```

## Promotional text (max 170 chars, editable anytime without a new build)
```
An AI that studies how you play, finds your weakness, and serves you the exact command you keep failing. Two players are never playing the same game.
```

## Keywords (max 100 chars, comma-separated, no spaces)
```
ai,adaptive,reflex,tap,brain,reaction,fast,psychology,learning,challenge,arcade,focus,test,speed
```

## Description
```
DON'T TAP THAT is a one-thumb reflex game with an AI that learns about YOU and uses it against you.

Read the command. TAP ME. DON'T TAP BLUE. HOLD. SWIPE. TAP AFTER IT TURNS GREEN. You get about a second to obey, or, when the command is a DON'T, to resist. One mistake ends the run.

But here's the twist: an on-device AI is watching how you play. It tracks which commands trip you up, learns your personal failure pattern, and steers the next round toward the exact thing you keep getting wrong. Choke on colors? You'll drown in colors. Can't resist tapping? It knows, and it will bait you. Two players at the same score are never playing the same game, because the game has quietly rebuilt itself around each of them.

The longer you play, the smarter it gets and the more personal it feels. It's not random difficulty, it's a game that studies you.

WHY YOU'LL KEEP TAPPING
- AI that adapts to your reflexes in real time and targets your weakness
- 17+ challenge types: tap, don't-tap, color, Stroop, swipe, hold, wait, catch, bait-and-switch, and more
- Quick retries, with occasional ad breaks between runs
- Difficulty that ramps as fast as you do
- Optional one-time Remove Ads purchase, with Restore Purchases for your Apple Account

ON-DEVICE GAMEPLAY
Adaptive difficulty runs entirely on your device. No game account or sign-up is required. The free iOS version includes advertising. Remove Ads is a one-time in-app purchase, not a subscription. Core gameplay works offline. See our privacy policy for advertising and purchase data practices.

How long can you last against a game that learns exactly how to make you fail?
```

## What's New (v1.0.0)
```
Adaptive reflex challenges, occasional ads between games, and an optional one-time Remove Ads purchase with purchase restoration.
```

## App Review note
The "AI" is a genuine on-device adaptive model (per-category fail-rate weighting +
difficulty scaling in `js/adaptive.js`), not a marketing veneer over a random picker.
Keep the copy honest to that. No cloud model is used, but Google Mobile Ads has
its own data practices: **"Data Not Collected" is no longer an accurate blanket
declaration for the monetized iOS build.** Complete the release checklist in
`APPSTORE.md` before using this copy. Do not submit test ads or an unconfigured
purchase product.

Reviewers can open **Remove ads & purchases** on the home screen, purchase
**Remove Ads**, or choose **Restore Purchases**. A configurable policy selects
breaks based on completed runs and new-best/near-best milestones with frequency
limits. A notice appears on game over; a ready ad is attempted only when choosing
**Try Again** or **Home**, not over the score celebration. No ad appears mid-round.
If an ad is unavailable
or consent does not permit ads, the game skips that break. An active verified
Remove Ads purchase suppresses all interstitials.

## Suggested metadata alignment (optional, keeps the whole app on-message)
- `manifest.webmanifest` → `description`: "An AI reflex game that learns about you and serves the exact command you keep failing."
- `index.html` og:description / twitter:description: same AI-forward line.
