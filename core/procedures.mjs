// The one catalogue of procedures the adapters turn into skills and commands. Each entry points at the tracked,
// tool-neutral file in the setup checkout that holds the procedure; an adapter renders a thin wrapper that finds the
// checkout, reads that file and follows it, plus the adapter's own notes for that procedure (adapters/<tool>.mjs).
// To add a procedure: write its neutral file, add an entry here, give each adapter that renders it its notes, then
// run `node tools/orc.mjs golden`.
//
// Entry: name (lowercase, hyphenated; also the slash name), kind (routine | workflow | review), title (the wrapper's
// heading), description (when to use it and when not), source {file, section?} (checkout-relative; section is a
// heading in that file), argumentHint (when it takes arguments), extras [{path, first?, about?}] (other checkout files
// it reads: `first` ones are read before the source, the others are named with what they are for).

// The one sentence every generated wrapper, both adapters' notes and the neutral procedures use to find the checkout.
export const checkoutLookup = (file) =>
  `Find the Orc-istration checkout: the "Setup checkout (this machine)" line in the rulebook's tool notes, else \`setupCheckout\` in \`~/.orc/config.json\`, else ask the user. Call it CHECKOUT and confirm \`${file}\` exists there; if it does not, stop and say so.`;

const WORKFLOW_README = { path: 'workflows/README.md', first: true };

