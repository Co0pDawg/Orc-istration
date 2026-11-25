import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, normalizeEol } from '../tools/lib/frontmatter.mjs';
import { parseRole } from '../tools/lib/roles.mjs';
import { serializeToml, parseToml, tomlMultiline } from '../tools/lib/toml.mjs';
import { main, loadRoles, loadModels, loadAdapters, buildTool, buildGolden, allowedTools, parseAgyModels, firstDiffLine } from '../tools/orc.mjs';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(REPO, 'tests', 'golden');
const read = (f) => normalizeEol(fs.readFileSync(f, 'utf8'));

async function run(argv, stdin = '') {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => stdin });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
}
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-data-'));

async function buildRepo() {
  const roles = loadRoles(REPO);
  const models = loadModels(REPO, { local: false });
  const agentsMd = read(path.join(REPO, 'AGENTS.md'));
  const adapters = await loadAdapters(REPO);
  return { roles, models, agentsMd, adapters };
}

test('frontmatter round-trips the real agent files', () => {
  for (const f of fs.readdirSync(path.join(REPO, 'agents'))) {
    const text = read(path.join(REPO, 'agents', f));
    const { data, body } = parse(text);
    assert.equal(serialize(data, body), text, f);
  }
  const sample = serialize({ name: 'x', description: 'has: colon', tools: ['a', 'b'], subagent: true }, 'Body\n');
  assert.deepEqual(parse(sample).data, { name: 'x', description: 'has: colon', tools: ['a', 'b'], subagent: true });
});

test('roles parse and validate', () => {
  const roles = loadRoles(REPO);
  assert.deepEqual(roles.map((r) => r.name), [
    'builder',
    'debugger',
    'refuter',
    'researcher',
    'review-checklist-explorer',
    'review-code-explorer',
    'review-design-explorer',
    'review-docs-explorer',
    'review-failure-explorer',
    'review-verifier',
    'scout',
  ]);
  const base = '---\nname: x\ndescription: d\ntier: low\naccess: write\ncapabilities:\n  - read\n---\n\nbody\n';
  assert.equal(parseRole(base).tier, 'low');
  assert.throws(() => parseRole(base.replace('tier: low', 'tier: huge')), /unknown tier/);
  assert.throws(() => parseRole(base.replace('  - read', '  - teleport')), /unknown capability/);
  for (const r of roles) if (r.access === 'read-only') assert.match(r.body, /never edit/i, r.name);
});

test('golden snapshots, tool allowlists, read-only roles', async () => {
  // The same build `node tools/orc.mjs golden` writes, so the test and the command cannot drift.
  const roles = loadRoles(REPO);
  const results = await buildGolden(REPO);
  assert.deepEqual(results.map((r) => r.adapter.id), ['antigravity', 'claude-code', 'codex', 'copilot', 'cursor', 'gemini-cli', 'opencode']);
  for (const { adapter, files, errors } of results) {
    assert.deepEqual(errors, [], adapter.id);
    assert.equal(files.filter((f) => f.role).length, roles.length, `${adapter.id} emits every role`);
    const allowed = allowedTools(adapter);
    const edit = new Set(adapter.capabilityTools?.edit ?? []);
    for (const f of files) {
      const golden = path.join(GOLDEN, adapter.id, ...f.path.split('/'));
      assert.equal(f.content, read(golden), `${adapter.id}/${f.path} differs from golden`);
      if (!f.role) continue;
      assert.ok(f.path.startsWith(`${adapter.home.agentsDir}/`), f.path);
      const role = roles.find((r) => r.name === f.role);
      if (f.path.endsWith('.toml')) {
        const t = parseToml(f.content);
        assert.equal(t.name, role.name);
        assert.equal(t.developer_instructions, role.body, `${f.path} body round-trips`);
        continue;
      }
      const { data } = parse(f.content);
      const tools = data.tools === undefined ? [] : Array.isArray(data.tools) ? data.tools : data.tools.split(', ');
      for (const t of tools) assert.ok(allowed.has(t), `${adapter.id} emits ${t}`);
      if (role.access === 'read-only') {
        for (const t of tools) assert.ok(!edit.has(t), `${role.name} gets ${t}`);
        if (adapter.id === 'cursor') assert.equal(data.readonly, true);
        if (adapter.id === 'opencode') assert.deepEqual(data.permissions, [{ action: 'edit', resource: '*', effect: 'deny' }]);
      } else if (adapter.id === 'opencode') assert.equal(data.permissions, undefined);
      if (adapter.id === 'copilot') assert.ok(!tools.includes('agent'));
      // `agy --agent <name>` (the headless recipe) selects only main agents; a role must stay a subagent too.
      if (adapter.id === 'antigravity') {
        assert.equal(data.mainAgent, true, `${f.path} mainAgent`);
        assert.equal(data.subagent, true, `${f.path} subagent`);
      }
    }
  }
});

test('toml strings: quotes, backslashes, triple quotes', () => {
  for (const body of ['plain "q" and \'s\'\n', 'back\\slash \\n "x"\n', "has ''' literal end\n", 'has """ basic end\n', "ends with '", 'tab\tand \u0001 ctl\n']) {
    const toml = serializeToml({ name: 'a"b\\c', developer_instructions: { multiline: body } });
    assert.deepEqual(parseToml(toml), { name: 'a"b\\c', developer_instructions: body }, JSON.stringify(body));
  }
  assert.match(tomlMultiline("x ''' y\n"), /^"""\n/);
  assert.match(tomlMultiline('x """ y\n'), /^'''\n/);
});

