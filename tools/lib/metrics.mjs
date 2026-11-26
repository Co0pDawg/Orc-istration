// Per-run agent metrics from Claude Code session transcripts (capture) and their aggregate (report). Schema, privacy
// rules and field definitions: review/metrics.md. Claude Code transcripts only; other tools write no comparable file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseRunLog, bucket, precision, pct, MIN_DENOMINATOR } from './calibration.mjs';
import { readText } from './text.mjs';

export const SCHEMA_VERSION = 1;

// API list prices per million tokens; cache writes are input x the 5-minute or 1-hour multiplier. `metrics report
// --prices <file>` replaces the table. A model missing from it is listed, never priced at zero.
export const DEFAULT_PRICES = {
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2.0,
  models: {
    'claude-fable-5-1': { input: 10.0, output: 50.0, cacheRead: 0.25 },
    'claude-opus-5-5': { input: 4.0, output: 20.0, cacheRead: 0.2 },
    'claude-sonnet-5-5': { input: 2.0, output: 10.0, cacheRead: 0.2 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  },
};

// Whole seconds and averages round half to even, as the original's [int]/[long] casts did.
const toInt = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  return d > 0.5 || (d === 0.5 && f % 2 !== 0) ? f + 1 : f;
};
const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const COMMAND = /<command-name>\/?([\w:-]+)<\/command-name>/;

function resultChars(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return content.length;
  let sum = 0;
  for (const b of Array.isArray(content) ? content : [content]) {
    if (typeof b === 'string') sum += b.length;
    else if (b?.type === 'text' && b.text) sum += String(b.text).length;
  }
  return sum;
}

// A prompt or a message sent to a running agent that puts a review-verifier in findings mode (review/PROCEDURE.md).
const FINDINGS_MODE = /findings mode/i;

// One transcript as events. Streaming repeats a message id; the last usage seen wins (what was billed), with the
// first timestamp. A tool result repeated in the file counts once. `findingsModeAt` holds the times of user text
// that names findings mode, so a verifier's verdicts can be told apart from its lead verdicts.
export function readTranscript(file) {
  const usage = new Map();
  const toolUses = new Map();
  const results = new Map();
  const texts = [];
  const invocations = [];
  const findingsModeAt = [];
  const info = { version: null, cwd: null, entrypoint: null, branch: null };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!/"type"\s*:\s*"(assistant|user)"/.test(line)) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o?.type !== 'assistant' && o?.type !== 'user') continue;
    const ts = Date.parse(o.timestamp);
    if (Number.isNaN(ts)) continue;
    info.version ??= o.version ? String(o.version) : null;
    info.cwd ??= o.cwd ? String(o.cwd) : null;
    info.entrypoint ??= o.entrypoint ? String(o.entrypoint) : null;
    if (o.gitBranch && o.gitBranch !== 'HEAD') info.branch = String(o.gitBranch);
    const m = o.message;
    if (m == null) continue;
    const blocks = Array.isArray(m.content) ? m.content : [m.content];
    if (o.type === 'assistant') {
      if (m.id && m.usage && m.model !== '<synthetic>') {
        usage.set(m.id, { ts: usage.get(m.id)?.ts ?? ts, model: String(m.model), u: m.usage });
      }
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_use') {
          const p = b.input?.file_path || b.input?.notebook_path || null;
          toolUses.set(b.id, { ts, name: String(b.name), path: p ? String(p) : null });
          if (b.name === 'SubagentHandback' && b.input?.message) texts.push({ ts, text: String(b.input.message) });
          if (b.name === 'Skill' && b.input?.skill) invocations.push({ ts, workflow: String(b.input.skill).replace(/^\/+/, ''), source: 'skill-tool' });
        } else if (b.type === 'text' && b.text) texts.push({ ts, text: String(b.text) });
      }
    } else {
      if (typeof m.content === 'string') {
        const c = COMMAND.exec(m.content);
        if (c) invocations.push({ ts, workflow: c[1], source: 'command' });
        if (FINDINGS_MODE.test(m.content)) findingsModeAt.push(ts);
        continue;
      }
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_result' && b.tool_use_id && !results.has(b.tool_use_id)) results.set(b.tool_use_id, resultChars(b.content));
        else if (b.type === 'text' && typeof b.text === 'string') {
          const c = COMMAND.exec(b.text);
          if (c) invocations.push({ ts, workflow: c[1], source: 'command' });
          if (FINDINGS_MODE.test(b.text)) findingsModeAt.push(ts);
        }
      }
    }
  }
  return { usage, toolUses, results, texts, invocations, info, findingsModeAt };
}

