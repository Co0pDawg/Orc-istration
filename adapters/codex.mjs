// Codex CLI. Syntax source: learn.chatgpt.com/docs/agent-configuration/subagents, /agents-md, /docs/models.
import { generatedMarker } from '../tools/lib/frontmatter.mjs';
import { serializeToml } from '../tools/lib/toml.mjs';

// Codex's read-only sandbox blocks every write, temp files included, so scout and researcher, which get it, report
// inline (a scratch file cannot be written). Every other role runs workspace-write: the refuter runs tests and builds a
// throwaway worktree, and the review-* roles write at most an overflow scratch report; their no-edit rule rests on the
// role body, as on the other tools.
const READ_ONLY_SANDBOX = new Set(['scout', 'researcher']);

export default {
  id: 'codex',
  title: 'Codex CLI',
  home: { root: '.codex', rulebook: '.codex/AGENTS.md', agentsDir: '.codex/agents' },
  capabilityTools: null,
  limits: { ruleBytes: 32768 },
  gaps: [
    'No per-agent tool allowlist, sandbox or approval setting in agents/*.toml: read-only rests on the role body. `orc.mjs dispatch` adds `--sandbox read-only` only for scout and researcher; every other role runs `workspace-write`, because the refuter runs tests and builds a throwaway worktree and the review-* roles write at most an overflow scratch report.',
    'A headless scout or researcher runs in the read-only sandbox, which cannot write a scratch file: its report must be inline.',
    'Headless runs (`codex exec`) have no web tool, and network access depends on your Codex sandbox configuration, so web lookups are best routed to another tool.',
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
  // role), optional effort, `-c windows.sandbox=mxc` on Windows (every role, because Codex blocks process launches
  // there without a sandbox selection), and role body + brief on stdin.
  headless(role, tierModel, briefText, { platform = process.platform } = {}) {
    const sandbox = READ_ONLY_SANDBOX.has(role.name) ? 'read-only' : 'workspace-write';
    const args = [
      'exec',
      '--model',
      tierModel.model,
      '--sandbox',
      sandbox,
      ...(tierModel.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(tierModel.effort)}`] : []),
      ...(platform === 'win32' ? ['-c', 'windows.sandbox=mxc'] : []),
      '-',
    ];
    return { command: 'codex', args, stdin: `${role.body}\n\n---\n\n${briefText}` };
  },
  // `orc doctor`: a non-interactive command that exits 0 when signed in (its output is never printed).
  authProbe: { args: ['login', 'status'] },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.codex/AGENTS.md', content: `${generatedMarker('codex')}\n${agentsMd}\n${notesMd}` }];
  },
};
