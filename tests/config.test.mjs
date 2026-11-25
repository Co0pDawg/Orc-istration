import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, loadModels, loadRoles, loadAdapters, buildGolden, compareInstall } from '../tools/orc.mjs';
import { runDoctor } from '../tools/lib/doctor.mjs';
import { orcHome, loadConfig, routeChain } from '../tools/lib/config.mjs';
import { resolveExecutable } from '../tools/lib/dispatch.mjs';
import { knownTools } from '../tools/lib/models.mjs';
import { parseMarchingOrders } from '../tools/lib/brief.mjs';
import { q, esc } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const AGENTS = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = tempDir('data');
// No test can start a real claude, agy or codex: PATH holds no agent CLI (System32 stays for taskkill), the Antigravity
// install folder (%LOCALAPPDATA%/agy/bin) points at scratch, and no ORC_TOOL_BIN_* is inherited.
const SAFE_PATH = [tempDir('nopath'), ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32')] : [])].join(path.delimiter);
function setEnv(env, key, value) {
  for (const k of Object.keys(env)) if (k.toLowerCase() === key.toLowerCase()) delete env[k];
  if (value !== undefined) env[key] = value;
}
setEnv(process.env, 'PATH', SAFE_PATH);
setEnv(process.env, 'LOCALAPPDATA', tempDir('localappdata'));
for (const k of Object.keys(process.env)) if (k.startsWith('ORC_TOOL_BIN_')) delete process.env[k];

const TOOLS = knownTools(REPO);
const ROLES = loadRoles(REPO).map((r) => r.name);

// A state home holding config.json (and models.json when given).
function dataDir(config, models) {
  const dir = tempDir('orcdata');
  if (config !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  if (models !== undefined) fs.writeFileSync(path.join(dir, 'models.json'), typeof models === 'string' ? models : JSON.stringify(models));
  return dir;
}

// The CLI in a child with an empty scratch HOME (which must stay empty) and the given state home.
function cli(argv, data, extraEnv = {}) {
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('ORC_TOOL_BIN_')) delete env[k];
  for (const [k, v] of Object.entries({ PATH: SAFE_PATH, HOME: fakeHome, USERPROFILE: fakeHome, ORC_DATA_DIR: data, ...extraEnv })) setEnv(env, k, v);
  const r = spawnSync(process.execPath, [ORC, ...argv], { env, encoding: 'utf8', timeout: 60000 });
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'scratch home stays empty');
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function run(argv, data) {
  const before = process.env.ORC_DATA_DIR;
  process.env.ORC_DATA_DIR = data;
  const out = [];
  const err = [];
  try {
    const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '' });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    process.env.ORC_DATA_DIR = before;
  }
}

// A brief that passes lint for any role: every rulebook item, filled.
function briefFile() {
  const fill = {
    1: 'Find where the session doc is written.',
    2: 'tools/orc.mjs',
    3: 'May change nothing; must not change anything.',
    4: 'Run `npm test`.',
    5: 'Do not edit files.',
    6: 'Paths only, cap 20 lines.',
    7: 'The board CLI is local/board.js.',
    8: 'scratch/scout-board.md',
    9: 'none: a tooling change with no ticket.',
    10: 'The real sessions collection.',
    11: 'BOARD: http://localhost:8377 card cards/c1 stage Build',
  };
  const text = parseMarchingOrders(AGENTS).map((it, i) => `${i + 1}. ${it.text}\n   ${fill[i + 1]}`).join('\n');
  const f = path.join(tempDir('brief'), 'brief.md');
  fs.writeFileSync(f, text);
  return f;
}

// A stub tool: records each start in starts.txt, answers --version, answers an auth status call with `auth` (printing
// an account line), exits with STUB_EXIT. With `hang` it answers nothing and never exits; `version` is the --version
// exit code.
function stub(dir, { auth = 0, hang = false, name = 'stub.mjs', version = 0 } = {}) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `import fs from 'node:fs';
if (${hang}) setInterval(() => {}, 1000);
else if (process.argv[2] === '--version') { console.log('stub-tool 9.9.9'); process.exit(${version}); }
else if (['auth', 'login'].includes(process.argv[2]) && process.argv[3] === 'status') { console.log('Logged in as someone@example.com'); process.exit(${auth}); }
else {
fs.appendFileSync(${JSON.stringify(path.join(dir, 'starts.txt'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(Number(process.env.STUB_EXIT ?? 0));
}
`);
  return file;
}
const starts = (dir) => (fs.existsSync(path.join(dir, 'starts.txt')) ? fs.readFileSync(path.join(dir, 'starts.txt'), 'utf8').trim().split('\n') : []);
const missingPath = () => path.join(tempDir('gone'), 'not-here.exe');
// The start of a dry-run command line for a .mjs stub (run under this Node), quoted as formatCommand quotes it: a temp
// path with a space or a `~` (the 8.3 form of a Windows runner's temp folder) is JSON-quoted.
const stubCommand = (file) => `command: ${q(process.execPath)} ${q(file)}`;

// ---------- config.json ----------

test('orcHome is ORC_DATA_DIR, else ~/.orc; an absent config is no config and creates nothing', () => {
  assert.equal(orcHome({ ORC_DATA_DIR: '/x/y' }), '/x/y');
  assert.equal(orcHome({}), path.join(os.homedir(), '.orc'));
  // Empty or whitespace-only is deliberately the same as unset.
  for (const blank of ['', '   ', '\t']) assert.equal(orcHome({ ORC_DATA_DIR: blank }), path.join(os.homedir(), '.orc'));
  const dir = tempDir('empty');
  const r = loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } });
  assert.deepEqual(r, { file: path.join(dir, 'config.json'), config: null });
  assert.deepEqual(fs.readdirSync(dir), []);
  const nowhere = path.join(tempDir('parent'), 'orc');
  assert.equal(loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: nowhere } }).config, null);
  assert.equal(fs.existsSync(nowhere), false, 'reading never creates the state home');
});

test('config.json: every key loads; an invalid file names the file and every problem, never a value', () => {
  const abs = path.resolve(tempDir('bin'), 'codex.exe');
  const good = {
    version: 1,
    activeTools: ['claude-code', 'codex'],
    setupCheckout: REPO,
    board: { url: 'http://localhost:8377', repo: REPO },
    binaries: { codex: abs },
    fallback: 'claude-code',
    routing: { builder: ['antigravity', 'claude-code'], scout: 'claude-code' },
  };
  const dir = dataDir(good);
  assert.deepEqual(loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } }).config, good);
  assert.deepEqual(routeChain(good, 'builder'), ['antigravity', 'claude-code']);
  assert.deepEqual(routeChain(good, 'scout'), ['claude-code']);
  assert.deepEqual(routeChain(good, 'refuter'), ['claude-code']);
  assert.deepEqual(routeChain({ version: 1 }, 'refuter'), []);

  const bad = dataDir({
    activeTools: [],
    board: { url: 'http://localhost:1', token: 'SECRET-1' },
    binaries: { codex: 'relative/codex.exe' },
    fallback: 7,
    routing: { builder: [], scout: [42] },
  });
  const file = path.join(bad, 'config.json');
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: bad } }), (e) => {
    assert.ok(e.message.startsWith(`${file}: `), e.message);
    for (const p of ['version is required', 'activeTools: must be a non-empty array', 'board: unknown key "token"', 'binaries.codex: must be an absolute path', 'fallback: must be a tool id', 'routing.builder: must not be an empty list', 'routing.scout[0]: must be a tool id']) {
      assert.ok(e.message.includes(p), `${p} in ${e.message}`);
    }
    assert.doesNotMatch(e.message, /SECRET/);
    return true;
  });
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dataDir({ version: 2 }) } }), /version must be 1/);
  const broken = dataDir('{ "version": 1, "fallback": "SECRET-4" ');
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: broken } }), (e) => e.message.startsWith(path.join(broken, 'config.json')) && /not valid JSON/.test(e.message) && !/SECRET/.test(e.message));
});

