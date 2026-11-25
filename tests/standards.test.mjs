import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../tools/orc.mjs';
import { classify } from '../tools/lib/reviewtier.mjs';
import { validateArchive, demoteHeadings, stripFrontmatter, detect, withRequires } from '../tools/lib/standards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-data-'));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

async function run(argv, extra = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '', ...extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function tree(files) {
  const dir = tempDir('std');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const canJunction = (() => {
  const d = tempDir('jprobe');
  try {
    fs.mkdirSync(path.join(d, 't'));
    fs.symlinkSync(path.join(d, 't'), path.join(d, 'l'), 'junction');
    return true;
  } catch {
    return false;
  }
})();

// ---------- list / show ----------

test('standards list: one line per archive entry, README excluded; show prints a file; unknown id lists the known ones', async () => {
  const l = await run(['standards', 'list']);
  assert.equal(l.code, 0);
  const ids = fs.readdirSync(path.join(REPO, 'standards')).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3));
  assert.equal(l.out.split('\n').length, ids.length);
  assert.match(l.out, /^csharp {2}language {2}C# and \.NET {2}\(reviewed \d{4}-\d{2}-\d{2}\)$/m);
  assert.doesNotMatch(l.out, /README/);
  const s = await run(['standards', 'show', 'go']);
  assert.equal(s.code, 0);
  assert.equal(s.out, read(path.join(REPO, 'standards', 'go.md')).replace(/\n$/, ''));
  const bad = await run(['standards', 'show', 'cobol']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown standard cobol; known: .*csharp/);
});

// ---------- detect ----------

test('standards detect: matches case-insensitively, skips folders by name, pulls requires in transitively, --json shape', async () => {
  const dir = tree({
    'src/App.CSPROJ': '',
    'src/Web/appsettings.json': '{}',
    'node_modules/x/tsconfig.json': '{}',
    'bin/a.ps1': '',
    'obj/b.ps1': '',
    '.claude/c.ps1': '',
    'venv/x.py': '',
    'ui/Button.tsx': '',
  });
  const r = await run(['standards', 'detect', '--repo', dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /STANDARDS\.md: absent/);
  assert.match(r.out, /csharp {2}language {2}1 match\(es\), e\.g\. src\/App\.CSPROJ/);
  assert.match(r.out, /aspnet-core {2}framework {2}1 match/);
  assert.match(r.out, /typescript {2}language {2}required by react/);
  assert.doesNotMatch(r.out, /^  (powershell|python) /m);
  fs.writeFileSync(path.join(dir, 'STANDARDS.md'), 'x\n');
  const j = JSON.parse((await run(['standards', 'detect', '--repo', dir, '--json'])).out);
  assert.deepEqual(Object.keys(j).sort(), ['archive', 'current', 'detected', 'repo', 'standardsFile', 'truncated', 'unreadable']);
  assert.equal(j.standardsFile, true);
  assert.equal(j.current, null, 'no marker');
  assert.equal(j.unreadable, 0);
  assert.ok(j.archive.includes('go'));
  const ts = j.detected.find((d) => d.id === 'typescript');
  assert.deepEqual(ts, { id: 'typescript', title: ts.title, kind: 'language', matches: 0, examples: [], requiredBy: 'react' });
  assert.equal(j.detected.find((d) => d.id === 'csharp').requiredBy, null);
  const empty = await run(['standards', 'detect', '--repo', tempDir('empty')]);
  assert.equal(empty.code, 0);
  assert.match(empty.out, /no archive stacks detected/);
});

test('standards detect and apply: requires resolve transitively (a -> b -> c)', () => {
  const entry = (id, kind, requires, glob) => ({ id, title: id.toUpperCase(), kind, requires, detect: [glob] });
  const archive = [entry('a', 'tool', ['b'], 'a.cfg'), entry('b', 'framework', ['c'], 'b.cfg'), entry('c', 'language', [], 'c.cfg')];
  const dir = tree({ 'x/A.CFG': '' });
  const { detected } = detect(dir, archive);
  assert.deepEqual(detected.map((d) => [d.id, d.matches, d.requiredBy]), [['a', 1, null], ['b', 0, 'a'], ['c', 0, 'b']]);
  const { entries, added } = withRequires(['a'], archive);
  assert.deepEqual(entries.map((e) => e.id), ['c', 'b', 'a'], 'languages, frameworks, tools');
  assert.deepEqual(added, [{ id: 'b', by: 'a' }, { id: 'c', by: 'b' }]);
});

test('standards detect: stops at the entry cap and says so', async () => {
  const dir = tree(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, ''])));
  fs.writeFileSync(path.join(dir, 'zz.go'), '');
  fs.writeFileSync(path.join(dir, 'go.mod'), '');
  const r = await run(['standards', 'detect', '--repo', dir, '--json'], { standardsCap: 5 });
  assert.equal(r.code, 0);
  assert.match(r.err, /stopped after 5 entries/);
  assert.equal(JSON.parse(r.out).truncated, true);
});

