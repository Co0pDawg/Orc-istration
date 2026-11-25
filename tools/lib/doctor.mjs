// orc doctor: read-only checks of the shared state home, each active tool and the board. Creates nothing; prints paths,
// tool ids and the board address, never another config value (and never an auth probe's output).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { orcHome, configFile, loadConfig, routeChain, boardDefault } from './config.mjs';
import { dispatchPlan, resolveExecutable, unavailable, binEnv, killTree } from './dispatch.mjs';
import { TIERS } from './models.mjs';
import { loadManifest } from './manifest.mjs';
import { readSettings, ANTIGRAVITY_GUARD_KEY, antigravityGuardScript } from './hooks.mjs';
import { readText } from './text.mjs';

// The --version and auth probes are killed after 5 seconds, the board health GET after 3 (tests pass shorter ones).
export const TIMEOUTS = { probeMs: 5000, boardMs: 3000 };
const message = (e) => (e instanceof Error ? e.message : String(e));
const seconds = (ms) => `${ms / 1000} second${ms === 1000 ? '' : 's'}`;

// `<exe> <args>`, killed after `ms`. Resolves to {code, out} or {problem}; `out` is the first line of stdout.
function probe(exe, args, ms) {
  return new Promise((resolve) => {
    let child;
    let out = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      done({ problem: `no answer within ${seconds(ms)}` });
      killTree(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, ms);
    try {
      child = spawn(exe.command, [...exe.pre, ...args], { shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      done({ problem: `cannot start it (${message(e)})` });
      return;
    }
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', () => {});
    child.on('error', (e) => done({ problem: `cannot start it (${message(e)})` }));
    child.on('close', (code) => done({ code, out: out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)?.slice(0, 100) }));
  });
}

const isLocalBoard = (url) => /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(url);

async function boardHealth(url, ms) {
  try {
    const res = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(ms), redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) return `/api/health answered ${res.status} (a redirect; not followed)`;
    return res.ok ? null : `/api/health answered ${res.status}`;
  } catch (e) {
    return `unreachable (${e instanceof Error && e.name === 'TimeoutError' ? `no answer within ${seconds(ms)}` : 'no connection'})`;
  }
}

// The fix for a binary that is only a .cmd/.bat shim, by where the shim came from.
function shimHint(exe, id, file) {
  if (exe.source === 'config') return `binaries.${id} in ${file} names a .cmd/.bat shim (${exe.shim}), which dispatch cannot start; point it at the real executable`;
  if (exe.source === 'env') return `${binEnv(id)} names a .cmd/.bat shim (${exe.shim}), which dispatch cannot start; point it at the real executable`;
  return `only a .cmd/.bat shim at ${exe.shim}, which dispatch cannot start; set binaries.${id} in ${file} to the real executable`;
}

