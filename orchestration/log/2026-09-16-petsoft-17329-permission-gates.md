# 2026-09-16 Petsoft — 17329 plan 2: Organization permission gates (Security suite)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | scout | haiku | map 11 permissions to nav ids, routes, controls; lockout + override mechanics | 98,376 | 35 | 4 | summary correct; claimed an overflow file it never wrote | earned — but the missing file cost two extra reads |
| 2 | builder | opus | Tasks 1-10 (page objects, base, 8 tests, map row) | 256,004 | 472 | 42 | 19/19 locally, 8 deviations all cited, own mutation check | earned |
| 2b | builder (resumed) | opus | 3 refuter should-fixes, edit-only then build+2 tests | ~10,000 | 70 | 4 | green | earned |
| 3 | refuter | opus | static + citations + reruns + mutation | 148,557 | 32 | 12 | ACCEPT static; REWORK on my should-fix #2 placement (assertion before the action, vacuous) | earned — caught a defect in its own suggested fix as applied |
| 4-7 | pre-PR agents (2 opus, 2 sonnet) | mixed | code-reviewer, playwright-reviewer, code-simplifier, comment-analyzer | 370,986 | 49 | 8 | 8 findings (4 sugg / 4 nit), all fixed | earned |

Fable inline: plan (~600 lines, from suite pattern + manual steps + scout facts), worktree, UAT run 19/19 (12 min), two one-line fixes, eight review fixes in one script, test-point marking (9 cases), commit/push/draft PR 5945.

**Totals:** 7 dispatches (+1 resume), ~884k agent tokens, 658 tool uses, ~70 agent-min. Wall ≈ 2.5 h, dominated by the 42-min builder run and two ~12-min full-class runs.

**Loop signal:** builder → refuter ACCEPT(static) → should-fixes → refuter REWORK(1 must-fix, my placement) → Fable fixed inline → no third refuter round (change was a 3-line move, verified by rerun). Right call.

**Spec misses (Fable's):**
- `/Facilities/Services/FacilityServices` assumed gated; it is not (ServicesController.cs:19 bare [Employees]). Should have grepped the attribute on the exact action.
- Employee list has no Name cell (Email/First/Last). I wrote a locator against a column I had not looked at.
- Permission display name on the group page differs from Identifiers.cs for Allow Pre-Payment Override (IdentifiersNotGenerated.cs:27). Rule: read the view that renders the label, not the enum.
- `SupportTicketListPage` is the customer-messaging list, not the Help-menu Assist list; AssistPage already had create + list. A scout question "which page object owns /Assist/SupportTickets" would have caught it.
- Refuter's should-fix #2 as I relayed it ("assert claim-expired absent before the override") was vacuous; I should have placed it after the action when relaying.
