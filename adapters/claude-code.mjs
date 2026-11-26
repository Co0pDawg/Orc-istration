// Claude Code: generates <home>/.claude/CLAUDE.md, AGENTS.md, agents/*.md, and from the procedure catalogue
// (core/procedures.mjs) the routine skills (skills/<name>/SKILL.md) and the workflow and review commands (commands/<name>.md).
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';
import { checkoutLookup, readStep } from '../core/procedures.mjs';

const capabilityTools = {
  list: ['Glob'],
  search: ['Grep'],
  read: ['Read'],
  shell: ['Bash'],
  edit: ['Edit', 'Write'],
  'web-fetch': ['WebFetch'],
  'web-search': ['WebSearch'],
};

const ASK = 'ask the developer with `AskUserQuestion`.';
const ASK_ONLY = 'Ask the developer with `AskUserQuestion`.';
const ROUTED_PANEL = 'A role that `review/PROCEDURE.md` "Routed agents" sends to another tool is the exception: run it with `orc dispatch` in the shell as that section says.';
const ROUTED_START = 'A role that `review/PROCEDURE.md` "Routed agents" sends to another tool, or the refuter that `orchestration/wrap-up.md` "Second reviewer (Full)" sends to another tool, is the exception: run it with `orc dispatch` in the shell as that section says.';
const BASE = ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion'];

