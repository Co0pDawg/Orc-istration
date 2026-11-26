// Antigravity CLI (agy). Syntax source: antigravity.google/docs/subagents, /rules, /hooks, /cli/headless.
import { serialize, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { ALL_CAPABILITIES } from '../tools/lib/roles.mjs';
import { checkoutLookup, readStep } from '../core/procedures.mjs';

// Tool names come from agy 1.5.16 itself (its deprecation log and the roles' own tool report), not from the docs
// pages above. list, search and web-fetch have no tool.
const capabilityTools = {
  list: [],
  search: [],
  read: ['read_file'],
  shell: ['run_command'],
  edit: ['write_file', 'edit_file'],
  'web-fetch': [],
  'web-search': ['search_web'],
};

// What differs on Antigravity for each procedure (core/procedures.mjs): every one is a skill and also the slash command
// /<name>; roster agents are dispatched with invoke_subagent; metrics capture reads Claude Code transcripts only; there
// is no subagent-stop hook; the artifact board is Claude Code only.
const DISPATCH = "Dispatch each roster agent with `invoke_subagent` and its roster name, as the tool notes' Dispatch line says.";
const ROUTED_PANEL = 'A role that `review/PROCEDURE.md` "Routed agents" sends to another tool is the exception: run it with `orc dispatch` in the shell as that section says.';
const ROUTED_START = 'A role that `review/PROCEDURE.md` "Routed agents" sends to another tool, or the refuter that `orchestration/wrap-up.md` "Second reviewer (Full)" sends to another tool, is the exception: run it with `orc dispatch` in the shell as that section says.';
const NO_METRICS = 'Skip every metrics capture step: `metrics capture` reads Claude Code transcripts only, so it is unsupported here.';
const NO_STOP_HOOK = 'There is no subagent-stop hook here, so update the board session yourself after every agent report.';
const procedureNotes = {
  board: [NO_STOP_HOOK, 'The artifact backend can be written only from Claude Code; use a local board here.'],
  brief: [DISPATCH],
  'wrap-up': [NO_STOP_HOOK],
  sprint: [DISPATCH],
  'repo-standards': [DISPATCH],
  start: [DISPATCH, ROUTED_START, NO_METRICS],
  grill: [DISPATCH],
  'draft-pr': [],
  'peer-review': [DISPATCH, ROUTED_PANEL, NO_METRICS],
  create: [],
  'fix-ci': [DISPATCH],
  'pre-pr-review': [DISPATCH, ROUTED_PANEL, NO_METRICS],
  'review-verdict': [],
  'calibration-report': [],
};

// The index of the brace that closes the JSON object opening at `start`, skipping strings; -1 when it never closes.
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function renderProcedure(p) {
  const own = procedureNotes[p.name];
  if (!own) throw new Error(`antigravity: no notes for procedure ${p.name} in adapters/antigravity.mjs`);
  const slash = `On Antigravity this skill is also the slash command \`/${p.name}\`${p.argumentHint ? ", and the user's request after the command name gives its arguments" : ''}.`;
  const args = p.argumentHint ? `with the arguments the user gave (\`${p.argumentHint}\`)` : '';
  const body = `${generatedMarker('antigravity')}\n\n# ${p.title}\n\n1. ${checkoutLookup(`CHECKOUT/${p.source.file}`)}\n2. ${readStep(p, args)}\n3. ${[slash, ...own].join(' ')}\n`;
  return { path: `.gemini/config/skills/${p.name}/SKILL.md`, content: serialize({ name: p.name, description: p.description }, body) };
}

export default {
  id: 'antigravity',
  title: 'Antigravity CLI',
  home: { root: '.gemini', rulebook: '.gemini/AGENTS.md', agentsDir: '.gemini/config/agents' },
  capabilityTools,
  // Script wired by `orc hooks --tool antigravity`; install copies it to <root>/tools/guard.mjs.
  hookScripts: ['tools/guard.mjs'],
  // nonEmptyTools: how agy reads `tools: []` is not established, so the build refuses one.
  // skillBytes: `agy plugin validate` warns when a skill body is over 24 KB.
  limits: { ruleBytes: 24000, nonEmptyTools: true, skillBytes: 24000 },
  conflicts: [
    {
      path: '.gemini/GEMINI.md',
      tool: 'Gemini CLI',
      warning: 'Antigravity could load two copies of the rulebook',
      handWrittenWarning: 'Antigravity may load both this file and AGENTS.md',
    },
  ],
  gaps: [
    'Per-agent model is only inherit, flash or pro: Mid and Low both map to flash, and what flash and pro resolve to is not documented.',
    'No per-agent effort key; effort exists only on a headless run (--effort).',
    'Low and Mid are the same per-agent model (flash) in the shipped `models.json`, so a per-dispatch tier override between them changes nothing outside a headless run.',
    'No subagent-stop hook: the board update after an agent report is a build-loop step.',
    'Read-only is enforced only by the tools allowlist; run_command can still change files, so the role body forbids edits.',
    'PreToolUse hook payloads carry no agent identity, so the git guard\'s read-only-role rule (blocking git writes for scout, researcher, refuter and review roles) is Claude Code only; the other git guard rules are available through `orc hooks --tool antigravity`, and an allow prints nothing.',
    'Listing, searching and URL fetching have no dedicated tool on Antigravity and go through run_command (or search_web); whether run_command can reach the network under the `sandbox` policy is not established, so only search_web is known to reach the web.',
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
      // `agy --agent <name>` (the headless recipe below) selects only main agents; with `false`, agy 1.5.16
      // answers `unknown agent "<name>" (no custom agents are available)`.
      mainAgent: true,
      model: tierModel.model,
    };
    // commandExecutionPolicy: `sandbox` is the documented default; the research does not document what
    // off/auto/eager do, so every role keeps the default and states it explicitly.
    if (caps.includes('shell')) fm.commandExecutionPolicy = 'sandbox';
    return { path: `.gemini/config/agents/${role.name}.md`, content: serialize(fm, role.body) };
  },
  // Headless run (agy --help, v1.5.16): stdin is read only with --input-format stream-json, so the brief is the
  // -p argument. --disable-slash-commands prevents print mode from expanding slash commands or skills. --effort
  // only when the tier names one.
  headless(role, tierModel, briefText) {
    const args = ['-p', briefText, '--agent', role.name, '--model', tierModel.model, '--output-format', 'json', '--disable-slash-commands'];
    if (tierModel.effort) args.push('--effort', tierModel.effort);
    return { command: 'agy', args, stdin: null };
  },
  // `orc dispatch` reads the result object `--output-format json` prints last on stdout
  // ({"status":"SUCCESS"|"ERROR","response":"...","denied_actions":[...],...}) from the end of the run's stdout.
  // The last object that starts a line and has a string `status` wins; lines after it are ignored. Null when there is
  // none. A `{` inside a JSON string is never at a line start, since a string holds no raw newline.
  headlessResult(stdoutTail) {
    const text = String(stdoutTail ?? '');
    const starts = text.startsWith('{') ? [0] : [];
    for (let i = text.indexOf('\n{'); i >= 0; i = text.indexOf('\n{', i + 1)) starts.push(i + 1);
    for (const i of starts.reverse()) {
      const end = objectEnd(text, i);
      if (end < 0) continue;
      let obj;
      try {
        obj = JSON.parse(text.slice(i, end + 1));
      } catch {
        continue;
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.status !== 'string') continue;
      const response = typeof obj.response === 'string' ? obj.response : '';
      const denied = Array.isArray(obj.denied_actions) ? obj.denied_actions.length : 0;
      return { ok: obj.status === 'SUCCESS', status: obj.status, response, denied };
    }
    return null;
  },
  renderRulebook(agentsMd, notesMd) {
    return [{ path: '.gemini/AGENTS.md', content: `${generatedMarker('antigravity')}\n${agentsMd}\n${notesMd}` }];
  },
  // Every procedure is a global skill (~/.gemini/config/skills/<name>/SKILL.md): a thin wrapper over the checkout.
  renderProcedure,
};
