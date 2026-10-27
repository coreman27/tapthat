# App Store Listing Copy

Ready-to-paste copy for App Store Connect. Positioning (2026-10-27): **a reflex game that learns how
to beat you. How long can you last?** Rounds, not commands, and no "AI is coming for you" tone. All of
it is backed by the real on-device adaptive engine (`js/adaptive.js`), so it stays
truthful for App Review — no server-side "AI" claims that don't exist.

## Name
```
DON'T TAP THAT
```

## Subtitle (max 30 chars)
```
How long can you last?
```

## Promotional text (max 170 chars, editable anytime without a new build)
```
A reflex game that learns how to beat you. Do what it says, don't when it says DON'T, and see how many rounds you can last. New Weekly Challenge every Monday.
```

## Keywords (max 100 chars, comma-separated, no spaces)
```
reflex,reaction,tap,adaptive,ai,brain,speed,arcade,challenge,weekly,focus,fast,test,game,leaderboard
```

## Description
```
DON'T TAP THAT is a one-thumb reflex game that learns how to beat you.

TAP ME. DON'T TAP BLUE. HOLD. SWIPE. TAP WHEN IT TURNS GREEN. You get about a second each round: do what it says, or, when it says DON'T, don't. One mistake ends the run.

The twist: the game is paying attention. It notices which rounds trip you up and gives you more of them. Mix up colors? Expect colors. Can't resist a tap? It will tempt you. No two players get the same game, and it gets harder the longer you last.

WHY YOU'LL KEEP TAPPING
- A game that adapts to you as you play
- 17+ kinds of rounds: tap, don't tap, colors, swipe, hold, wait, catch, bait-and-switch and more
- Weekly Challenge: the same rounds for everyone, a fresh set every Monday, with its own Game Center leaderboard
- An all-time Game Center leaderboard
- Challenge a friend with a link
- Quick retries, with an occasional ad between runs, never during one
- Remove Ads: a one-time purchase that restores on any device

ON YOUR DEVICE
The adaptive difficulty runs entirely on your iPhone. No account or sign-up needed. The free version includes ads. Remove Ads is a one-time in-app purchase, not a subscription. Plays offline. See our privacy policy for how ads and purchases handle data.

How long can you last?
```

## What's New (v1.1.0)
```
- Weekly Challenge: the same rounds for every player each week, with its own Game Center leaderboard. Share your score and see who beats it.
- Game Center leaderboards for your all-time best.
- A fresh, cleaner design, with your name on a player card.
- A shorter How to play.
- Occasional ads between runs. A one-time Remove Ads purchase removes them for good and restores on any device.
- Bug fixes and snappier taps.
```

## What's New (v1.0.0)
```
Adaptive reflex challenges. Challenge a friend with a link.
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
breaks based on completed runs and new-best milestones with frequency
limits. A notice appears on game over; a ready ad is attempted only when choosing
**Try Again** or **Home**, not over the score celebration. No ad appears mid-round.
If an ad is unavailable
or consent does not permit ads, the game skips that break. An active verified
Remove Ads purchase suppresses all interstitials.

## Suggested metadata alignment (optional, keeps the whole app on-message)
- `manifest.webmanifest` → `description`: "A reflex game that learns how to beat you. How long can you last?" (done 2026-10-27)