const newCounter = () => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, context: 0 });

function addUsage(c, u) {
  const inp = Number(u.input_tokens ?? 0);
  const cw = Number(u.cache_creation_input_tokens ?? 0);
  const cr = Number(u.cache_read_input_tokens ?? 0);
  const cw1h = Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  c.input += inp;
  c.cacheWrite1h += cw1h;
  c.cacheWrite5m += cw - cw1h;
  c.cacheRead += cr;
  c.output += Number(u.output_tokens ?? 0);
  c.context += inp + cw + cr;
}

const addCounter = (into, from) => {
  for (const k of Object.keys(from)) into[k] += from[k];
};

// Repo-relative, or a category placeholder: reports never carry home directories or scratchpad names.
export function redactPath(p, roots, home = os.homedir()) {
  if (!p) return null;
  const n = p.replace(/\\/g, '/');
  const lower = n.toLowerCase();
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    const r = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
    if (lower.startsWith(r.toLowerCase())) return n.slice(r.length);
  }
  if (/\/scratchpad(\/|$)|\/tmp\/claude-|\/Temp\/claude-/i.test(n)) return '<scratchpad>';
  const claudeHome = `${path.join(home, '.claude').replace(/\\/g, '/')}/`;
  if (lower.startsWith(claudeHome.toLowerCase())) return n.includes('/tool-results/') ? '<tool-output>' : '<claude-home>';
  if (!path.isAbsolute(p) && !path.win32.isAbsolute(p)) return n;
  return '<external>';
}

// One verifier message's verdict lines (`3. CONFIRMED`, `A3. CONFIRMED`, `Lead 3: CONFIRMED`), split into the lead set
// and the findings-mode set. The message starts in findings mode when a findings-mode prompt came before it; a heading
// naming only leads, or only findings, switches the set for the lines below it.
function verifierVerdicts(text, findingsMode) {
  const sets = { leads: [], findings: [] };
  let set = findingsMode ? 'findings' : 'leads';
  for (const line of text.split('\n')) {
    if (/^\s*#{1,6}\s/.test(line)) {
      const lead = /\bleads?\b/i.test(line);
      const finding = /\bfindings?\b/i.test(line);
      if (lead !== finding) set = lead ? 'leads' : 'findings';
      continue;
    }
    const m = /^\s*[*_]*\s*(?:[A-Za-z]?\d+\.|Lead\s+\d+[:.]?)\s*[*_]*\s*(CONFIRMED|PLAUSIBLE|REFUTED)\b/.exec(line);
    if (m) sets[set].push(m[1]);
  }
  return sets;
}

// `findingsModeAt`: the times of prompts that put the agent in findings mode (readTranscript).
export function agentResult(agentType, texts, findingsModeAt = []) {
  const all = texts.map((x) => x.text).join('\n');
  const r = {};
  const verdicts = [...all.matchAll(/VERDICT:\s*\**\s*(ACCEPT|REWORK)\b(?!\s*\|)/g)].map((m) => m[1]);
  if (verdicts.length) r.verdicts = verdicts;
  const statuses = [...all.matchAll(/STATUS:\s*\**\s*(DONE|BLOCKED|PARTIAL)\b(?!\s*\|)/g)].map((m) => m[1]);
  if (statuses.length) r.statuses = statuses;
  if (agentType === 'review-verifier') {
    // A verifier resumed for finding verification or its severity review answers in later messages. Its lead verdicts
    // and its findings-mode verdicts are counted apart (`leads`, `findings`), each from the message that settles the
    // most of that kind; RAISE/KEEP comes from the last message that has them.
    const best = { leads: [], findings: [] };
    for (const x of texts) {
      const sets = verifierVerdicts(x.text, findingsModeAt.some((t) => t <= (x.ts ?? Infinity)));
      for (const k of Object.keys(best)) if (sets[k].length > best[k].length) best[k] = sets[k];
    }
    for (const k of Object.keys(best)) {
      if (!best[k].length) continue;
      r[k] = { CONFIRMED: 0, PLAUSIBLE: 0, REFUTED: 0 };
      for (const v of best[k]) r[k][v]++;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i].text;
      if (!/^\s*[*_]*\s*(?:\d+\.\s*)?[*_]*(RAISE|KEEP)\b/m.test(t)) continue;
      const sr = {};
      for (const k of ['RAISE', 'KEEP']) {
        // A summary line ("KEEP: S1, S2") lists the items; without one, count the item lines ("RAISE S3 - ...").
        const list = new RegExp(`^\\s*[*_]*${k}[*_]*\\s*:\\s*(.+)$`, 'm').exec(t);
        sr[k] = list
          ? list[1].split(',').filter((s) => s.trim() && !/^(none|-)$/.test(s.trim())).length
          : [...t.matchAll(new RegExp(`^\\s*[*_]*\\s*(?:\\d+\\.\\s*)?[*_]*${k}\\b(?!\\s*:)`, 'gm'))].length;
      }
      r.severityReview = { raised: sr.RAISE, kept: sr.KEEP };
      break;
    }
  }
  return r;
}

