# SDD ledger — plan: docs/superpowers/plans/2026-11-06-hranitel-phase1-campaign.md

Spec: docs/superpowers/specs/2026-11-06-hranitel-solnca-design.md
Branch: worktree-atomic-booping-rossum, plan start b81863d (merge-base with main: 84d7d8f)
Git: use /usr/bin/git (rtk hook blocks plain git).

## Pre-flight scan

| Rows | Produces → Consumes | Finding |
|---|---|---|
| T1↔T2 (board.js, game.js) | T1 find*/hasMove/findMove → T2 planCascade/simulateMove | consistent |
| T2↔T3 (board.js) | T2 expandSpecials.unlocks (empty), collapse, generateGrid(level) → T3 fills unlocks, pinned collapse, level.vines | consistent |
| T3↔T7 (game.js) | T3 emits sun:unlock → T7 counts vines goal | consistent |
| T4↔T5 | Campaign.allLevelIds/nextLevelId → Progress.isUnlocked/migrateV1/currentLevelId | consistent |
| T4↔T6 | resolve().econTime/timer/stars, land files → bot; T6 rewrites stars stubs | consistent |
| T5↔T7 | Progress API → game save | consistent |
| T7↔T8/T9 | window.Game API → map/story/transfer | T7 says outro scene "(Task 9)" before T9 exists — see R1 |
| T7 (economy-sim) | needs Campaign loadable in Node | T4 provides require of land files — consistent |
| T1 self | helper gridFrom has `locked` key before T3 | harmless (map passes through) |
| T2 self | tests vs signatures | consistent |
| T3 self | consistent |
| T4 self | 1-01 challenge: ceil(12*1.3)=16, round(120*0.8)=96 | consistent |
| T5 self | consistent |
| T6 self | depends on T4 data; corridor (30–50 / 75–90) contains suggest (40/80) | consistent |
| T8 self | README edit also in T10 Step 4 | consistent |
| T9 self | consistent |
| T10 self | greps for `stars: [1, 2]` stubs | consistent |

Ruling: R1 — Task 7 ends a land's last level by going to the map via a single hook `Game.onLandComplete(landId)` (default: show map); Task 9 replaces it to play the outro first — keeps T7 independently testable — cost if wrong: small rewire in T9.

