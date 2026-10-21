# 2026-10-21 · board · Peer review of v25-v30 (Time portal scale, entries scroll, marker, log fill, hide done)

This is the /peer-review shape adapted to a personal repo with no ADO PR. Score 244 (228 product lines + 64 test/doc lines, a quarter weight), tier M, no risk hits. Two parallel reviewers split the work by concern (runtime behaviour; STANDARDS, a11y and skins) and measured in headless Edge with iframe pages. Then one builder fixed everything, a refuter checked it, and Fable fixed one line inline. Result: board v31 live, main bfa31d7.

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| refuter | opus | Review: runtime behaviour | 175k | 39 | 20 | REWORK: 2 issues, 3 warnings | earned (fillLog never settled beside a full-width card; not refilled after Time; marker could not reach end entries; restore threw away calendar scroll) |
| refuter | opus | Review: standards, a11y, skins | 166k | 40 | 19 | REWORK: 2 issues, 8 warnings | earned (tooltip failed WCAG 1.4.13 and 1.4.10; Hide done label read backwards; reorder lost hidden cards' place) |
| builder | opus | Fix F1-F16 | 270k | 63 | 29 | DONE, 2 justified deviations | earned |
| refuter | opus | Refute the fixes | 166k | 24 | 9 | REWORK: 1 must-fix (stray Esc left the tip off) | earned |

Inline by Fable: the Esc guard (bfa31d7), verified by class state in a timed measurement page.

**Totals:** 4 dispatches, ~777k subagent tokens. Fable context at start and at writing: not captured.

**Loop signal:** this is the first peer review of Fable's own inline work. v26-v30 went out with no independent review, and the review found 4 issues that Cooper would have hit, 2 of them in fillLog, which was written and previewed on one default layout. Lesson: inline UI work still gets a reviewer pass before publish when it adds layout logic (loops, measurement), not only when a builder wrote it. Splitting by concern produced almost no overlap (one shared finding: the log's height controls). Headless Edge cannot advance CSS transitions under virtual time and fires no rAF or scroll events; reviewers who polyfilled rAF and dispatched scroll by hand still found real bugs. No pre-PR tier (personal repo).

**Spec misses (Fable, inline v27-v29):** (1) fillLog assumed a fixed point always exists; (2) the centre probe made the end entries unreachable; (3) the scroll restore fed back into follow; (4) a `::after` tooltip collided with the 1337 brackets (Cooper caught this one); (5) Esc dismissal set state unconditionally (caught by the refuter of the fixes).

**Not actioned:** S9 class-based hooks (`.tl` precedent); S13b stale hideDone ids; F10 two light palettes under 3:1 against one block each (the ring separates them).
