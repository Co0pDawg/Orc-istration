// Antigravity CLI (agy). Syntax source: antigravity.google/docs/subagents, /rules, /hooks, /cli/headless.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';

const capabilityTools = {
  list: [],
  search: [],
  read: ['read_file'],
  shell: ['run_command'],
  edit: ['write_file', 'edit_file'],
  'web-fetch': [],
  'web-search': ['search_web'],
};

export default {
  id: 'antigravity',
  title: 'Antigravity CLI',
  home: { root: '.gemini', rulebook: '.gemini/AGENTS.md', agentsDir: '.gemini/config/agents' },
  capabilityTools,
  limits: { ruleBytes: 24000 },
  conflicts: [{ path: '.gemini/GEMINI.md', tool: 'Gemini CLI', warning: 'Antigravity could load two copies of the rulebook' }],
  gaps: [
    'Per-agent model is only inherit, flash or pro: Mid and Low both map to flash, and what flash and pro resolve to is not documented.',
    'No per-agent effort key; effort exists only on a headless run (--effort).',
    'Low and Mid are the same per-agent model (flash) in the shipped `models.json`, so a per-dispatch tier override between them changes nothing outside a headless run.',
    'Listing, searching and URL fetching have no dedicated tool on Antigravity and go through run_command (or search_web).',
    'No subagent-stop hook: the board update after an agent report is a build-loop step.',
    'Read-only is enforced only by the tools allowlist; run_command can still change files, so the role body forbids edits.',
  ],
  renderAgent(role, tierModel) {
    const caps = ALL_CAPABILITIES.filter(
      (c) => role.capabilities.includes(c) && !(role.access === 'read-only' && c === 'edit'),
    );
    const fm = {
      name: role.name,
      description: role.description,
      tools: [...new Set(caps.flatMap((c) => capabilityTools[c]))],
      subagent: true,
      mainAgent: true,
      model: tierModel.model,
    };
    // commandExecutionPolicy: `sandbox` is the documented default; the research does not document what
    // off/auto/eager do, so every role keeps the default and states it explicitly.
    if (caps.includes('shell')) fm.commandExecutionPolicy = 'sandbox';
    return { path: `.gemini/config/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  // Headless run (agy --help, v1.5.16): stdin is read only with --input-format stream-json, so the brief is the
  // -p argument. --disable-slash-commands keeps brief text starting with `/` from triggering slash commands;
  // --effort only when the tier names one.
  headless(role, tierModel, briefText) {
    const args = ['-p', briefText, '--agent', role.name, '--model', tierModel.model, '--output-format', 'json', '--disable-slash-commands'];
    if (tierModel.effort) args.push('--effort', tierModel.effort);
    return { command: 'agy', args, stdin: null };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.gemini/AGENTS.md', content: `${generatedMarker('antigravity')}\n${agentsMd}\n${notesMd}` }];
  },
};
