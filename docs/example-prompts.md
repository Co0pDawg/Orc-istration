# Example prompts

Real prompts kept as examples of how to brief the orchestrator. Voice-dictated originals are cleaned up for wording and layout; the asks are unchanged.

## Feature request: practice sprints and interview-machine onboarding

Given on 2026-11-21 in a session on a job-search app. It asks for a spec first, names two separate deliverables and says where the results should show up, and it leaves the gaps for the orchestrator to find and ask about.

> Next feature for the app: practice projects.
>
> We built a sprint mode with a 45-minute default. I want to be able to practice it and have the results stored on a page below the Practice tab: timings, completions and the other statistics you would want from a technical interview where they let you use Claude Code.
>
> Separately, I want an onboarding process. Say an interviewer gives me a machine with Visual Studio and the Claude app installed. I should be able to hand Claude the repository link, have it set itself up, and get going on a sprint immediately, following the proper process.
>
> Let's spec it out and fill the gaps.
>
> Also record this prompt and its starter prompt separately, so I can use them as examples. Fix the formatting, since this was all voice intake.

What the orchestrator asked before speccing (one several-question prompt): which repo the onboarding link points at, where practice exercises come from, what the prompt record should hold, and where to save it.

## Codex practice exercise

This standalone Node.js 22 exercise adapts the practice-project request above into a local CLI. Use the following brief in a disposable project.

> Build a CLI that records practice sprint attempts in a local JSON file. Use Node.js built-ins. Support `node sprint.mjs add "API exercise" 25 completed` and `node sprint.mjs summary`.
>
> - AC-1: Record a title, elapsed whole minutes (positive), and completed or incomplete outcome.
> - AC-2: Records persist across CLI invocations.
> - AC-3: Summary reports total attempts, completed attempts, and average elapsed minutes to one decimal place. No attempts reports zero.
> - AC-4: Invalid input exits nonzero and leaves the store unchanged.
>
> Keep the exercise to the CLI and local storage. Write tests in `sprint.test.mjs` and run `node --test sprint.test.mjs`.

From the Orc-istration checkout, run `node tools/orc.mjs build --tool codex`. For the tested setup, use the instructions from `dist/codex/.codex/agents/builder.toml` in a Codex CLI session with the brief. In a fresh Codex CLI session, give the refuter the instructions from `dist/codex/.codex/agents/refuter.toml`, the same brief, and the implementation diff. Ask the refuter to run the tests, check each acceptance criterion, and return `ACCEPT` or `REWORK` with evidence. After any fixes, rerun the independent review and read the final diff.

In the separate-session trial, all three initial tests passed. The refuter reproduced an AC-2 failure where overlapping saves could both exit successfully while one attempt disappeared. The builder serialized writes and added a concurrency regression test. The refuter returned `ACCEPT`, all four tests passed, and a replay against a store seeded with 100,000 attempts verified that all eight overlapping saves persisted.

### Native Windows execution checks

The standalone Codex CLI 0.172.0 loaded both generated roles from a trusted exercise project's `.codex/agents/`. With `multi_agent_v2` and `multi_agent_v2_dynamic_tools` enabled, `collaboration.spawn_agent` selected `builder` and `refuter` by exact `agent_type`. Both agents independently read the requirements. Use `fork_turns: "none"` to start a fresh role context and include the spec path in each brief. A launch that tried to fork the ephemeral parent failed because the parent rollout was unavailable.

In the same-session workflow check, the named builder retained the existing CLI candidate and added a test for the storage path override. The named refuter independently ran all seven tests and returned `ACCEPT`. The orchestrator inspected the files, reran the seven tests on Node.js 22.23.2, and checked the CLI against a sample attempt. A second named refuter ran the same green suite and then returned `REWORK` for an AC-3 rounding error. Six 1-minute attempts and eighteen 2-minute attempts displayed 1.7 minutes for an exact average of 1.75. The named builder switched to integer arithmetic and added a regression test. A fresh named refuter returned `ACCEPT` for the fix after all eight tests passed and a separate replay displayed 1.8 minutes.

The initial runs used the sandbox-off mode. The bundled CLI (0.171.0-alpha.13) failed to start the workspace-write shell because its app runtime provisioning service was unavailable. The standalone CLI's unelevated Windows sandbox probe failed at shell startup because its registered Core process had no package identity.

On the same Windows 11 host, standalone Codex CLI 0.172.0 passed the explicit Microsoft Execution Containers (MXC) workspace probe. To reproduce the compatibility check from the exercise directory, run this command and check that it prints `MXC_OK` and exits with code 0.

```powershell
codex -c windows.sandbox=mxc sandbox --include-managed-config --permission-profile :workspace -- cmd.exe /d /c echo MXC_OK
```

For the exercise session, use `codex exec --ephemeral --sandbox workspace-write -c windows.sandbox=mxc` with the named-role flags above. This selects MXC for that invocation. A PowerShell probe wrote and read back a file in the exercise directory and received access denied when writing to its parent. The [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox#mxc-compatibility) covers host compatibility and managed policy.

Run the exercise tests with the test process's `TEMP` and `TMP` pointing inside the exercise directory. The default Windows temp location produced file rename errors in the sandbox. With workspace-local temporary files, the named builder, named refuter, and orchestrator each passed all five tests under explicit MXC, including the overlapping-write and rounding regressions. The refuter returned `ACCEPT`.

## Starter prompt: interview machine

The prompt to paste into Claude Code on a machine that has only an editor and the Claude app. Claude follows [`interview-machine.md`](interview-machine.md): it checks the prerequisites, clones the repo to `<clone>`, runs `node "<clone>/tools/orc.mjs" install --tool claude-code --sprint-kit --home "<home>"` from the exercise folder (so it detects the stack; or with `--stack`) as a dry run and then with `--apply`, and verifies with `status`. Without Node it takes the doc's no-Node path instead.

> Set up from https://github.com/Co0pDawg/Orc-istration: clone it outside `~/.claude`, follow `docs/interview-machine.md`, and tell me in one line when the sprint kit is installed and verified. Back up anything you replace and do not touch anything outside my user profile.
>
> Then start a 45-minute sprint in `<path to the exercise folder>`. The task: `<paste the interviewer's task>`.

Replace the two placeholders. Give the minutes if the interviewer sets a different clock ("a 60-minute sprint"). If Claude asks for a fresh session after the install (step 5 of the doc), open one in the exercise folder and paste the second paragraph there. Afterwards, ask Claude to clean up as the doc's last step says: `uninstall --apply` (it deletes only the backups the output names as kit copies and shows you any other), then delete the clone.
