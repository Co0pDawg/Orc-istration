# 2026-10-20 Petsoft #18025 shared avatars, PR 1 of 2 (Task #18027)

Grilled from handoff docs/superpowers/handoffs/2026-10-20-customer-pet-card-handoff.md (5 AskUserQuestion rounds), filed #18025 + #18026, /start -> plan mode -> builder -> refuter -> full /pre-pr-review. Branch feature/18025-shared-customer-and-pet-cards off feature/17983 (Cooper's call). GPT mirror declined.

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | researcher | sonnet | inventory card/pet surfaces for grilling | 62,885 | 14 | 14.9 | table of 18 surfaces | earned: disproved 2 handoff claims (no Dashboard JS renderer, no dashboard-card testid), found the fixed-76px size bug |
| 2 | Explore | opus (session) | plan-mode code facts for PR 1 | n/a (not reported) | n/a | ~4 | 10 facts | earned: found CustomerPetResult positional reader shared with p_CustomerReservations (pos 7 = ORGANIZATION_ID) |
| 3 | builder | opus | implement PR 1 | 233,799 | 130 | 74.7 | 3 commits, 44/44 unit, 15/15 PW after rerun, screenshots | earned: flagged the tag "+" before avatar layout bug from its own screenshots |
| 4 | refuter | opus | refute diff | 155,441 | 49 | 15.1 | ACCEPT (static) | marginal: build/run blocked by auto-mode classifier, so mutations/PW/post-fix shot could not run; 2 comment nits |
| 5 | builder (resumed) | opus | verification round the refuter could not run | 13,739 (delta) | 23 | 21.5 | mutations red, PW 3/3, post-fix shots OK | earned: cheap because it kept its context |
| 6 | code-reviewer | opus (session) | panel | 106,055 | 15 | 6.5 | 0 | marginal |
| 7 | silent-failure-hunter | opus (session) | panel | 87,744 | 7 | 5.4 | 1 suggestion | earned: PET_TYPE_ID missing from Pet ctor (3-agent agreement) |
| 8 | architecture-reviewer | opus (session) | panel | 109,455 | 16 | 8.8 | 1 suggestion + 1 question | earned: duplicate species map in onboarding (fa-dove) -> unified |
| 9 | type-design-analyzer | opus (session) | panel | 96,009 | 15 | 8.5 | 1 suggestion | waste: duplicate of #7 |
| 10 | comment-analyzer | opus (session) | panel | 101,375 | 7 | 3.0 | 0 | marginal |
| 11 | playwright-reviewer | opus (session) | panel | 87,597 | 6 | 2.5 | 0 | marginal |
| 12 | code-simplifier | opus (session) | panel | 82,351 | 5 | 1.6 | 1 nit | marginal: nit fixed |

Totals: 1,136,450 subagent tokens over 11 reported dispatches (Explore not reported); panel 670,586 = 59%. Full KennelManagementSystem.Tests run once by Fable (6936 pass / 0 fail, 5:28-5:36 PM, after the last product edit at 5:27 PM); filtered 44/44 and onboarding wizard PW after the review fixes. Fable context: ~15.00M remaining at task start, ~14.83M at writing (~175k used).
Loop signal: full tier (product code + 2 procs). Panel of 7 found 0 issue / 0 warning / 2 suggestion / 1 nit, all fixed; the refuter + builder had already covered correctness. For a refuter-ACCEPTed PR whose only schema change is an appended proc column, code-reviewer + architecture-reviewer + silent-failure-hunter would have found everything this panel did (~370k cheaper). No later review/CI catch known yet.
Spec misses: (1) plan said "avatar before the name link" but did not account for .tag-inline's order:-1 on the + button; caught by the builder's screenshots. (2) The plan didn't search for an existing species-icon map (OrganizationRules.cshtml); the architecture-reviewer found it. Grep for existing icon/label maps before speccing a new one. (3) Refuter brief should not depend on build/run when the auto-mode classifier may block it; run verification in the builder round instead.
Outcome: 6 commits pushed (6e06af958, 95e9f120f, c279c8818, f37f9377c, 93a9a24ef, 46d88a4d1). /draft-pr not run (Cooper tests first). PR 2 needs its own Task.
