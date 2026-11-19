# A job that reports a cancelled run as done and swallows the failure

Lanes: silent-failure-hunter, code-reviewer

What it tests: misreported outcomes. When the signal aborts, the loop breaks and the job is still recorded as `done`; when a batch throws, the error is logged at debug level only and the job is again recorded as `done`. A caller or a user watching the job list sees a finished export that is partial or empty.

The failure-injection pass (silent-failure-hunter) should catch the swallowed error at the `catch`; the cancelled path needs following the `break` to the status write (code-reviewer, or silent-failure-hunter, whose lane covers misreported outcomes).