test('copilot enforces the 30,000-character agent body cap', async () => {
  const { roles, models, agentsMd, adapters } = await buildRepo();
  const copilot = adapters.find((a) => a.id === 'copilot');
  const big = roles.map((r) => (r.name === 'scout' ? { ...r, body: 'x'.repeat(30001) } : r));
  assert.match(buildTool(copilot, big, models, agentsMd).errors.join('\n'), /scout\.agent\.md body is 30001 characters/);
});

test('models.local.json overrides per tool and tier', () => {
  const copy = tempDir('models');
  fs.copyFileSync(path.join(REPO, 'models.json'), path.join(copy, 'models.json'));
  fs.writeFileSync(path.join(copy, 'models.local.json'), JSON.stringify({ copilot: { high: { model: 'x-high' } }, codex: { mid: { effort: 'low' } } }));
  const m = loadModels(copy);
  assert.deepEqual(m.copilot.high, { model: 'x-high' });
  assert.deepEqual(m.copilot.low, {});
  assert.deepEqual(m.codex.mid, { model: 'gpt-6.1-sol', effort: 'low' });
  assert.deepEqual(loadModels(copy, { local: false }).copilot.high, {});
});

test('antigravity rejects a 30 KB rulebook', async () => {
  const { roles, models, adapters } = await buildRepo();
  const agy = adapters.find((a) => a.id === 'antigravity');
  const { errors } = buildTool(agy, roles, models, 'x'.repeat(30 * 1024));
  assert.match(errors.join('\n'), /limit is under 24000/);
});

test('check passes on the repo and fails on a mutated agents/scout.md', async () => {
  assert.equal((await run(['check'])).code, 0);
  const copy = tempDir('check');
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'models.json', 'roles', 'adapters', 'agents', 'commands', 'tools/lib']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  assert.equal((await run(['check', '--repo', copy])).code, 0);
  const scout = path.join(copy, 'agents', 'scout.md');
  fs.writeFileSync(scout, read(scout).replace('model: haiku', 'model: sonnet'));
  const r = await run(['check', '--repo', copy]);
  assert.equal(r.code, 1);
  assert.match(r.err, /agents\/scout\.md: differs/);
});

test('install: dry run, apply, backup, claude-code guard', async () => {
  const home = tempDir('home');
  const dry = await run(['install', '--tool', 'antigravity', '--home', home]);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /would create/);
  assert.deepEqual(fs.readdirSync(home), []);

  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  for (const p of ['.gemini/AGENTS.md', ...['builder', 'debugger', 'refuter', 'researcher', 'scout'].map((n) => `.gemini/config/agents/${n}.md`)]) {
    assert.ok(fs.existsSync(path.join(home, ...p.split('/'))), p);
  }
  const rule = path.join(home, '.gemini', 'AGENTS.md');
  // An older orc-generated rulebook (it carries the marker) with no manifest entry is replaced normally, with a backup.
  fs.rmSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'));
  const older = '<!-- generated by orc.mjs: antigravity -->\nolder version\n';
  fs.writeFileSync(rule, older);
  const again = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(again.code, 0);
  assert.match(again.out, /applied replace: .*AGENTS\.md/);
  assert.match(again.out, /applied unchanged: .*scout\.md/);
  const backups = fs.readdirSync(path.dirname(rule)).filter((f) => f.startsWith('AGENTS.md.orc-backup-'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^AGENTS\.md\.orc-backup-\d{8}-\d{6}$/);
  assert.equal(read(path.join(path.dirname(rule), backups[0])), older);

  const refused = await run(['install', '--tool', 'claude-code']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refusing --tool claude-code without --home/);
});

const FULL_AGY_MODELS = [
  'gemini-4-neon-high\tGemini 4 Neon (High)',
  'gemini-4-neon-xhigh\tGemini 4 Neon (Extra High)',
  'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  'gemini-pro-orchestrator-neon\tGemini Pro Orchestrator Neon',
].join('\n') + '\n';