test('config.json: an entry this checkout does not know is dropped with one warning each, never half applied', () => {
  const dir = dataDir({
    version: 1,
    newer: { x: 'SECRET-1' },
    activeTools: ['codex', 'SECRET-2', 'antigravity'],
    binaries: { codex: path.resolve(tempDir('bin'), 'codex.exe'), 'future-tool': '/SECRET-3' },
    fallback: 'SECRET-4',
    routing: { builder: ['SECRET-5', 'claude-code'], scout: ['SECRET-6'], refuter: 'SECRET-7', 'future-role': 'claude-code', researcher: 'codex' },
  });
  const file = path.join(dir, 'config.json');
  const { config, warnings } = loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } });
  const ignored = '(ignored; this checkout does not know it)';
  assert.deepEqual(warnings, [
    `${file}: unknown key "newer" ${ignored}`,
    `${file}: activeTools[1]: not a known tool id ${ignored}`,
    `${file}: binaries: "future-tool" is not a known tool id ${ignored}`,
    `${file}: fallback: not a known tool id ${ignored}`,
    `${file}: routing.builder[0]: not a known tool id ${ignored}`,
    `${file}: routing.scout[0]: not a known tool id, and no known tool is left, so the routing.scout entry is dropped ${ignored}`,
    `${file}: routing.refuter: not a known tool id, so the routing.refuter entry is dropped ${ignored}`,
    `${file}: routing: unknown role "future-role" ${ignored}`,
  ]);
  assert.doesNotMatch(warnings.join('\n'), /SECRET/, 'keys and role names only, never a value');
  assert.deepEqual(Object.keys(config), ['version', 'activeTools', 'binaries', 'routing']);
  assert.deepEqual(config.activeTools, ['codex', 'antigravity']);
  assert.deepEqual(Object.keys(config.binaries), ['codex']);
  assert.deepEqual(config.routing, { builder: ['claude-code'], researcher: 'codex' });
  assert.deepEqual(routeChain(config, 'scout'), [], 'a dropped entry leaves no route, and no unknown tool');
  // Every activeTools entry unknown: the key is dropped (never left empty), the last warning says so.
  const none = loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dataDir({ version: 1, activeTools: ['x-tool', 'y-tool'] }) } });
  assert.equal(none.config.activeTools, undefined);
  assert.match(none.warnings[1], /activeTools\[1\]: not a known tool id, and no known tool is left, so activeTools is dropped/);
  // A skipped entry never hides a real problem elsewhere.
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dataDir({ version: 1, newer: 1, activeTools: ['codex', 'codex'] }) } }), /activeTools: names a tool more than once/);
});

test('config.json: wrong types and shapes are errors, each named', () => {
  const load = (config) => () => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dataDir(config) } });
  assert.throws(load('[1, 2]'), /config\.json: must be a JSON object$/);
  assert.throws(load('"text"'), /config\.json: must be a JSON object$/);
  for (const [config, problem] of [
    [{ version: 1, setupCheckout: '' }, 'setupCheckout: must be a path'],
    [{ version: 1, setupCheckout: 3 }, 'setupCheckout: must be a path'],
    [{ version: 1, board: 'http://localhost:1' }, 'board: must be an object with url and repo'],
    [{ version: 1, board: { repo: REPO } }, 'board.url: must be the board address'],
    [{ version: 1, board: { url: 'http://localhost:1', repo: 5 } }, 'board.repo: must be a path'],
    [{ version: 1, binaries: ['codex'] }, 'binaries: must be an object of tool id to executable path'],
    [{ version: 1, routing: ['builder'] }, 'routing: must be an object of role name to tool id or list of tool ids'],
    [{ version: 1, routing: { builder: { tool: 'codex' } } }, 'routing.builder: must be a tool id'],
    [{ version: 1, routing: { builder: 7 } }, 'routing.builder: must be a tool id'],
    [{ version: 1, activeTools: 'codex' }, 'activeTools: must be a non-empty array of tool ids'],
  ]) assert.throws(load(config), (e) => e.message.includes(problem), `${problem} for ${JSON.stringify(config)}`);
  // config.json that cannot be read (a folder) names the file and the error code.
  const dir = tempDir('orcdata');
  fs.mkdirSync(path.join(dir, 'config.json'));
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } }), (e) => e.message === `${path.join(dir, 'config.json')}: cannot read (EISDIR)`);
});

test('an unknown tool in ~/.orc/models.json is skipped with a warning; models.json and models.local.json stay strict', () => {
  const repo = tempDir('repo');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(repo, p), { recursive: true });
  const data = dataDir(undefined, { 'future-tool': { high: { model: 'x' } }, codex: { high: { model: 'shared-high' } } });
  const said = [];
  const m = loadModels(repo, { shared: true, env: { ORC_DATA_DIR: data }, warn: (w) => said.push(w) });
  assert.equal(m.codex.high.model, 'shared-high', 'the known tool still applies');
  assert.equal(m['future-tool'], undefined);
  assert.deepEqual(said, [`${path.join(data, 'models.json')}: unknown tool id "future-tool" (ignored; this checkout does not know it)`]);
  // A wrong shape for a known tool is still an error.
  assert.throws(() => loadModels(repo, { shared: true, env: { ORC_DATA_DIR: dataDir(undefined, { 'future-tool': {}, codex: { huge: {} } }) } }), /unknown tier key "huge"/);
  fs.writeFileSync(path.join(repo, 'models.local.json'), JSON.stringify({ 'future-tool': { high: { model: 'x' } } }));
  assert.throws(() => loadModels(repo, { env: { ORC_DATA_DIR: data } }), /models\.local\.json: unknown tool id "future-tool"/);
  fs.rmSync(path.join(repo, 'models.local.json'));
  const base = JSON.parse(fs.readFileSync(path.join(repo, 'models.json'), 'utf8'));
  fs.writeFileSync(path.join(repo, 'models.json'), JSON.stringify({ ...base, 'future-tool': {} }));
  assert.throws(() => loadModels(repo, { env: { ORC_DATA_DIR: data } }), /models\.json: unknown tool id "future-tool"/);
});