// Prints one `LEVEL check: detail` line per check (or, with json, one JSON object) and returns 1 when any check FAILs.
export async function runDoctor({ repo, home, json, io, env = process.env, timeouts = TIMEOUTS }, { loadAdapters, loadRoles, loadModels, compareInstall, isArtifactBoard, loadProcedures, isOrcGenerated }) {
  const checks = [];
  const add = (level, check, detail, tool) => checks.push({ level, check, detail, ...(tool ? { tool } : {}) });
  const adapters = await loadAdapters(repo);
  const roles = loadRoles(repo);

  let cfg = { file: configFile(env), config: null };
  try {
    cfg = loadConfig({ tools: adapters.map((a) => a.id), roles: roles.map((r) => r.name), env });
    if (cfg.config) add('OK', 'config', cfg.file);
    else add('WARN', 'config', `no ${cfg.file}; write one to route dispatch without --tool and to use --all (docs/cli.md)`);
    for (const w of cfg.warnings ?? []) add('WARN', 'config', w);
  } catch (e) {
    add('FAIL', 'config', message(e));
  }
  const config = cfg.config;

  // No fallback to the checkout's models alone: dispatch would fail on the same file.
  const sharedModels = path.join(orcHome(env), 'models.json');
  let models = null;
  const modelWarnings = [];
  try {
    models = loadModels(repo, { shared: true, env, warn: (w) => modelWarnings.push(w) });
    add('OK', 'models', fs.existsSync(sharedModels) ? sharedModels : `none (no ${sharedModels})`);
    for (const w of modelWarnings) add('WARN', 'models', w);
  } catch (e) {
    add('FAIL', 'models', message(e));
  }

  // One check that throws becomes that check's WARN; the others still run.
  const guarded = async (check, tool, fn) => {
    try {
      await fn();
    } catch (e) {
      add('WARN', check, `the check failed: ${message(e)}`, tool);
    }
  };

  if (config) {
    const sc = config.setupCheckout;
    if (!sc) add('WARN', 'setupCheckout', `not set in ${cfg.file}`);
    else if (fs.existsSync(path.join(sc, 'tools', 'orc.mjs'))) add('OK', 'setupCheckout', sc);
    else add('WARN', 'setupCheckout', `${sc} does not hold tools/orc.mjs`);

    const bins = { binaries: config.binaries ?? null, configFile: cfg.file };
    const boardRule = boardDefault(config, cfg.file, isArtifactBoard);
    const configBoard = boardRule?.error ? null : boardRule;
    const quiet = { ...io, out: () => {}, err: () => {} };
    for (const id of config.activeTools ?? []) {
      const adapter = adapters.find((a) => a.id === id);
      await guarded('headless', id, async () => {
        if (typeof adapter.headless !== 'function') add('WARN', 'headless', 'no headless recipe, so dispatch cannot run it', id);
        else {
          const tiers = models?.[id] ?? {};
          const gaps = TIERS.filter((t) => !(tiers.headless?.[t] ?? tiers[t]?.model));
          if (!models) add('WARN', 'headless', 'recipe present; the models cannot be read (see the models check)', id);
          else add(gaps.length ? 'WARN' : 'OK', 'headless', gaps.length ? `recipe present; no model for ${gaps.join(', ')}` : 'recipe present; a model for low, mid and high', id);
          const name = adapter.headless(roles[0], { model: 'probe' }, '').command;
          const exe = resolveExecutable(name, id, env, bins);
          const from = { env: `env ${binEnv(id)}`, config: `binaries.${id} in ${cfg.file}`, PATH: 'PATH' }[exe.source];
          // A shim named in binaries or ORC_TOOL_BIN_* is one dispatch will be told to start: FAIL. One found on PATH
          // only: WARN.
          if (exe.shim) add(exe.source === 'PATH' ? 'WARN' : 'FAIL', 'binary', shimHint(exe, id, cfg.file), id);
          else if (exe.missing) add('FAIL', 'binary', exe.reason ?? `${name} not found on PATH`, id);
          else if (exe.unusable) add('FAIL', 'binary', exe.unusable, id);
          else {
            add('OK', 'binary', `${exe.pre[0] ?? exe.command} (from ${from})`, id);
            const v = await probe(exe, ['--version'], timeouts.probeMs);
            if (v.problem) add('WARN', 'version', `--version: ${v.problem}`, id);
            else add(v.code === 0 ? 'OK' : 'WARN', 'version', v.code === 0 ? (v.out ?? 'answered') : `--version exited ${v.code}`, id);
            // The probe's output names the account: only its exit code is reported.
            if (!adapter.authProbe) add('OK', 'auth', 'not checked (no status command)', id);
            else {
              const a = await probe(exe, adapter.authProbe.args, timeouts.probeMs);
              if (a.code === 0) add('OK', 'auth', 'signed in', id);
              else add('WARN', 'auth', `not signed in or the check failed (${a.problem ?? (a.code == null ? 'killed by a signal' : `exit ${a.code}`)})`, id);
            }
          }
        }
      });
      await guarded('install', id, async () => {
        const r = await compareInstall(repo, home, id, {}, quiet, configBoard, env);
        if (r.manifestError) add('FAIL', 'install', `${r.manifestError}; install will refuse`, id);
        else if (r.error) add('WARN', 'install', `cannot compare with ${home}: ${r.error.split('\n')[0]}`, id);
        else if (r.clean) add('OK', 'install', `clean in ${home}`, id);
        else if (r.missing === r.files) add('WARN', 'install', `not installed in ${home}`, id);
        else add('WARN', 'install', `drift in ${home} (status --tool ${id} lists the files)`, id);
      });
      if (id === 'antigravity') {
        await guarded('hooks', id, async () => {
          const hooksFile = path.join(home, '.gemini', 'config', 'hooks.json');
          const homeArg = /\s/.test(home) ? `"${home}"` : home;
          const wireCmd = `node tools/orc.mjs hooks --tool antigravity --home ${homeArg} --apply`;
          if (!fs.existsSync(hooksFile)) {
            add('WARN', 'hooks', `${hooksFile} not found; run ${wireCmd}`, id);
            return;
          }
          let settings;
          try {
            ({ settings } = readSettings(hooksFile));
          } catch (e) {
            add('WARN', 'hooks', `${hooksFile} cannot be parsed (${message(e)})`, id);
            return;
          }
          if (!Object.hasOwn(settings, ANTIGRAVITY_GUARD_KEY)) {
            add('WARN', 'hooks', `${hooksFile} has no ${ANTIGRAVITY_GUARD_KEY} entry; run ${wireCmd}`, id);
            return;
          }
          const { command, script, disabled } = antigravityGuardScript(settings[ANTIGRAVITY_GUARD_KEY]);
          if (disabled) {
            add('WARN', 'hooks', `${ANTIGRAVITY_GUARD_KEY} in ${hooksFile} is disabled (enabled: false)`, id);
            return;
          }
          if (!command || !script) {
            add('WARN', 'hooks', `${ANTIGRAVITY_GUARD_KEY} in ${hooksFile} does not name a guard script; run ${wireCmd}`, id);
            return;
          }
          const resolved = script.startsWith('~/') || script.startsWith('~\\')
            ? path.join(home, script.slice(2))
            : path.isAbsolute(script)
              ? script
              : path.resolve(path.dirname(hooksFile), script);
          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
            add('WARN', 'hooks', `${ANTIGRAVITY_GUARD_KEY} in ${hooksFile} names ${script}, which does not exist (run install --tool antigravity --apply)`, id);
            return;
          }
          add('OK', 'hooks', `${ANTIGRAVITY_GUARD_KEY} wired`, id);
        });
      }
    }

    for (const role of roles) {
      await guarded('routing', undefined, async () => {
        const chain = routeChain(config, role.name);
        if (!chain.length) {
          add('WARN', 'routing', `${role.name}: no route and no fallback; dispatch needs --tool`);
          return;
        }
        const head = `${role.name}: ${chain.join(' > ')}`;
        if (!models) {
          add('FAIL', 'routing', `${head}; the models cannot be read (see the models check), so dispatch cannot run it`);
          return;
        }
        const skipped = [];
        let first = null;
        for (const id of chain) {
          const why = unavailable(dispatchPlan(adapters.find((a) => a.id === id), role, models, '', env, bins));
          if (!why) {
            first = id;
            break;
          }
          skipped.push(`${id} (${why})`);
        }
        if (first) add('OK', 'routing', `${head}; runs ${first}${skipped.length ? `; skips ${skipped.join(', ')}` : ''}`);
        else add('FAIL', 'routing', `${head}; none available: ${skipped.join(', ')}`);
      });
    }

    await guarded('board', undefined, async () => {
      const url = config.board?.url;
      if (!url) add('WARN', 'board', `not configured in ${cfg.file}`);
      else if (boardRule?.error) add('FAIL', 'board', `${boardRule.error}; install --all and status --all refuse it`);
      else if (isLocalBoard(url)) {
        const problem = await boardHealth(url, timeouts.boardMs);
        add(problem ? 'WARN' : 'OK', 'board', problem ? `${url} ${problem}` : `${url} (health ok)`);
      } else add('OK', 'board', `${url} (not fetched)`);
    });
  }

  // Retired board.local.md: warn whenever the file still exists in <home>/.claude/, even without config.json.
  const retiredBoard = path.join(home, '.claude', 'board.local.md');
  if (fs.existsSync(retiredBoard)) {
    const tail = config?.board?.url
      ? `; the board address comes from board.url in ${cfg.file}`
      : `; put its address in ${cfg.file} under board.url (and board.repo for a local board) first`;
    add('WARN', 'board', `${retiredBoard} is no longer read by orc${tail}`);
  }

  // Unrecorded hand-copied board-reminder hook scripts in <home>/.claude/tools/ that differ from this checkout:
  // install keeps them without --force. A manifest-recorded copy that differs is ordinary install drift.
  const claudeAdapter = adapters.find((a) => a.id === 'claude-code');
  const recordedClaudeFiles = (claudeAdapter ? loadManifest(home, claudeAdapter).manifest?.files : null) ?? {};
  for (const name of ['board-reminder.ps1', 'board-reminder.mjs']) {
    if (Object.hasOwn(recordedClaudeFiles, `.claude/tools/${name}`)) continue;
    const installed = path.join(home, '.claude', 'tools', name);
    const source = path.join(repo, 'tools', name);
    if (!fs.existsSync(installed) || !fs.existsSync(source)) continue;
    await guarded('hooks', 'claude-code', async () => {
      if (readText(installed) !== readText(source)) {
        add('WARN', 'hooks', `${installed} is a hand copy that differs from this checkout, so install keeps it; delete it and run install --tool claude-code --apply to get the current one`, 'claude-code');
      }
    });
  }

  // Hand copies of the routine skills and workflow commands from before install generated them: unrecorded and with no
  // generated marker, so install keeps them in place of the generated wrapper.
  if (loadProcedures && isOrcGenerated && claudeAdapter) {
    await guarded('skills', 'claude-code', async () => {
      for (const p of await loadProcedures(repo)) {
        const rel = p.kind === 'routine' ? `.claude/skills/${p.name}/SKILL.md` : `.claude/commands/${p.name}.md`;
        const installed = path.join(home, ...rel.split('/'));
        if (Object.hasOwn(recordedClaudeFiles, rel) || !fs.existsSync(installed) || isOrcGenerated(readText(installed))) continue;
        add('WARN', 'skills', `${installed} is a hand copy from before install generated it, so install keeps it; delete it and run install --tool claude-code --apply to get the generated one`, 'claude-code');
      }
    });
  }

  const ok = !checks.some((c) => c.level === 'FAIL');
  if (json) io.out(JSON.stringify({ ok, checks }, null, 2));
  else for (const c of checks) io.out(`${c.level} ${c.tool ? `${c.tool} ` : ''}${c.check}: ${c.detail}`);
  return ok ? 0 : 1;
}
