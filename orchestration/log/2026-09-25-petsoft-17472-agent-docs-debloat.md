# 2026-09-25 Petsoft #17472 agent docs debloat

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 1 | claude-code-guide | haiku (default) | Claude Code loading mechanics (nested CLAUDE.md, rules paths:, imports, skills, hooks) | 75,052 | 11 | 1.5 | 8 sourced answers | earned - set the whole design |
| 2 | researcher | sonnet | Industry conventions survey | 88,917 | 28 | 4.5 | converged patterns + UNVERIFIED gaps; one wrong number (~500 lines) fixed before attaching | earned |
| 3 | researcher | sonnet | Petsoft docs inventory | 96,369 | 23 | 5.8 | useful, but "1 MB of plans" missed .gitignore and sidecar spot-check undone | marginal - wrong premise cost a user question |
| 4 | researcher | sonnet | Classify superpowers plans | 54,123 | 9 | 1.0 | exposed that only 2 files are tracked | earned (caught #3's error) |
| 5 | builder | opus | Restructure per spec | 176,798 | 50 | 11.0 | PARTIAL: hook write denied by classifier | earned |
| 6 | refuter | opus | Review round 1 | 132,951 | 15 | 5.5 | REWORK: 8 must-fixes incl. review agents Read CLAUDE.md without import expansion | earned - real losses caught |
| 7 | builder (resumed) | opus | REWORK round 1 | 29,378 (delta) | 20 | 3.1 | all 10 fixed | earned |
| 8 | refuter | opus | Review round 2 | 107,790 | 12 | 1.8 | effectively ACCEPT (only flag = user-approved deletions not in its brief) | marginal - brief omitted the approved deletion |

Inline Fable work: calibration-log before/after analysis (the key evidence for keeping pre-PR criteria), headless `claude -p --model haiku` live test of path-scoped rule loading (3 sessions), ADO story + checklist.

## Totals
- Subagent tokens: ~761k across 8 dispatches (4 opus-tier).
- Fable context: start and end sizes not captured (no /context read this session) - gap.

## Loop signal
- One REWORK round, then accept. Refuter round 1 was the highest-value dispatch: it caught rules moved into path files whose globs never load at the point of need, and review agents Reading CLAUDE.md (an @import is not expanded by Read).

## Spec misses
- Spec did not consider where a rule's *subject file* lives (ReservationStayBaseModel in Core/Models, not Areas/Parents) - lesson: when moving a rule into a path-scoped file, glob on the files the rule governs, verified with git ls-files.
- Spec said "do not edit docs/internal/agents" without checking whether agents Read CLAUDE.md for content.
- Round-2 refuter brief omitted a user-approved deletion, producing a false must-fix.
- Hook files under .claude/hooks are refused by the auto-mode classifier as self-modification; spec hooks as drafts for the user to install.

## Round 2 (items 1-3 + PR)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 9 | claude (batch A) | opus | Golden cases kms-12491, kms-13995, pet-10339 x2 | 116,368 (last resume; earlier legs 87,609 + 89,381) | 34 | ~16 | no regression; pre-existing kms-12491 misses | marginal - handed back twice before its blind children finished |
| 10-12 | blind children of A | opus | Blind per-agent reviews | ~108k + 105k + (type-design n/a) | ~60 | ~6 | fed A's scoring | earned - blindness mattered |
| 13 | claude (batch B) | opus | Golden cases pet-15466, pet-16098, pet-16111 | 158,570 | 28 | 5.6 | pet-16098 miss | marginal - inline, non-blind review produced a noisy miss |
| 14 | claude (batch C) | opus | Golden cases pet-16485, pet-17131, petsoftdocs-lastmod | 121,350 | 16 | 2.4 | all pass | earned |
| 15 | builder | sonnet | Skill pointers on skills/agents-md-pointers | 103,674 | 50 | 3.7 | clean | earned |
| 16 | claude | opus | Blind code-reviewer rerun pet-16098 | 130,050 | 15 | 2.3 | 3/3 - resolved B's miss | earned |

Round 2 lessons:
- Golden re-runs: brief each batch to run reviews as blind subagents ONE at a time in the foreground; nested background children caused early hand-backs and blew the 3-Opus cap.
- A review subagent surfaced a real stale rule (Core CS8632 is suppressed) - golden runs are also a doc-accuracy check.

## Round 3 (hook install, map split, skills + docs trims)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 17 | builder | opus | Playwright map split | 235,131 | 36 | 9.4 | 200 KB -> 32 KB + gotchas file | earned |
| 18 | refuter | opus | Map split review | 164,476 | 32 | 4.1 | ACCEPT; tag cleanup applied inline | earned |
| 19 | builder | opus | Skills references + pointer swaps | 142,435 | 19 | 3.7 | clean | earned |
| 20 | builder | opus | Pet Parent + testing docs rules-first | 132,202 | 21 | 4.3 | 3 rules demoted to reference doc | marginal - demotions needed a fix |
| 21 | refuter | opus | Skills + docs review | 153,831 | 34 | 8.3 | REWORK: moved STOP gate, 3 demoted rules, stale section ref; fixed inline | earned |

Round 3 lessons:
- The hook live test found a gap the 25-case harness missed (`dotnet test .`): always live-test hooks in a headless session.
- "Move conditional steps to references" moved a STOP gate; spec must say gates stay in SKILL.md even inside conditional blocks.
- Splitting rules vs reference: the builder demoted "must preserve" behavior as description; spec the test as "would a change that breaks this be a bug?" -> rule.