// One agent (the main thread or one subagent), counting only what happened in [since, until].
export function measureAgent(ev, since, until, roots, agentType) {
  const inWindow = (t) => t >= since && t <= until;
  const tokens = newCounter();
  const byModel = {};
  const turns = [...ev.usage.values()].filter((t) => inWindow(t.ts)).sort((a, b) => a.ts - b.ts);
  let initial = null;
  let peak = 0;
  const times = [];
  for (const t of turns) {
    addUsage(tokens, t.u);
    addUsage((byModel[t.model] ??= newCounter()), t.u);
    const ctx = Number(t.u.input_tokens ?? 0) + Number(t.u.cache_creation_input_tokens ?? 0) + Number(t.u.cache_read_input_tokens ?? 0);
    initial ??= ctx;
    if (ctx > peak) peak = ctx;
    times.push(t.ts);
  }
  const toolCalls = {};
  const toolResultChars = {};
  let reads = 0;
  let readChars = 0;
  const perFile = new Map();
  for (const [id, u] of ev.toolUses) {
    if (!inWindow(u.ts)) continue;
    times.push(u.ts);
    toolCalls[u.name] = (toolCalls[u.name] ?? 0) + 1;
    const chars = ev.results.get(id) ?? 0;
    toolResultChars[u.name] = (toolResultChars[u.name] ?? 0) + chars;
    if (u.name === 'Read' && u.path) {
      reads++;
      readChars += chars;
      const key = redactPath(u.path, roots);
      perFile.set(key, (perFile.get(key) ?? 0) + chars);
    }
  }
  const texts = ev.texts.filter((x) => inWindow(x.ts));
  for (const x of texts) times.push(x.ts);
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  const models = Object.keys(byModel);
  return {
    model: models.length ? models.join(',') : null,
    startedUtc: iso(start),
    endedUtc: iso(end),
    runtimeSeconds: start === null ? 0 : toInt((end - start) / 1000),
    turns: turns.length,
    initialContextTokens: initial ?? 0,
    peakContextTokens: peak,
    tokens,
    tokensByModel: byModel,
    toolCalls,
    toolResultChars,
    filesRead: {
      reads,
      distinct: perFile.size,
      totalChars: readChars,
      avgChars: reads ? toInt(readChars / reads) : 0,
      top: [...perFile].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, chars]) => ({ path: p, chars })),
    },
    result: agentResult(agentType, texts, ev.findingsModeAt ?? []),
  };
}

// One lane's verdict counts, in the run report and in the report's Review lanes table.
const laneCounter = () => ({ total: 0, confirmed: 0, falsePositive: 0, wontFix: 0, notActioned: 0, pending: 0, agent: 0 });

// Read routed agents (`<role> on <tool>`) from a run log's `Agents:` header line.
// A `ran in-session:` fallback entry does not count.
export function routedAgentsFromLog(text) {
  let value = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*\|/.test(line) || /^##\s/.test(line)) break;
    const m = /^\s*Agents:\s*(.+)$/.exec(line);
    if (m) {
      value = m[1];
      break;
    }
  }
  if (!value) return [];
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (depth === 0 && (ch === ',' || ch === ';')) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  const routed = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part || /\bran in-session:/i.test(part)) continue;
    const m = /^([a-z][a-z0-9-]*)\s+on\s+([a-z][a-z0-9-]*)(?:\s*\([^)]*\))*\s*$/i.exec(part);
    if (m) routed.push({ role: m[1], tool: m[2] });
  }
  return routed;
}

