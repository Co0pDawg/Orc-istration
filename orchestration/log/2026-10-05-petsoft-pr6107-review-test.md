# PR 6107 review + test (2026-10-05)
| Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| refuter | opus | static review of 23-file diff | 124k | 14 | 2.9 | ACCEPT, 3 suggestions | earned: proved -Check w/o Python, hash stamps, dark-mode specificity |
| builder | opus | live test of PR's 7 How-to-Test steps | 95k | 35 | 14 | 7/7 PASS | earned: Staging cache header, Lighthouse, GTM counts |
Totals: 219k subagent tokens. Fable context: not captured.
Loop signal: full tier (product code); single refuter used as reviewer instead of /pre-pr-review panel (teammate PR). Nothing missed known yet.
Spec misses: `~marketing` filter also matched orgmarketing suite (one cold-login flake, passed on rerun).