test('antigravity emits only agy 1.5.16 tools, no deprecated tools, read-only has no edit, gaps documented', async () => {
  const roles = loadRoles(REPO);
  const [res] = await buildGolden(REPO, 'antigravity');
  assert.deepStrictEqual(res.errors, []);
  assert.ok(res.rulebook && res.rulebook.size < 24000, `rulebook size ${res.rulebook?.size} under 24000`);
  const deprecated = ['find_by_name', 'grep_search', 'list_dir', 'view_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'read_url_content'];
  for (const f of res.files) {
    for (const d of deprecated) {
      assert.ok(!f.content.includes(d), `${f.path} must not name deprecated tool ${d}`);
    }
  }
  const agents = res.files.filter((f) => f.role);
  assert.strictEqual(agents.length, roles.length);
  for (const f of agents) {
    const role = roles.find((r) => r.name === f.role);
    const { data } = parse(f.content);
    assert.ok(Array.isArray(data.tools), `${f.path} tools array`);
    const want = role.access === 'write'
      ? ['read_file', 'run_command', 'write_file', 'edit_file', 'search_web']
      : role.capabilities.includes('web-search')
        ? ['read_file', 'run_command', 'search_web']
        : ['read_file', 'run_command'];
    assert.deepStrictEqual(data.tools, want, `${f.path} tools`);
  }
  const gap = res.adapter.gaps.find((g) => /listing, searching and URL fetching/i.test(g));
  assert.ok(gap, 'gaps mentions listing, searching and URL fetching');
  assert.match(gap, /run_command/);
  assert.match(gap, /search_web/);
  const rulebook = res.files.find((f) => f.path === '.gemini/AGENTS.md');
  assert.ok(rulebook.content.includes(gap), 'generated rulebook includes the missing-tools gap');
});

test('models helper reads agy models output and supports --family', async () => {
  const expectedFlash = {
    antigravity: { headless: { low: 'gemini-3.8-flash-low', mid: 'gemini-3.8-flash-medium', high: 'gemini-3.8-flash-high' } },
  };
  assert.deepStrictEqual(parseAgyModels(FULL_AGY_MODELS).fragment, expectedFlash);
  const ok = await run(['models', '--tool', 'antigravity', '--from-stdin'], FULL_AGY_MODELS);
  assert.strictEqual(ok.code, 0, ok.err);
  assert.strictEqual(ok.out, JSON.stringify(expectedFlash, null, 2));

  const neon = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'neon'], FULL_AGY_MODELS);
  assert.strictEqual(neon.code, 0, neon.err);
  assert.deepStrictEqual(JSON.parse(neon.out), {
    antigravity: { headless: { low: 'gemini-4-neon-low', mid: 'gemini-4-neon-medium', high: 'gemini-4-neon-high' } },
  });

  // Order check: -xhigh and orchestrator-neon before valid tiers, and a later neon family after, are ignored.
  const ordered = [
    'gemini-4-neon-xhigh\tExtra High',
    'gemini-pro-orchestrator-neon\tOrchestrator',
    FULL_AGY_MODELS,
    'gemini-3.9-neon-high\tOlder High',
  ].join('\n');
  const neonEq = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family=neon'], ordered);
  assert.strictEqual(neonEq.code, 0, neonEq.err);
  assert.deepStrictEqual(JSON.parse(neonEq.out), {
    antigravity: { headless: { low: 'gemini-4-neon-low', mid: 'gemini-4-neon-medium', high: 'gemini-4-neon-high' } },
  });

  // Missing tiers for a partial family name the missing tiers and the family.
  const hydrogen = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'hydrogen'], FULL_AGY_MODELS);
  assert.strictEqual(hydrogen.code, 1);
  assert.match(hydrogen.err, /cannot tell the low, mid hydrogen slug\(s\)/);
  assert.doesNotMatch(hydrogen.err, /\bhigh\b/);

  const bad = await run(['models', '--tool', 'antigravity', '--from-stdin'], 'gpt-oss-120b-medium  GPT\n');
  assert.strictEqual(bad.code, 1);
  assert.match(bad.err, /cannot tell the low, mid, high flash slug/);

  // Regex metacharacters in --family are escaped literally.
  const regexFamily = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', '.*'], FULL_AGY_MODELS);
  assert.strictEqual(regexFamily.code, 1);
  assert.match(regexFamily.err, /cannot tell the low, mid, high \.\* slug\(s\)/);

  const missingVal = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family'], FULL_AGY_MODELS);
  assert.strictEqual(missingVal.code, 1);
  assert.match(missingVal.err, /--family needs a value/);

  // (a) Without --family, the original pattern still matches flash-lite slugs.
  const flashLite = [
    'gemini-2.5-flash-lite-high\tGemini 2.5 Flash Lite (High)',
    'gemini-2.5-flash-lite-medium\tGemini 2.5 Flash Lite (Medium)',
    'gemini-2.5-flash-lite-low\tGemini 2.5 Flash Lite (Low)',
  ].join('\n') + '\n';
  const liteRes = await run(['models', '--tool', 'antigravity', '--from-stdin'], flashLite);
  assert.strictEqual(liteRes.code, 0, liteRes.err);
  assert.deepStrictEqual(JSON.parse(liteRes.out), {
    antigravity: { headless: { low: 'gemini-2.5-flash-lite-low', mid: 'gemini-2.5-flash-lite-medium', high: 'gemini-2.5-flash-lite-high' } },
  });

  // (b) Without --family, uppercase FLASH slugs still fail (case-sensitive original pattern).
  const upperFlash = [
    'GEMINI-FLASH-HIGH\tHigh',
    'GEMINI-FLASH-MEDIUM\tMedium',
    'GEMINI-FLASH-LOW\tLow',
  ].join('\n') + '\n';
  const upperRes = await run(['models', '--tool', 'antigravity', '--from-stdin'], upperFlash);
  assert.strictEqual(upperRes.code, 1);
  assert.match(upperRes.err, /cannot tell the low, mid, high flash slug\(s\)/);

  // (c) Explicit --family requires a whole hyphen-separated segment: eon does not match neon.
  const partialSeg = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'eon'], FULL_AGY_MODELS);
  assert.strictEqual(partialSeg.code, 1);
  assert.match(partialSeg.err, /cannot tell the low, mid, high eon slug\(s\)/);

  // (d) Explicit --family is case-sensitive: NEON does not match neon.
  const upperFamily = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'NEON'], FULL_AGY_MODELS);
  assert.strictEqual(upperFamily.code, 1);
  assert.match(upperFamily.err, /cannot tell the low, mid, high NEON slug\(s\)/);

  // Empty or whitespace-only explicit family returns the empty-family error.
  assert.deepStrictEqual(parseAgyModels(FULL_AGY_MODELS, ''), { error: 'family name must not be empty' });
  assert.deepStrictEqual(parseAgyModels(FULL_AGY_MODELS, '   '), { error: 'family name must not be empty' });
});

