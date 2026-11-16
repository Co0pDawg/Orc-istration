// Gemini CLI. Syntax source: geminicli.com/docs/core/subagents, /cli/gemini-md, /reference/tools, /cli/model.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';

const capabilityTools = {
  list: ['list_directory', 'glob'],
  search: ['grep_search'],
  read: ['read_file', 'read_many_files'],
  shell: ['run_shell_command'],
  edit: ['write_file', 'replace'],
  'web-fetch': ['web_fetch'],
  'web-search': ['google_web_search'],
};

export default {
  id: 'gemini-cli',
  title: 'Gemini CLI',
  home: { root: '.gemini', rulebook: '.gemini/GEMINI.md', agentsDir: '.gemini/agents' },
  capabilityTools,
  limits: {},
  conflicts: [{ path: '.gemini/AGENTS.md', tool: 'Antigravity', warning: 'Antigravity could load two copies of the rulebook' }],
  gaps: [
    'No reasoning-effort key; tiers differ by model id only, and Low and Mid share the Flash id (no Flash-Lite id documented).',
    'Subagents cannot dispatch subagents, and parallel subagents are not documented: dispatch one at a time.',
    'No subagent-stop hook: the board update after an agent report is a build-loop step.',
    'Read-only is enforced only by the tools allowlist; run_shell_command can still change files, so the role body forbids edits.',
    'No native user-level AGENTS.md: the rulebook is installed as GEMINI.md.',
    'No headless recipe: `orc.mjs dispatch` cannot run this tool (no documented headless syntax in the research).',
  ],
  renderAgent(role, tierModel) {
    const caps = ALL_CAPABILITIES.filter(
      (c) => role.capabilities.includes(c) && !(role.access === 'read-only' && c === 'edit'),
    );
    const fm = {
      name: role.name,
      description: role.description,
      kind: 'local',
      tools: caps.flatMap((c) => capabilityTools[c]),
      model: tierModel.model,
    };
    return { path: `.gemini/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.gemini/GEMINI.md', content: `${generatedMarker('gemini-cli')}\n${agentsMd}\n${notesMd}` }];
  },
};
