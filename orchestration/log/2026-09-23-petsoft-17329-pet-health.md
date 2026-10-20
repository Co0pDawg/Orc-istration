# 2026-09-23 Petsoft — 17329 plan 5: Pet Health Records (PetHealthTests)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | pet health markup ids (6 tabs, org settings) | 78,056 | 45 | 3 | ids correct; seed claim (Rabies+Bordetella@30) from the demo proc, contradicted the researcher | earned |
| 2 | researcher | sonnet | warning view rule, seed, incidents, allergies encoding, vet model | 77,382 | 35 | 2 | rule cited exactly; seed from signup model (3 types@60); flagged grace days unused | earned — the alert-window test design came from this |
| 3 | builder | opus | Tasks 1-7 (2 page objects, 4 tests, docs) | 234,215 | 71 | 22 | 13/13 twice, own mutation; found the warning renders as a chip, not the icon | earned |
| 3b | builder (resumed) | opus | 3 must-fixes + 11 review items in one dispatch | ~25,000 | 14 | 6 | 13/13 | earned |
| 4 | refuter | opus | static + reruns + mutation | 162,060 | 54 | 11 | REWORK: textarea-breakout payload, reset in Arrange, XMLDoc → ACCEPT | earned — the allergies catch made an unfalsifiable test falsifiable |
| 5-8 | pre-PR agents (2 opus, 2 sonnet) | mixed | 4 reviewers | 450,000 | 71 | 8 | 12 findings, 10 fixed, 2 wont-fix | earned |

Fable inline: plan (~450 lines), worktree + app restart (old develop worktree was gone), UAT 13/13 + 4/4 rerun, PR description, commit/push/draft PR.

**Totals:** 8 dispatches (+1 resume), ~1.03M agent tokens, 290 tool uses, ~52 agent-min. Wall ≈ 2.5 h.

**Loop signal:** builder → refuter REWORK → one combined builder dispatch (refuter + reviewer items) → refuter ACCEPT. Batching the reviewer findings into the same builder round saved a full cycle versus the earlier plans.

**Spec misses (Fable's):**
- Wrote the overview warning locator against the syringe icon; the Overview view sets RenderStatusIcons=false and shows a system-tag chip. A scout question on the actual Overview partial (not the shared _CustomerPet) would have caught it.
- Allergies XSS check with the script INSIDE a textarea is unfalsifiable; the refuter caught it. Rule: an injection test's payload must escape the containing element.
- The restore-in-finally pattern is not enough for org-wide edits on a cached org; reset in Arrange too.
- Two agents (scout/researcher) gave different vaccination seeds because they read different provisioning paths; the plan correctly deferred to a DB query, which is the right default whenever seeds differ by path.
- Session start: bug 17372 was picked up under /start before Cooper redirected; cost = one builder dispatch stopped early (~10 min) and a paused checklist on the ticket.
