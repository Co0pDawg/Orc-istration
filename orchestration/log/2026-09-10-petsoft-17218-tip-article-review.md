# 17218 Tip Adjustments article — pre-PR review (PetsoftDocs PET-17218_TipAdjustmentsArticle → main)

Date: 2026-09-10
Project: PetsoftDocs (reviewed with the Petsoft repo's pre-pr-review 2.3.2)
Branch: PET-17218_TipAdjustmentsArticle (no commits; working-tree diff against merge-base)
Task: run `/pre-pr-review` on the new Tip Adjustments article (EN + ES) and two FAQ entries. Article authored inline by Fable earlier in the session (4 files, ~160 lines) — no builder/refuter loop; this record covers the review dispatches only.
Outcome: report delivered, needs changes (2 issue / 4 warning / 3 suggestion / 3 nit); fixes pending Cooper's go-ahead. Site build + related-links validator green.

| # | Agent | Model | Purpose | Tokens | Tools | Time | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | code-reviewer (general-purpose) | fable (session) | frontmatter/links/glossary/Spanish consistency | 108,787 | 9 | 2.7 | 1 warning (por/para usted inversion), 1 suggestion, 2 nits; verified-clean list | earned — the por/para inversion flips meaning |
| 2 | comment-analyzer (general-purpose) | fable (session) | factual accuracy vs app source, translation fidelity | 133,918 | 27 | 5.3 | 2 issues (Credit Card Revenue report excludes gratuity — decompiled the journal and read the proc), 3 nits | earned — the only agent to catch that the reporting section is inverted |
| 3 | code-reviewer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~3 | 2 warnings (Paid-on-partial, refund-to-card vs retired device), 2 suggestions | earned — both warnings verified against sibling articles |
| 4 | comment-analyzer-gpt | gpt-5.6-sol | GPT mirror | n/a | n/a | ~6 | 1 issue (service fee omitted), 1 warning, 1 suggestion | marginal — service-fee point is fair; its warning asserted the opposite of #2's verified finding |

**Totals:** 2 Claude agents ≈ 243k tokens / 36 tool uses / 8 agent-minutes; wall clock ~6 min, fully parallel. 2 GPT mirrors, tokens unreported. Fable: ~45 direct tool calls across the whole task (ticket/guideline discovery, app-fact verification, authoring, build, review setup, one proc read to adjudicate #2 vs #4).

**Loop signal:** no builder/refuter loop. Review precision: 11 of 12 findings hold on verification; 1 false positive (#4's report-includes-tips warning). The two comment-analyzers contradicted each other on the same line; adjudicated by reading `p_rsCreditCardRevenue.sql` (Claude was right). The two mirrors again found non-overlapping things — GPT code-reviewer caught two real over-claims the Claude code-reviewer missed.

**Spec misses:** none in the dispatches. Authoring miss worth recording: the reporting section was written from the surcharges doc's "PAYMENT_AMOUNT is tip-inclusive" without checking the report proc — an inference about a report from a storage fact. Verify report claims against the `rpt.` proc, not the journal.

---

## Fix phase (same task)

Inline by Fable, no dispatch: 2 file rewrites + 1 sed, rebuild, log verdicts. 11 of 12 findings fixed, 1 false-positive (#4's inverted report claim), 1 wont-fix (validator, resolved by PR 5882). Rebuild green both locales.
