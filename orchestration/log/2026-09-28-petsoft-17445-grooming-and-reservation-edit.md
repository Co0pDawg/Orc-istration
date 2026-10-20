# Petsoft 17445: grooming (17517, PR 6048) and Reservation Edit (17522, PR 6049)

| # | Agent | Model | Purpose | Tokens | Tool uses | Min | Result | Rating |
|---|---|---|---|---|---|---|---|---|
| 1 | builder | opus | Grooming tests + refuter rework batch (resumed) | 578,708 | 39 | 34 | 8 tests, 3x green, mutations | earned |
| 2 | builder | opus | Grooming pre-PR fix batch (resumed; delta) | ~69,000 | 36 | 51 | 7/8 items applied, 8/8 green | earned: -59 net lines |
| 3 | refuter | opus | Reservation Edit review 1 | 166,214 | 49 | 10 | REWORK: the 15226 past-date step passed only because of fixture data | earned: caught a false product claim |
| 4 | builder | opus | Reservation Edit rework (resumed) | 329,352 | 19 | 13 | all MUST applied, leftover reservation canceled | earned |
| 5 | refuter | opus | Reservation Edit review 2 | 124,399 | 21 | 11 | ACCEPT; rerun hit app overload | marginal: static pass enough |
| 6-9 | pre-PR x4 | session | Grooming review (code, playwright, simplifier, comment) | ~586,000 | 106 | 16 | 14 findings, 11 fixed | earned: helper duplicates the refuter missed |
| 10-13 | pre-PR x4 | session | Reservation Edit review | ~420,000 | 42 | 8 | 8 findings, 3 fixed | marginal: small diff, little found |

## Totals
Subagents: about 2.27M tokens. Fable context: about 60k at the post-compaction start, about 200k at writing.

## Loop signal
- The first refuter caught a test that asserted a fixture artefact: new orgs have no price on past dates. This is worth adding to the spec template: "confirm the refusal comes from a product rule, not from the org's age or data."
- The pre-PR comment-analyzer found reuse misses (ParentReservationPage members) that the builder and refuter didn't. The builder spec should say to grep the sibling page class for the same locator before adding one.
- The shared :7099 app under parallel load produced timeouts in shared helpers three times, never in new code.

## Spec misses
- 17522 spec asked for a past-date refusal the product does not have (Bug 17525).
- Neither spec listed ParentReservationPage/ItineraryServicePage as reuse candidates.