test('models --family refuses slugs from two generations; a version in the name picks one', async () => {
  const neon4 = { antigravity: { headless: { low: 'gemini-4-neon-low', mid: 'gemini-4-neon-medium', high: 'gemini-4-neon-high' } } };
  const v4 = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', '4-neon'], FULL_AGY_MODELS);
  assert.strictEqual(v4.code, 0, v4.err);
  assert.deepStrictEqual(JSON.parse(v4.out), neon4);

  // The first generation lacks a low slug, so the first match per tier mixes 4 and 3.9.
  const mixed = FULL_AGY_MODELS.replace('gemini-4-neon-low\tGemini 4 Neon (Low)\n', '') + 'gemini-3.9-neon-low\tGemini 3.9 Neon (Low)\n';
  const m = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'neon'], mixed);
  assert.strictEqual(m.code, 1, m.out);
  assert.strictEqual(m.out, '');
  assert.match(m.err, /gemini-3\.9-neon-low, gemini-4-neon-medium, gemini-4-neon-high\); name one model, for example --family 4-neon$/);
  // The list was readable, so this error does not ask for the "agy models" output again; a missing tier does.
  assert.doesNotMatch(m.err, /paste the output/);
  const m4 = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', '4-neon'], mixed);
  assert.strictEqual(m4.code, 1);
  assert.match(m4.err, /cannot tell the low 4-neon slug\(s\)/);

  // A consistent first generation still wins over a later one listed in full.
  const twoFull = FULL_AGY_MODELS + ['gemini-3.9-neon-high\tOld', 'gemini-3.9-neon-medium\tOld', 'gemini-3.9-neon-low\tOld'].join('\n') + '\n';
  const first = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'neon'], twoFull);
  assert.strictEqual(first.code, 0, first.err);
  assert.deepStrictEqual(JSON.parse(first.out), neon4);

  // Without --family nothing changed: mixed flash generations still give the first match per tier.
  const mixedFlash = FULL_AGY_MODELS.replace('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n', '') + 'gemini-3.5-flash-low\tGemini 3.5 Flash (Low)\n';
  const legacy = await run(['models', '--tool', 'antigravity', '--from-stdin'], mixedFlash);
  assert.strictEqual(legacy.code, 0, legacy.err);
  assert.deepStrictEqual(JSON.parse(legacy.out), {
    antigravity: { headless: { low: 'gemini-3.5-flash-low', mid: 'gemini-3.8-flash-medium', high: 'gemini-3.8-flash-high' } },
  });
});

test('models: the default and --family flash agree on the full list, and differ on flash-lite', async () => {
  const dflt = await run(['models', '--tool', 'antigravity', '--from-stdin'], FULL_AGY_MODELS);
  const flash = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'flash'], FULL_AGY_MODELS);
  assert.strictEqual(dflt.code, 0, dflt.err);
  assert.strictEqual(flash.code, 0, flash.err);
  assert.strictEqual(flash.out, dflt.out);

  const lite = ['gemini-2.5-flash-lite-low', 'gemini-2.5-flash-lite-medium', 'gemini-2.5-flash-lite-high'].map((s) => `${s}\tLite`).join('\n') + '\n';
  const liteDefault = await run(['models', '--tool', 'antigravity', '--from-stdin'], lite);
  assert.strictEqual(liteDefault.code, 0, liteDefault.err);
  assert.deepStrictEqual(JSON.parse(liteDefault.out).antigravity.headless, {
    low: 'gemini-2.5-flash-lite-low', mid: 'gemini-2.5-flash-lite-medium', high: 'gemini-2.5-flash-lite-high',
  });
  const liteFamily = await run(['models', '--tool', 'antigravity', '--from-stdin', '--family', 'flash'], lite);
  assert.strictEqual(liteFamily.code, 1);
  assert.match(liteFamily.err, /cannot tell the low, mid, high flash slug\(s\)/);
});

test('antigravity build refuses a role whose capabilities map to no tool; every real role has tools', async () => {
  const { roles, models, adapters } = await buildRepo();
  const agy = adapters.find((a) => a.id === 'antigravity');
  const lister = parseRole('---\nname: lister\ndescription: lists\ntier: low\naccess: read-only\ncapabilities: [list, search, web-fetch]\n---\nbody\n');
  const { errors } = buildTool(agy, [lister], models, 'x');
  assert.deepStrictEqual(errors, ['antigravity: .gemini/config/agents/lister.md has an empty tools list; give the role a capability that maps to a tool']);

  const real = buildTool(agy, roles, models, 'x');
  assert.deepStrictEqual(real.errors, []);
  const agents = real.files.filter((f) => f.role);
  assert.strictEqual(agents.length, 11);
  for (const f of agents) assert.ok(parse(f.content).data.tools.length > 0, f.path);
});

test('antigravity agents are main agents and subagents, and name only agy 1.5.16 tools', async () => {
  const [agy] = (await buildGolden(REPO)).filter((r) => r.adapter.id === 'antigravity');
  const roles = loadRoles(REPO);
  const accepted = new Set(['read_file', 'write_file', 'edit_file', 'run_command', 'search_web']);
  const deprecated = /\b(list_dir|find_by_name|grep_search|view_file|write_to_file|replace_file_content|multi_replace_file_content|read_url_content)\b/;
  for (const f of agy.files) assert.doesNotMatch(f.content, deprecated, f.path);
  const agents = agy.files.filter((f) => f.role);
  assert.equal(agents.length, roles.length);
  for (const f of agents) {
    const { data } = parse(f.content);
    assert.equal(data.subagent, true, f.path);
    assert.equal(data.mainAgent, true, f.path);
    const tools = Array.isArray(data.tools) ? data.tools : data.tools.split(', ');
    assert.equal(new Set(tools).size, tools.length, `${f.path}: no tool twice`);
    for (const t of tools) assert.ok(accepted.has(t), `${f.path} names ${t}`);
    const role = roles.find((r) => r.name === f.role);
    if (role.access === 'read-only') for (const t of ['write_file', 'edit_file']) assert.ok(!tools.includes(t), `${role.name} gets ${t}`);
    else assert.ok(tools.includes('write_file') && tools.includes('edit_file'), `${role.name} can edit`);
  }
  assert.ok(agy.adapter.gaps.some((g) => /listing, searching and URL fetching have no dedicated tool .*run_command.*search_web/i.test(g)));
  const rulebook = agy.files.find((f) => f.path === '.gemini/AGENTS.md');
  assert.ok(Buffer.byteLength(rulebook.content) < 24000, 'Antigravity rulebook under its cap');
});