## Progress
Task 1: dispatched (base b81863d, implementer acc01fc74a23f5d38, sonnet)
Task 1: ⚠️ Firefox manual regression — Ruling: pure-JS extraction with 20000-board differential test and Chrome pass; Firefox check folded into Task 10 full browser pass — cost if wrong: a Firefox-only regression found later in T10.
Task 1: minor (deferred): game.js still duplicates ROWS/COLS/keyOf/gemAt/parseKey next to core copies
Task 1: minor (deferred): findCorners/analyzePatterns have thin positive coverage (T-shape untested)
Task 1: complete (commits b81863d..3cc411e, review clean)
Task 2: dispatched (base 3cc411e)
Task 2: implemented 1a84c2e (implementer a38bbc64ab32e6691); review dispatched (opus)
Task 2: ⚠️ Firefox/Safari manual + animation-in-motion — Ruling: folded into Task 10 full browser pass — cost if wrong: late-found browser regression.
Task 2: minor (deferred→carried to T3): spawned order (per column bottom→top) not asserted by test though dropGems stagger depends on it
Task 2: minor (deferred→carried to T3): DEFAULT_COLORS/fallbackId declared after use; shared module-wide id counter
Task 2: minor (deferred→carried to T6): simulateMove has opts.colors 6th arg and no auto-reshuffle when no moves — bot must handle
Task 2: minor (deferred): game.js mixes window.BoardCore and Board alias
Task 2: complete (commits 3cc411e..1a84c2e, review clean)
Task 3: dispatched (base 1a84c2e)
Task 3: implemented 4773e37 (implementer a04859a08be0ac39d), DONE_WITH_CONCERNS
Ruling: T3 shuffle now permutes existing gems so specials survive (old reshuffle regenerated the board and dropped specials; my dispatch said "preserve") — kept: friendlier for the elderly player, nothing in spec requires losing specials — cost if wrong: one-line revert to regenerate-on-shuffle.
Ruling: T3 a gem unlocked mid-cascade becomes ordinary and may fall in the same drop — consistent with spec §5 "после этого он обычный" — cost if wrong: small core change.
Task 3: review Needs fixes (1 Important: wrong refusal hint; minors: shuffle fallback sentinel, dead-board test, impactFx NaN, locked dimming) — fix round 1 sent to implementer
Task 3: fix round 1/5 (5 addressed, 0 open — refusal hint, shuffle sentinel+resolve, dead-board test, impactFx guard, no dimming; commits 4773e37..30a25c8)
Task 3: minor (deferred): reshuffleBoard↔resolveBoard recursion has no depth guard (theoretical)
Task 3: minor (deferred): unlock-only cascade still bumps chain/combo and plays match sound
Task 3: ⚠️ browser re-check after fix round + Firefox — folded into Task 10
Task 3: complete (commits 1a84c2e..30a25c8, review clean)
Task 4: dispatched (base 30a25c8)
Task 4: implemented d49879f (implementer ac6e93275c613eb15); invented names Тзаркун (Lord of Night), Кайоль (priest) — surface to user at finish; review dispatched
Task 4: ⚠️ intro line «Сложи ряд с таким камнем, и лиана упадёт» — checked vs T3 rule (gem must be part of the row): correct.
Ruling: T4 challenge vine count may exceed 14 (2-19/2-20 → 17) — spec §6 "Испытание — препятствий больше"; "≤~14" is the base set — cost if wrong: trim challenge extras.
Task 4: minor (carried to T6): 2-01 tutorial vines mostly in column 0 incl. corner — move toward centre when tuning
Task 4: minor (deferred): validate() throws TypeError if goals not array (campaign.js:194)
Task 4: minor (deferred): loadLands silently [] if scripts missing; validate passes on empty campaign
Task 4: minor (deferred): resolve() unknown difficulty silently falls back to normal
Task 4: minor (deferred): ceil(need*1.3) float; STARS/lvl helpers duplicated across land files; negative validate test without finally; lands()/level() return live objects
Task 4: minor (deferred): text nits «Жрецы берегли так храм…» word order; rare words «придел», «сейба»
Task 4: complete (commits 30a25c8..d49879f, review clean)
Task 5: dispatched (base d49879f)
Task 5: implemented 6389ece (implementer a940eb8d40587d5a2), DONE_WITH_CONCERNS
Ruling: T5 corrupt/unusable new key falls through to migrating a valid old key (plan said corrupt → empty()); plus Progress.readRaw so T7 backs up the unreadable raw before first persist — avoids silently losing the father's old progress — cost if wrong: none significant.
Task 5: ⚠️ game must back up readRaw before first persist — carried to T7
Task 5: minor (carried to T7): migrateV1 should accept numeric-string unlocked/best like old reader (Number()+isFinite)
Task 5: minor (carried to T7): importCode should strip zero-width chars (U+200B–U+200D, U+FEFF); exportCode should export normalize(save)
Task 5: minor (deferred): outer catch in load() also swallows migration programming errors; record() clamps stars up to 1 (call only on win); stale isValidShape comment; record/clone throw on malformed save; escape/unescape deprecated
Task 5: complete (commits d49879f..bb3bb21, review clean)
Task 6: dispatched (base bb3bb21)
Task 6: implemented 8b2db98 (implementer ac824fc5f910132cd), DONE_WITH_CONCERNS (levels too short: 7–35 greedy moves)
Ruling: T6 retune for spec §2 level length (calm 4–6 min): human-median moves 1-05→1-20 ~20→45, 2-01 ~25, 2-02→2-20 ~35→65, rests ~70%; 1-01..1-04 verbatim stay short; time = human median × 5 s × 1.4 (round 5) — cost if wrong: levels too long/short, retune numbers only.
Ruling: T6 --check must also pass on independent seeds (--seed-offset 1000) to break circular star fit — cost: longer run.
Task 6: retune committed 8156b98 (human medians 1-05 20→1-20 45, 2-01 26, 2-02 36→2-20 66; time = human median × 7 s; star corridor checked on 500 human runs; s3 at p82)
Ruling: T6 "Обычно" timer = bot-human median × 7 s may be tight for a real elderly player (bot more efficient) — accept for now, flag to user for playtest after T7; tune multiplier from real play — cost if wrong: father hits time-outs on «Обычно», one-number retune.
Task 6: review dispatched
Task 6: review Needs fixes (Important: bot sees future refills; plan-mandated: 4 s/move score clock vs 7 s/move timers)
Ruling: T6 score clock and timer sizing share SECONDS_PER_MOVE = 7; greedy in-time check stays at 4 s/move (FAST_SECONDS_PER_MOVE) as the brief says — plan text said 4 s for the score clock; overridden for consistency with the spec's "stars for an ordinary player" intent — cost if wrong: normal/challenge star thresholds shift, refit numbers.
Task 6: fix round 1 sent (eval seed independence + refit, clock unification, minors 3–7)
Task 6: fix round 1 committed c4dbf4c (eval seed independent, SECONDS_PER_MOVE 7, 2-08 vine (7,7)→(5,3), minors fixed; --check exit 0 at offsets 0 and 1000); re-review dispatched
Task 6: fix round 1/5 (7 addressed, 0 open; commits 8156b98..c4dbf4c)
Task 6: minor (deferred): no direct unit test for no-lookahead; shared evalSeed per turn undocumented
Task 6: note: late-level color needs 60–95 per color (challenge up to ~125) — goal chips must fit 3-digit numbers (carried to T7)
Task 6: complete (commits bb3bb21..c4dbf4c, review clean after 1 fix round)
Task 7: dispatched (base c4dbf4c)
Task 7: implemented e46f750, cbde467, dd54dd1 (implementer a9efc96bcf2de1b9f, opus), DONE_WITH_CONCERNS
Ruling: T7 onLandComplete fires when the player leaves the win screen (not at the win moment) so he sees his stars first — matches R1 intent — cost if wrong: trivial move of the call.
Ruling: T7 «Лучший счёт» = best single-level score (campaign scores are per level; migrated old best stays until beaten) — cost if wrong: label tweak.
Task 7: review dispatched
Task 7: review: only Important = Firefox Step 3 not run (verification gap, no code defect)
Ruling: T7 Firefox manual pass moved to Task 10 — no Firefox automation here (Playwright not installed; installing needs the user's OK); in T10 either ask the user to approve installing Playwright for Firefox or ask him to do a 5-minute Firefox checklist — cost if wrong: a Firefox-only bug found at T10 instead of now.
Task 7: minor (carried to T9): close end/pause overlays or guard pending hook before awaiting onBeforeLevel/onLandComplete (double-click «Дальше» during async outro)
Task 7: minor (carried to T8): replaceSave should normalize its argument, refresh home preview, and keep a backup of the previous save
Task 7: minor (deferred): broken-key timestamped copies can pile up across reloads; home preview not rebuilt on difficulty change; economy-sim passes dead levelIndex; toMap missing click sound
Task 7: complete (commits c4dbf4c..dd54dd1, 1 Important ruled to T10)
Task 8: dispatched (base dd54dd1)
Task 8: implemented 6f00454 (implementer ab0d5620fd7bde855); review dispatched
Task 8: minor (carried to T9): replaceSave proceeds if backup setItem throws — must return false instead; second replace overwrites only backup
Task 8: minor (carried to T9): «Звёзд собрано» sums all difficulties while level buttons show current difficulty — clarify label; difficulty <small> captions 16px → ≥18px
Task 8: minor (deferred): stone vs gold border contrast; 4-col grid overflows <340px; mosaic numbers 16/14px; redundant setDifficulty call; aria-disabled on section; old name in dev tools pages; locked note never clears
Task 8: complete (commits dd54dd1..6f00454, review clean)
Task 9: dispatched (base 6f00454)
Task 9: implemented aa33d41 (implementer abcfe3d91b5f77258)
Ruling: T9 prologue and current land's intro play once for any save where they're unseen, including migrated saves (implementer had suppressed them for saves with results — the father would never see the story) — cost if wrong: an extra short scene once for a returning player.
Ruling: T9 «Пропустить» in «История» replay ends the whole sequence.
Task 9: fix (ruling) 8dfff60
Task 9: minor (deferred): replaceSave assigns state.save before persist — on persist failure message «Прежний прогресс не изменён» inaccurate for session
Task 9: minor (deferred): story finish() not try/finally; skip on outro/prologue ends only that scene outside replay; no automated tests for re-entrancy/replay/replaceSave failure; transfer screen should say «Текущий прогресс будет заменён»
Task 9: complete (commits 6f00454..8dfff60, review clean)
Ruling: T10 Firefox — user approved installing Playwright + its Firefox build into a scratch dir (not the project).
Task 10: dispatched (base 8dfff60)
Task 10 step 4: deploy target found via Vercel MCP — project sun-treasures (team_KccoiWOYeRG0zwsVPL3nt0Ya), production domain https://sun-treasures.vercel.app; README line to be added in the T10 follow-up dispatch. No deploy without user OK.
User 2026-11-06: do not deploy anywhere for now; father hasn't played yet (no old save on his side).
Task 10: verification done (Firefox+WebKit via Playwright, http+file://, muted): scenarios 1–6 PASS; tests 108/108; bot check exit 0; greps clean
Task 10: defects D1 stone-tex 404 in css/*.css, D2 buttons 52–54px, D3 390px horizontal overflow, D4 stars text contrast — fix dispatched (a0a57abf2ab010634) with README deploy line
Task 10: fix 9d049be (D1–D4 resolved; Playwright 9/9 Firefox+WebKit muted; tests 108/108)
Task 10: complete (commits 8dfff60..9d049be)
Final review (opus): With fixes — Important: replaceSave assigns before persist; no import warning; end-of-land outro can be lost; gold «Играть» always starts 1-01. Minors: README drift, duplicate-color-goal parity trap, «Дальше» on replayed last level.
Ruling: import requires a confirming second click on the same button («Да, заменить прогресс»), plus 2-deep backup (backup, backup-prev) — no system dialogs per constraints — cost if wrong: one extra click.
Ruling: with progress, gold primary = «Продолжить», secondary = «Начать с начала» (starts 1-01, keeps progress) — cost if wrong: label tweak.
Final fix wave dispatched (adf7acd9eaec28853), incl. Chromium Playwright pass
Final fix wave 8d8e8c4: re-review — all 7 addressed, no new Critical/Important.
Final: parked — import double-click can arm+confirm in milliseconds — Ruling: parked for phase 2 (import is a rare, son-operated action; warning text + 2 backups remain) — cost if wrong: a fast double-click replaces progress without seeing the confirm label (recoverable from backup key manually).
Final: parked — backups are write-only (no restore UI); missing scene lines would re-queue — Ruling: deferred to phase 2.
Phase 1 complete.
