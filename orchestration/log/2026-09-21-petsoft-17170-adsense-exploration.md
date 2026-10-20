# 17170 AdSense exploration

- Date: 2026-09-21
- Project: Petsoft
- Branch: feature/17403-nightly-uitests-failures (read-only work; no branch created for 17170)
- Task: #17170 Ad Placement Suggestion, AdSense, Proprietary Pipeline (parent story 17148). Exploratory: is AdSense viable in the Pet Parent Portal, and where could slots go.
- Outcome: partial. Research only, no code. Placement shortlist and blockers reported; no build or test run applies. Several AdSense policy specifics remain UNVERIFIED.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | Parents-area layout, full-page view inventory, CSP, consent/tracking, per-org toggle pattern | 73,693 | 30 | 2.7 | 44 pages classed; shared _Layout; NO CSP; no consent banner; GTM unconditional | earned - shared layout + no CSP + no consent reshaped the whole recommendation. Part (e) was a guess ("likely OrganizationSettings"), not a location |
| 2 | researcher | sonnet | AdSense policy for login-gated multi-tenant portal, official sources only | 72,425 | 31 | 4.7 | Crawler login needs literal credentials, no scoping; certified CMP for EEA/UK/CH; nonce-based CSP; 6 items UNVERIFIED | earned - crawler-login finding is the go/no-go driver. Marked unconfirmed items honestly instead of filling from blogs |
| 3 | fable | fable | Ticket + parent fetch, user scoping question, one grep confirming no CSP/consent | - | 5 | - | Both work items blank; scout's two key claims confirmed | earned |

## Totals

- Subagent tokens: 146,118 across 2 dispatches; ~7.4 min wall clock, run in parallel (~4.7 min elapsed).
- Fable context: unmeasured - no status line or /context reading is available to the model in this VSCode session. Record fails the format on this line; needs a user-side reading.

## Loop signal

No builder/refuter loop; read-only task.

## Spec misses

- Scout brief asked for "do not propose designs" yet the report ended with placement recommendations (Review step, checkout). Ignored, no cost, but the Do-not line did not hold on haiku. Consider "report ends after section e" as an explicit stop.
- Scout item (e) asked for a setting table/column and got ViewBag names plus a guess. A locations-only agent should have been told "say NOT FOUND rather than likely".
- Scout wrote its scratch file to a different name than the one given (`-findings.txt` vs `.md`).
- Researcher brief had 8 sub-questions; official-page fetches failed to surface full text for b, c, f. Narrower brief (a, d, e, f only) would have confirmed more per token.