test('a routing list that loses an unknown tool keeps only the known ones, with every role still present', () => {
  const dir = tempDir('stub');
  const sf = stub(dir);
  const data = dataDir({ version: 1, binaries: { 'claude-code': sf }, routing: { builder: ['future-tool', 'claude-code'] } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, /routing\.builder\[0\]: not a known tool id \(ignored; this checkout does not know it\)/);
  assert.ok(r.out.includes(`${stubCommand(sf)} -p --agent builder --model opus`), r.out);
  const p = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run', '--prefer', 'claude-code'], data);
  assert.equal(p.code, 0, p.err);
  assert.deepEqual(starts(dir), []);
});

test('the CLI prints each config.json warning once; dispatch, --all and doctor go on without the skipped entries', async () => {
  const dir = tempDir('stub');
  const sf = stub(dir);
  const data = dataDir({ version: 1, newer: true, activeTools: ['claude-code', 'future-tool'], binaries: { 'claude-code': sf }, routing: { builder: 'claude-code', 'future-role': 'codex' } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(r.code, 0, r.err);
  const warns = r.err.trim().split('\n');
  assert.equal(warns.length, 3, r.err);
  for (const w of warns) assert.match(w, /^WARN .*config\.json: .* \(ignored; this checkout does not know it\)$/);
  assert.ok(r.out.includes(`${stubCommand(sf)} -p --agent builder --model opus`), r.out);
  const d = cli(['doctor', '--home', tempDir('home')], data);
  assert.equal(d.code, 0, d.out);
  assert.equal(d.out.split('\n').filter((l) => l.startsWith('WARN config: ')).length, 3, d.out);
  assert.doesNotMatch(d.out, /future-tool \w+:/, 'no check for a tool this checkout does not know');
  const s = await run(['status', '--all', '--home', tempDir('home')], data);
  assert.deepEqual(s.out.split('\n').filter((l) => l.startsWith('== ')), ['== claude-code ==']);
  assert.equal(s.err.split('\n').filter((l) => l.startsWith('WARN ') && l.includes('ignored')).length, 3, s.err);
  assert.deepEqual(starts(dir), []);
});

test('an invalid config.json: dispatch --tool warns and goes on without binaries; routing, --prefer, --all and doctor fail', async () => {
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, binaries: { 'claude-code': stub(dir) }, routing: { builder: 7 } });
  const file = path.join(data, 'config.json');
  const env = { ORC_TOOL_BIN_CLAUDE_CODE: stub(dir) };
  const explicit = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run'], data, env);
  assert.equal(explicit.code, 0, explicit.err);
  assert.equal(explicit.err.trim(), `WARN ${file}: routing.builder: must be a tool id (known: ${TOOLS.join(', ')}) (dispatch --tool goes on without its binaries)`);
  // Without its binaries entry nothing resolves claude-code (PATH holds no agent CLI): the dry run says so.
  const noBins = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(noBins.code, 0, noBins.err);
  assert.match(noBins.out, /^note: claude not found on PATH/m);
  for (const argv of [['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], ['dispatch', '--prefer', 'claude-code', '--role', 'builder', '--brief', briefFile(), '--dry-run'], ['status', '--all', '--home', tempDir('home')], ['install', '--all', '--home', tempDir('home')]]) {
    const r = cli(argv, data, env);
    assert.equal(r.code, 1, argv.join(' '));
    assert.ok(r.err.includes(`${file}: routing.builder: must be a tool id`), r.err);
    assert.equal(r.out, '');
  }
  const d = await run(['doctor', '--home', tempDir('home')], data);
  assert.equal(d.code, 1);
  assert.match(d.out, /^FAIL config: .*routing\.builder: must be a tool id/m);
  assert.deepEqual(starts(dir), []);
});

// ---------- ~/.orc/models.json ----------

test('~/.orc/models.json layers between models.json and models.local.json, only for the commands that pass shared', async () => {
  const repo = tempDir('repo');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(repo, p), { recursive: true });
  const data = dataDir(undefined, { codex: { high: { model: 'shared-high' }, headless: { low: 'shared-low' } } });
  const env = { ORC_DATA_DIR: data };
  const m = loadModels(repo, { shared: true, env });
  assert.equal(m.codex.high.model, 'shared-high');
  assert.equal(m.codex.high.effort, 'high', 'two-level merge keeps the base effort');
  assert.equal(m.codex.headless.low, 'shared-low');
  assert.equal(loadModels(repo, { env }).codex.high.model, 'gpt-6-astra', 'not read without shared');
  assert.equal(loadModels(repo, { local: false, shared: true, env }).codex.high.model, 'gpt-6-astra', 'not read with local: false');
  fs.writeFileSync(path.join(repo, 'models.local.json'), JSON.stringify({ codex: { high: { model: 'local-high' } } }));
  assert.equal(loadModels(repo, { shared: true, env }).codex.high.model, 'local-high', 'models.local.json wins');
  const bad = dataDir(undefined, { codex: { huge: {} } });
  assert.throws(() => loadModels(repo, { shared: true, env: { ORC_DATA_DIR: bad } }), (e) => e.message.startsWith(`${path.join(bad, 'models.json')}: `) && /unknown tier key "huge"/.test(e.message));
});

test('an invalid ~/.orc/models.json never reaches build, check or golden; install, status, dispatch and doctor name it', async () => {
  const bad = dataDir(undefined, '{ not json');
  const file = path.join(bad, 'models.json');
  assert.equal(cli(['check'], bad).code, 0);
  const out = tempDir('dist');
  assert.equal(cli(['build', '--out', out], bad).code, 0);
  process.env.ORC_DATA_DIR = bad;
  try {
    const results = await buildGolden(REPO);
    assert.deepEqual(results.flatMap((r) => r.errors), []);
  } finally {
    process.env.ORC_DATA_DIR = tempDir('data');
  }
  const home = tempDir('home');
  for (const argv of [['install', '--tool', 'antigravity', '--home', home], ['status', '--tool', 'antigravity', '--home', home], ['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run']]) {
    const r = cli(argv, bad);
    assert.equal(r.code, 1, argv.join(' '));
    assert.ok(r.err.includes(`${file}: not valid JSON`), r.err);
  }
  const d = cli(['doctor', '--home', home], bad);
  assert.equal(d.code, 1);
  assert.ok(d.out.includes(`FAIL models: ${file}: not valid JSON`), d.out);
  assert.deepEqual(fs.readdirSync(home), []);
});

// ---------- dispatch routing ----------

test('dispatch with no --tool and no route says what to add, naming config.json', () => {
  const empty = dataDir();
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], empty);
  assert.equal(r.code, 1);
  assert.match(r.err, /dispatch needs --tool, or a routing entry for builder \(or a fallback\) in /);
  assert.ok(r.err.includes(path.join(empty, 'config.json')));
  const routed = dataDir({ version: 1, routing: { scout: 'claude-code' } });
  assert.match(cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], routed).err, /routing entry for builder/);
});

test('dispatch routes to the first available tool, falls back before starting, and never retries after a start', () => {
  const dir = tempDir('stub');
  const sf = stub(dir);
  const gone = missingPath();
  const data = dataDir({ version: 1, binaries: { antigravity: gone, 'claude-code': sf }, routing: { builder: ['antigravity', 'claude-code'] } });
  const file = path.join(data, 'config.json');
  const dry = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.err.trim(), `dispatch: antigravity unavailable (${gone} (binaries.antigravity in ${file}) does not exist); falling back to claude-code`);
  assert.ok(dry.out.split('\n').includes(`${stubCommand(sf)} -p --agent builder --model opus`), dry.out);
  assert.deepEqual(starts(dir), [], 'a dry run starts nothing');

  // The first member is used when available: no fallback line.
  const first = dataDir({ version: 1, binaries: { antigravity: stub(dir) }, routing: { builder: ['antigravity', 'claude-code'] } });
  const r1 = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], first);
  assert.equal(r1.err, '');
  assert.ok(r1.out.startsWith(`${stubCommand(sf)} -p `), r1.out);
  assert.match(r1.out, / --agent builder --model gemini-3\.8-flash-high/);

  // A tool that starts and exits non-zero is not retried on the next.
  const both = tempDir('stub2');
  const failing = dataDir({ version: 1, binaries: { antigravity: stub(both), 'claude-code': stub(both) }, routing: { builder: ['antigravity', 'claude-code'] } });
  const real = cli(['dispatch', '--role', 'builder', '--brief', briefFile()], failing, { STUB_EXIT: '3' });
  assert.equal(real.code, 3);
  assert.equal(starts(both).length, 1, 'one start only');
  assert.doesNotMatch(real.err, /falling back/);
});

test('dispatch: none available exits 1 listing each member, also under --dry-run; a .cmd binary and an absent override count as unavailable', () => {
  const dir = tempDir('shim');
  const shim = path.join(dir, 'claude.cmd');
  fs.writeFileSync(shim, '@echo off\r\n');
  const gone = missingPath();
  const data = dataDir({ version: 1, binaries: { 'claude-code': shim }, fallback: 'claude-code', routing: { builder: ['cursor', 'antigravity'] } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data, { ORC_TOOL_BIN_ANTIGRAVITY: gone });
  assert.equal(r.code, 1);
  assert.match(r.err, /^dispatch: cursor unavailable \(no headless recipe for cursor\)$/m);
  assert.ok(r.err.includes(`dispatch: antigravity unavailable (ORC_TOOL_BIN_ANTIGRAVITY names ${gone}, which does not exist)`), r.err);
  assert.match(r.err, /dispatch: claude-code unavailable \(.*claude\.cmd \(binaries\.claude-code in .*\) is a \.cmd\/\.bat shim, which cannot be started without a shell\)/);
  assert.match(r.err, /dispatch: no tool available for builder \(cursor, antigravity, claude-code\); nothing started$/m);
  assert.equal(r.out, '');
  assert.doesNotMatch(r.err, /falling back/);
});

test('dispatch --tool is explicit: no fallback, a configured binary that is gone fails naming the path and config.json', () => {
  const gone = missingPath();
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, binaries: { antigravity: gone, 'claude-code': stub(dir) }, fallback: 'claude-code' });
  const file = path.join(data, 'config.json');
  const dry = cli(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(dry.code, 0);
  assert.ok(dry.out.includes(`note: ${gone} (binaries.antigravity in ${file}) does not exist`), dry.out);
  const real = cli(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], data);
  assert.equal(real.code, 1);
  assert.ok(real.err.includes(`cannot run antigravity: ${gone} (binaries.antigravity in ${file}) does not exist`), real.err);
  assert.doesNotMatch(real.err, /falling back/);
  assert.deepEqual(starts(dir), []);
  // ORC_TOOL_BIN_<TOOL> wins over binaries; a .mjs binary runs under this Node.
  const viaEnv = cli(['dispatch', '--tool', 'antigravity', '--role', 'scout', '--brief', briefFile()], data, { ORC_TOOL_BIN_ANTIGRAVITY: stub(dir) });
  assert.equal(viaEnv.code, 0, viaEnv.err);
  const viaConfig = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile()], data);
  assert.equal(viaConfig.code, 0, viaConfig.err);
  assert.equal(starts(dir).length, 2);
});

test('dispatch --model replaces the first tool\'s model, keeps the effort, and is dropped on a fallback', () => {
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, binaries: { codex: stub(dir), 'claude-code': stub(dir) }, routing: { builder: ['codex', 'claude-code'] } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run', '--model', 'gpt-6.2-astra'], data);
  assert.equal(r.code, 0, r.err);
  const mxc = process.platform === 'win32' ? ' -c windows\\.sandbox=mxc' : '';
  assert.match(r.out, new RegExp(`exec --model gpt-6\\.2-astra --sandbox workspace-write -c "model_reasoning_effort=\\\\"high\\\\""${mxc} -`));
  const explicit = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run', '--model', 'sonnet'], data);
  assert.match(explicit.out, /--agent scout --model sonnet$/m);

  const fallback = dataDir({ version: 1, binaries: { codex: missingPath(), 'claude-code': stub(dir) }, routing: { builder: ['codex', 'claude-code'] } });
  const f = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run', '--model', 'gpt-6.2-astra'], fallback);
  assert.equal(f.code, 0, f.err);
  assert.match(f.err, /^dispatch: --model gpt-6\.2-astra dropped \(it was for codex\); claude-code runs its high model$/m);
  assert.match(f.out, /--agent builder --model opus$/m);
  assert.match(cli(['status', '--tool', 'codex', '--model', 'x'], fallback).err, /--model applies to dispatch and queue only/);
});

