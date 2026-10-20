# PR 6183 review + test (Jackson's #17881 reservation edit hardening)

| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| code-reviewer (general-purpose) | opus | pre-pr-review | 244k | 62 | 9.1 | 2W 1N; Bulk Cancel antiforgery gap verified | earned |
| silent-failure-hunter | opus | pre-pr-review | 149k | 28 | 3.8 | 1I 4W 1S; RunDetails atomicity verified | earned |
| architecture-reviewer | opus | pre-pr-review | 172k | 44 | 5.4 | Cancel voids invoiced-stay invoice (confirmed live) | earned |
| comment-analyzer | opus | pre-pr-review | 174k | 31 | 3.6 | 2 stale-comment issues | earned |
| pr-test-analyzer | opus | pre-pr-review | 112k | 17 | 1.9 | 3W, duplicated RunDetails finding | marginal |
| playwright-reviewer | opus | pre-pr-review | 95k | 7 | 1.0 | 1 nit | marginal |
| type-design-analyzer | opus | pre-pr-review | 116k | 13 | 1.3 | no findings | waste (view models only) |
| code-simplifier | opus | pre-pr-review | 145k | 13 | 1.4 | 2S 3N | marginal |
| builder (live verify) | opus | How-to-Test + 4 specs + cross-tenant | 211k | 102 | 28 | all PASS after 2 blocks | earned |

Totals: ~1.42M subagent tokens; Fable context ~25k at start, ~95k at write.
Loop signal: full tier (product code, tenant, money). No refuter (teammate PR review). CI catch-later: unknown.
Spec misses (Fable): (1) assumed Petsoft_DEV schema matched the PR head; it lacked #17738 ITEM_IMAGE_ID. Check `sys.columns` for new columns in the PR's base, not just __SchemaVersion. (2) Didn't check port 7099 before dispatch (17897 app running). Both cost one builder round-trip each.
Also: PR head fails NU1903 against today's advisory feed; needed cherry-pick of 07bb9b77f.

## Fix loop (same day, after Cooper said "review and address these")

| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | spec A-I fixes + develop merge | 310k | 124 | 30 | done, 7 mutation checks | earned |
| refuter | sonnet (builder >300k) | static refute | 127k | 12 | 2.3 | REWORK: 547 replace-all hit 3 unrelated methods | earned |
| Fable inline | - | revert 3 hunks, JS-encode alert, rerun | - | ~10 | 10 | green after edit | earned |
| builder (live, resumed) | opus | live recheck of fixes | 230k | 15 | 8.5 | 6/6 PASS | earned |

Fix-loop totals: ~667k subagent tokens. Full runs once (Fable): Tests 6424, Core.Test 1782, 0 failed; targeted reruns after last edit green.
Spec miss: spec G named one method but the pattern appears 4x in KmsDbContext; say "only this method" when a fix pattern repeats in the file.
Review tier: full. Calibration trigger tripped (2423 vs 2096 marker).
