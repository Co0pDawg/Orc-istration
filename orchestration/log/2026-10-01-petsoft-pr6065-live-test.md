# PR 6065 live test (How to Test steps 1-6)

| Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|---|---|---|---|---|---|---|
| builder | opus | live-run the PR's 6 How to Test steps on Petsoft_DEV | 174,923 | 75 | 18.3 | 6/6 PASS, 1 minor finding (confirmed by code read) | earned: full live coverage incl. tampered POST |

Totals: 1 dispatch, ~175k subagent tokens, ~18 min. Fable context: not captured at start; small (~85k) at write.
Loop signal: no review tier (verification only, not a PR we author). No refuter: verification-only work, the finding was confirmed inline by Fable.
Spec misses: the brief's "next Friday" wording was ambiguous (10-02 vs 10-09); the builder picked 10-09, which was fine.