// ---------- doctor ----------

test('doctor with no state home: exit 0, a WARN for config.json, and nothing created', () => {
  const data = path.join(tempDir('parent'), 'orc');
  const home = tempDir('home');
  const r = cli(['doctor', '--home', home], data);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^WARN config: no .*config\.json; write one/m);
  assert.match(r.out, /^OK models: none/m);
  assert.equal(fs.existsSync(data), false);
  assert.deepEqual(fs.readdirSync(home), []);
  const j = cli(['doctor', '--home', home, '--json'], data);
  const parsed = JSON.parse(j.out);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.checks.map((c) => `${c.level} ${c.check}`), ['WARN config', 'OK models']);
});

test('doctor checks each active tool, the routing table and the board; FAIL exits 1; --json is one object', async () => {
  const dir = tempDir('stub');
  const home = tempDir('home');
  const gone = missingPath();
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const data = dataDir(
    {
      version: 1,
      activeTools: ['antigravity', 'codex'],
      setupCheckout: REPO,
      board: { url, repo: REPO },
      binaries: { antigravity: stub(dir), codex: gone },
      routing: { builder: ['codex', 'antigravity'], refuter: 'codex' },
    },
    { codex: { headless: { low: 'luna-x' } } },
  );
  try {
    assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--board', url, '--board-repo', REPO], data)).code, 0);
    const r = await run(['doctor', '--home', home], data);
    const lines = r.out.split('\n');
    const has = (re) => assert.ok(lines.some((l) => re.test(l)), `${re} in\n${r.out}`);
    has(/^OK config: .*config\.json$/);
    has(/^OK models: .*models\.json$/);
    has(/^OK setupCheckout: /);
    has(/^OK antigravity headless: recipe present; a model for low, mid and high$/);
    has(/^OK antigravity binary: .*stub\.mjs \(from binaries\.antigravity in .*config\.json\)$/);
    has(/^OK antigravity version: stub-tool 9\.9\.9$/);
    has(/^OK antigravity auth: not checked \(no status command\)$/);
    has(/^OK antigravity install: clean in /);
    has(/^FAIL codex binary: .*not-here\.exe \(binaries\.codex in .*\) does not exist$/);
    has(/^WARN codex install: not installed in /);
    has(/^OK routing: builder: codex > antigravity; runs antigravity; skips codex \(/);
    has(/^FAIL routing: refuter: codex; none available: codex \(/);
    has(/^WARN routing: scout: no route and no fallback; dispatch needs --tool$/);
    has(new RegExp(`^OK board: ${url.replace(/[.]/g, '\\.')} \\(health ok\\)$`));
    assert.equal(r.code, 1);
    assert.equal(starts(dir).length, 0, 'doctor never starts a model run');

    const j = await run(['doctor', '--home', home, '--json'], data);
    const parsed = JSON.parse(j.out);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.checks.find((c) => c.check === 'version'), { level: 'OK', check: 'version', detail: 'stub-tool 9.9.9', tool: 'antigravity' });
  } finally {
    server.close();
  }
  // An edited install is drift; an unreachable local board is a WARN, never a FAIL.
  fs.appendFileSync(path.join(home, '.gemini', 'AGENTS.md'), 'edited\n');
  const closed = dataDir({ version: 1, activeTools: ['antigravity'], binaries: { antigravity: stub(dir) }, board: { url: 'http://localhost:9', repo: REPO } });
  const r2 = await run(['doctor', '--home', home], closed);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /^WARN antigravity install: drift in /m);
  assert.match(r2.out, /^WARN board: http:\/\/localhost:9 unreachable/m);
  const remote = dataDir({ version: 1, board: { url: 'https://example.invalid/board', repo: REPO } });
  assert.match((await run(['doctor', '--home', home], remote)).out, /^OK board: https:\/\/example\.invalid\/board \(not fetched\)$/m);
  // Only http://localhost and http://127.0.0.1 are fetched: a host that starts with "localhost" is not.
  const lookalike = dataDir({ version: 1, board: { url: 'http://localhost.example.invalid:9', repo: REPO } });
  assert.match((await run(['doctor', '--home', home], lookalike)).out, /^OK board: http:\/\/localhost\.example\.invalid:9 \(not fetched\)$/m);
  const nope = await run(['doctor', '--home', home], dataDir('{"version":1,"nope":true}'));
  assert.equal(nope.code, 0, nope.out);
  assert.match(nope.out, /^WARN config: .*unknown key "nope" \(ignored; this checkout does not know it\)$/m);
  assert.match((await run(['doctor', '--home', home], dataDir('{"version":2}'))).out, /^FAIL config: .*version must be 1/m);
});

test('doctor warns about a PATH that holds only a .cmd shim and names the fix', { skip: process.platform !== 'win32' && 'the .cmd shim rule is Windows only' }, () => {
  const bin = tempDir('npmbin');
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@echo off\r\n');
  const data = dataDir({ version: 1, activeTools: ['codex'] });
  const r = cli(['doctor', '--home', tempDir('home')], data, { PATH: bin });
  assert.match(r.out, /^WARN codex binary: only a \.cmd\/\.bat shim at .*codex, which dispatch cannot start; set binaries\.codex in .*config\.json to the real executable$/m);
  assert.equal(r.code, 0, `a shim found only on PATH is a WARN, not a FAIL\n${r.out}`);
});

// ---------- --all ----------

test('--all needs activeTools, excludes --tool, and applies to install and status only', () => {
  const empty = dataDir();
  const r = cli(['status', '--all', '--home', tempDir('home')], empty);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes(`--all needs activeTools in ${path.join(empty, 'config.json')}`), r.err);
  const data = dataDir({ version: 1, activeTools: ['antigravity'] });
  assert.match(cli(['status', '--all', '--tool', 'antigravity'], data).err, /pass --all or --tool, not both/);
  assert.match(cli(['uninstall', '--all'], data).err, /--all applies to install and status only/);
});

test('install --all and status --all run every active tool in order with a header; the board defaults from config.json', async () => {
  const home = tempDir('home');
  const data = dataDir({ version: 1, activeTools: ['codex', 'antigravity'], board: { url: 'http://localhost:8399', repo: REPO } });
  const i = await run(['install', '--all', '--home', home, '--apply'], data);
  assert.equal(i.code, 0, i.err);
  const headers = i.out.split('\n').filter((l) => l.startsWith('== '));
  assert.deepEqual(headers, ['== codex ==', '== antigravity ==']);
  assert.match(i.out, /using the board from .*config\.json: http:\/\/localhost:8399/);
  for (const f of ['.codex/AGENTS.md', '.gemini/AGENTS.md']) assert.match(fs.readFileSync(path.join(home, f), 'utf8'), /board address is `http:\/\/localhost:8399`/);
  const s = await run(['status', '--all', '--home', home], data);
  assert.equal(s.code, 0, s.out);
  assert.match(s.out, /== codex ==[\s\S]*status codex: all same[\s\S]*== antigravity ==[\s\S]*status antigravity: all same/);
  // The manifest's board wins over config.json; a flag wins over both.
  const other = dataDir({ version: 1, activeTools: ['codex'], board: { url: 'http://localhost:8400', repo: REPO } });
  assert.equal((await run(['status', '--all', '--home', home], other)).code, 0);
  const flagged = await run(['status', '--all', '--home', home, '--board', 'http://localhost:8401', '--board-repo', REPO], other);
  assert.equal(flagged.code, 1, 'a different board differs');
  // One tool out of date: the rest still run, the exit code is the worst.
  fs.appendFileSync(path.join(home, '.codex', 'AGENTS.md'), 'edited\n');
  const worst = await run(['status', '--all', '--home', home], data);
  assert.equal(worst.code, 1);
  assert.match(worst.out, /status codex: out of date[\s\S]*status antigravity: all same/);
  assert.equal(worst.err.trim().split('\n').pop(), 'status --all: failed for codex (exit 1)', 'the last line names the tool that failed');
  assert.doesNotMatch(s.err, /--all: failed for/, 'no summary line when every tool exits 0');
});

