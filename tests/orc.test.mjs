import { test } from 'node:test';
import { isolateHome, esc } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, normalizeEol, generatedMarker } from '../tools/lib/frontmatter.mjs';
import { parseRole } from '../tools/lib/roles.mjs';
import { serializeToml, parseToml, tomlMultiline } from '../tools/lib/toml.mjs';
import { main, loadRoles, loadModels, loadAdapters, loadProcedures, buildTool, buildGolden, allowedTools, parseAgyModels, firstDiffLine, isOrcGenerated } from '../tools/orc.mjs';
import { PROCEDURES, checkoutLookup } from '../core/procedures.mjs';
import { knownTools } from '../tools/lib/models.mjs';
import { spawnSync } from 'node:child_process';

// No test in this file can reach the real home folder: commands that default --home use this scratch one.
isolateHome();

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
  const agentsMd = read(path.join(REPO, 'core', 'AGENTS.md'));
  const adapters = await loadAdapters(REPO);
  return { roles, models, agentsMd, adapters };
}

test('frontmatter round-trips the real agent files', () => {
  const agents = path.join(GOLDEN, 'claude-code', '.claude', 'agents');
  for (const f of fs.readdirSync(agents)) {
    const text = read(path.join(agents, f));
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

test('buildTool: a skill body at or over skillBytes fails the build; a renderProcedure error is reported; a missing catalogue throws', async () => {
  const { models, agentsMd, adapters } = await buildRepo();
  const agy = adapters.find((a) => a.id === 'antigravity');
  // The real Antigravity adapter with its real procedure renderer, held to a smaller cap.
  const small = { ...agy, limits: { ...agy.limits, skillBytes: 900 } };
  const board = PROCEDURES.find((p) => p.name === 'board');
  const bodyBytes = Buffer.byteLength(parse(agy.renderProcedure(board).content).body, 'utf8');
  assert.ok(bodyBytes > 300 && bodyBytes < 900, `board body is ${bodyBytes} bytes`);
  assert.deepStrictEqual(buildTool(small, [], models, agentsMd, { procedures: [board] }).errors, []);
  const atCap = { ...agy, limits: { ...agy.limits, skillBytes: bodyBytes } };
  assert.deepStrictEqual(buildTool(atCap, [], models, agentsMd, { procedures: [board] }).errors, [`antigravity: .gemini/config/skills/board/SKILL.md body is ${bodyBytes} bytes; the limit is under ${bodyBytes}`]);
  // A procedure an adapter has no notes for, on both adapters that render them: reported, not thrown, and no file.
  const stray = { ...board, name: 'stray', title: 'Stray' };
  for (const id of ['antigravity', 'claude-code']) {
    const adapter = adapters.find((a) => a.id === id);
    const built = buildTool(adapter, [], models, agentsMd, { procedures: [stray, board] });
    assert.deepStrictEqual(built.errors, [`${id}: no notes for procedure stray in adapters/${id}.mjs`]);
    assert.deepStrictEqual(built.files.filter((f) => f.procedure).map((f) => f.procedure), ['board'], id);
  }
  // A checkout with no catalogue: the build stops with the file named.
  const bare = tempDir('no-catalogue');
  await assert.rejects(loadProcedures(bare), (e) => e.message === `${path.join(bare, 'core', 'procedures.mjs')} is missing: the procedure catalogue the adapters render skills and commands from`);
});

test('models.local.json overrides per tool and tier', () => {
  const copy = tempDir('models');
  fs.copyFileSync(path.join(REPO, 'models.json'), path.join(copy, 'models.json'));
  fs.writeFileSync(path.join(copy, 'models.local.json'), JSON.stringify({ copilot: { high: { model: 'x-high' } }, codex: { mid: { effort: 'low' } } }));
  const m = loadModels(copy);
  assert.deepEqual(m.copilot.high, { model: 'x-high' });
  assert.deepEqual(m.copilot.low, {});
  assert.deepEqual(m.codex.mid, { model: 'gpt-6.2-sol', effort: 'low' });
  assert.deepEqual(loadModels(copy, { local: false }).copilot.high, {});
});

test('antigravity rejects a 30 KB rulebook', async () => {
  const { roles, models, adapters } = await buildRepo();
  const agy = adapters.find((a) => a.id === 'antigravity');
  const { errors } = buildTool(agy, roles, models, 'x'.repeat(30 * 1024));
  assert.match(errors.join('\n'), /limit is under 24000/);
});

test('check passes on the repo and fails on a differing, a missing and a stale golden file', async () => {
  assert.equal((await run(['check'])).code, 0);
  const copy = tempDir('check');
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib', 'tests/golden']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  assert.equal((await run(['check', '--repo', copy])).code, 0);
  const gold = path.join(copy, 'tests', 'golden');
  const scout = path.join(gold, 'claude-code', '.claude', 'agents', 'scout.md');
  fs.writeFileSync(scout, read(scout).replace('model: haiku', 'model: sonnet'));
  fs.rmSync(path.join(gold, 'codex', '.codex', 'AGENTS.md'));
  fs.writeFileSync(path.join(gold, 'antigravity', '.gemini', 'config', 'agents', 'gone.md'), 'x\n');
  const r = await run(['check', '--repo', copy]);
  assert.equal(r.code, 1);
  const fails = r.err.split('\n').filter((l) => l.startsWith('FAIL '));
  assert.deepEqual(fails, [
    'FAIL tests/golden/antigravity/.gemini/config/agents/gone.md: stale (no source generates it; run node tools/orc.mjs golden)',
    'FAIL tests/golden/claude-code/.claude/agents/scout.md: differs from the build at line 4 (generated from core/roles/scout.md; edit that, then run node tools/orc.mjs golden)',
    'FAIL tests/golden/codex/.codex/AGENTS.md: missing (generated from core/AGENTS.md / adapters/codex.notes.md / adapters/codex.mjs; run node tools/orc.mjs golden)',
  ]);
  // check reads tests/golden only: nothing in the copy is written, and no checked-in Claude Code build is compared.
  assert.equal(fs.existsSync(path.join(copy, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(copy, 'agents')), false);
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

  // --tool claude-code with no --home installs into the user's home, like every other tool. In a child with a
  // scratch HOME and USERPROFILE (and the scratch state home this file sets), so the real home is never reached.
  const fakeHome = tempDir('defaulthome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const cli = (...a) => spawnSync(process.execPath, [path.join(REPO, 'tools', 'orc.mjs'), ...a], { env, encoding: 'utf8' });
  const dryDefault = cli('install', '--tool', 'claude-code');
  assert.equal(dryDefault.status, 0, dryDefault.stderr);
  assert.doesNotMatch(dryDefault.stderr, /refusing/);
  assert.ok(dryDefault.stdout.includes(path.join(fakeHome, '.claude', 'CLAUDE.md')), dryDefault.stdout);
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'the dry run writes nothing');
  const applied = cli('install', '--tool', 'claude-code', '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'agents', 'scout.md')));
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
  const missingToolsGaps = res.adapter.gaps.filter((g) => /listing, searching and URL fetching/i.test(g));
  assert.strictEqual(missingToolsGaps.length, 1, 'gaps mentions listing, searching and URL fetching once');
  const [gap] = missingToolsGaps;
  assert.match(gap, /run_command/);
  assert.match(gap, /search_web/);
  assert.match(gap, /sandbox/);
  const rulebook = res.files.find((f) => f.path === '.gemini/AGENTS.md');
  assert.strictEqual((rulebook.content.match(/listing, searching and URL fetching/gi) ?? []).length, 1, 'generated rulebook includes the missing-tools gap exactly once');
  assert.ok(rulebook.content.includes(gap), 'generated rulebook includes the missing-tools gap');
  assert.match(rulebook.content, /orc hooks --tool antigravity/);
  assert.match(rulebook.content, /read-only-role rule.*Claude Code only/i);
  assert.match(rulebook.content, /allow prints nothing/i);
  assert.strictEqual((rulebook.content.match(/hook fires in a headless `agy -p` run/g) ?? []).length, 1, 'headless hook behaviour stated once in rulebook');
});

test('no adapter has duplicate gap entries starting with the same first six words', async () => {
  const adapters = await loadAdapters(REPO);
  for (const adapter of adapters) {
    const seen = new Map();
    for (const gap of adapter.gaps) {
      const prefix = gap.trim().toLowerCase().split(/\s+/).slice(0, 6).join(' ');
      assert.ok(!seen.has(prefix), `${adapter.id}: duplicate gap prefix "${prefix}"`);
      seen.set(prefix, gap);
    }
  }
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

test('core/AGENTS.md hygiene', () => {
  const text = read(path.join(REPO, 'core', 'AGENTS.md'));
  assert.ok(Buffer.byteLength(text) < 24000, 'core/AGENTS.md over 24,000 bytes');
  const banned = /subagent_type|ArtifactData|claude -p|haiku|sonnet|opus|fable|board-reminder|@board\.local\.md|~\/\.claude|AcmeApp|dotnet|Playwright|ticket-env|ado\.ps1|UITests|vstest|Azure DevOps/i;
  const hits = text.split('\n').filter((l) => banned.test(l));
  assert.deepEqual(hits, []);
});

test('the root AGENTS.md and CLAUDE.md are contributor files, not a second copy of the product rulebook', () => {
  const root = read(path.join(REPO, 'AGENTS.md'));
  assert.ok(Buffer.byteLength(root) < 4000, `root AGENTS.md is ${Buffer.byteLength(root)} bytes; keep it under 4,000`);
  assert.doesNotMatch(root, /^#+\s+Marching orders\b/im);
  assert.equal(read(path.join(REPO, 'CLAUDE.md')), '@AGENTS.md\n');
  // No section heading of the product rulebook appears in the root file.
  const core = read(path.join(REPO, 'core', 'AGENTS.md'));
  const headings = core.split('\n').filter((l) => /^#{1,3} /.test(l));
  assert.ok(headings.length > 5, 'core/AGENTS.md has its headings');
  for (const h of headings) assert.ok(!root.split('\n').includes(h), `root AGENTS.md repeats "${h}"`);
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
    const { data } = parse(read(path.join(GOLDEN, 'claude-code', '.claude', 'agents', `${name}.md`)));
    assert.deepEqual(data, { name, description: data.description, ...fm }, name);
  }
});

// Tracked files, including intent-added (`git add -N`) new ones.
const trackedFiles = () => spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);

test('procedure catalogue: fourteen entries; every source, section and extra is a tracked file', () => {
  assert.equal(PROCEDURES.length, 14);
  const kinds = (k) => PROCEDURES.filter((p) => p.kind === k).map((p) => p.name);
  assert.deepEqual(kinds('routine'), ['board', 'brief', 'wrap-up', 'sprint', 'repo-standards']);
  assert.deepEqual(kinds('workflow'), ['start', 'grill', 'draft-pr', 'peer-review', 'create', 'fix-ci']);
  assert.deepEqual(kinds('review'), ['pre-pr-review', 'review-verdict', 'calibration-report']);
  const tracked = new Set(trackedFiles());
  for (const p of PROCEDURES) {
    assert.match(p.name, /^[a-z]+(-[a-z]+)*$/, p.name);
    assert.ok(p.description && p.title, p.name);
    assert.ok(tracked.has(p.source.file) && fs.existsSync(path.join(REPO, p.source.file)), `${p.name}: ${p.source.file} is tracked`);
    if (p.source.section) assert.match(read(path.join(REPO, p.source.file)), new RegExp(`^#+ ${p.source.section}$`, 'm'), `${p.name}: section ${p.source.section}`);
    for (const e of p.extras) {
      const ok = e.path.endsWith('/') ? [...tracked].some((t) => t.startsWith(e.path)) : tracked.has(e.path);
      assert.ok(ok, `${p.name}: extra ${e.path} is tracked`);
    }
  }
  assert.deepEqual(new Set(PROCEDURES.map((p) => p.name)).size, 14, 'names are unique');
});

test('generated skills and commands: thin wrappers that find the checkout and name a source that exists', async () => {
  const built = Object.fromEntries((await buildGolden(REPO)).map((r) => [r.adapter.id, r.files]));
  const expectTools = {
    start: ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion', 'Agent', 'SendMessage', 'EnterPlanMode', 'ExitPlanMode'],
    grill: ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion', 'Agent'],
    'draft-pr': ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion'],
    'peer-review': ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion', 'Agent', 'SendMessage'],
    create: ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'AskUserQuestion'],
    'fix-ci': ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'AskUserQuestion', 'Agent', 'SendMessage'],
    'pre-pr-review': ['Bash', 'Glob', 'Grep', 'Read', 'Write', 'Edit', 'Agent', 'SendMessage', 'AskUserQuestion'],
    'review-verdict': ['Bash', 'Glob', 'Grep', 'Read', 'Edit', 'AskUserQuestion'],
    'calibration-report': ['Bash', 'Glob', 'Grep', 'Read', 'Edit'],
  };
  const wrappers = { 'claude-code': [], antigravity: [] };
  for (const p of PROCEDURES) {
    const routine = p.kind === 'routine';
    const cc = built['claude-code'].find((f) => f.path === (routine ? `.claude/skills/${p.name}/SKILL.md` : `.claude/commands/${p.name}.md`));
    const agy = built.antigravity.find((f) => f.path === `.gemini/config/skills/${p.name}/SKILL.md`);
    assert.ok(cc && agy, p.name);
    const ccData = parse(cc.content).data;
    if (routine) assert.deepEqual(ccData, { name: p.name, description: p.description }, p.name);
    else {
      assert.deepEqual(Object.keys(ccData), p.argumentHint ? ['description', 'argument-hint', 'allowed-tools'] : ['description', 'allowed-tools'], p.name);
      assert.equal(ccData.description, p.description);
      assert.deepEqual(ccData['allowed-tools'], expectTools[p.name], `${p.name}: today's tool list`);
      assert.match(parse(cc.content).body, /\*\*Arguments:\*\* "\$ARGUMENTS"/, p.name);
    }
    const agyData = parse(agy.content).data;
    assert.deepEqual(agyData, { name: p.name, description: p.description }, `${p.name}: name equals the folder`);
    assert.ok(Buffer.byteLength(parse(agy.content).body) < 24000, `${p.name}: Antigravity body under 24,000 bytes`);
    assert.match(parse(agy.content).body, new RegExp(`slash command \`/${p.name}\``), p.name);
    wrappers['claude-code'].push([p, cc]);
    wrappers.antigravity.push([p, agy]);
  }
  for (const [tool, list] of Object.entries(wrappers)) {
    for (const [p, f] of list) {
      const { body } = parse(f.content);
      assert.equal(body.split('\n')[0], generatedMarker(tool), `${f.path}: the marker is the first body line`);
      assert.ok(isOrcGenerated(f.content), f.path);
      assert.ok(body.includes(checkoutLookup(`CHECKOUT/${p.source.file}`)), `${f.path}: the lookup sentence`);
      assert.ok(body.includes(`\`CHECKOUT/${p.source.file}\``) && fs.existsSync(path.join(REPO, p.source.file)), `${f.path}: names its source`);
      if (p.source.section) assert.ok(body.includes(`its "${p.source.section}" section`), f.path);
      for (const e of p.extras) assert.ok(body.includes(`\`CHECKOUT/${e.path}\``), `${f.path}: names ${e.path}`);
      assert.doesNotMatch(f.content, /[A-Za-z]:[\\/]|\/Users\/|\/home\//, `${f.path} names no machine path`);
    }
  }
  // Each tool writes only under its own root, and no other adapter renders procedures in this slice.
  assert.ok(built.antigravity.every((f) => f.path.startsWith('.gemini/')), 'no Antigravity file under .claude/');
  for (const [id, files] of Object.entries(built)) if (!['claude-code', 'antigravity'].includes(id)) assert.ok(files.every((f) => !f.procedure), id);
  // The thin-wrapper claim: no wrapper is more than a few kilobytes.
  for (const files of Object.values(wrappers)) for (const [, f] of files) assert.ok(f.content.length < 4000, f.path);
});

// Claude Code only tool names, and slash names that are not one of the fourteen procedures (a slash after a space,
// backtick, quote or bracket; a path such as `CHECKOUT/workflows/` or `~/.orc/` is not one).
function claudeOnlyTerms(text) {
  const names = new Set(PROCEDURES.map((p) => p.name));
  const hits = ['AskUserQuestion', 'subagent_type', 'SendMessage', 'TaskStop', 'ArtifactData', 'ToolSearch'].filter((t) => text.includes(t));
  for (const m of text.matchAll(/(?:^|[\s`'"(\[])\/([a-z][a-z0-9-]*)/gm)) if (!names.has(m[1])) hits.push(`/${m[1]}`);
  return hits;
}

test('generated Antigravity skills name no Claude Code only tool or slash command', async () => {
  const built = (await buildGolden(REPO)).find((r) => r.adapter.id === 'antigravity').files;
  const skills = built.filter((f) => /^\.gemini\/config\/skills\/[^/]+\/SKILL\.md$/.test(f.path));
  assert.strictEqual(skills.length, PROCEDURES.length);
  for (const f of skills) assert.deepStrictEqual(claudeOnlyTerms(f.content), [], f.path);
  // The scanner itself: each term and a foreign slash name is caught; paths and the procedures' own names are not.
  assert.deepStrictEqual(claudeOnlyTerms('Ask with `AskUserQuestion`, `subagent_type`, SendMessage, TaskStop, ArtifactData via ToolSearch.'), ['AskUserQuestion', 'subagent_type', 'SendMessage', 'TaskStop', 'ArtifactData', 'ToolSearch']);
  assert.deepStrictEqual(claudeOnlyTerms('run `/fast`, then /context or (/fewer-permission-prompts)'), ['/fast', '/context', '/fewer-permission-prompts']);
  assert.deepStrictEqual(claudeOnlyTerms('the slash command `/pre-pr-review`; read `CHECKOUT/workflows/start.md` and ~/.orc/config.json and `.gemini/config/skills/<name>/SKILL.md`'), []);
  // The wrapper wording for arguments is the one nobody has to verify.
  const start = skills.find((f) => f.path.includes('/start/'));
  assert.match(start.content, /On Antigravity this skill is also the slash command `\/start`, and the user's request after the command name gives its arguments\./);
});

// The neutral sources name no Claude Code only tool: the specific lives in the tool notes or a generated wrapper. A
// statement that a feature is Claude Code only may stay, as a [file, phrase, reason] entry here; none needs one today.
test('workflows, review, orchestration and core/AGENTS.md name no Claude Code only tool', () => {
  const allowed = [];
  const terms = ['AskUserQuestion', 'SendMessage', 'TaskStop', 'ArtifactData', 'ToolSearch', 'subagent_type', 'model: "sonnet"'];
  const files = spawnSync('git', ['ls-files', '--', 'workflows/*.md', 'review/*.md', 'orchestration/*.md', 'core/AGENTS.md'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  assert.ok(['workflows/grill.md', 'review/lanes/code-reviewer.md', 'orchestration/sprint.md', 'core/AGENTS.md'].every((f) => files.includes(f)), 'every folder is scanned');
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(REPO, f))) continue;
    read(path.join(REPO, f)).split('\n').forEach((line, i) => {
      for (const t of terms) if (line.includes(t) && !allowed.some(([file, phrase]) => file === f && line.includes(phrase))) hits.push(`${f}:${i + 1}: ${t}`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

// Workflows, review and orchestration procedures run in any shell: no bash fence and no POSIX text tool, except the
// lines below, each with its reason.
test('no tracked workflows, review or orchestration Markdown holds a bash fence or a POSIX text tool', () => {
  const allowed = [
    // Advice on reading economy (a search with context lines), not a step that runs; the reader picks its own search.
    ['review/contract.md', /`grep -n -C3`/],
    // Plain git against a docs repo given by path: git runs the same in any shell.
    ['review/lanes/secondary-artifacts.md', /^git -C <docs repo> grep -n /],
    ['review/lanes/secondary-artifacts.md', /^```bash$/],
  ];
  const files = spawnSync('git', ['ls-files', '--', 'workflows/*.md', 'review/*.md', 'orchestration/*.md'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  assert.ok(files.includes('workflows/fix-ci.md') && files.includes('review/lanes/secondary-artifacts.md'), 'subfolders are scanned');
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(path.join(REPO, f))) continue;
    read(path.join(REPO, f)).split('\n').forEach((line, i) => {
      const bad = /^\s*```(bash|sh|shell)\s*$/.test(line) || /\bawk\b|\bsed -|\bwc -|(?<!\bgit )\bgrep -/.test(line);
      if (bad && !allowed.some(([file, re]) => file === f && re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

test('the checkout lookup is one sentence: wrappers, both adapters\' notes, the standards, brief, wrap-up and review procedures', () => {
  const [before, after] = checkoutLookup('\0').split('\0');
  const once = new RegExp(`${esc(before)}[^\`]+${esc(after)}`);
  for (const f of ['adapters/claude-code.notes.md', 'adapters/antigravity.notes.md', 'orchestration/standards.md', 'orchestration/brief.md', 'orchestration/wrap-up.md', 'review/PROCEDURE.md']) {
    assert.match(read(path.join(REPO, f)), once, f);
  }
  assert.doesNotMatch(checkoutLookup('x'), /ORC_[H]OME|~\/\.claude/);
});

test('no generated or tracked file still finds the checkout through the old environment variable or the Claude home', async () => {
  // Built from fragments so this file never holds them; the cost logs name neither. The one allowed line is the
  // README migration note saying the variable is no longer read ([file, phrase the line must hold]).
  const needles = [['ORC', '_HOME'].join(''), ['else `~/', '.claude`'].join(''), ['`~/', '.claude` when'].join('')];
  const allowed = [['README.md', `\`${needles[0]}\` is no longer read`]];
  const hits = [];
  for (const f of trackedFiles()) {
    if (!fs.existsSync(path.join(REPO, f))) continue;
    const buf = fs.readFileSync(path.join(REPO, f));
    if (buf.includes(0)) continue;
    for (const line of buf.toString('utf8').split('\n')) {
      for (const n of needles) if (line.includes(n) && !allowed.some(([file, phrase]) => file === f && line.includes(phrase))) hits.push(`${f}: ${n}`);
    }
  }
  for (const { adapter, files } of await buildGolden(REPO)) {
    for (const f of files) for (const n of needles) if (f.content.includes(n)) hits.push(`build ${adapter.id}/${f.path}: ${n}`);
  }
  assert.deepEqual(hits, []);
});

test('isOrcGenerated: the marker on the first lines, or on the first body line under front matter', () => {
  assert.ok(isOrcGenerated(`---\nname: board\ndescription: x\n---\n\n${generatedMarker('claude-code')}\n\n# Board\n`));
  assert.ok(isOrcGenerated(`${generatedMarker('antigravity')}\nrules\n`));
  assert.ok(!isOrcGenerated('---\nname: board\ndescription: x\n---\n\n# Board\n\nThis skill exists only where a copy is.\n'));
  assert.ok(!isOrcGenerated('---\nname: [broken\n'), 'unparseable front matter is not generated');
  assert.ok(!isOrcGenerated('# my own start\n'));
});

test('review panel files present', () => {
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
  assert.doesNotMatch(read(path.join(REPO, 'core', 'AGENTS.md')), /# Profile:/);
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
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
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
  // Tools without hookScripts wire no hooks and get no scripts.
  const codex = tempDir('hookscripts-codex');
  assert.strictEqual((await run(['install', '--tool', 'codex', '--home', codex, '--apply', '--no-board'])).code, 0);
  assert.ok(!fs.existsSync(path.join(codex, '.codex', 'tools')));
});

test('install copies tools/guard.mjs for antigravity; status compares it; hand copy kept unless --force; uninstall removes it and reminds about orc-guard', async () => {
  const home = tempDir('hookscripts-agy');
  const guardPath = path.join(home, '.gemini', 'tools', 'guard.mjs');
  // Pre-seed a differing hand-copied guard.mjs: install keeps it without --force.
  fs.mkdirSync(path.dirname(guardPath), { recursive: true });
  fs.writeFileSync(guardPath, '// old hand copy\n');
  const first = await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--no-board']);
  assert.strictEqual(first.code, 0, first.err);
  assert.match(first.out, /kept \(hand-copied hook script, differs; --force replaces it, with a backup\): .*guard\.mjs/);
  assert.strictEqual(fs.readFileSync(guardPath, 'utf8'), '// old hand copy\n');
  const st1 = await run(['status', '--tool', 'antigravity', '--home', home, '--no-board']);
  assert.strictEqual(st1.code, 1);
  assert.match(st1.out, /differs \(first difference at line 1; a hand-copied hook script.*guard\.mjs/);

  // --force replaces it with a backup and records it in the manifest.
  const forced = await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--no-board', '--force']);
  assert.strictEqual(forced.code, 0, forced.err);
  assert.strictEqual(read(guardPath), read(path.join(REPO, 'tools', 'guard.mjs')));
  assert.strictEqual(fs.readdirSync(path.dirname(guardPath)).filter((f) => f.startsWith('guard.mjs.orc-backup-')).length, 1);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.ok(mf.files['.gemini/tools/guard.mjs'], 'guard.mjs recorded in antigravity manifest');
  assert.strictEqual((await run(['status', '--tool', 'antigravity', '--home', home, '--no-board'])).code, 0);

  // The installed copy runs standalone on an Antigravity PreToolUse payload.
  const repo = path.join(home, 'r');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  const hook = spawnSync(process.execPath, [guardPath], {
    input: JSON.stringify({ cwd: repo, hookEventName: 'PreToolUse', toolCall: { id: 't1', name: 'run_command', args: { CommandLine: 'git commit -m x' } } }),
    encoding: 'utf8',
  });
  assert.strictEqual(hook.status, 0, hook.stderr);
  assert.strictEqual(JSON.parse(hook.stdout).decision, 'deny');

  // Wire orc-guard in hooks.json: uninstall deletes guard.mjs, so it removes the orc-guard that runs it.
  assert.strictEqual((await run(['hooks', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  const hooksFile = path.join(home, '.gemini', 'config', 'hooks.json');
  const unDry = await run(['uninstall', '--tool', 'antigravity', '--home', home]);
  assert.strictEqual(unDry.code, 0, unDry.err);
  assert.ok(unDry.out.includes(`would remove orc-guard from ${hooksFile} (it runs ${guardPath.replace(/\\/g, '/')}, which this uninstall deletes; other hooks are kept, with a backup)`), unDry.out);
  assert.ok(Object.hasOwn(JSON.parse(fs.readFileSync(hooksFile, 'utf8')), 'orc-guard'), 'the dry run writes nothing');
  const unApply = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(unApply.code, 0, unApply.err);
  assert.ok(!fs.existsSync(guardPath), 'guard.mjs deleted by uninstall');
  assert.ok(unApply.out.includes(`removed orc-guard from ${hooksFile}`), unApply.out);
  assert.doesNotMatch(unApply.out, /--remove --apply/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(hooksFile, 'utf8')), {});

  // With no orc-guard in hooks.json, uninstall prints no reminder.
  assert.strictEqual((await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--no-board'])).code, 0);
  const unClean = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.strictEqual(unClean.code, 0, unClean.err);
  assert.doesNotMatch(unClean.out, /--remove --apply|orc-guard/);
});

// The hooks.json shapes uninstall --tool antigravity meets: another named hook beside orc-guard (as another tool
// writes it), an orc-guard running another script, an unreadable file, and none.
test('uninstall --tool antigravity removes only an orc-guard that runs the guard.mjs it deletes; an unreadable hooks.json is a WARN', async () => {
  const setup = async (hooks) => {
    const home = tempDir('uninstall-agy-hooks');
    assert.strictEqual((await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--no-board'])).code, 0);
    const hooksFile = path.join(home, '.gemini', 'config', 'hooks.json');
    if (hooks !== undefined) {
      fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
      fs.writeFileSync(hooksFile, typeof hooks === 'function' ? hooks(home) : hooks);
    }
    return { home, hooksFile, guard: path.join(home, '.gemini', 'tools', 'guard.mjs') };
  };
  const removeCmd = (home) => `node tools/orc.mjs hooks --tool antigravity --home ${home} --remove --apply`;
  const guardCommand = (home) => `node "${path.join(home, '.gemini', 'tools', 'guard.mjs').replace(/\\/g, '/')}"`;
  const entry = (command) => ({ PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command, timeout: 10 }] }] });
  const other = { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'other-tool-hook.cmd' }] }], Stop: [] };

  // Another named hook (a PreToolUse group on `*`) ahead of orc-guard, in a 4-space CRLF file with a BOM: only
  // orc-guard goes, with a backup, and the BOM and layout stay.
  const a = await setup((home) => '\ufeff' + JSON.stringify({ 'orca-status': other, 'orc-guard': entry(guardCommand(home)) }, null, 4).replace(/\n/g, '\r\n') + '\r\n');
  const before = fs.readFileSync(a.hooksFile, 'utf8');
  const aDry = await run(['uninstall', '--tool', 'antigravity', '--home', a.home]);
  assert.strictEqual(aDry.code, 0, aDry.err);
  assert.match(aDry.out, /would remove orc-guard from .*hooks\.json \(it runs .*guard\.mjs, which this uninstall deletes/);
  assert.strictEqual(fs.readFileSync(a.hooksFile, 'utf8'), before, 'the dry run writes nothing');
  const aApply = await run(['uninstall', '--tool', 'antigravity', '--home', a.home, '--apply']);
  assert.strictEqual(aApply.code, 0, aApply.err);
  assert.strictEqual(aApply.err, '');
  assert.match(aApply.out, /^backed up: .*hooks\.json\.orc-backup-\d{8}-\d{6}$/m);
  assert.ok(aApply.out.includes(`removed orc-guard from ${a.hooksFile} (it ran `), aApply.out);
  assert.strictEqual(fs.readFileSync(a.hooksFile, 'utf8'), '\ufeff' + JSON.stringify({ 'orca-status': other }, null, 4).replace(/\n/g, '\r\n') + '\r\n');
  const backups = fs.readdirSync(path.dirname(a.hooksFile)).filter((f) => f.startsWith('hooks.json.orc-backup-'));
  assert.strictEqual(backups.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(a.hooksFile), backups[0]), 'utf8'), before);
  assert.ok(!fs.existsSync(a.guard));

  // An orc-guard that runs another script is left alone, and named.
  const elsewhere = JSON.stringify({ 'orc-guard': entry('node "/opt/elsewhere/guard.mjs"') }, null, 2);
  const b = await setup(elsewhere);
  const bApply = await run(['uninstall', '--tool', 'antigravity', '--home', b.home, '--apply']);
  assert.strictEqual(bApply.code, 0, bApply.err);
  assert.strictEqual(fs.readFileSync(b.hooksFile, 'utf8'), elsewhere);
  assert.ok(bApply.out.includes(`note: ${b.hooksFile} still has orc-guard; run ${removeCmd(b.home)} to remove it`), bApply.out);
  assert.doesNotMatch(bApply.out, /removed orc-guard/);

  // A guard.mjs edited since install is kept by uninstall, so the orc-guard that runs it stays, and is named.
  const k = await setup((home) => JSON.stringify({ 'orc-guard': entry(guardCommand(home)) }, null, 2));
  const kBefore = fs.readFileSync(k.hooksFile, 'utf8');
  fs.appendFileSync(k.guard, '\n// edited by the owner\n');
  const kApply = await run(['uninstall', '--tool', 'antigravity', '--home', k.home, '--apply']);
  assert.strictEqual(kApply.code, 0, kApply.err);
  assert.ok(fs.existsSync(k.guard), 'the edited guard is kept');
  assert.strictEqual(fs.readFileSync(k.hooksFile, 'utf8'), kBefore);
  assert.ok(kApply.out.includes(`note: ${k.hooksFile} still has orc-guard; run ${removeCmd(k.home)} to remove it`), kApply.out);
  assert.doesNotMatch(kApply.out, /removed orc-guard/);

  // An unreadable hooks.json: a WARN naming the file and the command; the uninstall still completes.
  const c = await setup('{ not json');
  const cApply = await run(['uninstall', '--tool', 'antigravity', '--home', c.home, '--apply']);
  assert.strictEqual(cApply.code, 0, cApply.err);
  assert.match(cApply.err, new RegExp(`^WARN cannot read ${esc(c.hooksFile)} \\(not valid JSON: .+\\); if it still has orc-guard, fix the file and run ${esc(removeCmd(c.home))}$`));
  assert.ok(!fs.existsSync(c.guard), 'the uninstall went on');
  assert.match(cApply.out, /removed manifest: /);
  assert.strictEqual(fs.readFileSync(c.hooksFile, 'utf8'), '{ not json');
  // The same WARN when there is no manifest to uninstall.
  const none = await run(['uninstall', '--tool', 'antigravity', '--home', c.home]);
  assert.strictEqual(none.code, 1);
  assert.match(none.err, /^WARN cannot read .*hooks\.json \(not valid JSON: [^\n]+\n.*no install manifest at /s);

  // No hooks.json: nothing about orc-guard.
  const d = await setup(undefined);
  const dApply = await run(['uninstall', '--tool', 'antigravity', '--home', d.home, '--apply']);
  assert.strictEqual(dApply.code, 0, dApply.err);
  assert.strictEqual(dApply.err, '');
  assert.doesNotMatch(dApply.out, /orc-guard/);
  assert.ok(!fs.existsSync(d.hooksFile));
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

test('install writes the generated skills and commands with hand-copy/edit safeguards; uninstall removes unchanged ones', async () => {
  const home = tempDir('claude-generated');
  const claude = path.join(home, '.claude');
  const built = new Map((await buildGolden(REPO, 'claude-code'))[0].files.map((f) => [f.path, f.content]));
  // Hand copies from before generation (no manifest, no marker): an old routine skill and an old workflow command.
  const oldSkill = '---\nname: board\ndescription: Write an orchestrated task to the live board.\n---\n\n# Board\n\nThis skill exists only where a copy of it is.\n';
  fs.mkdirSync(path.join(claude, 'skills', 'board'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'skills', 'board', 'SKILL.md'), oldSkill);
  fs.writeFileSync(path.join(claude, 'commands', 'start.md'), '# my own start\n');
  const first = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /kept \(hand-copied skill, differs; --force replaces it, with a backup\): .*board[\\/]SKILL\.md/);
  assert.match(first.out, /kept \(hand-copied command, differs; --force replaces it, with a backup\): .*start\.md/);
  assert.equal(read(path.join(claude, 'skills', 'board', 'SKILL.md')), oldSkill, 'hand-copied skill kept');
  assert.equal(read(path.join(claude, 'commands', 'start.md')), '# my own start\n', 'hand-copied command kept');
  const procFiles = PROCEDURES.map((p) => (p.kind === 'routine' ? `.claude/skills/${p.name}/SKILL.md` : `.claude/commands/${p.name}.md`));
  assert.equal(procFiles.length, 14);
  for (const rel of procFiles.filter((r) => !['.claude/skills/board/SKILL.md', '.claude/commands/start.md'].includes(r))) {
    assert.equal(read(path.join(home, ...rel.split('/'))), built.get(rel), rel);
  }
  const permTarget = path.join(claude, 'skills', 'orc-permissions', 'SKILL.md');
  assert.equal(read(permTarget), read(path.join(REPO, 'adapters', 'claude-code', 'skills', 'orc-permissions', 'SKILL.md')));
  const mf = JSON.parse(fs.readFileSync(path.join(claude, '.orc-manifest.claude-code.json'), 'utf8'));
  assert.ok(!mf.files['.claude/commands/start.md'] && !mf.files['.claude/skills/board/SKILL.md'], 'kept hand copies are not recorded');
  assert.ok(mf.files['.claude/commands/grill.md'] && mf.files['.claude/skills/sprint/SKILL.md'], 'generated files are recorded');
  assert.ok(mf.files['.claude/skills/orc-permissions/SKILL.md'], 'orc-permissions skill is recorded');
  // status reports the hand copies as differs, and the rest as same.
  const st1 = await run(['status', '--tool', 'claude-code', '--home', home, '--no-board']);
  assert.equal(st1.code, 1);
  assert.match(st1.out, /differs \(first difference at line 1; a hand-copied command, which install --apply keeps: install --apply --force replaces it, with a backup\): .*start\.md/);
  assert.match(st1.out, /differs \(first difference at line \d+; a hand-copied skill, which install --apply keeps: install --apply --force replaces it, with a backup\): .*board[\\/]SKILL\.md/);
  assert.match(st1.out, /same: .*skills[\\/]orc-permissions[\\/]SKILL\.md/);
  assert.match(st1.out, /same: .*skills[\\/]wrap-up[\\/]SKILL\.md/);
  // Deleting a hand copy hands the path over: install writes and records the generated file.
  fs.rmSync(path.join(claude, 'skills', 'board', 'SKILL.md'));
  const handed = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.match(handed.out, /applied create: .*board[\\/]SKILL\.md/);
  assert.equal(read(path.join(claude, 'skills', 'board', 'SKILL.md')), built.get('.claude/skills/board/SKILL.md'));
  // --force replaces the other hand copy with a backup; now status is clean.
  assert.equal((await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board', '--force'])).code, 0);
  assert.equal(read(path.join(claude, 'commands', 'start.md')), built.get('.claude/commands/start.md'));
  assert.equal((await run(['status', '--tool', 'claude-code', '--home', home, '--no-board'])).code, 0);
  // A generated file left by an earlier install (it carries the marker) and in no manifest is replaced, not kept.
  const sprint = path.join(claude, 'skills', 'sprint', 'SKILL.md');
  fs.writeFileSync(sprint, built.get('.claude/skills/sprint/SKILL.md').replace('# Sprint', '# Sprint (older)'));
  const mfNow = JSON.parse(fs.readFileSync(path.join(claude, '.orc-manifest.claude-code.json'), 'utf8'));
  delete mfNow.files['.claude/skills/sprint/SKILL.md'];
  fs.writeFileSync(path.join(claude, '.orc-manifest.claude-code.json'), JSON.stringify(mfNow));
  const regen = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.equal(regen.code, 0, regen.err);
  assert.match(regen.out, /applied replace: .*sprint[\\/]SKILL\.md/);
  // Hand-editing an installed command refuses re-install without --force and is kept by uninstall without --force.
  const grill = path.join(claude, 'commands', 'grill.md');
  fs.appendFileSync(grill, '\nlocal edit\n');
  const refused = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refused \(edited since install; pass --force to replace it, with a backup\): .*grill\.md/);
  assert.match(read(grill), /local edit/, 'edited installed command is not overwritten without --force');
  const un = await run(['uninstall', '--tool', 'claude-code', '--home', home, '--apply']);
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /kept \(edited since install; --force deletes it after a backup\): .*grill\.md/);
  assert.ok(fs.existsSync(grill), 'edited command kept on uninstall');
  assert.ok(!fs.existsSync(permTarget), 'unchanged orc-permissions skill removed on uninstall');
  assert.ok(!fs.existsSync(path.join(claude, 'commands', 'create.md')), 'unchanged command removed on uninstall');
  assert.ok(!fs.existsSync(path.join(claude, 'skills', 'wrap-up')), 'unchanged skill and its folder removed on uninstall');
  // Clean uninstall with --force leaves nothing installed (other than the earlier backups).
  assert.equal((await run(['uninstall', '--tool', 'claude-code', '--home', home, '--apply', '--force'])).code, 0);
  assert.ok(!fs.existsSync(grill));
  // The golden build has the generated skills and commands, never the static orc-permissions skill.
  const ccGold = (await buildGolden(REPO, 'claude-code'))[0].files.map((f) => f.path);
  assert.ok(ccGold.includes('.claude/commands/start.md') && ccGold.includes('.claude/skills/board/SKILL.md') && !ccGold.includes('.claude/skills/orc-permissions/SKILL.md'));
});

test('install --tool antigravity writes the fourteen generated skills; uninstall removes them', async () => {
  const home = tempDir('agy-skills');
  const r = await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--no-board']);
  assert.equal(r.code, 0, r.err);
  const skills = path.join(home, '.gemini', 'config', 'skills');
  assert.deepEqual(fs.readdirSync(skills).sort(), PROCEDURES.map((p) => p.name).sort());
  for (const p of PROCEDURES) assert.equal(parse(read(path.join(skills, p.name, 'SKILL.md'))).data.name, p.name);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'nothing under .claude');
  assert.equal((await run(['status', '--tool', 'antigravity', '--home', home, '--no-board'])).code, 0);
  assert.equal((await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  assert.ok(!fs.existsSync(skills), 'skills and their folders removed');
});

test('adapter loaders ignore sub-folders under adapters/ (including adapters/claude-code/ and *.mjs folders)', async () => {
  const expected = ['antigravity', 'claude-code', 'codex', 'copilot', 'cursor', 'gemini-cli', 'opencode'];
  assert.ok(fs.statSync(path.join(REPO, 'adapters', 'claude-code')).isDirectory());
  assert.deepEqual(knownTools(REPO), expected);
  assert.deepEqual((await loadAdapters(REPO)).map((a) => a.id), expected);
  // Even a subfolder whose name ends in .mjs is ignored.
  const copy = tempDir('adapter-dirs');
  // The adapters import the procedure catalogue (core/procedures.mjs) and tools/lib.
  for (const p of ['adapters', 'core', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  fs.mkdirSync(path.join(copy, 'adapters', 'fake.mjs'));
  assert.deepEqual(knownTools(copy), expected);
  assert.deepEqual((await loadAdapters(copy)).map((a) => a.id), expected);
});

test('ship-prompts skill is identical for Claude Code and Antigravity', () => {
  const claude = parse(read(path.join(REPO, '.claude', 'skills', 'ship-prompts', 'SKILL.md')));
  const agy = parse(read(path.join(REPO, '.agents', 'skills', 'ship-prompts', 'SKILL.md')));
  assert.equal(claude.data.name, 'ship-prompts');
  assert.equal(agy.data.name, 'ship-prompts');
  assert.equal(agy.body, claude.body, '.agents and .claude ship-prompts bodies must match');
});

test('D3d: an identical hand-copied static file stays unrecorded, is kept after a source change, and hands over once deleted', async () => {
  const copy = tempDir('static-owner-repo');
  for (const p of ['core', 'models.json', 'adapters', 'tools/lib', 'tools/guard.mjs', 'tools/guard.ps1', 'tools/board-reminder.mjs', 'tools/board-reminder.ps1']) {
    fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  }
  const home = tempDir('static-owner-home');
  const claude = path.join(home, '.claude');
  // The static orc-permissions skill (generated skills and commands carry a marker, so install recognises its own output).
  const grillSrc = path.join(copy, 'adapters', 'claude-code', 'skills', 'orc-permissions', 'SKILL.md');
  const grillDst = path.join(claude, 'skills', 'orc-permissions', 'SKILL.md');
  const original = read(grillSrc);
  fs.mkdirSync(path.dirname(grillDst), { recursive: true });
  fs.writeFileSync(grillDst, original);

  // First install: byte-identical static file with no manifest stays the owner's (not recorded).
  const first = await run(['install', '--tool', 'claude-code', '--repo', copy, '--home', home, '--apply', '--no-board']);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /applied unchanged: .*orc-permissions[\\/]SKILL\.md \(already there and in no orc manifest: not recorded, uninstall leaves it\)/);
  const mf1 = JSON.parse(fs.readFileSync(path.join(claude, '.orc-manifest.claude-code.json'), 'utf8'));
  assert.equal(mf1.files['.claude/skills/orc-permissions/SKILL.md'], undefined, 'identical pre-existing file is not recorded');

  // Later source change: install keeps the unrecorded file without --force, and status flags it as a hand copy.
  fs.appendFileSync(grillSrc, '\nUpdated line.\n');
  const second = await run(['install', '--tool', 'claude-code', '--repo', copy, '--home', home, '--apply', '--no-board']);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /kept \(hand-copied skill, differs; --force replaces it, with a backup\): .*orc-permissions[\\/]SKILL\.md/);
  assert.equal(read(grillDst), original, 'unrecorded hand copy is not overwritten');
  const st1 = await run(['status', '--tool', 'claude-code', '--repo', copy, '--home', home, '--no-board']);
  assert.equal(st1.code, 1);
  assert.match(st1.out, /differs \(first difference at line \d+; a hand-copied skill, which install --apply keeps: install --apply --force replaces it, with a backup\): .*orc-permissions[\\/]SKILL\.md/);

  // Handover without --force: delete the file, then install; it is now installed and recorded.
  fs.rmSync(grillDst);
  const third = await run(['install', '--tool', 'claude-code', '--repo', copy, '--home', home, '--apply', '--no-board']);
  assert.equal(third.code, 0, third.err);
  assert.match(third.out, /applied create: .*orc-permissions[\\/]SKILL\.md/);
  assert.equal(read(grillDst), read(grillSrc));
  const mf3 = JSON.parse(fs.readFileSync(path.join(claude, '.orc-manifest.claude-code.json'), 'utf8'));
  assert.ok(mf3.files['.claude/skills/orc-permissions/SKILL.md'], 'now recorded in manifest');
  assert.equal((await run(['status', '--tool', 'claude-code', '--repo', copy, '--home', home, '--no-board'])).code, 0);
});

test('panel commands and skills on Claude Code and Antigravity note the Routed agents orc dispatch exception', async () => {
  const built = Object.fromEntries((await buildGolden(REPO)).map((r) => [r.adapter.id, r.files]));
  const panel = ['start', 'peer-review', 'pre-pr-review'];
  const nonPanel = ['grill', 'draft-pr', 'board'];
  for (const [tool, pathFor] of [
    ['claude-code', (name) => (PROCEDURES.find((p) => p.name === name).kind === 'routine' ? `.claude/skills/${name}/SKILL.md` : `.claude/commands/${name}.md`)],
    ['antigravity', (name) => `.gemini/config/skills/${name}/SKILL.md`],
  ]) {
    for (const name of panel) {
      const file = built[tool].find((f) => f.path === pathFor(name));
      assert.ok(file, `${tool}: ${name} generated`);
      assert.match(file.content, /review\/PROCEDURE\.md.*"Routed agents"/, `${tool}/${name} names Routed agents`);
      assert.match(file.content, /orc dispatch/, `${tool}/${name} names orc dispatch`);
    }
    for (const name of nonPanel) {
      const file = built[tool].find((f) => f.path === pathFor(name));
      assert.ok(file, `${tool}: ${name} generated`);
      assert.doesNotMatch(file.content, /Routed agents/, `${tool}/${name} does not mention Routed agents`);
    }
  }
});
