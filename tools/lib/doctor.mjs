// orc doctor: read-only checks of the shared state home, each active tool and the board. Creates nothing; prints paths,
// tool ids and the board address, never another config value (and never an auth probe's output).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { orcHome, configFile, loadConfig, routeChain, boardDefault } from './config.mjs';
import { dispatchPlan, resolveExecutable, unavailable, binEnv, killTree } from './dispatch.mjs';
import { TIERS } from './models.mjs';
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
export async function runDoctor({ repo, home, json, io, env = process.env, timeouts = TIMEOUTS }, { loadAdapters, loadRoles, loadModels, compareInstall, isArtifactBoard }) {
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
    add('WARN', 'board', `${retiredBoard} is no longer read by orc; the board address comes from ${cfg.file}. Reinstall the hook scripts first (install --tool claude-code --apply --force), then delete it`);
  }

  // Outdated board-reminder hook scripts in <home>/.claude/tools/: an older hand-copied script keys on board.local.md
  // and is kept by install/sync without --force.
  for (const name of ['board-reminder.ps1', 'board-reminder.mjs']) {
    const installed = path.join(home, '.claude', 'tools', name);
    const source = path.join(repo, 'tools', name);
    if (!fs.existsSync(installed) || !fs.existsSync(source)) continue;
    await guarded('hooks', 'claude-code', async () => {
      if (readText(installed) !== readText(source)) {
        add('WARN', 'hooks', `${installed} differs from this checkout (an older board reminder still keys on board.local.md); install --tool claude-code --apply --force replaces it, with a backup`, 'claude-code');
      }
    });
  }

  const ok = !checks.some((c) => c.level === 'FAIL');
  if (json) io.out(JSON.stringify({ ok, checks }, null, 2));
  else for (const c of checks) io.out(`${c.level} ${c.tool ? `${c.tool} ` : ''}${c.check}: ${c.detail}`);
  return ok ? 0 : 1;
}
