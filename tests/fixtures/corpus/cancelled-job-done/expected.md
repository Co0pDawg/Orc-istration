# Expected findings: cancelled-job-done

| Id | Lane | File | Lines | Defect |
|----|------|------|-------|--------|
| E1 | silent-failure-hunter | src/jobs/exportJob.js | 12-14 | A failed batch is caught and logged at debug level only, then the job is recorded as `done` |
| E2 | code-reviewer | src/jobs/exportJob.js | 9, 15 | A cancelled run (the `break` on an aborted signal) is recorded as `done` with a finish time |
