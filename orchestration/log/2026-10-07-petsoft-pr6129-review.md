# PR 6129 review + test (#17738 item images)

| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | build, tests, live walk on DB copy | 128k | 48 | 15 | all green, 7/7 steps PASS | earned - live proof incl. cross-org 404, EXIF |
| code-reviewer | session | review | 95k | 6 | 1.1 | 7 findings | earned - both issues |
| silent-failure-hunter | session | review | 86k | 9 | 1.1 | 5 | earned - corroborated issues |
| playwright-reviewer | session | review | 79k | 4 | 1.0 | 8 | earned - real coverage gaps |
| type-design-analyzer | session | review | 86k | 5 | 0.6 | 3 | marginal |
| comment-analyzer | session | review | 94k | 6 | 0.8 | 1 nit | marginal |
| code-simplifier | session | review | 78k | 6 | 0.6 | 2 | marginal |

Totals: ~518k reviewer tokens + builder. Fable context: start ~45k, end ~95k.
Loop signal: full tier (product code); later review/CI catches unknown.
Spec misses: builder could not run KmsDbTool on copy (SQL72045 drift on dbo.Message); applied 4 objects by hand.
| builder (fix) | opus | fix bugs 1+2 | 92k + 110k resume | 52 | 14 | bug 2 red/green; bug 1 reorder, no test (in-memory not atomic) | earned |
Fix loop: refuter skipped, Fable read 3-file diff; full Tests run once 4206/0.
