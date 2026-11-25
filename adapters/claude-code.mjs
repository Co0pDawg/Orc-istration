// Claude Code: generates <home>/.claude/CLAUDE.md, AGENTS.md, agents/*.md and the review panel's commands/*.md.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';

const capabilityTools = {
  list: ['Glob'],
  search: ['Grep'],
  read: ['Read'],
  shell: ['Bash'],
  edit: ['Edit', 'Write'],
  'web-fetch': ['WebFetch'],
  'web-search': ['WebSearch'],
};

// The checkout is found at run time ($ORC_HOME, else the rulebook's Setup checkout line, else ~/.claude), so no
// machine path is written into these files.
const FIND_CHECKOUT =
  'Find the Orc-istration checkout: the `ORC_HOME` environment variable when it is set (`echo "$ORC_HOME"`), else the "Setup checkout (this machine)" line in the rulebook\'s tool notes, else `~/.claude`. Call it CHECKOUT and confirm the file named below exists there; if it does not, stop and say to set `ORC_HOME` to the checkout.';

const commands = [
  {
    name: 'pre-pr-review',
    description: 'Run the review panel on the current branch changes: explorers over checklist lanes, a verifier for leads and issue and warning findings, one report, a run log (review/PROCEDURE.md).',
    hint: '[branch] [base] [code|errors|comments|types|tests|simplify|ui|arch|secondary|tickets] [lite|full] [ticket brief path]',
    tools: ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'Agent', 'SendMessage', 'AskUserQuestion'],
    title: 'Pre-PR Review',
    file: 'review/PROCEDURE.md',
    how: 'Read `CHECKOUT/review/PROCEDURE.md` and follow it with these arguments. Dispatch each explorer and the verifier by its roster name as `subagent_type`, never `general-purpose`; launch all selected explorers in one message, each with `run_in_background: true`, so they run in parallel; pass a tier override as `model:` (the Tiers line of the tool notes maps tiers to models); resume an explorer with SendMessage; ask the developer with `AskUserQuestion`.',
  },
  {
    name: 'review-verdict',
    description: 'Record confirmed / false-positive / wont-fix verdicts on findings from a review panel run, confirm or overrule agent verdicts, and log escaped defects, in its run log (review/calibration.md).',
    hint: '[branch or run log file] [verdicts, e.g. 1 confirmed, 2 fp: covered by an end-to-end test]',
    tools: ['Bash', 'Glob', 'Grep', 'Read', 'Edit', 'AskUserQuestion'],
    title: 'Review Verdict',
    file: 'review/calibration.md',
    how: 'Read `CHECKOUT/review/calibration.md` and follow its verdict procedure with these arguments. Ask for a missing reason with `AskUserQuestion`.',
  },
  {
    name: 'calibration-report',
    description: 'Aggregate review run-log verdicts and escaped defects into per-lane precision and recall, and ranked recalibration recommendations (review/calibration.md).',
    hint: '[lane to focus on, e.g. code-reviewer]',
    tools: ['Bash', 'Glob', 'Grep', 'Read', 'Edit'],
    title: 'Calibration Report',
    file: 'review/calibration.md',
    how: 'Read `CHECKOUT/review/calibration.md` and follow its calibration-report procedure with these arguments; the counting is `node CHECKOUT/tools/orc.mjs calibration`. Recommend, then wait for approval before editing any lane or role.',
  },
];

function renderCommand(c) {
  const fm = { description: c.description, 'argument-hint': c.hint, 'allowed-tools': c.tools };
  const body = `# ${c.title}\n\n**Arguments:** "$ARGUMENTS"\n\n1. ${FIND_CHECKOUT.replace('the file named below', `\`CHECKOUT/${c.file}\``)}\n2. ${c.how}\n`;
  return { path: `.claude/commands/${c.name}.md`, content: serialize(fm, body) };
}

export default {
  id: 'claude-code',
  title: 'Claude Code',
  home: { root: '.claude', rulebook: '.claude/CLAUDE.md', agentsDir: '.claude/agents' },
  capabilityTools,
  // Scripts the example hooks (settings.example.json, hooks.node.example.json) run; install copies them to <root>/tools/.
  hookScripts: ['tools/guard.mjs', 'tools/guard.ps1', 'tools/board-reminder.ps1', 'tools/board-reminder.mjs'],
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
  // The review panel's slash commands ride with the rulebook: thin wrappers over review/*.md in the checkout.
  renderRulebook(agentsMd, notesMd) {
    return [
      { path: '.claude/CLAUDE.md', content: `@AGENTS.md\n${generatedMarker('claude-code')}\n\n${notesMd}` },
      { path: '.claude/AGENTS.md', content: agentsMd },
      ...commands.map(renderCommand),
    ];
  },
};