test('standards detect: does not follow a junction', { skip: canJunction ? false : 'cannot create a junction' }, async () => {
  const outside = tree({ 'go.mod': '' });
  const dir = tempDir('jdetect');
  fs.symlinkSync(outside, path.join(dir, 'link'), 'junction');
  assert.match((await run(['standards', 'detect', '--repo', dir])).out, /no archive stacks detected/);
});

// ---------- apply ----------

test('standards apply: dry run writes nothing; create; identical re-run is unchanged; a new stack set is replace', async () => {
  const dir = tempDir('apply');
  const dry = await run(['standards', 'apply', '--repo', dir, '--stack', 'aspnet-core']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /added csharp \(required by aspnet-core\)/);
  assert.match(dry.out, /\(create\)/);
  assert.match(dry.out, /dry run/);
  assert.deepEqual(fs.readdirSync(dir), []);
  const c = await run(['standards', 'apply', '--repo', dir, '--stack', 'aspnet-core', '--apply']);
  assert.equal(c.code, 0);
  const text = fs.readFileSync(path.join(dir, 'STANDARDS.md'), 'utf8');
  assert.doesNotMatch(text, /\r/);
  const lines = text.split('\n');
  assert.match(lines[0], /^<!-- orc standards: stacks=csharp,aspnet-core; imports=; sha256=[0-9a-f]{64} -->$/);
  assert.equal(lines[1], '# Coding standards');
  assert.ok(text.indexOf('## C# and .NET') < text.indexOf('## ASP.NET Core'), 'languages before frameworks');
  assert.match(text, /^### Review checklist$/m);
  assert.match(text, /^### Sources\n\n1\. https:\/\//m);
  assert.match(text, /^Reviewed \d{4}-\d{2}-\d{2}\.$/m);
  const again = await run(['standards', 'apply', '--repo', dir, '--stack', 'csharp,aspnet-core', '--apply']);
  assert.match(again.out, /\(unchanged\)/);
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--stack', 'aspnet-core', '--apply']);
  assert.equal(r.code, 0);
  assert.match(r.out, /\(replace\)/);
  assert.equal(fs.readdirSync(dir).length, 1, 'a clean replace leaves no backup');
});

test('standards apply: a hand edit is REPLACE EDITED (refused, then --force with a backup); no marker is REPLACE HAND-WRITTEN; CRLF is not an edit', async () => {
  const dir = tempDir('edited');
  await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--apply']);
  const file = path.join(dir, 'STANDARDS.md');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace(/\n/g, '\r\n'));
  assert.match((await run(['standards', 'apply', '--repo', dir, '--stack', 'go'])).out, /\(unchanged\)/);
  fs.writeFileSync(file, `${original}\nTeam rule.\n`);
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'rust', '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.out, /\(REPLACE EDITED\)/);
  assert.match(r.err, /edited since it was applied; pass --force/);
  assert.match(read(file), /Team rule/);
  const f = await run(['standards', 'apply', '--repo', dir, '--stack', 'rust', '--apply', '--force']);
  assert.equal(f.code, 0);
  const backups = fs.readdirSync(dir).filter((n) => n.startsWith('STANDARDS.md.orc-backup-'));
  assert.equal(backups.length, 1);
  assert.match(read(path.join(dir, backups[0])), /Team rule/);
  assert.match(read(file), /stacks=rust;/);
  fs.writeFileSync(file, '# Our standards\n');
  const h = await run(['standards', 'apply', '--repo', dir, '--stack', 'rust', '--apply']);
  assert.equal(h.code, 1);
  assert.match(h.out, /\(REPLACE HAND-WRITTEN\)/);
  assert.equal(read(file), '# Our standards\n');
});

test('standards apply --from: a file and a folder; frontmatter stripped; headings demoted outside fences only', async () => {
  const src = tree({
    'mine.md': '---\ntitle: x\nnested:\n  a: 1\n---\n\n# Team rules\n\n- Rule.\n\n```sh\n# not a heading\n```\n',
    'dir/b.md': '## B rules\n',
    'dir/a.md': '# A rules\n',
    'dir/skip.txt': 'no',
    'dir/sub/c.md': '# C\n',
  });
  const dir = tempDir('from');
  const r = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'mine.md'), '--from', path.join(src, 'dir'), '--stack', 'go', '--apply']);
  assert.equal(r.code, 0, r.err);
  const text = read(path.join(dir, 'STANDARDS.md'));
  assert.match(text.split('\n')[0], /stacks=go; imports=mine\.md,a\.md,b\.md;/);
  assert.match(text, /## Imported: mine\.md\n\n## Team rules\n\n- Rule\.\n\n```sh\n# not a heading\n```/);
  assert.doesNotMatch(text, /nested:/);
  assert.ok(text.indexOf('## Imported: a.md') < text.indexOf('## Imported: b.md'));
  assert.match(text, /## Imported: b\.md\n\n### B rules/);
  assert.doesNotMatch(text, /## C\b/);
  assert.ok(text.indexOf('## Go') < text.indexOf('## Imported: mine.md'), 'stacks before imports');
  assert.equal(demoteHeadings('# a\n~~~\n# b\n~~~\n###### c'), '## a\n~~~\n# b\n~~~\n###### c');
  assert.equal(stripFrontmatter('---\na: b\n---\nbody'), 'body');
});

test('standards apply: unknown stack, missing --from, neither, an --out escaping the repo all exit 1 and write nothing', async () => {
  const dir = tempDir('bad');
  const cases = [
    [['--stack', 'cobol'], /unknown stack\(s\) cobol; known:/],
    [['--from', path.join(dir, 'nope.md')], /not found/],
    [[], /needs --stack <ids> or --from <path>/],
    [['--stack', 'go', '--out', '../x.md'], /outside the repo/],
    [['--stack', 'go', '--out', path.join(dir, 'abs.md')], /must be relative/],
  ];
  for (const [extra, re] of cases) {
    const r = await run(['standards', 'apply', '--repo', dir, ...extra, '--apply']);
    assert.equal(r.code, 1, extra.join(' '));
    assert.match(r.err, re);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
  const nested = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--out', 'docs/STANDARDS.md', '--apply']);
  assert.equal(nested.code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'STANDARDS.md')));
});

