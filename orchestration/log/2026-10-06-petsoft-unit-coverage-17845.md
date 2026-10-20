# 2026-10-06 petsoft unit-test coverage round 7 (story 17845)

All builders ran on opus and all refuters on sonnet. Detailed token figures are in the session c24f041c task notifications. Every task followed the builder -> refuter -> cherry-pick loop.

| Task | Builder | Refuter | Result | Value |
|---|---|---|---|---|
| 17846 Customers Edit | 146k (+6k) | REWORK: delete pet list, DeleteCustomers permission readable via CustomAttributeData | 11->99%; 2 paths to 17843 | earned |
| 17847 Parents Settings | 130k (+3k) | REWORK: ChangeContactInformation controller branches | 14->75% | earned |
| 17851 Groups + holidays | 126k (+19k) | REWORK: delete-in-use via controller, mixed cases | 73->94 / 27->89%; HIGH cross-org group permission write (17843); new 17856 | earned: critical |
| 17848 Tag controller | 117k (+2k) | REWORK: SeedDefaults cache mutation survived | 0->100%, no bugs | earned |
| 17849 Schedules | 141k (+4k) | REWORK: sibling-facility pins false positive | 0->90% | earned (refuter prevented 2 false bugs) |
| 17850 Mobile account activity | 118k | ACCEPT | 30->72% | earned |
| 17852 Coupons + overrides | 147k | ACCEPT | ->100% / 100% | earned |
| 17853 Facilities lists/creates | 192k | ACCEPT | 0->79-91%; new 17857 | earned |
| 17854 PetEditModel | 139k | ACCEPT (confirmed PR 6123 does not cover model-bound ids) | 69->99.6% | earned |
| PR CI fix (inline, Fable) | - | - | ExtendClaim tests TZ-dependent; Posted() helper; 6128/6133/6146 green | earned: critical |
| review (2 agents) | 160k | PASS | no warnings | earned |

## Totals
About 26 dispatches including resumes, roughly 2.3M subagent tokens: builders ~1.4M, refuters ~0.75M, review ~0.16M. Fable context was not recorded. The user paused the run once, mid-round, to triage a CI failure.

## Loop signal
- Pre-PR review tier: **light + pr-test-analyzer** (test-only, refuted). No warnings, which matches the tier evidence.
- 5 of 9 refuters returned REWORK. Builders still claimed "untestable" or "private" where a cheap path existed (CustomAttributeData, the controller ctor pattern). They are getting fewer.
- CI caught what local runs cannot: the build agent runs in UTC, so Local-kind DateTimes passed locally and failed in CI. The brief now requires Kind Unspecified. Consider pinning TZ in the PR pipeline the way the deploy pipelines do.
- The bug dupe-check rule held. Almost every finding went to 17843 or 17586; only 17856 and 17857 are new.

## Spec misses
- The round-7 brief asked for "mixed cases with own tag on another org's customer" for TagController, which has no customer ids. The builder adapted.