// The run log's verdict counts, in the report's shape (a non-canonical verdict counts as pending). A triaged verdict
// carrying `(agent)` counts under `agent`, not confirmed / falsePositive / wontFix, through calibration's own bucket, so
// precision here matches `calibration`. `verification` is the run log's Verification: line (finding verification), or
// null. Parser warnings (a Leads: or Verification: line missing a count) go into `warnings`.
export function findingsFromLog(text, name, warnings = []) {
  const log = parseRunLog(text);
  for (const w of log.warnings) warnings.push(`metrics: ${name}: ${w}`);
  const bySeverity = {};
  const byVerdict = { confirmed: 0, falsePositive: 0, wontFix: 0, notActioned: 0, pending: 0, agent: 0 };
  const byLane = {};
  for (const r of log.rows) {
    const b = bucket(r);
    const v = b === 'nonCanonical' ? 'pending' : b;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    byVerdict[v]++;
    for (const lane of r.lanes) {
      byLane[lane] ??= laneCounter();
      byLane[lane].total++;
      byLane[lane][v]++;
    }
  }
  return { log: name, leads: log.leads, verification: log.verification, bySeverity, byVerdict, byLane };
}

export function loopOutcomes(agents) {
  const o = {};
  const verdicts = agents
    .filter((a) => a.agentType === 'refuter')
    .sort((a, b) => String(a.startedUtc).localeCompare(String(b.startedUtc)))
    .flatMap((a) => a.result.verdicts ?? []);
  if (verdicts.length) {
    let accept = 0;
    let firstPass = 0;
    let rework = 0;
    let since = 0;
    for (const v of verdicts) {
      if (v === 'REWORK') {
        rework++;
        since++;
      } else {
        accept++;
        if (since === 0) firstPass++;
        since = 0;
      }
    }
    o.refuter = { verdicts: verdicts.length, accept, rework, acceptedFirstPass: firstPass, openRework: since };
  }
  const statuses = agents.filter((a) => a.agentType === 'builder').flatMap((a) => a.result.statuses ?? []);
  if (statuses.length) {
    const n = (s) => statuses.filter((x) => x === s).length;
    o.builder = { done: n('DONE'), blocked: n('BLOCKED'), partial: n('PARTIAL') };
  }
  // Lead verdicts only; findings-mode verdicts are summed apart, so each count covers one defined set.
  for (const [key, field] of [['verifier', 'leads'], ['verifierFindings', 'findings']]) {
    const sets = agents.filter((a) => a.result[field]);
    if (!sets.length) continue;
    o[key] = { CONFIRMED: 0, PLAUSIBLE: 0, REFUTED: 0 };
    for (const a of sets) for (const k of Object.keys(o[key])) o[key][k] += a.result[field][k];
  }
  return o;
}