test('standards apply: a junctioned parent below the repo is refused', { skip: canJunction ? false : 'cannot create a junction' }, async () => {
  const outside = tempDir('outside');
  const dir = tempDir('jrepo');
  fs.symlinkSync(outside, path.join(dir, 'docs'), 'junction');
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--out', 'docs/STANDARDS.md', '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /symlink or junction|resolves outside/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

// ---------- check validation ----------

test('check validates the archive: a bad citation index and a missing checklist fail; README.md is not an entry', async () => {
  assert.deepEqual(validateArchive(path.join(REPO, 'standards')), []);
  const dir = tempDir('archive');
  for (const f of fs.readdirSync(path.join(REPO, 'standards'))) fs.copyFileSync(path.join(REPO, 'standards', f), path.join(dir, f));
  const go = read(path.join(dir, 'go.md'));
  fs.writeFileSync(path.join(dir, 'go.md'), go.replace('## Naming', 'Cite [99] and `arr[0]`.\n\n## Naming'));
  const rust = read(path.join(dir, 'rust.md'));
  fs.writeFileSync(path.join(dir, 'rust.md'), rust.slice(0, rust.indexOf('## Review checklist')));
  fs.writeFileSync(path.join(dir, 'README.md'), '# not an entry\n');
  const problems = validateArchive(dir);
  assert.deepEqual(problems, ['standards/go.md: citation(s) [99] out of range (12 source(s))', 'standards/rust.md: no "## Review checklist" section']);
  const copy = tempDir('checkrepo');
  for (const p of ['AGENTS.md', 'CLAUDE.md', 'models.json', 'roles', 'adapters', 'agents', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  fs.cpSync(dir, path.join(copy, 'standards'), { recursive: true });
  const c = await run(['check', '--repo', copy]);
  assert.equal(c.code, 1);
  assert.match(c.err, /FAIL standards\/go\.md: citation\(s\) \[99\]/);
});

// ---------- review-tier and help ----------

test('review-tier: the archive and the setup procedure are prompts (Full)', () => {
  for (const p of ['standards/go.md', 'standards/README.md', 'orchestration/standards.md', 'orchestration/sprint.md', 'skills/repo-standards/SKILL.md']) assert.equal(classify([p]).tier, 'Full', p);
  assert.equal(classify(['docs/standards.md']).tier, 'Light-eligible');
});

test('help: the table lists standards, and its --repo names the project', async () => {
  assert.match((await run(['help'])).out, /^ {2}standards +\S/m);
  const h = await run(['standards', '--help']);
  assert.match(h.out, /^usage: node tools\/orc\.mjs standards list/);
  assert.match(h.out, /--repo <dir> +the project/);
  assert.doesNotMatch(h.out, /Orc-istration checkout to read/);
});

// ---------- rework: option gate, --out parents, install pointer ----------

test('--stack, --from and --json are refused outside standards', async () => {
  const home = tempDir('gate');
  for (const extra of [['--stack', 'x'], ['--from', 'x.md'], ['--json']]) {
    const r = await run(['install', ...extra, '--tool', 'claude-code', '--home', home]);
    assert.equal(r.code, 1, extra.join(' '));
    assert.match(r.err, /--stack, --from and --json apply to standards only/);
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test('check validation: a Review checklist with no "- [ ]" item fails', () => {
  const dir = tempDir('nochecks');
  const go = read(path.join(REPO, 'standards', 'go.md'));
  fs.writeFileSync(path.join(dir, 'go.md'), go.replace(/^- \[ \] /gm, '- '));
  assert.deepEqual(validateArchive(dir), ['standards/go.md: the Review checklist has no "- [ ]" item']);
});

test('standards apply: --out below an existing file, or inside .git, fails cleanly', async () => {
  const dir = tempDir('outfile');
  assert.equal((await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--apply'])).code, 0);
  const before = read(path.join(dir, 'STANDARDS.md'));
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--out', 'STANDARDS.md/x.md', '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /STANDARDS\.md is a file, not a folder; nothing written/);
  assert.equal(read(path.join(dir, 'STANDARDS.md')), before);
  for (const out of ['.git/STANDARDS.md', 'sub/.GIT/x.md']) {
    const g = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--out', out, '--apply']);
    assert.equal(g.code, 1, out);
    assert.match(g.err, /inside \.git; refusing/);
  }
  assert.deepEqual(fs.readdirSync(dir), ['STANDARDS.md']);
});

test('install ends with the standards-setup pointer, dry run and --apply', async () => {
  const home = tempDir('next');
  const line = `set up each project's coding standards: see ${fs.realpathSync.native(REPO).replace(/\\/g, '/')}/orchestration/standards.md (Claude Code: the repo-standards skill, where ~/.claude/skills has it).`;
  const dry = await run(['install', '--tool', 'antigravity', '--home', home]);
  assert.equal(dry.out.split('\n').at(-1), `After --apply, next: ${line}`);
  const done = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(done.code, 0);
  assert.equal(done.out.split('\n').at(-1), `Next: ${line}`);
});

// ---------- pre-PR review fixes ----------

const ORC = path.join(REPO, 'tools', 'orc.mjs');
const caseInsensitive = (() => {
  const d = tempDir('caseprobe');
  fs.writeFileSync(path.join(d, 'a'), '');
  return fs.existsSync(path.join(d, 'A'));
})();

test('standards apply: an --out through a case-different repo name does not hang (A1)', () => {
  const proj = path.join(tempDir('a1'), 'proj');
  fs.mkdirSync(proj);
  const r = spawnSync(process.execPath, [ORC, 'standards', 'apply', '--repo', '.', '--stack', 'python', '--out', '../PROJ/x.md'], { cwd: proj, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.signal, null, 'killed by the timeout: the walk hung');
  if (caseInsensitive) {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /target: .*[\\/]proj[\\/]x\.md \(create\)/);
  } else assert.equal(r.status, 1);
  assert.deepEqual(fs.readdirSync(proj), []);
});

test('golden renames a golden that differs only by case instead of deleting it (A2)', { skip: caseInsensitive ? false : 'case-sensitive file system' }, async () => {
  const copy = tempDir('goldcase');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'tools/lib', 'tests/golden/codex']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  const dir = path.join(copy, 'tests', 'golden', 'codex', '.codex');
  fs.renameSync(path.join(dir, 'AGENTS.md'), path.join(dir, 'Agents.md'));
  const r = await run(['golden', '--tool', 'codex', '--repo', copy]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /renamed tests\/golden\/codex\/\.codex\/Agents\.md -> tests\/golden\/codex\/\.codex\/AGENTS\.md/);
  assert.doesNotMatch(r.out, /deleted/);
  assert.ok(fs.readdirSync(dir).includes('AGENTS.md'));
  assert.equal(read(path.join(dir, 'AGENTS.md')), read(path.join(REPO, 'tests', 'golden', 'codex', '.codex', 'AGENTS.md')));
});

test('standards apply --from: a folder holding the target leaves it out; the target itself is refused (A3)', async () => {
  const dir = tree({ 'team.md': '# Team\n' });
  assert.equal((await run(['standards', 'apply', '--repo', dir, '--from', dir, '--apply'])).code, 0);
  const first = read(path.join(dir, 'STANDARDS.md'));
  assert.match(first.split('\n')[0], /imports=team\.md;/);
  const again = await run(['standards', 'apply', '--repo', dir, '--from', dir, '--apply']);
  assert.match(again.out, /\(unchanged\)/);
  const self = await run(['standards', 'apply', '--repo', dir, '--from', path.join(dir, 'STANDARDS.md'), '--apply']);
  assert.equal(self.code, 1);
  assert.match(self.err, /is the apply target; refusing/);
  assert.equal(read(path.join(dir, 'STANDARDS.md')), first);
});

test('standards detect: unreadable folders are counted and warned; an unreadable repo exits 1 (A4)', async () => {
  const dir = tree({ 'a/go.mod': '', 'b/x.py': '', 'c/y.py': '' });
  const readdir = (p, o) => {
    if (/[\\/][bc]$/.test(p)) throw new Error('EACCES');
    return fs.readdirSync(p, o);
  };
  const r = await run(['standards', 'detect', '--repo', dir, '--json'], { standardsReaddir: readdir });
  assert.equal(r.code, 0);
  assert.match(r.err, /^WARN could not read 2 folder\(s\); results are partial$/m);
  const j = JSON.parse(r.out);
  assert.equal(j.unreadable, 2);
  assert.deepEqual(j.detected.map((d) => d.id), ['go']);
  const deny = () => {
    throw new Error('EACCES');
  };
  const root = await run(['standards', 'detect', '--repo', dir], { standardsReaddir: deny });
  assert.equal(root.code, 1);
  assert.match(root.err, /cannot read .*EACCES/);
});

test('help toString and help __proto__ are unknown commands, not crashes (A5)', async () => {
  for (const c of ['toString', '__proto__', 'constructor']) {
    const r = await run(['help', c]);
    assert.equal(r.code, 1, c);
    assert.match(r.err, new RegExp(`^unknown command ${c}`));
  }
});

test('standards subcommands refuse options that do not apply (A6)', async () => {
  const dir = tempDir('opts');
  const cases = [
    [['list', '--json'], /standards list does not take --json/],
    [['show', 'go', '--stack', 'go'], /standards show does not take --stack/],
    [['detect', '--repo', dir, '--force'], /standards detect does not take --force/],
    [['detect', '--repo', dir, '--out', 'x.md', '--apply'], /standards detect does not take --out, --apply/],
    [['apply', '--repo', dir, '--stack', 'go', '--json'], /standards apply does not take --json/],
  ];
  for (const [argv, re] of cases) {
    const r = await run(['standards', ...argv]);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, re);
  }
  assert.equal((await run(['standards', 'list', '--repo', dir])).code, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('standards apply: leaving out a recorded stack or import is REPLACE DROPS; detect reports current (A8)', async () => {
  const src = tree({ 'team.md': '# Team\n' });
  const dir = tempDir('drops');
  await run(['standards', 'apply', '--repo', dir, '--stack', 'go,python', '--from', path.join(src, 'team.md'), '--apply']);
  const file = path.join(dir, 'STANDARDS.md');
  const before = read(file);
  const j = JSON.parse((await run(['standards', 'detect', '--repo', dir, '--json'])).out);
  assert.deepEqual(j.current, { stacks: ['go', 'python'], imports: ['team.md'] });
  const dry = await run(['standards', 'apply', '--repo', dir, '--stack', 'go']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /\(REPLACE DROPS\)/);
  assert.match(dry.out, /--apply would refuse: the file is recorded with python, team\.md, which this composition drops/);
  const refused = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--apply']);
  assert.equal(refused.code, 1);
  assert.equal(read(file), before);
  const added = await run(['standards', 'apply', '--repo', dir, '--stack', 'go,python,rust', '--from', path.join(src, 'team.md'), '--apply']);
  assert.match(added.out, /\(replace\)/, 'a superset is a plain replace');
  const forced = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--apply', '--force']);
  assert.equal(forced.code, 0);
  assert.equal(fs.readdirSync(dir).filter((n) => n.includes('.orc-backup-')).length, 1);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp-')), [], 'the temp file was renamed over the target (A7)');
});

const ENTRY = (over = '') => `---
id: kotlin
title: Kotlin
kind: language
detect:
  - "*.kt"
reviewed: 2026-01-02
sources:
  - https://kotlinlang.org/docs/coding-conventions.html
${over}---

# Kotlin

## Naming

- Use camelCase [1].

## Review checklist

- [ ] Names follow the conventions [1].
`;

test('standards apply --from: an archive-format entry is validated and rendered like a stack (A9, A10)', async () => {
  const src = tree({ 'kotlin.md': ENTRY(), 'team.md': '# Team\n' });
  const dir = tempDir('a9');
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--from', path.join(src, 'team.md'), '--from', path.join(src, 'kotlin.md'), '--apply']);
  assert.equal(r.code, 0, r.err);
  const text = read(path.join(dir, 'STANDARDS.md'));
  assert.match(text.split('\n')[0], /stacks=go; imports=team\.md,kotlin\.md;/);
  assert.match(text, /^- Kotlin \(imported: kotlin\.md\)$/m);
  assert.match(text, /## Kotlin\n\n### Naming\n\n- Use camelCase \[1\]\.\n\n### Review checklist\n\n- \[ \] Names follow the conventions \[1\]\.\n\n### Sources\n\n1\. https:\/\/kotlinlang\.org\/docs\/coding-conventions\.html\n\nReviewed 2026-01-02\./);
  assert.ok(text.indexOf('## Go') < text.indexOf('## Kotlin') && text.indexOf('## Kotlin') < text.indexOf('## Imported: team.md'), 'stacks, archive-format imports, other imports');
  assert.match(text, /a re-apply \(`tools\/orc\.mjs standards apply` in the setup checkout\) then needs `--force`/);
  assert.doesNotMatch(text, /`orc standards/);
  fs.writeFileSync(path.join(src, 'kotlin.md'), ENTRY().replace('camelCase [1]', 'camelCase [2]'));
  const bad = await run(['standards', 'apply', '--repo', tempDir('a9bad'), '--from', path.join(src, 'kotlin.md'), '--apply']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /kotlin\.md is an archive-format entry with problems: citation\(s\) \[2\] out of range \(1 source\(s\)\)/);
  fs.writeFileSync(path.join(src, 'kotlin.md'), ENTRY('requires:\n  - java-unknown\n'));
  assert.equal((await run(['standards', 'apply', '--repo', tempDir('a9req'), '--from', path.join(src, 'kotlin.md')])).code, 0, 'requires is not checked for an import');
});

test('install writes the Setup checkout line, status matches it, build and golden never carry it (B)', async () => {
  const home = tempDir('setup');
  const setup = fs.realpathSync.native(REPO).replace(/\\/g, '/');
  const line = `- Setup checkout (this machine): ${setup}. Standards setup: node "${setup}/tools/orc.mjs" standards ...; procedure: ${setup}/orchestration/standards.md.`;
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  assert.ok(read(path.join(home, '.gemini', 'AGENTS.md')).split('\n').includes(line));
  const st = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /status antigravity: all same/);
  const out = tempDir('setupbuild');
  assert.equal((await run(['build', '--tool', 'antigravity', '--out', out])).code, 0);
  assert.doesNotMatch(read(path.join(out, 'antigravity', '.gemini', 'AGENTS.md')), /Setup checkout \(this machine\)/);
  assert.doesNotMatch(read(path.join(REPO, 'tests', 'golden', 'antigravity', '.gemini', 'AGENTS.md')), /Setup checkout \(this machine\)/);
});

test('golden refuses a golden folder that differs only by case, writing nothing (A2)', { skip: caseInsensitive ? false : 'case-sensitive file system' }, async () => {
  const copy = tempDir('golddir');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'tools/lib', 'tests/golden/codex']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  const gold = path.join(copy, 'tests', 'golden', 'codex');
  fs.renameSync(path.join(gold, '.codex'), path.join(gold, '.Codex'));
  fs.writeFileSync(path.join(gold, '.Codex', 'AGENTS.md'), 'stale\n');
  const r = await run(['golden', '--tool', 'codex', '--repo', copy]);
  assert.equal(r.code, 1);
  assert.match(r.err, /refused: folder tests\/golden\/codex\/\.Codex differs only by case from tests\/golden\/codex\/\.codex/);
  assert.match(r.err, /nothing written/);
  assert.equal(r.out, '');
  assert.equal(read(path.join(gold, '.Codex', 'AGENTS.md')), 'stale\n');
  assert.deepEqual(fs.readdirSync(gold), ['.Codex']);
});

test('install and status through a checkout path in another case agree: all same (B)', { skip: caseInsensitive ? false : 'case-sensitive file system' }, () => {
  const home = tempDir('setupcase');
  const other = path.join(REPO.toUpperCase(), 'tools', 'orc.mjs');
  const i = spawnSync(process.execPath, [other, 'install', '--tool', 'antigravity', '--home', home, '--apply'], { encoding: 'utf8' });
  assert.equal(i.status, 0, i.stderr);
  const st = spawnSync(process.execPath, [ORC, 'status', '--tool', 'antigravity', '--home', home], { encoding: 'utf8' });
  assert.equal(st.status, 0, st.stdout);
  assert.match(st.stdout, /status antigravity: all same/);
});

// ---------- PR #11 review fixes ----------

test('standards apply --from: a leading horizontal rule is not frontmatter; the rules after it survive', async () => {
  const src = tree({ 'rules.md': '---\n\n# Team rules\n\n- Use tabs.\n\n---\n\n## Testing\n\n- Write tests.\n' });
  const dir = tempDir('hr');
  const r = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'rules.md'), '--apply']);
  assert.equal(r.code, 0, r.err);
  const text = read(path.join(dir, 'STANDARDS.md'));
  assert.match(text, /## Imported: rules\.md\n\n---\n\n## Team rules\n\n- Use tabs\.\n\n---\n\n### Testing\n\n- Write tests\.\n$/);
  assert.equal(stripFrontmatter('---\n\n# T\n\n---\n\nx\n'), '---\n\n# T\n\n---\n\nx\n');
});

test('standards apply --from: sources: frontmatter that does not parse, has no sources list or no id exits 1', async () => {
  const cases = [
    ['toplist.md', '---\nid: toplist\nsources:\n- https://x\n---\n\n# T\n', /--from \S+: toplist\.md: frontmatter: cannot parse line: - https:\/\/x/],
    ['scalar.md', '---\nid: scalar\nsources: https://x\n---\n\n# S\n', /--from \S+: scalar\.md: sources must be a non-empty list/],
    ['noid.md', '---\nsources:\n  - https://x\n---\n\n# N\n', /--from \S+: noid\.md: an archive-format entry needs an id/],
  ];
  for (const [name, text, re] of cases) {
    const src = tree({ [name]: text });
    const dir = tempDir('badfm');
    const r = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, name), '--apply']);
    assert.equal(r.code, 1, name);
    assert.match(r.err, re, name);
    assert.deepEqual(fs.readdirSync(dir), [], name);
  }
});

test('standards apply --from: two imports with one file name, or a name with a marker separator, exit 1 naming the files', async () => {
  // Windows file names cannot hold ">", so "-->" is checked only off Windows.
  const odd = ['a,b.md', 'c;d.md', ...(process.platform === 'win32' ? [] : ['e-->f.md'])];
  const src = tree({ 'x/style.md': '# X\n', 'y/style.md': '# Y\n', ...Object.fromEntries(odd.map((n) => [n, '# Odd\n'])) });
  const dir = tempDir('dupe');
  const twoFolders = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'x'), '--from', path.join(src, 'y'), '--apply']);
  assert.equal(twoFolders.code, 1);
  assert.match(twoFolders.err, /two imports named style\.md \([^()]*x[\\/]style\.md and [^()]*y[\\/]style\.md\)/);
  const fileAndFolder = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'x', 'style.md'), '--from', path.join(src, 'y'), '--apply']);
  assert.equal(fileAndFolder.code, 1);
  assert.match(fileAndFolder.err, /two imports named style\.md/);
  fs.renameSync(path.join(src, 'y', 'style.md'), path.join(src, 'y', 'Style.md'));
  const caseOnly = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'x'), '--from', path.join(src, 'y'), '--apply']);
  assert.equal(caseOnly.code, 1);
  assert.match(caseOnly.err, /two imports named Style\.md/);
  const twice = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'x', 'style.md'), '--from', path.join(src, 'x'), '--apply']);
  assert.equal(twice.code, 1);
  assert.match(twice.err, /--from: passed twice: \S*x[\\/]style\.md/);
  for (const name of odd) {
    const r = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, name), '--apply']);
    assert.equal(r.code, 1, name);
    assert.ok(r.err.includes(`${name}: a file name with ",", ";" or "-->" cannot be recorded in the marker`), r.err);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('standards apply --from: comment-first and blank-first YAML is stripped; id-only frontmatter is a plain import', async () => {
  const src = tree({
    'yaml.md': '---\n# yaml-language-server: $schema=x.json\ntitle: Rules\n---\n\n# Rules\n\n- One.\n',
    'blank.md': '---\n\ntitle: Blank\n---\n\n# B\n',
    'intro.md': '---\nid: intro\ntitle: Intro\n---\n\n# Intro\n',
  });
  const dir = tempDir('fmshapes');
  const r = await run(['standards', 'apply', '--repo', dir, '--from', src, '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /archive format/);
  const text = read(path.join(dir, 'STANDARDS.md'));
  assert.match(text, /## Imported: yaml\.md\n\n## Rules\n\n- One\./);
  assert.match(text, /## Imported: blank\.md\n\n## B\n/);
  assert.match(text, /## Imported: intro\.md\n\n## Intro\n/);
  assert.doesNotMatch(text, /yaml-language-server|title: |id: intro/);
  // A heading over a list, even with a key line after it, is a horizontal-rule pair; so is a heading alone.
  for (const t of ['---\n# Rules\n- Use tabs.\nScope: all files\n---\nbody', '---\n# Title\n---\nbody', '---\nnested:\n  a: 1\n- x\n---\nbody']) assert.equal(stripFrontmatter(t), t, t);
});

test('standards apply --from: a comment-first archive-format entry is validated and rendered like a stack', async () => {
  const src = tempDir('cfentry');
  fs.writeFileSync(path.join(src, 'kotlin.md'), ENTRY().replace('---\n', '---\n# schema: x.json\n').replace('sources:\n', 'sources:\n  # an indented comment\n'));
  const dir = tempDir('cfapply');
  const r = await run(['standards', 'apply', '--repo', dir, '--from', path.join(src, 'kotlin.md'), '--apply']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Imported: kotlin\.md \(archive format: kotlin\)/);
  assert.match(read(path.join(dir, 'STANDARDS.md')), /^- Kotlin \(imported: kotlin\.md\)$/m);
  fs.writeFileSync(path.join(src, 'kotlin.md'), ENTRY().replace('---\n', '---\n# schema: x.json\n').replace('camelCase [1]', 'camelCase [2]'));
  const bad = await run(['standards', 'apply', '--repo', tempDir('cfbad'), '--from', path.join(src, 'kotlin.md'), '--apply']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /kotlin\.md is an archive-format entry with problems: citation\(s\) \[2\] out of range/);
});

test('standards apply --from: one file named in two cases is passed twice', { skip: caseInsensitive ? false : 'case-sensitive file system' }, async () => {
  const src = tree({ 'Style.md': '# S\n' });
  const r = await run(['standards', 'apply', '--repo', tempDir('casetwice'), '--from', path.join(src, 'Style.md'), '--from', path.join(src, 'style.md'), '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--from: passed twice: \S*[\\/]Style\.md/);
});

test('help: --repo is listed only for commands that read the checkout', async () => {
  const reads = ['build', 'check', 'sync', 'golden', 'install', 'uninstall', 'status', 'brief', 'dispatch', 'hooks'];
  const ignores = ['models', 'review-tier', 'costlog', 'calibration', 'metrics', 'help'];
  for (const c of reads) assert.match((await run(['help', c])).out, /--repo <dir> +the Orc-istration checkout to read/, c);
  for (const c of ignores) assert.doesNotMatch((await run(['help', c])).out, /--repo </, c);
  const global = (await run(['help'])).out;
  assert.doesNotMatch(global, /Every command takes --repo/);
  assert.match(global, /Commands that read this checkout take --repo <dir>/);
  for (const c of ['calibration', 'metrics']) assert.match((await run(['help', c])).out, /--force +(report: )?overwrite an existing --out file/, c);
});