test('install --all checks every refusal for every tool before writing anything', async () => {
  const withClaude = dataDir({ version: 1, activeTools: ['antigravity', 'claude-code'] });
  // In a child with a scratch HOME (asserted empty), so a regression here cannot write the real home.
  const noHome = cli(['install', '--all', '--apply'], withClaude);
  assert.equal(noHome.code, 1);
  assert.match(noHome.err, /refused: claude-code: refusing --tool claude-code without --home/);

  const home = tempDir('home');
  const artifact = dataDir({ version: 1, activeTools: ['claude-code', 'antigravity'], board: { url: 'https://claude.ai/artifact/abc' } });
  const a = await run(['install', '--all', '--home', home, '--apply'], artifact);
  assert.equal(a.code, 1);
  assert.match(a.err, /refused: antigravity: the artifact board can be written only from Claude Code/);
  assert.deepEqual(fs.readdirSync(home), [], 'claude-code, first in order, was not written');
  assert.match((await run(['status', '--all', '--home', home], artifact)).err, /refused: antigravity: the artifact board/);

  // A hand-written file in the way of the second tool stops the first one too.
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'AGENTS.md'), 'my own rules\n');
  const blocked = dataDir({ version: 1, activeTools: ['antigravity', 'codex'] });
  const b = await run(['install', '--all', '--home', home, '--apply'], blocked);
  assert.equal(b.code, 1);
  assert.match(b.err, /refused: codex: refused \(hand-written; pass --force to replace it, with a backup\): .*AGENTS\.md/);
  assert.match(b.err, /nothing written: install --all refused for codex$/m);
  assert.equal(fs.existsSync(path.join(home, '.gemini')), false);
  assert.equal(fs.readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8'), 'my own rules\n');
  const local = dataDir({ version: 1, activeTools: ['antigravity'], board: { url: 'http://localhost:1' } });
  assert.match((await run(['status', '--all', '--home', home], local)).err, /board\.repo is needed with the local board address/);
});

// ---------- rework round 1 ----------

test('binaries beats PATH: a claude.exe on PATH is passed over for the configured stub; doctor says where it came from', async () => {
  const onPath = tempDir('pathbin');
  const dummy = path.join(onPath, process.platform === 'win32' ? 'claude.exe' : 'claude');
  fs.writeFileSync(dummy, '');
  const pathEnv = { PATH: [onPath, SAFE_PATH].join(path.delimiter) };
  // Without a binaries entry the dummy on PATH is what resolves (so the test below proves config wins over it).
  const plain = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run'], dataDir({ version: 1 }), pathEnv);
  assert.ok(plain.out.startsWith(`command: ${q(dummy)} -p`), plain.out);
  const dir = tempDir('stub');
  const sf = stub(dir);
  const data = dataDir({ version: 1, activeTools: ['claude-code'], binaries: { 'claude-code': sf } });
  const r = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run'], data, pathEnv);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.startsWith(`${stubCommand(sf)} -p --agent scout`), r.out);
  assert.ok(!r.out.includes(dummy), r.out);
  const d = cli(['doctor', '--home', tempDir('home')], data, pathEnv);
  assert.match(d.out, /^OK claude-code binary: .*stub\.mjs \(from binaries\.claude-code in .*config\.json\)$/m);
});

test('dispatch: a tool with no model for the role\'s tier is unavailable, and routing falls back', () => {
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, binaries: { codex: stub(dir), 'claude-code': stub(dir) }, routing: { builder: ['codex', 'claude-code'] } }, { codex: { high: { model: '' } } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err.trim(), 'dispatch: codex unavailable (no high model for codex in the models files (models.json, ~/.orc/models.json, models.local.json)); falling back to claude-code');
  assert.match(r.out, /--agent builder --model opus$/m);
});

test('dispatch --prefer puts a tool first and keeps the chain behind it; not with --tool; works with no config', () => {
  const dir = tempDir('stub');
  const sf = stub(dir);
  const data = dataDir({ version: 1, binaries: { codex: sf, 'claude-code': sf }, fallback: 'claude-code', routing: { refuter: 'claude-code' } });
  const routed = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run'], data);
  assert.match(routed.out, /--agent refuter --model opus$/m, 'the routed reviewer runs Claude Code');
  const second = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run', '--prefer', 'codex', '--model', 'gpt-6.2-astra'], data);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.err, '');
  assert.ok(second.out.startsWith(`${stubCommand(sf)} exec --model gpt-6.2-astra --sandbox workspace-write`), `the second reviewer runs Codex, --model on the first member: ${second.out}`);
  // The preferred tool unavailable: the routing entry and fallback stay behind it, once each.
  const gone = dataDir({ version: 1, binaries: { codex: missingPath(), 'claude-code': stub(dir) }, fallback: 'claude-code', routing: { refuter: ['claude-code', 'codex'] } });
  const f = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run', '--prefer', 'codex'], gone);
  assert.equal(f.code, 0, f.err);
  assert.match(f.err, /^dispatch: codex unavailable \(.*does not exist\); falling back to claude-code$/m);
  assert.equal(f.err.trim().split('\n').length, 1);
  assert.match(f.out, /--agent refuter --model opus$/m);
  // A preferred tool already in the chain is listed once, first.
  const both = dataDir({ version: 1, binaries: { codex: missingPath(), 'claude-code': missingPath() }, fallback: 'claude-code', routing: { refuter: ['claude-code', 'codex'] } });
  const dead = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run', '--prefer', 'codex'], both);
  assert.equal(dead.code, 1);
  assert.match(dead.err, /no tool available for refuter \(codex, claude-code\); nothing started/);
  // No config: the chain is the preferred tool alone.
  const none = dataDir();
  const solo = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run', '--prefer', 'codex'], none, { ORC_TOOL_BIN_CODEX: stub(dir) });
  assert.equal(solo.code, 0, solo.err);
  assert.ok(solo.out.startsWith(`${stubCommand(sf)} exec --model `), solo.out);
  const soloGone = cli(['dispatch', '--role', 'refuter', '--brief', briefFile(), '--dry-run', '--prefer', 'codex'], none);
  assert.equal(soloGone.code, 1);
  assert.match(soloGone.err, /no tool available for refuter \(codex\); nothing started/);
  assert.match(cli(['dispatch', '--tool', 'claude-code', '--prefer', 'codex', '--role', 'refuter', '--brief', briefFile(), '--dry-run'], data).err, /pass --tool or --prefer, not both/);
  assert.match(cli(['dispatch', '--prefer', 'nope', '--role', 'refuter', '--brief', briefFile(), '--dry-run'], data).err, /unknown tool nope/);
  assert.match(cli(['status', '--tool', 'codex', '--prefer', 'codex'], data).err, /--prefer applies to dispatch only/);
  assert.deepEqual(starts(dir), []);
});

test('doctor auth: exit 0 is signed in, any other exit a WARN with the code, no probe is not checked; the output is never printed', async () => {
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, activeTools: ['claude-code', 'codex', 'antigravity'], binaries: { 'claude-code': stub(dir, { name: 'claude.mjs' }), codex: stub(dir, { auth: 1, name: 'codex.mjs' }), antigravity: stub(dir, { name: 'agy.mjs' }) } });
  const r = await run(['doctor', '--home', tempDir('home')], data);
  assert.match(r.out, /^OK claude-code auth: signed in$/m);
  assert.match(r.out, /^WARN codex auth: not signed in or the check failed \(exit 1\)$/m, 'exit 1, the usual not-signed-in code, is never read as signed in');
  assert.match(r.out, /^OK antigravity auth: not checked \(no status command\)$/m);
  assert.doesNotMatch(r.out, /example\.com|Logged in/);
  const j = await run(['doctor', '--home', tempDir('home'), '--json'], data);
  assert.doesNotMatch(j.out, /example\.com|Logged in/);
  assert.deepEqual(JSON.parse(j.out).checks.filter((c) => c.check === 'auth').map((c) => `${c.tool} ${c.level}`), ['claude-code OK', 'codex WARN', 'antigravity OK']);
  assert.deepEqual(starts(dir), [], 'no model run');
});

