import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, normalizeEol } from '../tools/lib/frontmatter.mjs';
import { parseRole } from '../tools/lib/roles.mjs';
import { serializeToml, parseToml, tomlMultiline } from '../tools/lib/toml.mjs';
import { main, loadRoles, loadModels, loadAdapters, buildTool, allowedTools, parseAgyModels } from '../tools/orc.mjs';

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
  assert.deepEqual(roles.map((r) => r.name), ['builder', 'debugger', 'refuter', 'researcher', 'scout']);
  const base = '---\nname: x\ndescription: d\ntier: low\naccess: write\ncapabilities:\n  - read\n---\n\nbody\n';
  assert.equal(parseRole(base).tier, 'low');
  assert.throws(() => parseRole(base.replace('tier: low', 'tier: huge')), /unknown tier/);
  assert.throws(() => parseRole(base.replace('  - read', '  - teleport')), /unknown capability/);
  for (const r of roles) if (r.access === 'read-only') assert.match(r.body, /never edit/i, r.name);
});

test('golden snapshots, tool allowlists, read-only roles', async () => {
  const { roles, models, agentsMd, adapters } = await buildRepo();
  assert.deepEqual(adapters.map((a) => a.id), ['antigravity', 'claude-code', 'codex', 'copilot', 'cursor', 'gemini-cli', 'opencode']);
  for (const adapter of adapters) {
    const { files, errors } = buildTool(adapter, roles, models, agentsMd);
    assert.deepEqual(errors, [], adapter.id);
    const allowed = allowedTools(adapter);
    const edit = new Set(adapter.capabilityTools?.edit ?? []);
    for (const f of files) {
      const golden = path.join(GOLDEN, adapter.id, ...f.path.split('/'));
      assert.equal(f.content, read(golden), `${adapter.id}/${f.path} differs from golden`);
      if (!f.path.startsWith(`${adapter.home.agentsDir}/`)) continue;
      const role = roles.find((r) => f.path.split('/').at(-1).split('.')[0] === r.name);
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
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'models.json', 'roles', 'adapters', 'agents', 'tools/lib']) {
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
  fs.writeFileSync(rule, 'local edit\n');
  const again = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.match(again.out, /applied replace: .*AGENTS\.md/);
  assert.match(again.out, /applied unchanged: .*scout\.md/);
  const backups = fs.readdirSync(path.dirname(rule)).filter((f) => f.startsWith('AGENTS.md.orc-backup-'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^AGENTS\.md\.orc-backup-\d{8}-\d{6}$/);
  assert.equal(read(path.join(path.dirname(rule), backups[0])), 'local edit\n');

  const refused = await run(['install', '--tool', 'claude-code']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refusing --tool claude-code without --home/);
});

const SAMPLE = `gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)
gemini-3.8-flash-low      Gemini 3.8 Flash (Low)
claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking  Claude Opus 4.6 (Thinking)
gpt-oss-120b-medium       GPT-OSS 120B (Medium)
`;

test('models helper reads agy models output', async () => {
  assert.deepEqual(parseAgyModels(SAMPLE).fragment, {
    antigravity: { headless: { low: 'gemini-3.8-flash-low', mid: 'gemini-3.8-flash-medium', high: 'gemini-3.8-flash-high' } },
  });
  const ok = await run(['models', '--tool', 'antigravity', '--from-stdin'], SAMPLE);
  assert.equal(ok.code, 0);
  assert.equal(JSON.parse(ok.out).antigravity.headless.mid, 'gemini-3.8-flash-medium');
  const bad = await run(['models', '--tool', 'antigravity', '--from-stdin'], 'gpt-oss-120b-medium  GPT\n');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /cannot tell the low, mid, high flash slug/);
});

// Lines that may name a model because they record an incident as a fact, not a rule.
const INCIDENT_ALLOW = ['  - On 18261 Haiku gave opposite size verdicts on identical tickets across two runs.'];

test('AGENTS.md hygiene', () => {
  const text = read(path.join(REPO, 'AGENTS.md'));
  assert.ok(Buffer.byteLength(text) < 24000, 'AGENTS.md over 24,000 bytes');
  const banned = /subagent_type|ArtifactData|claude -p|haiku|sonnet|opus|fable/i;
  const hits = text.split('\n').filter((l) => banned.test(l) && !INCIDENT_ALLOW.includes(l));
  assert.deepEqual(hits, []);
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
    /- \*\*Board:\*\* this machine's board address is `http:\/\/localhost:8377\/`; write it with `node C:\/src\/Orc-Dashboard\/local\/board\.js` \(set `ORC_BOARD_PORT=8377`\)\./,
  );
});

test('install warns about two rulebooks in a shared ~/.gemini', async () => {
  const home = tempDir('gemini');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  assert.match(read(path.join(home, '.gemini', 'AGENTS.md')), /^<!-- generated by orc\.mjs: antigravity -->\n/);
  const g = await run(['install', '--tool', 'gemini-cli', '--home', home]);
  assert.match(g.err, /AGENTS\.md is an orc-generated Antigravity rulebook .*two copies.*Remove .*AGENTS\.md unless you also use Antigravity/);
  const home2 = tempDir('gemini2');
  await run(['install', '--tool', 'gemini-cli', '--home', home2, '--apply']);
  const a = await run(['install', '--tool', 'antigravity', '--home', home2]);
  assert.match(a.err, /GEMINI\.md is an orc-generated Gemini CLI rulebook .*Remove .*GEMINI\.md unless you also use Gemini CLI/);
  // A hand-written file is not ours: no warning.
  const home3 = tempDir('gemini3');
  fs.mkdirSync(path.join(home3, '.gemini'));
  fs.writeFileSync(path.join(home3, '.gemini', 'GEMINI.md'), '# my own rules\n');
  assert.doesNotMatch((await run(['install', '--tool', 'antigravity', '--home', home3])).err, /two copies/);
});

test('install backups never collide within one second', async () => {
  const home = tempDir('stamp');
  const io = (out) => ({ out: (s) => out.push(s), err: () => {}, stdin: () => '', now: () => new Date(2026, 10, 15, 13, 5, 9) });
  await main(['install', '--tool', 'codex', '--home', home, '--apply'], io([]));
  const rule = path.join(home, '.codex', 'AGENTS.md');
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(rule, `edit ${n}\n`);
    await main(['install', '--tool', 'codex', '--home', home, '--apply'], io([]));
  }
  const backups = fs.readdirSync(path.dirname(rule)).filter((f) => f.includes('.orc-backup-')).sort();
  assert.deepEqual(backups, ['AGENTS.md.orc-backup-20261115-130509', 'AGENTS.md.orc-backup-20261115-130509-2', 'AGENTS.md.orc-backup-20261115-130509-3']);
  assert.equal(read(path.join(path.dirname(rule), backups[2])), 'edit 3\n');
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
