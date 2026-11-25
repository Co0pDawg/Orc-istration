// Codex CLI. Syntax source: learn.chatgpt.com/docs/agent-configuration/subagents, /agents-md, /docs/models.
import { generatedMarker } from '../tools/lib/frontmatter.mjs';
import { serializeToml } from '../tools/lib/toml.mjs';

// Codex's read-only sandbox blocks every write, temp files included. Only the roles that read and report inline get
// it; the other read-only roles (refuter, review-*) run tests, build a throwaway worktree and write a scratch report,
// so they run workspace-write and their no-edit rule rests on the role body, as on the other tools.
const READ_ONLY_SANDBOX = new Set(['scout', 'researcher']);

export default {
  id: 'codex',
  title: 'Codex CLI',
  home: { root: '.codex', rulebook: '.codex/AGENTS.md', agentsDir: '.codex/agents' },
  capabilityTools: null,
  limits: { ruleBytes: 32768 },
  gaps: [
    'No per-agent tool allowlist, sandbox or approval setting in agents/*.toml: read-only rests on the role body. `orc.mjs dispatch` adds `--sandbox read-only` only for scout and researcher; refuter and review-* run `workspace-write`, because they write test output, worktrees and scratch reports.',
    'No imports in AGENTS.md: the whole rulebook is one file (32 KiB default cap).',
    'No hook system in the research: the board update after an agent report is a build-loop step.',
    'Native Windows workspace-write passed with MXC on standalone Codex CLI 0.172.0. See docs/example-prompts.md for the tested configuration and earlier bundled and legacy sandbox errors.',
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
  // Headless run: `codex exec` with --sandbox read-only for scout and researcher (workspace-write for every other
  // role), optional effort, and role body + brief on stdin.
  headless(role, tierModel, briefText) {
    const sandbox = READ_ONLY_SANDBOX.has(role.name) ? 'read-only' : 'workspace-write';
    const args = [
      'exec',
      '--model',
      tierModel.model,
      '--sandbox',
      sandbox,
      ...(tierModel.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(tierModel.effort)}`] : []),
      '-',
    ];
    return { command: 'codex', args, stdin: `${role.body}\n\n---\n\n${briefText}` };
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.codex/AGENTS.md', content: `${generatedMarker('codex')}\n${agentsMd}\n${notesMd}` }];
  },
};
