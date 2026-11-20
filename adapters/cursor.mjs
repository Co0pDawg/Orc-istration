// Cursor. Syntax source: cursor.com/docs/context/subagents, /rules, /models.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';

export default {
  id: 'cursor',
  title: 'Cursor',
  home: { root: '.cursor', rulebook: null, agentsDir: '.cursor/agents' },
  capabilityTools: null,
  limits: {},
  gaps: [
    'No global rulebook file: copy the built `project/AGENTS.md` into each project as `AGENTS.md`, or paste it into User Rules.',
    'Exact model ids are unverified: every tier is `inherit` until you set ids in `models.local.json`.',
    'Low, Mid and High all inherit the session model in the shipped `models.json`, so a per-dispatch tier override changes nothing.',
    'No per-agent tool allowlist: read-only roles get `readonly: true` and the role body.',
    'No hook system in the research: the board update after an agent report is a build-loop step.',
    'No headless recipe: `orc.mjs dispatch` cannot run this tool (no documented headless syntax in the research).',
  ],
  installNote:
    'cursor has no global rulebook file: copy dist/cursor/project/AGENTS.md (node tools/orc.mjs build --tool cursor) into a project as AGENTS.md, or paste it into User Rules.',
  renderAgent(role, tierModel) {
    const fm = { name: role.name, description: role.description, model: tierModel.model };
    if (role.access === 'read-only') fm.readonly = true;
    return { path: `.cursor/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: 'project/AGENTS.md', content: `${generatedMarker('cursor')}\n${agentsMd}\n${notesMd}`, install: false }];
  },
};
