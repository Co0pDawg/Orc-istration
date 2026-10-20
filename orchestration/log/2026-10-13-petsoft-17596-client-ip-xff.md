# 2026-10-13 Petsoft Bug 17596: client IP trusts client-sent X-Forwarded-For (/start)

| # | Agent | Model | Purpose | Tokens | Tools | Min | Result | Value |
|---|---|---|---|---|---|---|---|---|
| 1 | Explore | inherit | Hosting topology, callers, tests pinning XFF | n/a (not in notification) | ? | ~3 | All hosted = Linux App Service, vm-deploy gone, "kuzu" = Kudu, test list | earned: decided the approach |
| 2 | builder | opus | Implement spec (helper, yml, launchSettings, tests, docs, live check) | 131,208 | 48 | 13.0 | DONE; mutation 6 fails; live check via MarketingCampaignTrace | earned |
| 3 | refuter | opus | Static refute | 123,279 | 22 | 4.2 | ACCEPT; Front Door caveat taken | earned (Front Door sentence) |
| 4 | code-reviewer | inherit | pre-pr-review | 119,727 | 23 | 2.9 | 0 findings | marginal: refuter already covered |
| 5 | silent-failure-hunter | inherit | pre-pr-review | 113,543 | 20 | 2.2 | 2 (missing env var warning, UAT strikes) | earned |
| 6 | comment-analyzer | inherit | pre-pr-review | 115,477 | 15 | 2.5 | 1 pre-existing | marginal |
| 7 | playwright-reviewer | inherit | pre-pr-review | 97,404 | 14 | 2.3 | 2 (UAT strike skip, launch-profile wording) | earned |
| 8 | code-simplifier | inherit | pre-pr-review | 80,263 | 5 | 0.6 | 1 nit | marginal |

Totals: ~781k subagent tokens (excl. Explore); 8 dispatches. Fable context at start / at writing: not captured (status line not read).
Loop signal: full tier (product code + pipeline config + security path). Full panel found 2 real warnings the refuter missed (UAT pipeline runs the strike tests against a hosted host; silent misconfiguration). Tier choice justified.
Spec misses: spec did not ask which pipelines run SecurityTests against hosted envs (should have, given the XFF trick's dependence on topology); spec's "$env:...=false" live-check recipe was wrong (launch profile overrides shell env).
