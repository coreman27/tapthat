# DON'T TAP THAT — Game Design Spec

A buildable specification: the first five minutes, scoring, progression, screens, sound, monetization, and a 100+ challenge roadmap. The current codebase already implements the core loop, 17 mechanics, adaptive difficulty, and friend challenges; this document is the north star for expansion.

---

## 1. Design pillars

1. **Understandable in 5 seconds.** Read a command, obey (or don't), survive.
2. **One thumb.** Everything reachable with a single hand.
3. **Fast retry.** Keep `TRY AGAIN` immediately accessible outside clearly signposted
   between-run ad breaks. Never interrupt active gameplay; reject monetization
   changes that undermine the desire for one more try.
4. **It's out to get *you*.** The game learns your specific weaknesses and exploits them.
5. **Reason to reopen.** Friends, challenges, and "one more to beat my best."

---

## 2. The first five minutes (onboarding by stealth)

No tutorial screens. The difficulty curve *is* the tutorial.

- **0:00 – 0:10 (Score 0–2):** Only `TAP ME`. Big button, ~1.9s. Builds the tap reflex.
- **0:10 – 0:30 (Score 2–4):** Introduce `DON'T TAP ME` (red) and `TAP <COLOR>`. First moment of hesitation — the muscle memory from tapping now works against you.
- **0:30 – 1:00 (Score 4–6):** `TAP TWICE`, `HOLD`, `TAP THE SMALLER ONE`, `DON'T DO ANYTHING`. Timer starts shrinking.
- **1:00 – 2:00 (Score 6–9):** `SWIPE`, `TAP <N>`, `TAP AFTER IT TURNS GREEN`, `DON'T TAP <COLOR>`. Multiple decoys appear.
- **2:00 – 3:30 (Score 9–14):** `STROOP`, moving targets, `CATCH IT`, fake notifications. Reading vs. reflex conflict peaks.
- **3:30 – 5:00 (Score 14+):** Screen rotation, bait-and-switch (`DON'T` at the last instant), faster timers. Adaptive weighting now visibly targets your worst category.

First failure usually lands around score 8–15. The score feels *just* beatable, which is the hook.

---

## 3. Scoring & progression

- **+1 per command survived.** Score = commands survived. Simple, legible, shareable.
- **Best** stored locally (and later Game Center).
- **Difficulty `d` ∈ [0,1]** ramps with score: `d = clamp(score / 45, 0, 1)`.
  - **Time pressure:** each challenge lerps from `baseTime` (easy) to `minTime` (hard). Floor ~700ms.
  - **Decoys:** number of distractor buttons scales with `d`.
  - **Motion:** drift/flee speed scales with `d`.
  - **Unlocks:** each challenge has a `minScore` gate.
- **Milestone feedback:** every 10th command plays a richer sound and a bigger flash. New best triggers a celebratory sting.

### Optional richer scoring (future)
- **Combo streak** multiplier for consecutive fast/perfect reactions (adds risk/reward without complicating the core +1).
- **Speed bonus** for reacting in the first 30% of the window.

---

## 4. Adaptive "evil" engine

Per category, track `{plays, fails}` in local storage. Selection weight:

```
weight = 1 + failRate * 4 + min(fails, 6) * 0.35
```

Categories: `tap, wait, color, sequence, gesture, size, reflex, stroop, find, distractor`.

- Early game (score < 3) is pinned to basics so new players learn the loop.
- Immediate repeats are avoided.
- Result: someone who chokes on color gets ~3–5× more color challenges; someone who chokes on `WAIT` gets buried in `DON'T` commands. The game's implied personality: *"I know you can't resist tapping."*

Future: decay old stats so the model tracks *current* weakness; per-session vs. lifetime blend.

---

## 5. Screens

1. **Home** — logo, name input, `PLAY`, best score, `How to play`.
2. **Challenge intro** (from a friend link) — `Bill survived 51 commands. Can you beat them?` → `ACCEPT & PLAY`.
3. **Game** — HUD (score + best), timer bar, instruction, playfield, notification layer.
4. **Game over** — reason, big score, best, `NEW BEST!`, versus block (if challenged), `TRY AGAIN`, `CHALLENGE A FRIEND`.
5. **How to play** — four lines, then `GOT IT`.

Design: dark background, blue→purple accent, red for danger/`DON'T`, safe-area insets, no scrolling, huge tap targets.

---

## 6. Sound & haptics

All synthesized at runtime (WebAudio) — zero audio assets, tiny bundle.

| Event | Sound | Haptic |
|---|---|---|
| Correct | short 660Hz triangle blip | light |
| Every 10th | two-note rising | medium |
| Wrong / game over | low 150Hz saw buzz | error pattern |
| Timer final second | soft 1200Hz ticks | — |
| Turns green / ready | 520Hz cue | — |
| New best | three-note arpeggio | celebratory pattern |

Mute toggle persists. On iOS, audio unlocks on first touch.

---

## 7. Friend challenges (retention engine)

1. After a run: `CHALLENGE A FRIEND` → native share sheet with text + link.
2. Link = `…/index.html#c=<base64({name,score})>` — no backend, no account.
3. Friend opens link → challenge intro → plays → game-over compares:
   - Won: `You beat Bill! You: 53 • Bill: 51`
   - Lost: `Bill leads. Bill: 51 • You: 47 — TAKE BACK THE LEAD`
   - Tie: `Tied at 51. Break the tie.`
4. Fallback to clipboard copy where share sheet is unavailable.

Future (needs a lightweight backend): persistent leaderboards among friends, rematch notifications, weekly family tournaments.

---

## 8. Monetization (without killing the loop)

The phased plan, acceptance criteria, and retention scorecard live in
[`MONETIZATION_ROADMAP.md`](MONETIZATION_ROADMAP.md). The first target milestone
is **Rewarded Continue + occasional interstitials + $4.99 one-time Remove Ads**.
Rewarded Continue is **not implemented yet**. Configurable timing and local
measurement are implemented as described below. Price changes happen in App Store Connect.

- **Core game: free.** On iOS, select occasional breaks based on completed runs,
  new bests, or near-best scores, subject to onboarding/cooldown/session limits
  in `js/ad-config.js`. Preserve the result celebration: a notice announces a
  possible ad, and it is attempted only on **Try Again** or **Home**. No timer
  can interrupt the result screen or an active run. Skip unavailable/stale
  opportunities rather than catching up later. The browser game has no native ads.
- **Measure locally first.** Opt-in bounded on-device reports compare placement
  reasons, actual ad exposure, and replay timing. Do not equate a selected
  opportunity with an impression or a single-device report with population retention.
- **Remove Ads** — one-time Apple non-consumable purchase in the same app, with
  Restore Purchases and verified entitlement updates. Pending/cancelled purchases
  do not remove ads; refunds/revocations remove the entitlement.
- **Privacy** — request ads only after the native consent flow permits them,
  provide privacy choices when required, and update App Store data disclosures.
- **Development** — use Google's test ads; live identifiers, product metadata,
  purchase pricing, consent setup, and release checks are configured separately.
- **Cosmetic themes and personalities** — original skins, dialogue, animations,
  and sound packs with unchanged game rules and legibility.
- **Challenge packs** — themed command sets (e.g., "Emoji Chaos," "Math Mode," "Rhythm").
- **Family / friends competition** — seasonal tournaments, group leaderboards.
- **Seasonal events** — limited-time challenge types + cosmetics.
- **Season Pass (later)** — optional exhibition tournaments, cosmetics, badges,
  and historical stats; never paid advantages in shared ranked competition.

---

## 9. 100+ challenge roadmap

Currently implemented (17): `TAP ME`, `DON'T TAP ME`, `TAP <color>`, `DON'T TAP <color>`, `TAP TWICE`, `HOLD`, `SWIPE <dir>`, `TAP SMALLER/BIGGER`, `DON'T DO ANYTHING`, `TAP AFTER GREEN`, `STROOP word`, `TAP <number>`, `CATCH IT`, moving color, `IGNORE NOTIFICATION`, screen rotate, bait-and-switch.

Each mechanic already multiplies into many concrete commands (5 colors × N decoys × timing). Expansion backlog toward 100+:

**Tapping / counting**
- Tap N times exactly (3×, 5×)
- Tap in order 1→2→3
- Tap all blue (multi-select), tap all EXCEPT red
- Tap the odd one out (color/shape/size)
- Tap the biggest number / smallest number
- Tap the only moving one / the only still one

**Reading / Stroop family**
- Tap the color the WORD names vs. the ink color (both variants)
- Tap the word that's a lie ("this is BLUE" on a red button)
- Tap the misspelled word
- Follow a two-step instruction ("if 3 buttons, tap red; else tap blue")

**Timing / reflex**
- Tap on the beat / tap when the ring aligns
- Release exactly when the gauge hits the line
- Tap the instant it flashes (not before)
- Double-tap only if it turned green, else don't

**Gesture**
- Swipe the arrow's direction / swipe OPPOSITE the arrow
- Draw an L / draw a circle
- Pinch / rotate to a target angle
- Long-swipe vs. flick distinction

**Wait / restraint**
- Wait exactly 2 seconds then tap (too early or too late fails)
- Don't tap the blinking one
- Let the bomb timer run out (do nothing)
- Ignore two notifications in a row

**Distraction / evil**
- Button teleports on approach
- Instruction text itself moves / fades
- Fake "system" alert ("Low Battery — tap OK") that must be ignored
- Decoy timer bar that's fake
- Screen dims; command shown briefly then hidden (memory)
- Upside-down / mirrored text
- Two commands at once, obey only the highlighted one

**Meta / personality**
- "You always tap. Don't." (targets the player's known habit)
- Rematch a "ghost" of the player's own best run

**Motion / sensors** (new family; first entry is specified below)
- **Point your phone the right way** (compass) — see 9a
- Later, only if 9a feels good: tilt to level, shake it, hold the phone upside down

Target: ship in themed packs of ~10, each pack reusing the existing `build(env)` challenge contract in `js/challenges.js` — add a definition, set `category` + `minScore` + timing, done.

### 9a. Compass challenge — "POINT YOUR PHONE IN THE RIGHT DIRECTION" (planned, v1.2)

Not started. Target release: **v1.2** (v1.1 is already packaged; see `RELEASE_1.1.md`).

**The idea.** A random direction is chosen. The player physically turns (body and phone) until the
phone points that way. A dial on screen shows how close they are, and the round passes the moment
they are facing the right way. If time runs out it fails like any other command (`env.fail`).
They get extra time because turning takes longer than tapping.

**Rules**
- Command text: `POINT YOUR PHONE IN THE RIGHT DIRECTION`. The target is never printed as a bearing
  or as "north/east": the player follows the dial, so nobody needs to know compass directions.
- **Time:** `baseTime` 7000 ms easing to `minTime` 5000 ms at full difficulty (other commands are
  about 1.5 to 2.5 s). Tune in playtests; the numbers are the plan's starting point only.
- **Pass:** heading within the tolerance of the target, held for a short dwell, so sweeping past the
  target by accident does not count. Starting values: tolerance **±15°** (down to ±10° at full
  difficulty), dwell **400 ms**.
- **Target choice:** random bearing at least **90°** and at most **170°** from where the phone points
  when the round starts. So it always needs a real turn, and never more than a half turn.
- **Unlock:** `minScore` about **20**, never the first command of a run, and not within about 6 rounds
  of the previous compass round. It is slower than the rest, so it should be an occasional surprise.
- **Category:** a new `motion` category, so adaptive weighting and fail stats treat it like the others.
- **Not in the weekly challenge.** See "Fairness" below. This is a firm rule.

**The indicator (matches the theme)**
- A large dial in the playfield: a ring whose arc fills as the phone turns toward the target, and a
  marker showing which way to turn (the short way round). Passing turns the ring green (the gameplay
  green, which keeps its meaning) and plays the success haptic.
- All colors come from theme tokens (`--accent` for progress, `--line2`/glass for the track,
  `--link` for the marker). Any glow may only come from `--title-glow`, so Classic and Space stay
  glow-free and the design-guard tests keep passing. Contrast of the ring against each theme's
  background is tested (>= 3:1), like the gameplay colors.
- Optional haptic "ticks" that speed up as the player gets closer (Capacitor Haptics), with a
  haptics-off switch. Reduce Motion: no easing on the dial, but it must still track the phone, because
  that movement is the feedback.
- Open question for the first playtest: arrow always on, or arrow only at low difficulty with a
  hot/cold ring at high difficulty. Default: ring plus marker always.

**Heading source (decision and risk)**
- The app is a Capacitor WebView. Web `deviceorientation` on iOS needs an explicit permission call
  from a tap and behaves differently in a WebView than in Safari. **Plan: a small native Capacitor
  plugin using CoreMotion** (like `MonetizationPlugin`), with a JS facade (`Heading`) so the game never
  talks to the sensor directly. Expected: no permission prompt, and no location permission (magnetic
  heading is enough because the target is random). **Verify both in the first spike**; if a prompt turns
  out to be required, add a one-time explanation before the first compass round, never mid-round.
- **What "pointing" means:** held upright, the direction the back of the phone faces; held flat, the
  direction the top edge faces. The plan uses whichever is more horizontal. **Verify on a real phone.**
- Smooth the signal (circular low-pass) and use the magnetometer accuracy value: if it is poor, show a
  "wave your phone in a figure 8" calibration hint before the round starts (not during the timer).
- Web / PWA build: the compass command is never selected (no reliable sensor access).
- **The iOS simulator has no magnetometer.** Development uses a fake driver behind the same facade
  (a slider overlay in debug builds only) so the logic can be exercised without a device.

**Fairness and safety**
- **Weekly challenge:** every player must get the identical sequence, but some phones cannot do this
  command (no magnetometer, sensor error, motion switched off). So compass defs carry
  `weekly: false` and are filtered out in fixed (weekly) selection. A golden-sequence test must prove
  existing weeks' sequences are byte-for-byte unchanged after the def is added, because the leaderboard
  server replays the sequence with the same `challenges.js` (see `server/README.md`). Also add a
  `rulesVersion` to weekly score submissions so a server and app on different rules cannot disagree
  silently.
- **Never punish a broken sensor.** If no heading arrives within about 700 ms of the round start, the
  round passes without penalty (the engine already does this for challenges that error), the command
  is disabled for the session, and the player sees nothing worse than a missing round.
- **Switch:** a "Motion challenges" on/off switch (default on), for players who cannot or should not
  turn around (on a couch, in a car or plane, mobility or vestibular reasons). It lives in a small
  Settings area next to the other toggles. Sensor-unavailable devices skip the command automatically.
- Never ask players to move while walking or driving: the how-to-play screen says to play
  seated or standing in a safe place, and the dial is large so the screen is easy to follow.
- **Rewarded Continue / ads:** unaffected. A continue never offers a skipped compass round.

**Privacy and the store**
- Sensor data is read and used on the device only. Nothing is stored or sent. No App Privacy answer
  changes (still no collection for this feature). `privacy.html` gets one sentence saying the app uses the
  phone's orientation sensors for this command and that the data stays on the device. If the spike shows an
  Info.plist usage string is needed, it says: "Used for the compass challenge. Motion data stays on your
  device."

**Build plan (one small story at a time, each tested before the next)**
1. **Spike on a real phone:** CoreMotion heading, upright versus flat, calibration behavior, whether
   any permission appears. Output: a short note in this section. Nothing else ships before this.
2. **`js/compass.js`: pure logic, no DOM** (heading difference with wraparound, circular smoothing,
   target choice, proximity, dwell tracker, tolerance by difficulty), with unit tests.
3. **`Heading` facade, the native plugin, and the fake driver.**
4. **The challenge and the dial**, `weekly: false`, availability and fail-open rules, cleanup of all
   listeners/timers via `env.addCleanup`.
5. **Settings switch, how-to-play text, privacy page sentence.**
6. **Device test and tuning** (time, tolerance, dwell, `minScore`, frequency) with real players.

**Tests that must exist**
- Heading math: wraparound (359 vs 1), exactly 180, negative and over-360 inputs, NaN/missing samples.
- Target choice stays within 90 to 170 degrees over many random seeds.
- Dwell: passes only after holding in tolerance; resets if the player leaves; a fly-through never passes.
- Through the real engine with the fake driver: pass, timeout fail, sensor silent (fail open, disabled for
  the session), listeners and timers released after every outcome.
- Never selected: on web, when the switch is off, when unavailable, and in weekly mode, with the weekly
  golden-sequence test and the server replay test both unchanged.
- Dial colors come from theme tokens only, with contrast checks for every theme.
- Native: compile check in CI-style build, plus the device checklist from step 1 and 6 (eight headings,
  calibration, upright and flat, indoors near metal).

**Decisions made by default (change any of these)**
- v1.2, not v1.1. Native CoreMotion plugin over web `deviceorientation`. Excluded from weekly. Extra
  time of roughly 3x a normal command. Ring plus marker indicator. Default on, with an off switch.

---

## 10. Tech notes for expansion

- **Add a challenge:** append a `def({...})` in `js/challenges.js` with `id, category, minScore, baseTime, minTime, timeoutResult?, build(env)`. It's automatically picked up by the adaptive selector.
- **`env` API:** `field, notifLayer, fw, fh, difficulty, score, rint, pick, shuffle, makeBtn, setInstruction, addCleanup, success(), fail(reason)`.
- **Always** register teardown via `env.addCleanup(fn)` (timers, rAF loops, listeners) so rounds don't leak.
- **Sensor challenges (planned, see 9a):** read hardware only through a facade (e.g. `Heading`), never directly from a challenge, so a fake driver can stand in for the simulator and tests. A def may declare `weekly: false` to be excluded from the fixed weekly selection; any challenge some devices cannot perform must set it, or the seeded weekly sequences would differ between players.
- **Native:** logic is platform-agnostic web; Capacitor wraps it. Haptics can upgrade from `navigator.vibrate` to `@capacitor/haptics` for richer iOS feedback.
