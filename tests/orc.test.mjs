import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, normalizeEol } from '../tools/lib/frontmatter.mjs';
import { parseRole } from '../tools/lib/roles.mjs';
import { serializeToml, parseToml, tomlMultiline } from '../tools/lib/toml.mjs';
import { main, loadRoles, loadModels, loadAdapters, buildTool, allowedTools, parseAgyModels, firstDiffLine } from '../tools/orc.mjs';
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
  // An older orc-generated rulebook (it carries the marker) is replaced normally, with a backup.
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

test('no tracked text file names the owner', () => {
  const name = new RegExp(['c', 'o', 'o', 'p', 'e', 'r'].join(''), 'i');
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 50, 'git ls-files listed the repo');
  const hits = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(REPO, f));
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((l, i) => {
      if (name.test(l)) hits.push(`${f}:${i + 1}`);
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
  };
  for (const [name, fm] of Object.entries(want)) {
    const { data } = parse(read(path.join(REPO, 'agents', `${name}.md`)));
    assert.deepEqual(data, { name, description: data.description, ...fm }, name);
  }
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
  for (const p of ['CLAUDE.md', 'AGENTS.md', 'refuter.md']) assert.match(c.out, new RegExp(`same: .*${p.replace('.', '\\.')}`));
  assert.equal((await run(['status', '--tool', 'claude-code', '--home', ch])).code, 1, 'without the board line CLAUDE.md differs');
  assert.match((await run(['status', '--home', ch])).err, /status needs --tool/);
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
    fs.writeFileSync(rule, `<!-- generated by orc.mjs: codex -->\nedit ${n}\n`);
    await main(['install', '--tool', 'codex', '--home', home, '--apply'], io([]));
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
