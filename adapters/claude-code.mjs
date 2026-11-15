// Claude Code: generates the checked-in CLAUDE.md and agents/*.md (the repo is rooted at ~/.claude).
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

export default {
  id: 'claude-code',
  title: 'Claude Code',
  home: { root: '.claude', rulebook: '.claude/CLAUDE.md', agentsDir: '.claude/agents' },
  capabilityTools,
  limits: {},
  gaps: [
    'A role with every capability gets no `tools:` line, so it keeps MCP tools such as ArtifactData; for the read-only refuter that means read-only rests on the role body, not an allowlist.',
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
  renderRulebook(agentsMd, notesMd) {
    return [
      { path: '.claude/CLAUDE.md', content: `@AGENTS.md\n${generatedMarker('claude-code')}\n\n${notesMd}` },
      { path: '.claude/AGENTS.md', content: agentsMd },
    ];
  },
};
