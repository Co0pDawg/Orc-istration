# Review regression corpus

A small set of diffs with known defects. Precision (`calibration.md`) shows when a lane reports too much; the corpus shows when a change to a lane, a role or the models makes the panel miss something it used to catch. `node tools/orc.mjs corpus` lists the cases and scores a run.

## When to run it

Run the affected lanes on every case that names them after any of these changes:

- a lane definition (`review/lanes/<lane>.md`), including a calibration fix (`calibration.md`, "Apply and verify");
- an explorer or verifier role (`roles/review-*.md`), the explorer contract (`review/contract.md`) or the shared rules;
- `models.json`, when it changes the model or effort of an explorer or the verifier.

A change that touches every lane (the contract, the shared rules, a model) runs every case.

## Case format

A case is a folder `tests/fixtures/corpus/<id>/` in the setup checkout, where `<id>` is lower-case words joined by hyphens. It holds three files:

- `case.md`: a `# <title>` heading, a `Lanes: <lane>, <lane>` line naming the lanes it exercises, then what it tests and what a lane has to do to catch it.
- `diff.patch`: the change under review, as `git diff` output. Keep it small and self-contained, with invented code: no project, product, company or person names, since the corpus is public.
- `expected.md`: the defects a correct run reports, as a table:

```markdown
| Id | Lane | File | Lines | Defect |
|----|------|------|-------|--------|
| E1 | code-reviewer | src/catalog/priceCache.js | 10-18 | <one-line defect> |
```

**Lines** is the range `a-b` in the new file's numbering (one number for a single line), or a comma list of them (`9, 15` or `9-9, 15-15`) when a reviewer could cite the defect at separate places, such as its cause and the line where the wrong result is written. Make the ranges cover every line a reviewer could reasonably cite for that defect, and keep two defects' ranges apart, so one finding cannot count for both. **Lane** is the lane expected to report it.

A new case comes from an escaped defect or a hard-won confirmed finding (`calibration.md`): rewrite the mechanism as fresh invented code rather than copying the project's diff.

## Procedure

1. **Set up the diff.** In a scratch repo, commit an empty base, branch, apply the case's `diff.patch` (`git apply`) and commit it. Push both branches to a local bare repo added as `origin`, since the procedure diffs against `origin/<BASE>`. The branch and its base are `TARGET` and `BASE` for the run.
2. **Run the lanes.** Run `review/PROCEDURE.md` on that branch with the case's lanes as scope filters, no ticket brief, and the tiers the change under test uses. Keep its Step 4 report as a file.
3. **Score.** `node tools/orc.mjs corpus score --case <id> --report <report file>`. It prints one line per expected row, `FOUND` (with the lanes that found it, and `(other lane)` when none is the expected lane) or `MISSED`, then each `EXTRA` finding no expected row matched. It exits 1 when anything expected is missed.
4. **Judge.** A missed expected finding blocks the change until it is explained: fix the change, or show why the case's expectation was wrong and fix the case in the same change. Read the extras: an extra that is a real defect belongs in `expected.md`; one that is wrong is a precision problem for the calibration report.

## Scoring rules

- Only bullets under the report's **Must fix**, **Review before submitting** and **Suggestions and nits** headings are findings. Questions, Runtime checks (which repeat findings) and Refuted by verification are not.
- A finding is scored only by a `path:line` (or `path:a-b`) location on its bullet line, with the path as the diff names it (`src/jobs/exportJob.js:15`). A finding with no location, or with a bare file name, matches nothing. Bullets may start `- [lane]` or `* [lane]`, at the start of the line; an indented bullet is a sub-item (an evidence or fix line), not a finding, and is skipped.
- A finding matches an expected row when one of its locations names the same file, with `\` and a leading `./` normalized, and its first line falls inside one of the row's ranges. A range counts by its first line only, so `file:1-999` does not match every row.
- The lane is shown but need not match: the panel caught the defect either way, and the merge rule in `PROCEDURE.md` Step 4 can move a finding to another lane's tag.
- An expected row counts once, however many findings match it. A finding that matches no row is extra.
