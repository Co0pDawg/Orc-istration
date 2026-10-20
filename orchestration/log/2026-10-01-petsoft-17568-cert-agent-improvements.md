# 17568 / 17592 Certificate Update Agent improvements (Petsoft + PetsoftCWSCertificateInstaller)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | Explore | inherit | installer repo map (origin/main) | 77.7k | 8 | 1.3 | full map | earned — drove the plan |
| 2 | Explore | inherit | Petsoft agent API map | 74.8k | 32 | 13.6 | full map + Retired-device hole | earned — found the security gap |
| 3 | Plan | inherit | design A+B+socket | 90.3k | 19 | 7.9 | plan | earned |
| 4 | builder | opus | installer 6 commits | 277.7k | 104 | 28.8 | DONE | earned |
| 5 | builder | opus | Petsoft filter + checkout + UITest (+resume after KmsDbTool) | 223.4k | 29+92 | 30.0 | DONE | earned |
| 6 | refuter | opus | installer round 1 | 176.1k | 23 | 6.2 | REWORK (3 must-fix) | earned — reboot sequencing, SYSTEM delete exploit |
| 7 | builder (resume) | opus | installer rework | ~30k delta (307.8k cum.) | 19 | 7.3 | DONE | earned |
| 8 | refuter | opus | Petsoft | 130.1k | 25 | 5.6 | ACCEPT + 5 should-fix | earned — poll overlap seed |
| 9 | refuter | sonnet | installer round 2 | 91.3k | 12 | 1.7 | REWORK (leaf link race) | earned — Fable fixed inline |
| 10-14 | pre-pr-review x5 | inherit | code/sfh/comments/playwright/simplify | 477k | 37 | ~2 each | 1 issue, 5 sugg | code-reviewer earned; playwright marginal (0); simplifier waste (DataRow false-positive) |
| 15-19 | GPT mirrors x5 | gpt-5.6-sol | same | n/a | n/a | ~15 | 1 issue (agreed), 1 failed | marginal — confirmed code-reviewer |

**Totals:** ~1.65M subagent tokens, 14 Claude dispatches + 5 GPT. Fable context at start ~45k; at writing ~280k.
**Loop signal:** full pre-PR tier (product code + device auth + payment JS). The review caught a real payment-path issue (overlapping poll failures) that the refuter had flagged only as a should-fix and that Fable's own polish had made only partly better. The full tier was justified.
**Spec misses:** (1) the spec did not say the ACL work must leave the shared parent ProgramData\Petsoft alone, so the builder re-ACLed siblings; (2) the spec asked "diagnosis is advisory; never block or delay the existing error flow" but the builder had to await 2 s, and the setInterval poll interaction was not called out; (3) local DB schema drift (CLICKED_DATE) was not checked before the Playwright dispatch.
