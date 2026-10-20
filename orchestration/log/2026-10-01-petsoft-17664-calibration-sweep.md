# 2026-10-01 petsoft: pre-PR review calibration sweep (Task 17664, draft PR 6084)

Analysis (/calibration-report aggregation, 187 logs / 3,433 rows) ran inline by Fable via calib.ps1. All dispatches below ran on Opus 5.5 (builder roster agent or general-purpose inheriting the session model).

| # | Agent | Purpose | Tokens | Tools | Min | Result |
|---|---|---|---|---|---|---|
| 1 | builder | Apply calibration agent-definition edits | 123,217 | 39 | 3.0 | earned - applied all approved recommendations |
| 2 | golden | Golden case kms-13995 | 155,986 | 16 | 2.0 | marginal - runner read the case early; rerun blind |
| 3 | golden | Golden case pet-16098 | 105,987 | 10 | 2.3 | earned - exposed the unreachable-catch recall gap |
| 4 | golden | Golden case kms-12491 | 119,542 | 24 | 4.2 | earned - drove must-find refresh |
| 5 | golden | Golden case pet-15466 | 89,749 | 8 | 1.0 | earned - caught XFF self-dismissal |
| 6 | golden | Golden case petsoftdocs-lastmod | 84,984 | 6 | 0.6 | earned - exposed the pipeline-output gap |
| 7 | golden | Baseline golden case pet-16098 | 100,808 | 9 | 1.6 | earned - proved the gap pre-dates the sweep |
| 8 | golden | Golden case pet-16485-aaa | 105,171 | 12 | 0.9 | earned |
| 9 | golden | Golden case pet-10339-aaa-newfile | 77,505 | 6 | 0.7 | earned |
| 10 | golden | Golden case pet-17131-moved-base | 93,483 | 8 | 0.5 | earned |
| 11 | golden | Blind rerun pet-16098 | 105,820 | 11 | 1.3 | waste - rule pointer leaked the answer; rerun |
| 12 | golden | Golden case pet-17290-error-page | 94,808 | 12 | 1.2 | earned - new case validated |
| 13 | golden | Golden case pet-16111-docmap | 107,655 | 19 | 1.8 | earned |
| 14 | golden | Golden case pet-10339-lead-enforcement | 92,922 | 10 | 1.7 | earned |
| 15 | golden | Final rerun pet-15466 | 91,332 | 8 | 1.6 | earned - verified carve-out |
| 16 | golden | Blind rerun kms-13995 | 191,345 | 27 | 4.1 | marginal - needed only because the first run was not blind |
| 17 | golden | Final blind rerun pet-16098 | 110,720 | 14 | 2.1 | earned |
| 18 | golden | Baseline blind lastmod on develop | 90,032 | 8 | 0.9 | earned |
| 19 | golden | Blind lastmod with new SFH section | 88,314 | 9 | 1.2 | earned |
| 20 | review | code-reviewer on calibration PR | 88,791 | 6 | 1.2 | earned - 11 findings, real contradictions |
| 21 | review | comment-analyzer on calibration PR | 93,181 | 8 | 1.6 | earned - 9 findings incl. stale case note |
| 22 | builder | Fix calibration PR review findings | 92,254 | 8 | 1.8 | earned |
| 23 | golden | Rev2 golden petsoftdocs-lastmod | 88,745 | 8 | 1.0 | earned |
| 24 | golden | Rev2 golden pet-10339-lead-enforcement | 92,452 | 12 | 1.3 | earned |
| 25 | golden | Rev2 golden pet-16098 | 105,044 | 11 | 1.8 | earned |
| 26 | golden | Rev2 golden pet-16485-aaa | 104,260 | 8 | 1.2 | earned |
| 27 | golden | Rev2 golden pet-15466 | 91,589 | 8 | 1.2 | earned |

## Totals

- 27 dispatches, 2,785,696 tokens, 325 tool uses, 44 agent-minutes.
- Golden runs: 23 dispatches, 2,388,253 tokens (85%). Waste/marginal reruns: about 0.40M.
- One golden notification (first blind rerun of petsoftdocs-lastmod) carried no usage figure and is not counted.
- Fable context: not captured at task start (session was compacted mid-task); ~230k at writing.

## Loop signal

- Review tier: full (docs-only diff, but rule text decides future reviews, so code-reviewer + comment-analyzer ran). It earned its cost: 17 findings, all real, several were contradictions the golden cases could not see.
- Golden cases are the expensive part (~90-190k each). The two non-blind runs and the leaked-pointer run cost ~0.40M; the BLIND RULE in the brief fixes it.

## Spec misses

- First rule edits were written without checking them against House conventions and Diff scope; the PR review caught the contradictions. Next sweep: have the builder diff each new rule against the Shared Review Rules before golden runs.
- A rule that cites its own golden case leaks the answer. Never point a rule at a case.