test('doctor: a probe that never answers is killed at the timeout (WARN), and so is a board that never answers', async () => {
  const dir = tempDir('stub');
  const server = http.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const data = dataDir({ version: 1, activeTools: ['claude-code'], binaries: { 'claude-code': stub(dir, { hang: true }) }, board: { url, repo: REPO } });
  const out = [];
  const started = Date.now();
  try {
    const code = await runDoctor(
      { repo: REPO, home: tempDir('home'), json: false, io: { out: (s) => out.push(s), err: () => {} }, env: { ...process.env, ORC_DATA_DIR: data }, timeouts: { probeMs: 300, boardMs: 300 } },
      { loadAdapters, loadRoles, loadModels, compareInstall: async () => ({ clean: true, files: 1, missing: 0 }), isArtifactBoard: () => false },
    );
    assert.equal(code, 0);
  } finally {
    server.closeAllConnections();
    server.close();
  }
  const text = out.join('\n');
  assert.match(text, /^WARN claude-code version: --version: no answer within 0\.3 seconds$/m);
  assert.match(text, /^WARN claude-code auth: not signed in or the check failed \(no answer within 0\.3 seconds\)$/m);
  assert.match(text, /^WARN board: http:\/\/127\.0\.0\.1:\d+ unreachable \(no answer within 0\.3 seconds\)$/m);
  // The default timeouts add up to 13 seconds; the bound leaves room for slow process kills on a loaded machine.
  assert.ok(Date.now() - started < 10000, 'the short timeouts were used');
});

test('an ORC_TOOL_BIN_* that names a .cmd/.bat shim is unavailable for routing; with --tool it fails naming the shim', () => {
  const dir = tempDir('stub');
  const shim = path.join(tempDir('envshim'), 'claude.cmd');
  fs.writeFileSync(shim, '@echo off\r\n');
  const data = dataDir({ version: 1, binaries: { codex: stub(dir) }, routing: { builder: ['claude-code', 'codex'] } });
  const r = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], data, { ORC_TOOL_BIN_CLAUDE_CODE: shim });
  assert.equal(r.code, 0, r.err);
  assert.ok(r.err.includes(`dispatch: claude-code unavailable (ORC_TOOL_BIN_CLAUDE_CODE names ${shim}, a .cmd/.bat shim, which cannot be started without a shell); falling back to codex`), r.err);
  const explicit = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile()], data, { ORC_TOOL_BIN_CLAUDE_CODE: shim });
  assert.notEqual(explicit.code, 0);
  assert.ok(explicit.err.includes(`${shim} is a .cmd/.bat shim, which cannot be started without a shell; set ORC_TOOL_BIN_CLAUDE_CODE to the real executable`), explicit.err);
  assert.doesNotMatch(explicit.err, /falling back/);
  // A shim named explicitly (env or binaries) is one dispatch will be told to start: FAIL, exit 1.
  const d = cli(['doctor', '--home', tempDir('home')], dataDir({ version: 1, activeTools: ['claude-code'] }), { ORC_TOOL_BIN_CLAUDE_CODE: shim });
  assert.match(d.out, /^FAIL claude-code binary: ORC_TOOL_BIN_CLAUDE_CODE names a \.cmd\/\.bat shim .*; point it at the real executable$/m);
  assert.equal(d.code, 1);
  const c = cli(['doctor', '--home', tempDir('home')], dataDir({ version: 1, activeTools: ['claude-code'], binaries: { 'claude-code': shim } }));
  assert.match(c.out, /^FAIL claude-code binary: binaries\.claude-code in .*config\.json names a \.cmd\/\.bat shim .*; point it at the real executable$/m);
  assert.equal(c.code, 1);
  assert.deepEqual(starts(dir), []);
});

test('config.json: an activeTools list naming a tool twice is refused', () => {
  const dir = dataDir({ version: 1, activeTools: ['codex', 'antigravity', 'codex'] });
  assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } }), /activeTools: names a tool more than once/);
});

// ---------- review fixes ----------

test('install --no-board is recorded, so --all does not add the config.json board back; --board drops the mark', async () => {
  const home = tempDir('home');
  const data = dataDir({ version: 1, activeTools: ['codex'], board: { url: 'http://localhost:8399', repo: REPO } });
  const rulebook = path.join(home, '.codex', 'AGENTS.md');
  const manifest = () => JSON.parse(fs.readFileSync(path.join(home, '.codex', '.orc-manifest.codex.json'), 'utf8'));
  assert.equal((await run(['install', '--all', '--home', home, '--apply'], data)).code, 0);
  assert.match(fs.readFileSync(rulebook, 'utf8'), /board address is `http:\/\/localhost:8399`/);
  assert.equal(manifest().options.noBoard, undefined, 'no mark unless --no-board was given');
  const cleared = await run(['install', '--tool', 'codex', '--home', home, '--no-board', '--apply'], data);
  assert.equal(cleared.code, 0, cleared.err);
  assert.equal(manifest().options.noBoard, true);
  assert.equal(manifest().options.board, null);
  const again = await run(['install', '--all', '--home', home, '--apply'], data);
  assert.equal(again.code, 0, again.err);
  assert.doesNotMatch(again.out, /using the board from/);
  assert.match(again.out, /using the options recorded at install: no board/);
  assert.doesNotMatch(fs.readFileSync(rulebook, 'utf8'), /board address is/, 'the cleared board stays cleared');
  assert.equal(manifest().options.noBoard, true, 'the mark survives a plain re-install');
  const st = await run(['status', '--all', '--home', home], data);
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /status codex: all same/);
  assert.equal((await run(['uninstall', '--tool', 'codex', '--home', home], data)).code, 0, 'uninstall reads the marked manifest');
  const set = await run(['install', '--tool', 'codex', '--home', home, '--board', 'http://localhost:8400', '--board-repo', REPO, '--apply'], data);
  assert.equal(set.code, 0, set.err);
  assert.equal(manifest().options.noBoard, undefined, '--board drops the mark');
  assert.match(fs.readFileSync(rulebook, 'utf8'), /board address is `http:\/\/localhost:8400`/);
});

test('install --all and status --all refuse a --board without --board-repo and an artifact --board on a non-Claude tool', async () => {
  const home = tempDir('home');
  const data = dataDir({ version: 1, activeTools: ['claude-code', 'antigravity'] });
  for (const cmd of ['install', 'status']) {
    const pair = await run([cmd, '--all', '--home', home, '--board', 'http://localhost:1'], data);
    assert.equal(pair.code, 1);
    assert.match(pair.err, /refused: claude-code: pass --board and --board-repo together/);
    assert.match(pair.err, /refused: antigravity: pass --board and --board-repo together/);
    const art = await run([cmd, '--all', '--home', home, '--board', 'https://claude.ai/artifact/abc'], data);
    assert.equal(art.code, 1);
    assert.match(art.err, /refused: antigravity: the artifact board can be written only from Claude Code/);
    assert.doesNotMatch(art.err, /refused: claude-code/, 'an artifact --board is fine for Claude Code');
    assert.match(art.err, new RegExp(`${cmd} --all refused for antigravity$`, 'm'));
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test('install --all dry run: one tool failing does not stop the next; the exit code is the worst and the last line names it', async () => {
  const home = tempDir('home');
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', '.orc-manifest.codex.json'), '{ not json');
  const data = dataDir({ version: 1, activeTools: ['codex', 'antigravity'] });
  const r = await run(['install', '--all', '--home', home], data);
  assert.equal(r.code, 1);
  assert.match(r.err, /orc-manifest\.codex\.json: not valid JSON .*; remove or fix the manifest by hand/);
  assert.match(r.out, /== antigravity ==[\s\S]*dry run for antigravity; add --apply to write/);
  assert.equal(r.err.trim().split('\n').pop(), 'install --all: failed for codex (exit 1)');
  assert.equal(fs.existsSync(path.join(home, '.gemini')), false, 'a dry run writes nothing');
});

test('doctor: a corrupt manifest is FAIL, a local board with no repo is FAIL, and the models failure is named, not judged', async () => {
  const home = tempDir('home');
  fs.mkdirSync(path.join(home, '.gemini'));
  fs.writeFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), '{ not json');
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, activeTools: ['antigravity'], binaries: { antigravity: stub(dir) }, board: { url: 'http://localhost:1' } });
  const r = await run(['doctor', '--home', home], data);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^FAIL antigravity install: .*orc-manifest\.antigravity\.json: not valid JSON .*; install will refuse$/m);
  assert.match(r.out, new RegExp(`^FAIL board: ${esc(path.join(data, 'config.json'))}: board\\.repo is needed with the local board address in board\\.url; install --all and status --all refuse it$`, 'm'));
  assert.match((await run(['status', '--all', '--home', home], data)).err, /board\.repo is needed with the local board address/, '--all refuses the same config');

  const badModels = dataDir({ version: 1, activeTools: ['antigravity'], binaries: { antigravity: stub(dir) }, routing: { builder: 'antigravity' } }, '{ nope');
  const m = await run(['doctor', '--home', tempDir('home')], badModels);
  assert.equal(m.code, 1);
  assert.match(m.out, /^FAIL models: .*not valid JSON/m);
  assert.match(m.out, /^WARN antigravity headless: recipe present; the models cannot be read \(see the models check\)$/m);
  assert.match(m.out, /^FAIL routing: builder: antigravity; the models cannot be read \(see the models check\), so dispatch cannot run it$/m);
  assert.doesNotMatch(m.out, /^OK routing/m, 'no routing line judged from the checkout\'s models alone');
  assert.deepEqual(starts(dir), []);
});

