# 2026-09-24 — Petsoft — 17329 plan 9: invite-code sign-up Playwright

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Value |
|---|-------|-------|---------|--------|-----------|-----|--------|-------|
| 1 | builder | opus | 6-task spec: 3 page objects, new suite, docs; run, 3 mutations, db checks | 199k | 64 | 20 | 5/5 green; one assertion left out (needed a page it could not edit) | earned |
| 2 | refuter | opus | rerun ×2 (idempotency after regenerate) + skip-VerifyEmail mutation | 134k | 33 | 7 | ACCEPT; 5 should-fixes (house SignOutAsync, XMLDoc gaps, assert order, latent agreement race) | earned |
| 3 | code-reviewer | fable | pre-PR | 106k | 8 | 2 | needs changes → 1 issue (Fable's own "Active" line), 1 nit | earned |
| 4 | playwright-reviewer | fable | pre-PR | 98k | 9 | 1 | same issue + 1 suggestion | earned (independent confirmation) |
| 5 | comment-analyzer | fable | pre-PR | 112k | 12 | 2 | approved; 1 suggestion, 1 nit fixed | marginal |
| 6 | code-simplifier | fable | pre-PR | 93k | 7 | 1 | approved; AnswerDialogAsync reuse applied | earned |
| 7 | builder (resumed) | opus | 4 should-fixes + rerun | 7k (delta) | 4 | 1.5 | 2/2 green | earned |

Totals: ~749k agent tokens, 77 tool uses, ~35 agent-minutes. Fable context: ~185k at task start, ~230k at writing.
Fable inline: ~20 fact-finding calls, spec, worktree, the develop-merge conflict fix on PR 6014 (Cooper's request: keep the map synced), one-line locator + assertion (which introduced the "Not Active" false pass — caught by two reviewers), XMLDoc/helper edits, PR draft.

Loop signal: refuter + first two reviewers ran in parallel (3 in flight) and the diff changed under them once — acceptable because the change was two lines; the refuter picked it up on its final run. Fable rebuilt UITests while the refuter had a test host in the worktree (no lock hit, but a rule breach — serialise next time).

Spec misses (mine):
- Told the builder it could not touch CustomerPortalPage, then asked for an assertion that needed a locator there → partial build; list every page a test may need as "may change".
- My own inline fix used ToContainText("Active") against a "Not Active" sibling value — the exact reason the substring-match rule exists. Rule: any status text assertion is an exact/regex match.
- Did not point at `LayoutBase.AnswerDialogAsync` / `AuthenticatedLayout.SignOutAsync` in the facts; the builder hand-rolled both.

- Verified only against local (develop) before drafting "manual text is wrong" notes; the UAT run (Release 114) showed the manual quotes the release copy and develop changed it. Rule: a copy-vs-manual discrepancy is checked against origin/main before it is called a test-case correction; assert classes/ids over copy where the page keys state off them.
