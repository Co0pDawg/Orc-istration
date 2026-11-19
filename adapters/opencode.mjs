// OpenCode. Syntax source: opencode.ai/docs/agents, /permissions, /rules, /models.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';

export default {
  id: 'opencode',
  title: 'OpenCode',
  home: { root: '.config/opencode', rulebook: '.config/opencode/AGENTS.md', agentsDir: '.config/opencode/agents' },
  capabilityTools: null,
  limits: {},
  gaps: [
    'Only one model id is documented (`anthropic/claude-sonnet-5-5#high`): every tier uses it until you set ids in `models.local.json`.',
    'Low, Mid and High are the same model in the shipped `models.json`, so a per-dispatch tier override changes nothing.',
    'Read-only roles deny `edit` only; `shell` stays allowed so scouts and refuters can run commands, and the role body forbids edits.',
    'No shell-command hooks (TypeScript plugins only): the board update after an agent report is a build-loop step.',
    'No imports in AGENTS.md: the whole rulebook is one file.',
    'No headless recipe: `orc.mjs dispatch` cannot run this tool (no documented headless syntax in the research).',
  ],
  renderAgent(role, tierModel) {
    const fm = { description: role.description, mode: 'subagent', model: tierModel.model };
    if (role.access === 'read-only') fm.permissions = [{ action: 'edit', resource: '*', effect: 'deny' }];
    return { path: `.config/opencode/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.config/opencode/AGENTS.md', content: `${generatedMarker('opencode')}\n${agentsMd}\n${notesMd}` }];
  },
};