test('doctor WARN and FAIL branches: setup checkout, no recipe, no model, --version, an absent override, the board answer', async () => {
  const dir = tempDir('stub');
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const gone = missingPath();
  const data = dataDir(
    { version: 1, activeTools: ['cursor', 'codex', 'antigravity', 'claude-code'], setupCheckout: tempDir('notcheckout'), binaries: { codex: stub(dir, { version: 2, name: 'codex.mjs' }), antigravity: stub(dir) }, board: { url, repo: REPO } },
    { codex: { low: { model: '' } } },
  );
  let r;
  try {
    r = await runDoctorIn(data, { ORC_TOOL_BIN_CLAUDE_CODE: gone });
  } finally {
    server.close();
  }
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^WARN setupCheckout: .*notcheckout.* does not hold tools\/orc\.mjs$/m);
  assert.match(r.out, /^WARN cursor headless: no headless recipe, so dispatch cannot run it$/m);
  assert.doesNotMatch(r.out, /^\w+ cursor (binary|version|auth):/m, 'no binary, version or sign-in check without a recipe');
  assert.match(r.out, /^WARN codex headless: recipe present; no model for low$/m);
  assert.match(r.out, /^WARN codex version: --version exited 2$/m);
  assert.match(r.out, new RegExp(`^FAIL claude-code binary: ORC_TOOL_BIN_CLAUDE_CODE names ${esc(gone)}, which does not exist$`, 'm'));
  assert.match(r.out, new RegExp(`^WARN board: ${esc(url)} /api/health answered 500$`, 'm'));
  assert.deepEqual(starts(dir), []);
  const noSetup = await run(['doctor', '--home', tempDir('home')], dataDir({ version: 1 }));
  assert.match(noSetup.out, /^WARN setupCheckout: not set in .*config\.json$/m);
  // The comparison itself failing (the artifact config board on a non-Claude tool) is a WARN naming why.
  const art = await run(['doctor', '--home', tempDir('home')], dataDir({ version: 1, activeTools: ['antigravity'], binaries: { antigravity: stub(dir) }, board: { url: 'https://claude.ai/artifact/abc' } }));
  assert.match(art.out, /^WARN antigravity install: cannot compare with .*: the artifact board can be written only from Claude Code/m);
});

// runDoctor with the real dependencies and `extra` added to the environment it is given (process.env is untouched).
async function runDoctorIn(data, extra = {}, { home = tempDir('home'), compare = compareInstall } = {}) {
  const out = [];
  const code = await runDoctor(
    { repo: REPO, home, json: false, io: { out: (s) => out.push(s), err: () => {} }, env: { ...process.env, ORC_DATA_DIR: data, ...extra } },
    { loadAdapters, loadRoles, loadModels, compareInstall: compare, isArtifactBoard: (b) => /^(?:https:\/\/)?claude\.ai\/(?:code\/)?artifact\//.test(b ?? '') },
  );
  return { code, out: out.join('\n') };
}

test('doctor: a check that throws is that check\'s WARN and the others still print; its env reaches the install comparison', async () => {
  const dir = tempDir('stub');
  const data = dataDir({ version: 1, activeTools: ['antigravity'], binaries: { antigravity: stub(dir) }, routing: { builder: 'antigravity' } });
  const thrown = await runDoctorIn(data, {}, { compare: async () => { throw new Error('EISDIR: illegal operation on a directory'); } });
  assert.equal(thrown.code, 0, thrown.out);
  assert.match(thrown.out, /^WARN antigravity install: the check failed: EISDIR: illegal operation on a directory$/m);
  assert.match(thrown.out, /^OK antigravity binary: /m, 'the checks before it are kept');
  assert.match(thrown.out, /^OK routing: builder: antigravity; runs antigravity$/m, 'the checks after it still run');
  assert.match(thrown.out, /^WARN board: not configured/m);

  // A codex install made with a shared models.json is clean only when the comparison reads that same models.json
  // through the doctor's env, not process.env's (an empty scratch state home).
  const shared = dataDir({ version: 1, activeTools: ['codex'], binaries: { codex: stub(dir) } }, { codex: { high: { model: 'env-thread-model' } } });
  const home = tempDir('home');
  assert.equal((await run(['install', '--tool', 'codex', '--home', home, '--apply'], shared)).code, 0);
  assert.match(fs.readFileSync(path.join(home, '.codex', 'agents', 'builder.toml'), 'utf8'), /env-thread-model/);
  assert.notEqual(process.env.ORC_DATA_DIR, shared);
  const d = await runDoctorIn(shared, {}, { home });
  assert.match(d.out, /^OK codex install: clean in /m);
  assert.deepEqual(starts(dir), []);
});

test('resolveExecutable: a binaries entry naming a folder is missing; a bare-name override stays available', () => {
  const folder = tempDir('afolder');
  const r = resolveExecutable('codex', 'codex', { PATH: '' }, { binaries: { codex: folder }, configFile: 'config.json' });
  assert.equal(r.missing, true);
  assert.equal(r.reason, `${folder} (binaries.codex in config.json) does not exist`);
  const bare = resolveExecutable('codex', 'codex', { PATH: '', ORC_TOOL_BIN_CODEX: 'my-codex' });
  assert.deepEqual(bare, { command: 'my-codex', pre: [], source: 'env' }, 'a bare name is left to the OS search, with no unusable mark');
});

test('each adapter\'s sign-in probe is pinned: claude auth status, codex login status, none for Antigravity', async () => {
  const adapters = await loadAdapters(REPO);
  const probes = Object.fromEntries(adapters.filter((a) => typeof a.headless === 'function').map((a) => [a.id, a.authProbe?.args ?? null]));
  assert.deepEqual(probes, { antigravity: null, 'claude-code': ['auth', 'status'], codex: ['login', 'status'] });
});

test('a dry run from a temp folder whose name holds a space and a ~ prints the stub path quoted', () => {
  const odd = fs.mkdtempSync(path.join(os.tmpdir(), 'orc odd ~dir-'));
  const sf = stub(odd);
  const data = dataDir({ version: 1, binaries: { 'claude-code': sf } });
  const r = cli(['dispatch', '--tool', 'claude-code', '--role', 'scout', '--brief', briefFile(), '--dry-run'], data);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.startsWith(`${stubCommand(sf)} -p --agent scout --model `), r.out);
  assert.ok(r.out.includes(JSON.stringify(sf)), 'the path is JSON-quoted');
  assert.deepEqual(starts(odd), []);
});

test('dispatch --tool --dry-run notes an ORC_TOOL_BIN_* shim it cannot start', () => {
  const shim = path.join(tempDir('envshim'), 'codex.cmd');
  fs.writeFileSync(shim, '@echo off\r\n');
  const r = cli(['dispatch', '--tool', 'codex', '--role', 'scout', '--brief', briefFile(), '--dry-run'], dataDir(), { ORC_TOOL_BIN_CODEX: shim });
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes(`note: ORC_TOOL_BIN_CODEX names ${shim}, a .cmd/.bat shim, which cannot be started without a shell`), r.out);
});

// ---------- second-review fixes F1-F7 ----------

test('F1: install --all --apply writes nothing for any tool when an ancestor is not a directory or a target is a directory', async () => {
  // Reviewer reproduction: activeTools [antigravity, codex], regular file at <home>/.codex/agents.
  const home = tempDir('f1-file');
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'agents'), 'blocker\n');
  const data = dataDir({ version: 1, activeTools: ['antigravity', 'codex'] });
  const all = await run(['install', '--all', '--apply', '--home', home], data);
  assert.equal(all.code, 1);
  assert.match(all.err, /refused: codex: .*\.codex[\\/]agents is not a directory/);
  assert.match(all.err, /nothing written: install --all refused for codex$/m);
  assert.equal(fs.existsSync(path.join(home, '.gemini')), false, 'antigravity must not be written');
  assert.equal(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')), false, 'codex AGENTS.md must not be written');
  assert.equal(fs.readFileSync(path.join(home, '.codex', 'agents'), 'utf8'), 'blocker\n');

  // A single-tool install keeps its own rule: it stops at the failure and records what it wrote, so uninstall
  // undoes it (tests/manifest.test.mjs). Only --all, which would otherwise leave some tools installed, checks first.

  // Target itself is a directory: --all --apply refuses and writes nothing.
  const homeDir = tempDir('f1-dir');
  fs.mkdirSync(path.join(homeDir, '.codex', 'AGENTS.md'), { recursive: true });
  const allDir = await run(['install', '--all', '--apply', '--home', homeDir], data);
  assert.equal(allDir.code, 1);
  assert.match(allDir.err, /refused: codex: .*AGENTS\.md is a directory/);
  assert.equal(fs.existsSync(path.join(homeDir, '.gemini')), false);
});

