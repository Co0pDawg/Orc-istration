// Codex CLI. Syntax source: learn.chatgpt.com/docs/agent-configuration/subagents, /agents-md, /docs/models.
import { generatedMarker } from '../tools/lib/frontmatter.mjs';
import { serializeToml } from '../tools/lib/toml.mjs';

export default {
  id: 'codex',
  title: 'Codex CLI',
  home: { root: '.codex', rulebook: '.codex/AGENTS.md', agentsDir: '.codex/agents' },
  capabilityTools: null,
  limits: { ruleBytes: 32768 },
  gaps: [
    'No per-agent tool allowlist, sandbox or approval setting: read-only rests on the role body.',
    'No imports in AGENTS.md: the whole rulebook is one file (32 KiB default cap).',
    'No hook system in the research: the board update after an agent report is a build-loop step.',
    'Windows support is through WSL2 per the docs.',
    'No headless recipe: `orc.mjs dispatch` cannot run this tool (no documented headless syntax in the research).',
  ],
  renderAgent(role, tierModel) {
    const effort = role.effort ?? tierModel.effort;
    const toml = serializeToml({
      name: role.name,
      description: role.description,
      model: tierModel.model,
      model_reasoning_effort: effort,
      developer_instructions: { multiline: role.body },
    });
    return { path: `.codex/agents/${role.name}.toml`, content: `# ${generatedMarker('codex').slice(5, -4)}\n${toml}` };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.codex/AGENTS.md', content: `${generatedMarker('codex')}\n${agentsMd}\n${notesMd}` }];
  },
};