export const PROCEDURES = [
  {
    name: 'board',
    kind: 'routine',
    title: 'Board',
    description: 'Write an orchestrated task to the live board (open the session and cards, write at each dispatch, report and commit, mark it Done). Use at the start of any task that dispatches a builder, refuter or debugger, and at each of those moments after; not for inline work or a lone scout or researcher lookup.',
    source: { file: 'orchestration/board.md' },
    extras: [],
  },
  {
    name: 'brief',
    kind: 'routine',
    title: 'Brief',
    description: 'Write the marching orders for a roster dispatch (scout, researcher, builder, refuter, debugger) from the rulebook template and lint them before dispatching. Use when about to dispatch a roster agent in an orchestrated task; not for a PR description, a ticket or a summary.',
    source: { file: 'orchestration/brief.md' },
    extras: [],
  },
  {
    name: 'wrap-up',
    kind: 'routine',
    title: 'Wrap-up',
    description: 'Finish an orchestrated task (full test projects once, the diff read, the pre-PR review tier, the cost log, the handoff note, the board marked Done). Use when the builder/refuter loop of an orchestrated task is accepted and before reporting it done or opening the PR; not in sprint mode, which waives most of this.',
    source: { file: 'orchestration/wrap-up.md' },
    extras: [],
  },
  {
    name: 'sprint',
    kind: 'routine',
    title: 'Sprint',
    description: 'Timeboxed build mode (default 45 minutes) for a live AI-assisted build such as an interview exercise or a spike. Use when the user explicitly asks for a timeboxed build ("sprint mode", "a 45-minute sprint", "sprint 45 min", /sprint). Not for a sprint as an iteration or backlog period ("put this in sprint 45").',
    source: { file: 'orchestration/sprint.md' },
    argumentHint: '[minutes]',
    extras: [{ path: 'orchestration/sprint/', about: 'the story page template `story-template.html`, its filler `make-story.mjs` and the shared `theme/` to copy into the project; read them from the checkout, not from a copy' }],
  },
  {
    name: 'repo-standards',
    kind: 'routine',
    title: 'Repo standards',
    description: "Set up or refresh a repo's coding standards (STANDARDS.md at the project root) from the cited archive and/or the user's own files. Use when the user asks to set up, refresh or import coding standards, and before the first orchestrated build in a repo without STANDARDS.md.",
    source: { file: 'orchestration/standards.md' },
    extras: [],
  },
  {
    name: 'start',
    kind: 'workflow',
    title: 'Start',
    description: 'Work a ticket end to end: fetch and judge it, plan, branch, grill, builder/refuter loop with commit and push per accepted task, full tests once, pre-PR review, live verification, durable-rules check, live checklist on the ticket (workflows/start.md).',
    source: { file: 'workflows/start.md' },
    argumentHint: '<work item id or URL> [--lite|--full]',
    extras: [WORKFLOW_README],
  },
  {
    name: 'grill',
    kind: 'workflow',
    title: 'Grill',
    description: 'Grill the developer on a plan until no decision is left open, in rounds of questions, then append the settled answers to the plan as a Decisions list (workflows/grill.md).',
    source: { file: 'workflows/grill.md' },
    argumentHint: '[plan file]',
    extras: [],
  },
  {
    name: 'draft-pr',
    kind: 'workflow',
    title: 'Draft PR',
    description: 'Write a PR description for the current branch from its diff and work items, and open it as a draft PR through the tracker helper, or leave a markdown file without one (workflows/draft-pr.md).',
    source: { file: 'workflows/draft-pr.md' },
    extras: [WORKFLOW_README],
  },
  {
    name: 'peer-review',
    kind: 'workflow',
    title: 'Peer Review',
    description: "Review and fix a teammate's pull request at a tier sized to its diff and risk, then draft a summary comment (workflows/peer-review.md). Not for your own branch; that is /pre-pr-review.",
    source: { file: 'workflows/peer-review.md' },
    argumentHint: '<PR id or URL> [--tier S|M|L|XL] [--lite|--full]',
    extras: [WORKFLOW_README],
  },
  {
    name: 'create',
    kind: 'workflow',
    title: 'Create',
    description: 'File a work item from this conversation: title, user-story description and acceptance criteria, confirmed before it is created (workflows/create.md).',
    source: { file: 'workflows/create.md' },
    argumentHint: '[type=<type>] [area=<area>] [iteration=<iteration>]',
    extras: [WORKFLOW_README],
  },
  {
    name: 'fix-ci',
    kind: 'workflow',
    title: 'Fix CI',
    description: 'Get a failing CI pipeline back to green: classify the failures, fix and verify locally, deliver when authorized, queue a run, wait, review, with a cycle cap (workflows/fix-ci.md).',
    source: { file: 'workflows/fix-ci.md' },
    argumentHint: '[run URL | build id | <pipeline> <run number>] [cycle cap]',
    extras: [WORKFLOW_README],
  },
  {
    name: 'pre-pr-review',
    kind: 'review',
    title: 'Pre-PR Review',
    description: 'Run the review panel on the current branch changes: explorers over checklist lanes, a verifier for leads and issue and warning findings, one report, a run log (review/PROCEDURE.md).',
    source: { file: 'review/PROCEDURE.md' },
    argumentHint: '[branch] [base] [code|errors|comments|types|tests|simplify|ui|arch|secondary|tickets] [lite|full] [ticket brief path]',
    extras: [],
  },
  {
    name: 'review-verdict',
    kind: 'review',
    title: 'Review Verdict',
    description: 'Record confirmed / false-positive / wont-fix verdicts on findings from a review panel run, confirm or overrule agent verdicts, and log escaped defects, in its run log (review/calibration.md).',
    source: { file: 'review/calibration.md', section: 'Later triage' },
    argumentHint: '[branch or run log file] [verdicts, e.g. 1 confirmed, 2 fp: covered by an end-to-end test]',
    extras: [],
  },
  {
    name: 'calibration-report',
    kind: 'review',
    title: 'Calibration Report',
    description: 'Aggregate review run-log verdicts and escaped defects into per-lane precision and recall, and ranked recalibration recommendations (review/calibration.md).',
    source: { file: 'review/calibration.md', section: 'Calibration report' },
    argumentHint: '[lane to focus on, e.g. code-reviewer]',
    extras: [],
  },
];

// The wrapper's second step, shared by every adapter: read the extras marked `first`, then the source (and its
// section), and follow it; then name the other extras. `args` is how this adapter phrases the arguments, or ''.
export function readStep(p, args) {
  const at = (rel) => `\`CHECKOUT/${rel}\``;
  const first = p.extras.filter((e) => e.first).map((e) => at(e.path));
  const what = p.source.section ? `its "${p.source.section}" section` : 'it';
  const read = first.length ? `Read ${first.join(', ')}, then ${at(p.source.file)}, and follow ${what}` : `Read ${at(p.source.file)} and follow ${what}`;
  const uses = p.extras.filter((e) => !e.first).map((e) => ` It also uses ${at(e.path)}: ${e.about}.`).join('');
  return `${read}${args ? ` ${args}` : ''}.${uses}`;
}