test('AGENTS.md hygiene', () => {
  const text = read(path.join(REPO, 'AGENTS.md'));
  assert.ok(Buffer.byteLength(text) < 24000, 'AGENTS.md over 24,000 bytes');
  const banned = /subagent_type|ArtifactData|claude -p|haiku|sonnet|opus|fable|board-reminder|@board\.local\.md|~\/\.claude|AcmeApp|dotnet|Playwright|ticket-env|ado\.ps1|UITests|vstest|Azure DevOps/i;
  const hits = text.split('\n').filter((l) => banned.test(l));
  assert.deepEqual(hits, []);
});

test('every generated rulebook carries the pull request signature', async () => {
  const sig = 'End every pull request description with the line `Built with [Orc-istration](https://github.com/Co0pDawg/Orc-istration) \u{1F9CC}`.';
  const { roles, models, agentsMd, adapters } = await buildRepo();
  for (const adapter of adapters) {
    const { files } = buildTool(adapter, roles, models, agentsMd);
    const rule = files.find((f) => !f.role && f.content.includes('# Orchestration'));
    assert.ok(rule && rule.content.includes(sig), `${adapter.id} rulebook has the signature`);
  }
  const notes = read(path.join(REPO, 'adapters', 'claude-code.notes.md'));
  assert.ok(notes.includes('`\u{1F916} Generated with [Claude Code](https://claude.com/claude-code) and built with [Orc-istration](https://github.com/Co0pDawg/Orc-istration) \u{1F9CC}`'));
  // The troll is the only non-ASCII character AGENTS.md adds beyond its arrows and dashes, and only in that line.
  for (const l of agentsMd.split('\n')) if (l.includes('\u{1F9CC}')) assert.ok(l.includes(sig), l);
});