test('F2: status --all and install --all catch per-tool exceptions, report them and continue to the next tool', async (t) => {
  // Reviewer reproduction: activeTools [codex, antigravity], regular file at <home>/.codex/agents.
  const home = tempDir('f2');
  const data = dataDir({ version: 1, activeTools: ['codex', 'antigravity'] });
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'], data)).code, 0);
  fs.mkdirSync(path.join(home, '.codex'));
  fs.writeFileSync(path.join(home, '.codex', 'agents'), 'blocker\n');
  const st = await run(['status', '--all', '--home', home], data);
  assert.equal(st.code, 1);
  assert.match(st.out, /^== codex ==[\s\S]*^== antigravity ==[\s\S]*^status antigravity: all same$/m);
  assert.match(st.err, /^codex: ENOTDIR/m);
  assert.equal(st.err.trim().split('\n').pop(), 'status --all: failed for codex (exit 1)');

  // install --all (dry run) catching an exception thrown while running the first tool still runs the second.
  const home2 = tempDir('f2-inst');
  const needle = path.join(home2, '.codex', 'AGENTS.md');
  const realExists = fs.existsSync;
  t.mock.method(fs, 'existsSync', (p) => {
    if (p === needle) throw new Error('EIO: simulated read error');
    return realExists(p);
  });
  const inst = await run(['install', '--all', '--home', home2], data);
  assert.equal(inst.code, 1);
  assert.match(inst.out, /^== codex ==[\s\S]*^== antigravity ==[\s\S]*dry run for antigravity; add --apply to write/m);
  assert.match(inst.err, /^codex: EIO: simulated read error$/m);
  assert.equal(inst.err.trim().split('\n').pop(), 'install --all: failed for codex (exit 1)');
});

test('F3: resolveExecutable treats a directory in ORC_TOOL_BIN_* or binaries as unusable and routing falls back', () => {
  const folder = tempDir('bindir');
  const envRes = resolveExecutable('agy', 'antigravity', { ORC_TOOL_BIN_ANTIGRAVITY: folder, PATH: '' });
  assert.equal(envRes.unusable, `ORC_TOOL_BIN_ANTIGRAVITY names ${folder}, which is not a regular file`);
  const dir = tempDir('stub');
  const sf = stub(dir);
  const envData = dataDir({ version: 1, binaries: { 'claude-code': sf }, routing: { builder: ['antigravity', 'claude-code'] } });
  const rEnv = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], envData, { ORC_TOOL_BIN_ANTIGRAVITY: folder });
  assert.equal(rEnv.code, 0, rEnv.err);
  assert.ok(rEnv.err.includes(`dispatch: antigravity unavailable (ORC_TOOL_BIN_ANTIGRAVITY names ${folder}, which is not a regular file); falling back to claude-code`), rEnv.err);
  assert.ok(rEnv.out.includes(`${stubCommand(sf)} -p --agent builder --model opus`), rEnv.out);

  const binData = dataDir({ version: 1, binaries: { antigravity: folder, 'claude-code': sf }, routing: { builder: ['antigravity', 'claude-code'] } });
  const rBin = cli(['dispatch', '--role', 'builder', '--brief', briefFile(), '--dry-run'], binData);
  assert.equal(rBin.code, 0, rBin.err);
  assert.ok(rBin.err.includes(`dispatch: antigravity unavailable (${folder} (binaries.antigravity in ${path.join(binData, 'config.json')}) does not exist); falling back to claude-code`), rBin.err);
  assert.ok(rBin.out.includes(`${stubCommand(sf)} -p --agent builder --model opus`), rBin.out);
  assert.deepEqual(starts(dir), []);
});

test('F4: validateConfig rejects a routing list that names the same tool twice', () => {
  for (const [role, list] of [['builder', ['codex', 'codex']], ['refuter', ['claude-code', 'codex', 'claude-code']], ['scout', ['SECRET-DUP', 'SECRET-DUP']]]) {
    const dir = dataDir({ version: 1, routing: { [role]: list } });
    assert.throws(() => loadConfig({ tools: TOOLS, roles: ROLES, env: { ORC_DATA_DIR: dir } }), (e) => {
      assert.match(e.message, new RegExp(`routing\\.${role}: names a tool more than once`));
      assert.doesNotMatch(e.message, /SECRET-DUP/);
      return true;
    });
  }
});

test('F5: install --all and status --all validate config board.repo only when a tool actually uses the config board default', async () => {
  const data = dataDir({ version: 1, activeTools: ['codex'], board: { url: 'http://localhost:8377' } });
  // Without flags on an empty home, the config board would be used, so board.repo is still required.
  const empty = tempDir('f5-empty');
  assert.match((await run(['install', '--all', '--home', empty], data)).err, /board\.repo is needed with the local board address/);
  assert.match((await run(['status', '--all', '--home', empty], data)).err, /board\.repo is needed with the local board address/);

  // With --no-board: neither install --all nor status --all fails on board.repo.
  const homeNoBoard = tempDir('f5-nb');
  const iNb = await run(['install', '--all', '--home', homeNoBoard, '--no-board', '--apply'], data);
  assert.equal(iNb.code, 0, iNb.err);
  const sNb = await run(['status', '--all', '--home', homeNoBoard, '--no-board'], data);
  assert.equal(sNb.code, 0, sNb.err);
  // Recorded noBoard: true means plain --all (without flags) no longer uses the config board default either.
  assert.equal((await run(['install', '--all', '--home', homeNoBoard], data)).code, 0);
  assert.equal((await run(['status', '--all', '--home', homeNoBoard], data)).code, 0);

  // With --board / --board-repo flags: neither fails on config.json's missing board.repo.
  const homeFlag = tempDir('f5-flag');
  const iFlag = await run(['install', '--all', '--home', homeFlag, '--board', 'http://localhost:8399', '--board-repo', REPO, '--apply'], data);
  assert.equal(iFlag.code, 0, iFlag.err);
  const sFlag = await run(['status', '--all', '--home', homeFlag, '--board', 'http://localhost:8399', '--board-repo', REPO], data);
  assert.equal(sFlag.code, 0, sFlag.err);
  // Recorded board in manifest means plain status --all also does not need config.json's board.repo.
  assert.equal((await run(['status', '--all', '--home', homeFlag], data)).code, 0);
});

test('F6: ~/.orc/models.json errors name tool, tier, field and permitted choices without echoing the rejected value', async () => {
  const bad = dataDir({ version: 1 }, { codex: { mid: { effort: 'SECRET-EFFORT-VALUE' } } });
  const file = path.join(bad, 'models.json');
  assert.throws(() => loadModels(REPO, { shared: true, env: { ORC_DATA_DIR: bad } }), (e) => {
    assert.ok(e.message.startsWith(`${file}: `), e.message);
    assert.match(e.message, /codex\.mid\.effort: must be one of low, medium, high, xhigh, max, ultra/);
    assert.doesNotMatch(e.message, /SECRET-EFFORT-VALUE/);
    return true;
  });
  const d = await run(['doctor', '--home', tempDir('f6-home')], bad);
  assert.equal(d.code, 1);
  assert.match(d.out, /^FAIL models: .*codex\.mid\.effort: must be one of low, medium, high, xhigh, max, ultra$/m);
  assert.doesNotMatch(d.out, /SECRET-EFFORT-VALUE/);
});

test('F7: doctor board health check does not follow redirects and reports 3xx as WARN', async (t) => {
  const calls = [];
  let status = 302;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    // Simulate default fetch redirect following so reverting redirect: 'manual' turns WARN into OK and fails the test.
    if (init?.redirect !== 'manual') {
      calls.push({ url: 'http://127.0.0.1:8377/elsewhere', redirect: init?.redirect });
      return { ok: true, status: 200 };
    }
    return { ok: false, status };
  });
  const data = dataDir({ version: 1, board: { url: 'http://127.0.0.1:8377', repo: REPO } });
  for (const code of [301, 302, 307]) {
    calls.length = 0;
    status = code;
    const r = await runDoctorIn(data);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`^WARN board: http://127\\.0\\.0\\.1:8377 /api/health answered ${code} \\(a redirect; not followed\\)$`, 'm'));
    assert.deepEqual(calls, [{ url: 'http://127.0.0.1:8377/api/health', redirect: 'manual' }]);
  }
});