// Build the report for one run from the main transcript and its subagent transcripts. Reports already written for
// the same session inside this run's window become childRuns, and their agents are tagged so totals never double.
export function runReport(mainPath, workflow, { since: sinceArg = null, until, roots = [], existing = [] }) {
  const main = readTranscript(mainPath);
  const sessionId = path.basename(mainPath, '.jsonl');
  let invocation = null;
  if (workflow !== 'session') {
    const cut = sinceArg !== null ? sinceArg + 60000 : until;
    invocation = main.invocations
      .filter((i) => i.workflow.toLowerCase() === workflow.toLowerCase() && i.ts <= cut)
      .sort((a, b) => a.ts - b.ts)
      .at(-1) ?? null;
  }
  const since = sinceArg ?? invocation?.ts ?? -Infinity;
  const subDir = path.join(path.dirname(mainPath), sessionId, 'subagents');
  const subs = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f)).sort().map((f) => ({ file: path.join(subDir, f), events: readTranscript(path.join(subDir, f)) }))
    : [];
  // A checkout the session worked in may be gone (a deleted review worktree), so the transcripts' own cwds count too.
  const allRoots = [...new Set([...roots, ...[main, ...subs.map((s) => s.events)].map((e) => e.info.cwd).filter(Boolean)])];
  const orchestrator = measureAgent(main, since, until, allRoots, 'orchestrator');
  let agents = [];
  for (const s of subs) {
    const metaPath = s.file.replace(/\.jsonl$/, '.meta.json');
    let meta = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(readText(metaPath));
      } catch {
        meta = null;
      }
    }
    const type = meta?.agentType ? String(meta.agentType) : 'unknown';
    const m = measureAgent(s.events, since, until, allRoots, type);
    if (m.turns === 0 && !Object.keys(m.toolCalls).length) continue;
    agents.push({
      agentId: path.basename(s.file, '.jsonl').replace(/^agent-/, ''),
      agentType: type,
      description: meta?.description ? String(meta.description) : '',
      spawnDepth: Number(meta?.spawnDepth ?? 1),
      childRunId: null,
      ...m,
    });
  }
  agents = agents.sort((a, b) => String(a.startedUtc).localeCompare(String(b.startedUtc)));

  const childRuns = [];
  for (const r of existing) {
    if (r.sessionId !== sessionId || !r.startedUtc || r.workflow === workflow) continue;
    const rs = Date.parse(r.startedUtc);
    if (!(rs >= since && rs <= until)) continue;
    const ids = new Set((r.agents ?? []).map((a) => a.agentId));
    for (const a of agents) if (ids.has(a.agentId)) a.childRunId = r.runId;
    childRuns.push({ runId: r.runId, workflow: r.workflow, file: r.file });
  }

  const tokens = newCounter();
  const ownTokens = newCounter();
  const tokensByModel = {};
  let fileReads = 0;
  let fileChars = 0;
  for (const x of [orchestrator, ...agents]) {
    addCounter(tokens, x.tokens);
    if (!x.childRunId) addCounter(ownTokens, x.tokens);
    for (const [k, v] of Object.entries(x.tokensByModel)) addCounter((tokensByModel[k] ??= newCounter()), v);
    fileReads += x.filesRead.reads;
    fileChars += x.filesRead.totalChars;
  }
  const agentsByType = {};
  for (const a of agents) agentsByType[a.agentType] = (agentsByType[a.agentType] ?? 0) + 1;
  const startT = Number.isFinite(since) ? since : orchestrator.startedUtc ? Date.parse(orchestrator.startedUtc) : until;
  const ends = [orchestrator, ...agents].map((x) => x.endedUtc && Date.parse(x.endedUtc)).filter(Boolean);
  const endT = ends.length ? Math.max(...ends) : startT;
  return {
    transcriptBranch: main.info.branch,
    warning:
      workflow !== 'session' && !invocation && sinceArg === null
        ? `metrics: no /${workflow} invocation in ${sessionId}; the report covers the whole session`
        : null,
    report: {
      workflow,
      sessionId,
      startedUtc: iso(startT),
      endedUtc: iso(endT),
      wallClockSeconds: toInt((endT - startT) / 1000),
      claudeCodeVersion: main.info.version,
      entrypoint: main.info.entrypoint,
      totals: {
        agents: agents.length,
        agentsByType,
        tokens,
        ownTokens,
        tokensByModel,
        filesRead: { reads: fileReads, totalChars: fileChars, avgChars: fileReads ? toInt(fileChars / fileReads) : 0 },
      },
      childRuns,
      orchestrator,
      agents,
      outcomes: loopOutcomes(agents),
    },
  };
}

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  return r.status === 0 ? r.stdout.trim() : null;
};

export const repoTop = (cwd) => git(cwd, ['rev-parse', '--show-toplevel']);

export function findTranscript(id, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
  if (!id) throw new Error('metrics: no session id. Run inside Claude Code (CLAUDE_CODE_SESSION_ID) or pass --session / --transcript.');
  if (!/^[\w.-]+$/.test(id)) throw new Error(`metrics: --session ${id} is not a session id`);
  const dirs = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
  for (const d of dirs) {
    const f = path.join(projectsDir, d.name, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`metrics: no transcript for session ${id} under ${projectsDir}`);
}

function readReports(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try {
      const r = JSON.parse(readText(path.join(e.parentPath ?? e.path, e.name)));
      if (r?.runId) out.push(r);
    } catch {
      // not a report
    }
  }
  return out;
}

export const SKIPPED = 'metrics: skipped (no Claude Code session; capture reads Claude Code transcripts only)';