// Claude Code's own part of each wrapper: the command's tool list, and notes on how to ask, dispatch and run in this
// tool. A note's first paragraph follows the read step; any further paragraphs follow the list.
const procedureNotes = {
  board: {
    notes:
      'On Claude Code, the artifact backend (`claude.ai/artifact/...`) is written with ArtifactData: load it with ToolSearch `select:ArtifactData`. If it is absent, load `select:mcp__claude-artifacts__db_get,mcp__claude-artifacts__db_write`, resolve the address to its UUID slug first (the short id fails), and pass `ifVersion` on every write to an existing doc. Refuters, scouts and researchers have a tools allowlist without MCP tools here, so they cannot write the board: give a refuter\'s brief `BOARD: none`, and after it reports, write its stage, `note` and `tokens` yourself.',
  },
  brief: {
    notes:
      'On Claude Code, dispatch with `subagent_type: "<role>"` and the brief as the prompt. Pass `model:` only to override the tier for this one dispatch, such as `model: "sonnet"` for a Mid-tier refuter. Parallel builders get `isolation: "worktree"`. On the artifact backend a refuter cannot write the board, so its brief says `BOARD: none` (see the `board` skill); on a local board a refuter writes its own card, so its brief carries the `BOARD:` line.',
  },
  'wrap-up': {
    notes: 'On Claude Code, the Full review tier is `/pre-pr-review`, and the orchestrator\'s context size for the cost log comes from the status line or `/context`.',
  },
  sprint: {
    notes: 'On Claude Code, the refuter dispatch is `subagent_type: "refuter"` with `model: "sonnet"`. Before the clock starts, pre-approve the stack\'s read-only and build commands in `permissions.allow` of the user-level `~/.claude/settings.json`; `/fewer-permission-prompts` helps only in an existing project with past sessions, and only for read-only calls. `/fast` speeds up the orchestrator\'s own output.',
  },
  'repo-standards': {
    notes: [
      'On Claude Code, Step 2 is one `AskUserQuestion` call. Keep each `header` to 12 characters or fewer, and do not add "Other" as an option: the free-text "Other" is added automatically. With no `STANDARDS.md`, the ask looks like this:',
      '```json\n{\n  "questions": [\n    {\n      "question": "Which stacks should STANDARDS.md cover?",\n      "header": "Stacks",\n      "multiSelect": true,\n      "options": [\n        { "label": "csharp (Recommended)", "description": "Detected: 4 matches, e.g. src/App/App.csproj" },\n        { "label": "sql (Recommended)", "description": "Detected: 2 matches, e.g. db/schema.sql" }\n      ]\n    },\n    {\n      "question": "Do you have your own standards to import?",\n      "header": "Import",\n      "multiSelect": false,\n      "options": [\n        { "label": "No, the archive is enough", "description": "Use only the archive sections picked above" },\n        { "label": "Yes, a local file or folder", "description": "Give the path in the notes or in Other" },\n        { "label": "Yes, a URL", "description": "I fetch it and import it as Markdown" }\n      ]\n    }\n  ]\n}\n```',
      'When `STANDARDS.md` exists with a marker, its first two questions look like this (the third is the import question above):',
      '```json\n{\n  "questions": [\n    {\n      "question": "STANDARDS.md exists (csharp, sql). What should happen to it?",\n      "header": "Existing",\n      "multiSelect": false,\n      "options": [\n        { "label": "Keep it", "description": "Change nothing" },\n        { "label": "Re-apply as is", "description": "Rebuild the same stacks and imports from the archive" },\n        { "label": "Add stacks", "description": "Keep csharp and sql, and add the stacks picked next" }\n      ]\n    },\n    {\n      "question": "Which stacks should be added (only with Add stacks)?",\n      "header": "Add stacks",\n      "multiSelect": true,\n      "options": [\n        { "label": "typescript (Recommended)", "description": "Detected: 12 matches, e.g. web/app.ts" },\n        { "label": "playwright", "description": "Not detected" }\n      ]\n    }\n  ]\n}\n```',
    ].join('\n\n'),
  },
  start: {
    tools: [...BASE, 'Agent', 'SendMessage', 'EnterPlanMode', 'ExitPlanMode'],
    notes:
      `Run the grill and the review panel in this session by following \`CHECKOUT/workflows/grill.md\` and \`CHECKOUT/review/PROCEDURE.md\`; launch the panel's explorers in one message, each with \`run_in_background: true\`. Plan with EnterPlanMode and ExitPlanMode; dispatch every agent by its roster name as \`subagent_type\`; resume a builder with SendMessage; publish a Step 9 UI mockup as a private artifact; ${ASK} ${ROUTED_START}`,
  },
  grill: {
    tools: [...BASE, 'Agent'],
    notes: 'Ask every round with `AskUserQuestion`; look facts up with `scout` or `researcher` as `subagent_type`.',
  },
  'draft-pr': { tools: BASE, notes: ASK_ONLY },
  'peer-review': {
    tools: [...BASE, 'Agent', 'SendMessage'],
    notes:
      `Run the review panel in this session by following \`CHECKOUT/review/PROCEDURE.md\`, launching its explorers in one message, each with \`run_in_background: true\`; dispatch every agent by its roster name as \`subagent_type\`; ${ASK} ${ROUTED_PANEL}`,
  },
  create: { tools: BASE.filter((t) => t !== 'Edit'), notes: ASK_ONLY },
  'fix-ci': { tools: [...BASE, 'Agent', 'SendMessage'], notes: `Run the Step 7 poll with \`run_in_background: true\`; ${ASK}` },
  'pre-pr-review': {
    tools: ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'Agent', 'SendMessage', 'AskUserQuestion'],
    notes:
      `Dispatch each explorer and the verifier by its roster name as \`subagent_type\`, never \`general-purpose\`; launch all selected explorers in one message, each with \`run_in_background: true\`, so they run in parallel; pass a tier override as \`model:\` (the Tiers line of the tool notes maps tiers to models); resume an explorer with SendMessage; ${ASK} ${ROUTED_PANEL}`,
  },
  'review-verdict': { tools: ['Bash', 'Glob', 'Grep', 'Read', 'Edit', 'AskUserQuestion'], notes: 'Ask for a missing reason with `AskUserQuestion`.' },
  'calibration-report': {
    tools: ['Bash', 'Glob', 'Grep', 'Read', 'Edit'],
    notes: 'The counting is `node CHECKOUT/tools/orc.mjs calibration`. Recommend, then wait for approval before editing any lane or role.',
  },
};

