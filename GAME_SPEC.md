# DON'T TAP THAT — Game Design Spec

A buildable specification: the first five minutes, scoring, progression, screens, sound, monetization, and a 100+ challenge roadmap. The current codebase already implements the core loop, 17 mechanics, adaptive difficulty, and friend challenges; this document is the north star for expansion.

---

## 1. Design pillars

1. **Understandable in 5 seconds.** Read a command, obey (or don't), survive.
2. **One thumb.** Everything reachable with a single hand.
3. **Instant retry.** Game over → `TRY AGAIN` in under a second. Never interrupt this.
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

- **Core game: free.** Never interrupt a run with an ad — that destroys instant-retry.
- **Remove Ads** (cheap one-time) — if ads exist, only on the Home screen or as an optional "watch to revive once."
- **Cosmetic themes** — neon, pastel, retro-LCD, dark-mode-plus; button skins; timer-bar styles.
- **Challenge packs** — themed command sets (e.g., "Emoji Chaos," "Math Mode," "Rhythm").
- **Family / friends competition** — seasonal tournaments, group leaderboards.
- **Seasonal events** — limited-time challenge types + cosmetics.

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

Target: ship in themed packs of ~10, each pack reusing the existing `build(env)` challenge contract in `js/challenges.js` — add a definition, set `category` + `minScore` + timing, done.

---

## 10. Tech notes for expansion

- **Add a challenge:** append a `def({...})` in `js/challenges.js` with `id, category, minScore, baseTime, minTime, timeoutResult?, build(env)`. It's automatically picked up by the adaptive selector.
- **`env` API:** `field, notifLayer, fw, fh, difficulty, score, rint, pick, shuffle, makeBtn, setInstruction, addCleanup, success(), fail(reason)`.
- **Always** register teardown via `env.addCleanup(fn)` (timers, rAF loops, listeners) so rounds don't leak.
- **Native:** logic is platform-agnostic web; Capacitor wraps it. Haptics can upgrade from `navigator.vibrate` to `@capacitor/haptics` for richer iOS feedback.
