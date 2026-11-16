# Grill

Adapted from mattpocock-skills (MIT), `productivity/grilling` 1.3.1. License: [LICENSE-mattpocock-skills.txt](LICENSE-mattpocock-skills.txt).

**Arguments:** the plan file to grill. With none, use the plan this session is working from; if there is none, ask for its path.

Interview the developer relentlessly until you reach a shared understanding of the plan. Map it as a **design tree**: every decision branches into the decisions that hang off it.

## Rounds

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, then wait for the answers before the next round.

Each round goes through the tool's question prompt (in Claude Code, `AskUserQuestion`), never only as prose:

- At most 4 questions per call. A frontier larger than 4 takes consecutive calls in the same round.
- Each question carries your recommended answer as its first option, labelled with "(Recommended)", plus the real alternatives. Word it so picking the first option accepts your recommendation.
- Put the context a question needs (what it decides, what each option costs) in the question and option descriptions, so the developer can answer without scrolling back.

Each round the developer answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

## Facts versus decisions

Finding _facts_ is your job, never the developer's. When a frontier question needs a fact from the environment (the codebase, the database, a ticket, a doc), find it with a grep or dispatch a subagent (`scout` for locations, `researcher` for how something works); never ask the developer for anything you could look up yourself. Don't block on it: a running lookup is an unsettled prerequisite, so only the questions downstream of it wait for the report; ask the rest of the frontier now. The _decisions_ are the developer's: put each to them and wait.

## Done

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Then ask one last question whether you have reached a shared understanding. Do not act on the plan until the developer confirms; if they name something still open, it goes back on the frontier.

## Output

Append a `## Decisions` section to the end of the plan file: one bullet per settled decision, the question in a few words and the answer chosen, and "(developer)" or "(fact: <source>)" for how it was settled. A plan that already has a Decisions section gets the new bullets added to it, never a second section. Report the plan path and the number of decisions added.