test('no tracked text file holds a denylisted name or term', () => {
  // Every term is built from fragments so this file never holds one in plain text.
  const deny = [
    new RegExp(['c', 'o', 'o', 'p', 'e', 'r'].join(''), 'i'),
    new RegExp(['pet', 'soft'].join(''), 'i'),
    new RegExp(['cos', 'airus'].join(''), 'i'),
    new RegExp(['kms', 'db', 'tool'].join(''), 'i'),
    new RegExp(['ela', 'von'].join(''), 'i'),
    new RegExp(['head', 'hunter'].join(''), 'i'),
    new RegExp(`\\b(${['PE', 'T'].join('')}|${['KM', 'S'].join('')})-\\d+`, 'i'),
    // Surnames as whole words, case-sensitive; "wall clock" is ordinary English.
    new RegExp(`\\b${['Wa', 'll'].join('')}\\b(?!\\s+clock)`),
    new RegExp(`\\b${['Kei', 'th'].join('')}\\b`),
    new RegExp(`\\b${['End', 'res'].join('')}\\b`),
    // Machine paths: a home folder in a tracked or golden file leaks a user name and breaks other machines.
    // A `<user>`-style placeholder segment is allowed.
    /\b[A-Za-z]:[\\/]Users[\\/](?!<)/,
    /(^|[\s`'"(])\/Users\/[^/\s<]/,
    /(^|[\s`'"(])\/home\/[^/\s<]/,
  ];
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'git ls-files listed the repo');
  const hits = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(REPO, f));
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((l, i) => {
      for (const d of deny) if (d.test(l)) hits.push(`${f}:${i + 1}: ${d.source}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('claude-code agent frontmatter matches the roster', () => {
  const want = {
    scout: { model: 'haiku', tools: 'Glob, Grep, Read, Bash' },
    researcher: { model: 'sonnet', effort: 'high', tools: 'Glob, Grep, Read, Bash, WebFetch, WebSearch' },
    builder: { model: 'opus', effort: 'high' },
    refuter: { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    debugger: { model: 'opus', effort: 'high' },
    'review-code-explorer': { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    'review-failure-explorer': { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    'review-docs-explorer': { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    'review-design-explorer': { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    'review-checklist-explorer': { model: 'sonnet', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
    'review-verifier': { model: 'opus', effort: 'high', tools: 'Glob, Grep, Read, Bash' },
  };
  for (const [name, fm] of Object.entries(want)) {
    const { data } = parse(read(path.join(REPO, 'agents', `${name}.md`)));
    assert.deepEqual(data, { name, description: data.description, ...fm }, name);
  }
});

test('claude-code review commands: thin wrappers, no machine path, panel files present', async () => {
  const { roles, models, agentsMd, adapters } = await buildRepo();
  const cc = adapters.find((a) => a.id === 'claude-code');
  const cmds = buildTool(cc, roles, models, agentsMd).files.filter((f) => f.path.startsWith('.claude/commands/'));
  assert.deepEqual(cmds.map((f) => f.path).sort(), ['calibration-report', 'pre-pr-review', 'review-verdict'].map((n) => `.claude/commands/${n}.md`));
  for (const f of cmds) {
    const { data, body } = parse(f.content);
    assert.deepEqual(Object.keys(data), ['description', 'argument-hint', 'allowed-tools'], f.path);
    assert.match(body, /`ORC_HOME`.*, else the "Setup checkout \(this machine\)" line in the rulebook's tool notes, else `~\/\.claude`/, f.path);
    assert.match(body, /`CHECKOUT\/review\/(PROCEDURE|calibration)\.md`/, f.path);
    assert.doesNotMatch(f.content, /[A-Za-z]:[\\/]|\/Users\/|\/home\//, `${f.path} names no machine path`);
  }
  // The hand-written commands find the checkout in the same order.
  for (const n of ['create', 'draft-pr', 'fix-ci', 'grill', 'peer-review', 'start']) {
    assert.match(read(path.join(REPO, 'commands', `${n}.md`)), /`ORC_HOME`.*, else the "Setup checkout \(this machine\)" line in the rulebook's tool notes, else `~\/\.claude`/, n);
  }
  for (const f of ['PROCEDURE.md', 'contract.md', 'shared-rules.md', 'selection.md']) assert.ok(fs.existsSync(path.join(REPO, 'review', f)), f);
  const lanes = ['architecture-reviewer', 'code-reviewer', 'code-simplifier', 'comment-analyzer', 'pr-test-analyzer', 'secondary-artifacts', 'silent-failure-hunter', 'ticket-coverage', 'type-design-analyzer', 'ui-test-reviewer'];
  assert.deepEqual(fs.readdirSync(path.join(REPO, 'review', 'lanes')).sort(), lanes.map((l) => `${l}.md`));
  // Every lane the procedure groups into an explorer has a checklist.
  const procedure = read(path.join(REPO, 'review', 'PROCEDURE.md'));
  for (const l of lanes) assert.ok(procedure.includes(l), `PROCEDURE.md names ${l}`);
});

test('--profile appends after the tool notes; bad profiles fail', async () => {
  const out = tempDir('profile');
  const r = await run(['build', '--tool', 'codex', '--profile', 'dotnet-azure-devops', '--out', out]);
  assert.equal(r.code, 0, r.err);
  const rule = read(path.join(out, 'codex', '.codex', 'AGENTS.md'));
  const notes = rule.indexOf('# Codex CLI');
  const prof = rule.indexOf('\n# Profile: dotnet-azure-devops\n');
  assert.ok(notes > 0 && prof > notes, 'profile follows the tool notes');
  assert.match(rule.slice(prof), /## Stack-specific/);
  assert.doesNotMatch(read(path.join(REPO, 'AGENTS.md')), /# Profile:/);
  const twice = await run(['build', '--tool', 'opencode', '--profile', 'dotnet-azure-devops', '--profile=dotnet-azure-devops', '--out', out]);
  assert.equal(twice.code, 0);
  assert.equal(read(path.join(out, 'opencode', '.config', 'opencode', 'AGENTS.md')).split('# Profile: ').length, 3);
  const unknown = await run(['build', '--tool', 'codex', '--profile', 'nope', '--out', out]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown profile nope; known: dotnet-azure-devops/);
  for (const argv of [['build', '--profile'], ['build', '--profile', 'a,,b'], ['build', '--profile=']]) {
    assert.match((await run(argv)).err, /--profile needs a value/, argv.join(' '));
  }
  const chk = await run(['check', '--profile', 'dotnet-azure-devops']);
  assert.equal(chk.code, 1);
  assert.match(chk.err, /--profile applies to build, install and status only/);
});

test('--profile over the Antigravity cap fails with the size message', async () => {
  const copy = tempDir('bigprofile');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  fs.mkdirSync(path.join(copy, 'profiles'));
  fs.writeFileSync(path.join(copy, 'profiles', 'big.md'), `${'x'.repeat(20000)}\n`);
  const r = await run(['build', '--repo', copy, '--tool', 'antigravity', '--profile', 'big', '--out', path.join(copy, 'dist')]);
  assert.equal(r.code, 1);
  assert.match(r.err, /antigravity: \.gemini\/AGENTS\.md is \d+ bytes; the limit is under 24000/);
});

test('status: same, differs, missing, extra; never writes', async () => {
  const home = tempDir('status');
  const before = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(before.code, 1);
  assert.match(before.out, /missing: .*AGENTS\.md/);
  assert.deepEqual(fs.readdirSync(home), [], 'status wrote nothing');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  const same = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /status antigravity: all same/);
  assert.doesNotMatch(same.out, /differs|missing|extra/);
  const scout = path.join(home, '.gemini', 'config', 'agents', 'scout.md');
  const lines = read(scout).split('\n');
  lines[3] = 'edited';
  fs.writeFileSync(scout, lines.join('\n'));
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'agents', 'mine.md'), 'x\n');
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'agents', 'scout.md.orc-backup-20261115-130509'), 'x\n');
  fs.rmSync(path.join(home, '.gemini', 'config', 'agents', 'builder.md'));
  const snapshot = fs.readdirSync(path.join(home, '.gemini', 'config', 'agents')).sort();
  const diff = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(diff.code, 1);
  assert.match(diff.out, /differs \(first difference at line 4\): .*scout\.md/);
  assert.match(diff.out, /missing: .*builder\.md/);
  assert.match(diff.out, /extra: .*mine\.md/);
  assert.doesNotMatch(diff.out, /orc-backup/);
  assert.deepEqual(fs.readdirSync(path.join(home, '.gemini', 'config', 'agents')).sort(), snapshot, 'status wrote nothing');
  // claude-code compares the ~/.claude layout; the board line from install is part of the comparison.
  const ch = tempDir('status-claude');
  const board = ['--board', 'http://localhost:8377/', '--board-repo', 'C:/b'];
  assert.equal((await run(['install', '--tool', 'claude-code', '--home', ch, '--apply', ...board])).code, 0);
  const c = await run(['status', '--tool', 'claude-code', '--home', ch, ...board]);
  assert.equal(c.code, 0, c.out);
  for (const p of ['CLAUDE.md', 'AGENTS.md', 'refuter.md', 'review-verifier.md', 'pre-pr-review.md', 'review-verdict.md', 'calibration-report.md']) {
    assert.match(c.out, new RegExp(`same: .*${p.replace('.', '\\.')}`));
  }
  assert.equal((await run(['status', '--tool', 'claude-code', '--home', ch, '--no-board'])).code, 1, 'without the board line CLAUDE.md differs');
  assert.match((await run(['status', '--home', ch])).err, /status needs --tool/);
});

test('install copies the hook scripts for claude-code; status reports them; a hand-copied one is kept', async () => {
  const home = tempDir('hookscripts');
  const scripts = ['guard.mjs', 'guard.ps1', 'board-reminder.ps1', 'board-reminder.mjs'];
  const tools = path.join(home, '.claude', 'tools');
  // A hand-copied, older board reminder from before install shipped the scripts.
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, 'board-reminder.ps1'), 'old copy\n');
  const r = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.equal(r.code, 0, r.err);
  for (const s of ['guard.mjs', 'guard.ps1', 'board-reminder.mjs']) {
    assert.match(r.out, new RegExp(`applied create: .*tools[\\\\/]${s.replace('.', '\\.')}`));
    assert.equal(read(path.join(tools, s)), read(path.join(REPO, 'tools', s)), s);
  }
  assert.match(r.out, /kept \(hand-copied hook script, differs; --force replaces it, with a backup\): .*board-reminder\.ps1/);
  assert.equal(fs.readFileSync(path.join(tools, 'board-reminder.ps1'), 'utf8'), 'old copy\n', 'the hand copy is not overwritten');
  const manifest = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.orc-manifest.claude-code.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files).filter((k) => k.startsWith('.claude/tools/')).sort(), ['.claude/tools/board-reminder.mjs', '.claude/tools/guard.mjs', '.claude/tools/guard.ps1']);
  const st = await run(['status', '--tool', 'claude-code', '--home', home, '--no-board']);
  assert.equal(st.code, 1, 'the kept copy differs');
  assert.match(st.out, /same: .*guard\.mjs/);
  assert.match(st.out, /differs \(first difference at line 1; a hand-copied hook script, which install --apply keeps: install --apply --force replaces it, with a backup\): .*board-reminder\.ps1/);
  // The installed Node guard runs on its own, outside the checkout.
  const repo = path.join(home, 'r');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  const hook = spawnSync(process.execPath, [path.join(tools, 'guard.mjs')], { input: JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'git commit -m x' } }), encoding: 'utf8' });
  assert.equal(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision, 'deny', hook.stderr);
  // --force replaces the hand copy, with a backup.
  const forced = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board', '--force']);
  assert.equal(forced.code, 0, forced.err);
  assert.equal(read(path.join(tools, 'board-reminder.ps1')), read(path.join(REPO, 'tools', 'board-reminder.ps1')));
  assert.equal(fs.readdirSync(tools).filter((f) => f.startsWith('board-reminder.ps1.orc-backup-')).length, 1);
  assert.equal((await run(['status', '--tool', 'claude-code', '--home', home, '--no-board'])).code, 0);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(tools, s)), s);
  // Other tools wire no hooks and get no scripts.
  const agy = tempDir('hookscripts-agy');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', agy, '--apply', '--no-board'])).code, 0);
  assert.ok(!fs.existsSync(path.join(agy, '.gemini', 'tools')));
});

test('install --board adds the Board line; without it a warning', async () => {
  const home = tempDir('board');
  const without = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.match(without.err, /WARN the board address is not set/);
  assert.doesNotMatch(read(path.join(home, '.gemini', 'AGENTS.md')), /\*\*Board:\*\* this machine/);
  const withBoard = await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--board', 'http://localhost:8377/', '--board-repo', String.raw`C:\src\Orc-Dashboard`]);
  assert.doesNotMatch(withBoard.err, /not set/);
  assert.match(
    read(path.join(home, '.gemini', 'AGENTS.md')),
    /- \*\*Board:\*\* this machine's board address is `http:\/\/localhost:8377\/`; write it with `node "C:\/src\/Orc-Dashboard\/local\/board\.js"` \(set `ORC_BOARD_PORT=8377`\)\./,
  );
  // A path with spaces stays one quoted argument.
  await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--board', 'http://localhost:8377/', '--board-repo', String.raw`C:\My Repos\orc board`]);
  assert.match(read(path.join(home, '.gemini', 'AGENTS.md')), /write it with `node "C:\/My Repos\/orc board\/local\/board\.js"`/);
  // --board and --board-repo go together.
  for (const extra of [['--board', 'http://localhost:8377/'], ['--board-repo', 'C:/x']]) {
    const r = await run(['install', '--tool', 'antigravity', '--home', home, ...extra]);
    assert.equal(r.code, 1);
    assert.match(r.err, /pass --board and --board-repo together, or neither/);
  }
  // An artifact address needs no --board-repo, ignores one given, and its line names ArtifactData, not board.js.
  for (const [url, extra] of [['https://claude.ai/artifact/abc', []], ['claude.ai/code/artifact/def', ['--board-repo', 'C:/x']]]) {
    const ch = tempDir('board-artifact');
    const inst = await run(['install', '--tool', 'claude-code', '--home', ch, '--apply', '--board', url, ...extra]);
    assert.equal(inst.code, 0, inst.err);
    const rulebook = read(path.join(ch, '.claude', 'CLAUDE.md'));
    assert.ok(rulebook.includes(`- **Board:** this machine's board address is \`${url}\` (artifact backend: write it with ArtifactData, as the tool notes say).`), rulebook);
    assert.doesNotMatch(rulebook, /board\.js/);
    const st = await run(['status', '--tool', 'claude-code', '--home', ch]);
    assert.equal(st.code, 0, st.out);
    assert.match(st.out, /same: .*CLAUDE\.md/);
  }
  // Only Claude Code can write an artifact board: other tools refuse it, with or without --board-repo, in install and status.
  const cx = tempDir('board-artifact-codex');
  for (const cmd of [['install', '--apply'], ['status']]) {
    for (const extra of [[], ['--board-repo', 'C:/x']]) {
      const r = await run([cmd[0], '--tool', 'codex', '--home', cx, ...cmd.slice(1), '--board', 'https://claude.ai/artifact/abc', ...extra]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.err, /the artifact board can be written only from Claude Code; use a local board address/);
    }
  }
  assert.equal(fs.existsSync(path.join(cx, '.codex', 'AGENTS.md')), false, 'nothing installed');
});

test('install warns about two rulebooks in a shared ~/.gemini', async () => {
  const home = tempDir('gemini');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  assert.match(read(path.join(home, '.gemini', 'AGENTS.md')), /^<!-- generated by orc\.mjs: antigravity\. Do not edit: .* -->\n/);
  const g = await run(['install', '--tool', 'gemini-cli', '--home', home]);
  assert.match(g.err, /AGENTS\.md is an orc-generated Antigravity rulebook .*two copies.*Remove .*AGENTS\.md unless you also use Antigravity/);
  const home2 = tempDir('gemini2');
  await run(['install', '--tool', 'gemini-cli', '--home', home2, '--apply']);
  const a = await run(['install', '--tool', 'antigravity', '--home', home2]);
  assert.match(a.err, /GEMINI\.md is an orc-generated Gemini CLI rulebook .*Remove .*GEMINI\.md unless you also use Gemini CLI/);
  // A hand-written file is not orc-generated: still warns, without calling it orc-generated or telling the user to remove it.
  const home3 = tempDir('gemini3');
  fs.mkdirSync(path.join(home3, '.gemini'));
  fs.writeFileSync(path.join(home3, '.gemini', 'GEMINI.md'), '# my own rules\n');
  const hwAgy = await run(['install', '--tool', 'antigravity', '--home', home3]);
  assert.strictEqual(hwAgy.code, 0, hwAgy.err);
  assert.match(hwAgy.err, /WARN .*GEMINI\.md exists in the same folder \(Gemini CLI rulebook\): Antigravity may load both this file and AGENTS\.md/);
  assert.doesNotMatch(hwAgy.err, /orc-generated|remove|two copies/i);

  const home4 = tempDir('gemini4');
  fs.mkdirSync(path.join(home4, '.gemini'));
  fs.writeFileSync(path.join(home4, '.gemini', 'AGENTS.md'), '# my own rules\n');
  const hwGem = await run(['install', '--tool', 'gemini-cli', '--home', home4]);
  assert.strictEqual(hwGem.code, 0, hwGem.err);
  assert.match(hwGem.err, /WARN .*AGENTS\.md exists in the same folder \(Antigravity rulebook\): Antigravity may load both this file and GEMINI\.md/);
  assert.doesNotMatch(hwGem.err, /orc-generated|remove|two copies/i);

  // No conflict warning when the other tool's rulebook does not exist.
  const home5 = tempDir('gemini5');
  const cleanAgy = await run(['install', '--tool', 'antigravity', '--home', home5]);
  assert.doesNotMatch(cleanAgy.err, /GEMINI\.md/);

  // The other tool's rulebook path is a directory, not a file: no warning about it.
  const home6 = tempDir('gemini6');
  fs.mkdirSync(path.join(home6, '.gemini', 'GEMINI.md'), { recursive: true });
  const dirAgy = await run(['install', '--tool', 'antigravity', '--home', home6]);
  assert.strictEqual(dirAgy.code, 0, dirAgy.err);
  assert.doesNotMatch(dirAgy.err, /GEMINI\.md/);
});

test('install backups never collide within one second', async () => {
  const home = tempDir('stamp');
  const io = (out) => ({ out: (s) => out.push(s), err: () => {}, stdin: () => '', now: () => new Date(2026, 10, 15, 13, 5, 9) });
  await main(['install', '--tool', 'codex', '--home', home, '--apply'], io([]));
  const rule = path.join(home, '.codex', 'AGENTS.md');
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(rule, `<!-- generated by orc.mjs: codex -->\nedit ${n}\n`);
    await main(['install', '--tool', 'codex', '--home', home, '--apply', '--force'], io([])); // edited since install: the manifest hash differs, so --force
  }
  const backups = fs.readdirSync(path.dirname(rule)).filter((f) => f.includes('.orc-backup-')).sort();
  assert.deepEqual(backups, ['AGENTS.md.orc-backup-20261115-130509', 'AGENTS.md.orc-backup-20261115-130509-2', 'AGENTS.md.orc-backup-20261115-130509-3']);
  assert.equal(read(path.join(path.dirname(rule), backups[2])), '<!-- generated by orc.mjs: codex -->\nedit 3\n');
});

test('install paths for codex, cursor, copilot, opencode', async () => {
  const home = tempDir('round-b');
  const expect = {
    codex: ['.codex/AGENTS.md', '.codex/agents/scout.toml'],
    copilot: ['.copilot/copilot-instructions.md', '.copilot/agents/scout.agent.md'],
    opencode: ['.config/opencode/AGENTS.md', '.config/opencode/agents/scout.md'],
    cursor: ['.cursor/agents/scout.md'],
  };
  for (const [tool, paths] of Object.entries(expect)) {
    const r = await run(['install', '--tool', tool, '--home', home, '--apply']);
    assert.equal(r.code, 0, tool);
    for (const p of paths) assert.ok(fs.existsSync(path.join(home, ...p.split('/'))), p);
    if (tool === 'cursor') assert.match(r.out, /no global rulebook file/);
  }
  assert.ok(!fs.existsSync(path.join(home, 'project')));
});