// A routine is a skill; a workflow or review procedure is a command with `$ARGUMENTS`.
function renderProcedure(p) {
  const own = procedureNotes[p.name];
  if (!own) throw new Error(`claude-code: no notes for procedure ${p.name} in adapters/claude-code.mjs`);
  const [inline, ...block] = own.notes.split('\n\n');
  const command = p.kind !== 'routine';
  const args = command ? (p.argumentHint ? 'with these arguments' : '') : p.argumentHint ? `with the arguments the user gave (\`${p.argumentHint}\`)` : '';
  const steps = `1. ${checkoutLookup(`CHECKOUT/${p.source.file}`)}\n2. ${readStep(p, args)} ${inline}\n`;
  const body = `${generatedMarker('claude-code')}\n\n# ${p.title}\n\n${command ? '**Arguments:** "$ARGUMENTS"\n\n' : ''}${steps}${block.map((b) => `\n${b}\n`).join('')}`;
  if (!command) return { path: `.claude/skills/${p.name}/SKILL.md`, content: serialize({ name: p.name, description: p.description }, body) };
  if (!own.tools) throw new Error(`claude-code: no allowed-tools for command ${p.name} in adapters/claude-code.mjs`);
  const fm = { description: p.description, 'argument-hint': p.argumentHint, 'allowed-tools': own.tools };
  return { path: `.claude/commands/${p.name}.md`, content: serialize(fm, body) };
}

export default {
  id: 'claude-code',
  title: 'Claude Code',
  home: { root: '.claude', rulebook: '.claude/CLAUDE.md', agentsDir: '.claude/agents' },
  capabilityTools,
  // Scripts the example hooks (adapters/claude-code/settings.example.json, hooks.node.example.json) run; install copies them to <root>/tools/.
  hookScripts: ['tools/guard.mjs', 'tools/guard.ps1', 'tools/board-reminder.ps1', 'tools/board-reminder.mjs'],
  // Static Claude Code files copied beside the generated ones on a full install (not sprint-kit): `from` is
  // repo-relative, `to` is under <root>/.
  staticFiles: [
    {
      from: 'adapters/claude-code/skills/orc-permissions/SKILL.md',
      to: 'skills/orc-permissions/SKILL.md',
      kind: 'skill',
    },
  ],
  limits: {},
  gaps: [
    'A role with every capability gets no `tools:` line, so it keeps MCP tools such as ArtifactData; only those roles can write the artifact board.',
  ],
  renderAgent(role, tierModel) {
    const fm = { name: role.name, description: role.description, model: tierModel.model };
    const effort = role.effort ?? tierModel.effort;
    if (effort) fm.effort = effort;
    const full = ALL_CAPABILITIES.every((c) => role.capabilities.includes(c));
    if (!full) {
      const caps = ALL_CAPABILITIES.filter(
        (c) => role.capabilities.includes(c) && !(role.access === 'read-only' && c === 'edit'),
      );
      fm.tools = caps.flatMap((c) => capabilityTools[c]).join(', ');
    }
    return { path: `.claude/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  // Headless run: `claude -p --agent <name> --model <model>` with the brief on stdin (no effort flag is documented).
  headless(role, tierModel, briefText) {
    return { command: 'claude', args: ['-p', '--agent', role.name, '--model', tierModel.model], stdin: briefText };
  },
  // `orc doctor`: a non-interactive command that exits 0 when signed in (its output is never printed).
  authProbe: { args: ['auth', 'status'] },
  renderRulebook(agentsMd, notesMd) {
    return [
      { path: '.claude/CLAUDE.md', content: `@AGENTS.md\n${generatedMarker('claude-code')}\n\n${notesMd}` },
      { path: '.claude/AGENTS.md', content: agentsMd },
    ];
  },
  // Thin wrappers over the tool-neutral procedures in the checkout (core/procedures.mjs).
  renderProcedure,
};