// capture: returns { report, file, warnings } (file is where it goes; the caller writes it unless printing), or
// { skipped } with no --session, no --transcript, no CLAUDE_CODE_SESSION_ID and not inside Claude Code (`inClaudeCode`:
// CLAUDECODE set).
export function capture({ cwd, workflow, session, transcript, log, mode, version, out, now = Date.now(), projectsDir, inClaudeCode = false }) {
  if (!/^[\w:-]+$/.test(workflow ?? '')) throw new Error('metrics: capture needs --workflow <name> (pre-pr-review, or session for a whole transcript)');
  // Outside Claude Code there is no session to read: a clean skip, not an error, so a review on another tool goes on.
  // Inside Claude Code a missing session id is an error (findTranscript says so), not a silent skip.
  if (!transcript && !session && !inClaudeCode) return { skipped: SKIPPED };
  const mainPath = transcript ? path.resolve(cwd, transcript) : findTranscript(session, projectsDir);
  if (!fs.existsSync(mainPath)) throw new Error(`metrics: transcript not found: ${mainPath}`);
  if (log && !fs.existsSync(path.resolve(cwd, log))) throw new Error(`metrics: run log not found: ${path.resolve(cwd, log)}`);
  const top = repoTop(cwd) ?? cwd;
  const outDir = path.resolve(cwd, out ?? path.join(top, '.orc', 'metrics'));
  const roots = [top];
  for (const l of (git(cwd, ['worktree', 'list', '--porcelain']) ?? '').split('\n')) {
    const m = /^worktree (.+)$/.exec(l);
    if (m && !roots.includes(m[1])) roots.push(m[1]);
  }
  const { transcriptBranch, warning, report } = runReport(mainPath, workflow, { until: now, roots, existing: readReports(outDir) });
  // A transcript passed by path may belong to another checkout; its own recorded branch wins then.
  const checkedOut = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = (transcript && transcriptBranch) || checkedOut || null;
  const ticket = /(\d{4,6})/.exec(branch ?? '')?.[1] ?? null;
  const email = git(cwd, ['config', 'user.email']);
  const developer = email ? crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12) : 'unknown';
  const started = new Date(report.startedUtc);
  const stamp = started.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const slug = ticket ?? (branch ?? 'no-branch').replace(/[^\w-]/g, '-');
  const runId = `${stamp}-${workflow.replace(/:/g, '-')}-${slug}-${developer.slice(0, 6)}`;
  const file = path.join(outDir, started.toISOString().slice(0, 7), `${runId}.json`);
  // Repo-relative only when the file sits inside the repo; anything else would carry a home or scratchpad path.
  const rel = path.relative(top, file).replace(/\\/g, '/');
  const inside = rel && !rel.startsWith('../') && rel !== '..' && !path.isAbsolute(rel) && !path.win32.isAbsolute(rel);
  const full = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    file: inside ? rel : `<out>/${started.toISOString().slice(0, 7)}/${runId}.json`,
    developer,
    ticket,
    branch,
    skillVersion: version ?? null,
    mode: mode ?? null,
    ...report,
  };
  const warnings = warning ? [warning] : [];
  if (log) {
    const logText = readText(path.resolve(cwd, log));
    const logName = path.basename(log);
    full.outcomes.findings = findingsFromLog(logText, logName, warnings);
    const routed = routedAgentsFromLog(logText);
    if (routed.length) {
      full.partial = true;
      full.routed = routed;
      warnings.push(`metrics: ${logName}: run is partial (routed agents are outside Claude Code transcripts: ${routed.map((r) => `${r.role} on ${r.tool}`).join(', ')})`);
    }
  }
  return { report: full, file, warnings };
}

// ---------- report ----------

const median = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const sum = (values) => values.filter((x) => x !== null && x !== undefined).reduce((a, b) => a + b, 0);

export function cost(tokensByModel, prices) {
  if (!tokensByModel) return null;
  let total = 0;
  for (const [model, t] of Object.entries(tokensByModel)) {
    const p = prices.models?.[model];
    if (!p) return null;
    total +=
      (t.input * p.input +
        t.cacheWrite5m * p.input * prices.cacheWrite5mMultiplier +
        t.cacheWrite1h * p.input * prices.cacheWrite1hMultiplier +
        t.cacheRead * p.cacheRead +
        t.output * p.output) /
      1e6;
  }
  return total;
}

