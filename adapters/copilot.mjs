// GitHub Copilot CLI. Syntax source: docs.github.com/en/copilot/reference/custom-agents-configuration.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';

// Only the documented aliases; `agent` is never granted.
const capabilityTools = {
  list: ['search'],
  search: ['search'],
  read: ['read'],
  shell: ['execute'],
  edit: ['edit'],
  'web-fetch': ['web'],
  'web-search': ['web'],
};

export default {
  id: 'copilot',
  title: 'GitHub Copilot CLI',
  home: { root: '.copilot', rulebook: '.copilot/copilot-instructions.md', agentsDir: '.copilot/agents' },
  capabilityTools,
  limits: { agentBodyChars: 30000 },
  gaps: [
    'Exact model ids are unverified: agents carry no `model` until you set ids in `models.local.json`.',
    'Low, Mid and High carry no model in the shipped `models.json`, so all three run the default model and a per-dispatch tier override changes nothing.',
    'Tools are coarse aliases (`search` covers listing and searching; `web` covers fetch and search).',
    'Read-only rests on leaving out the `edit` alias; `execute` can still change files, so the role body forbids edits.',
    'No hook system in the research: the board update after an agent report is a build-loop step.',
    'No headless recipe: `orc.mjs dispatch` cannot run this tool (no documented headless syntax in the research).',
  ],
  renderAgent(role, tierModel) {
    const caps = ALL_CAPABILITIES.filter(
      (c) => role.capabilities.includes(c) && !(role.access === 'read-only' && c === 'edit'),
    );
    const fm = { name: role.name, description: role.description, tools: [...new Set(caps.flatMap((c) => capabilityTools[c]))] };
    if (tierModel.model) fm.model = tierModel.model;
    return { path: `.copilot/agents/${role.name}.agent.md`, content: serialize(fm, role.body) };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.copilot/copilot-instructions.md', content: `${generatedMarker('copilot')}\n${agentsMd}\n${notesMd}` }];
  },
};
