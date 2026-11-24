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

In the trial, all three initial tests passed. The refuter reproduced an AC-2 failure where overlapping saves could both exit successfully while one attempt disappeared. The builder serialized writes and added a concurrency regression test. The refuter returned `ACCEPT`, all four tests passed, and a replay against a store seeded with 100,000 attempts verified that all eight overlapping saves persisted. The trial used separate Codex CLI sessions with the generated role instructions. Native dispatch by role name remains unverified in that environment.

## Starter prompt: interview machine

The prompt to paste into Claude Code on a machine that has only an editor and the Claude app. Claude follows [`interview-machine.md`](interview-machine.md): it checks the prerequisites, clones the repo to `<clone>`, runs `node "<clone>/tools/orc.mjs" install --tool claude-code --sprint-kit --home "<home>"` from the exercise folder (so it detects the stack; or with `--stack`) as a dry run and then with `--apply`, and verifies with `status`. Without Node it takes the doc's no-Node path instead.

> Set up from https://github.com/Co0pDawg/Orc-istration: clone it outside `~/.claude`, follow `docs/interview-machine.md`, and tell me in one line when the sprint kit is installed and verified. Back up anything you replace and do not touch anything outside my user profile.
>
> Then start a 45-minute sprint in `<path to the exercise folder>`. The task: `<paste the interviewer's task>`.

Replace the two placeholders. Give the minutes if the interviewer sets a different clock ("a 60-minute sprint"). If Claude asks for a fresh session after the install (step 5 of the doc), open one in the exercise folder and paste the second paragraph there. Afterwards, ask Claude to clean up as the doc's last step says: `uninstall --apply` (it deletes only the backups the output names as kit copies and shows you any other), then delete the clone.