// Whole numbers round half to even too, so a median of 30.5 reads 30 as it did in the original report.
const num = (n, d = 0) => (n === null || n === undefined ? 'n/a' : (d ? Number(n) : toInt(Number(n))).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fk = (n) => (n === null ? 'n/a' : `${num(n / 1000)}k`);
const fcost = (n) => (n === null ? 'n/a' : `$${num(n, 2)}`);
const fpct = (a, b) => (!b ? 'n/a' : `${num((100 * a) / b)}%`);
const fmin = (s) => (s === null ? 'n/a' : num(s / 60, 1));

export function isoWeek(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function groupBy(items, key) {
  const m = new Map();
  for (const x of items) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function agentSuccess(type, as) {
  if (type === 'builder') {
    const s = as.flatMap((a) => a.result?.statuses ?? []);
    if (s.length) return `DONE ${fpct(s.filter((x) => x === 'DONE').length, s.length)} of ${s.length} reports`;
  }
  if (type === 'refuter') {
    const v = as.flatMap((a) => a.result?.verdicts ?? []);
    if (v.length) return `ACCEPT ${fpct(v.filter((x) => x === 'ACCEPT').length, v.length)} of ${v.length} verdicts`;
  }
  if (type === 'review-verifier') {
    const lead = (k) => sum(as.map((a) => a.result?.leads?.[k] ?? 0));
    const [c, p, r] = [lead('CONFIRMED'), lead('PLAUSIBLE'), lead('REFUTED')];
    if (c + p + r) return `leads upheld ${fpct(c + p, c + p + r)} of ${c + p + r} (refuted ${r})`;
  }
  return '';
}

export function loadRuns(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`metrics: no metrics folder at ${dir}`);
  const runs = readReports(dir).filter((r) => r.schemaVersion === SCHEMA_VERSION && r.startedUtc);
  const parentOf = {};
  for (const r of runs) for (const c of r.childRuns ?? []) if (c.runId) parentOf[c.runId] = r.runId;
  for (const r of runs) r.nestedIn = parentOf[r.runId] ?? null;
  return runs;
}

export function metricsReport(runs, prices = DEFAULT_PRICES) {
  const L = [];
  const top = runs.filter((r) => !r.nestedIn);
  const rawCost = (r) => cost(r.totals?.tokensByModel, prices);
  const c = (r) => (r.partial ? null : rawCost(r));
  L.push('# Agent workflow metrics', '');
  if (!runs.length) return `${[...L, 'No run reports found.'].join('\n')}\n`;
  const starts = runs.map((r) => r.startedUtc).sort();
  const devs = new Set(runs.map((r) => r.developer)).size;
  L.push(`${runs.length} runs (${runs.length - top.length} nested in a parent run) by ${devs} developer(s), ${starts[0].slice(0, 10)} to ${starts.at(-1).slice(0, 10)}. API-equivalent cost of top-level runs: ${fcost(sum(top.map(c)))}. Nested runs count once, inside their parent, in every total.`, '');

  L.push('## Workflows', '');
  L.push('| Workflow | Runs | Median wall clock (min) | Median agents | Median context tokens | Median output tokens | Median cost | Total cost | Median files read | Median chars per read |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [wf, rs] of groupBy(runs, (r) => r.workflow)) {
    const nested = rs.filter((r) => r.nestedIn).length;
    L.push(
      `| ${wf} | ${nested ? `${rs.length} (${nested} nested)` : rs.length} | ${fmin(median(rs.map((r) => r.wallClockSeconds)))} | ${num(median(rs.map((r) => r.totals.agents)), 1)} | ${fk(median(rs.map((r) => r.totals.tokens.context)))} | ${fk(median(rs.map((r) => r.totals.tokens.output)))} | ${fcost(median(rs.map(c)))} | ${fcost(sum(rs.filter((r) => !r.nestedIn).map(c)))} | ${num(median(rs.map((r) => r.totals.filesRead.reads)))} | ${num(median(rs.map((r) => r.totals.filesRead.avgChars)))} |`,
    );
  }
  L.push('');

  const parents = runs.filter((r) => r.childRuns?.length);
  if (parents.length) {
    L.push('Runs that contain a nested run, split into their own work and the linked child runs:', '');
    L.push('| Run | Workflow | Own context tokens | Child runs | Child share of context |');
    L.push('|---|---|---|---|---|');
    for (const p of parents) {
      const own = p.totals.ownTokens.context;
      const all = p.totals.tokens.context;
      L.push(`| ${p.runId} | ${p.workflow} | ${fk(own)} | ${p.childRuns.map((x) => `${x.workflow} \`${x.runId}\``).join(', ')} | ${fpct(all - own, all)} |`);
    }
    L.push('');
  }

  L.push('## Agents', '');
  L.push("One row per agent type. An agent inside a nested run is counted once, from the nested run's report. The orchestrator row is each run's main thread.", '');
  L.push('| Agent | Dispatches | Median initial context | Median peak context | Median context tokens | Median runtime (min) | Median reads | Chars per read | Total cost | Success |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  const rows = runs.flatMap((r) => [{ ...r.orchestrator, agentType: `orchestrator (${r.workflow})` }, ...(r.agents ?? []).filter((a) => !a.childRunId)]);
  for (const [type, as] of groupBy(rows, (a) => a.agentType)) {
    const reads = sum(as.map((a) => a.filesRead.reads));
    const chars = sum(as.map((a) => a.filesRead.totalChars));
    L.push(
      `| ${type} | ${as.length} | ${fk(median(as.map((a) => a.initialContextTokens)))} | ${fk(median(as.map((a) => a.peakContextTokens)))} | ${fk(median(as.map((a) => a.tokens.context)))} | ${fmin(median(as.map((a) => a.runtimeSeconds)))} | ${num(median(as.map((a) => a.filesRead.reads)))} | ${reads ? num(chars / reads) : 'n/a'} | ${fcost(sum(as.map((a) => cost(a.tokensByModel, prices))))} | ${agentSuccess(type, as)} |`,
    );
  }
  L.push('');

  const loops = runs.filter((r) => r.outcomes?.refuter);
  if (loops.length) {
    const s = (f) => sum(loops.map(f));
    const acc = s((r) => r.outcomes.refuter.accept);
    const rw = s((r) => r.outcomes.refuter.rework);
    L.push('## Build loop', '');
    L.push(`Across ${loops.length} runs with a refuter: ${acc} tasks accepted, ${fpct(s((r) => r.outcomes.refuter.acceptedFirstPass), acc)} on the first pass; ${rw} REWORK rounds (${num(rw / Math.max(1, acc), 2)} per accepted task); ${s((r) => r.outcomes.refuter.openRework)} REWORK still open at capture; ${s((r) => r.outcomes.builder?.blocked ?? 0)} builder BLOCKED reports.`, '');
  }

  // A re-run of a review on the same branch carries verdicts forward, so only the latest report per branch counts.
  const reviewed = groupBy(runs.filter((r) => r.outcomes?.findings), (r) => `${r.workflow}|${r.branch}|${r.developer}`).map(([, g]) => g.sort((a, b) => (a.startedUtc < b.startedUtc ? -1 : 1)).at(-1));
  if (reviewed.length) {
    const lanes = {};
    for (const r of reviewed) {
      for (const [lane, v] of Object.entries(r.outcomes.findings.byLane ?? {})) {
        lanes[lane] ??= laneCounter();
        for (const k of Object.keys(lanes[lane])) lanes[lane][k] += Number(v[k] ?? 0);
      }
    }
    L.push('## Review lanes', '');
    L.push(`From the latest review of each of ${reviewed.length} branches. Precision is confirmed / (confirmed + false-positive), from developer verdicts only and shown from ${MIN_DENOMINATOR} such verdicts, as in \`calibration\`; wont-fix, not-actioned, pending and agent verdicts (\`(agent)\`) are left out of it.`, '');
    L.push('| Lane | Findings | Confirmed | False positive | Wont fix | Not actioned | Pending | Precision | Agent verdicts |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const k of Object.keys(lanes).sort()) {
      const l = lanes[k];
      // calibration's own precision and rounding: n/a under its minimum of developer verdicts, so both tools agree.
      L.push(`| ${k} | ${l.total} | ${l.confirmed} | ${l.falsePositive} | ${l.wontFix} | ${l.notActioned} | ${l.pending} | ${pct(precision(l))} | ${l.agent} |`);
    }
    L.push('');
  }

  L.push('## Weekly trend', '');
  L.push('| Week | Workflow | Runs | Median cost | Median context tokens | Median wall clock (min) |');
  L.push('|---|---|---|---|---|---|');
  for (const [k, rs] of groupBy(runs, (r) => `${isoWeek(Date.parse(r.startedUtc))}|${r.workflow}`)) {
    const [wk, wf] = k.split('|');
    L.push(`| ${wk} | ${wf} | ${rs.length} | ${fcost(median(rs.map(c)))} | ${fk(median(rs.map((r) => r.totals.tokens.context)))} | ${fmin(median(rs.map((r) => r.wallClockSeconds)))} |`);
  }
  L.push('');

  L.push('## Developers', '');
  L.push('| Developer (hash) | Runs | Workflows | Total cost |');
  L.push('|---|---|---|---|');
  for (const [dev, rs] of groupBy(top, (r) => r.developer)) {
    const wfs = groupBy(rs, (r) => r.workflow).map(([w, g]) => `${w} ${g.length}`).join(', ');
    L.push(`| ${dev} | ${rs.length} | ${wfs} | ${fcost(sum(rs.map(c)))} |`);
  }
  const unpriced = runs.filter((r) => rawCost(r) === null);
  if (unpriced.length) {
    const models = [...new Set(unpriced.flatMap((r) => Object.keys(r.totals?.tokensByModel ?? {}).filter((m) => !prices.models?.[m])))];
    L.push('', `${unpriced.length} runs used a model missing from the price table and are left out of cost totals: ${models.join(', ')}.`);
  }
  const partial = runs.filter((r) => r.partial);
  if (partial.length) {
    L.push('', `${partial.length} partial run(s) had routed agents outside Claude Code transcripts and are left out of cost figures.`);
  }
  return `${L.join('\n')}\n`;
}
