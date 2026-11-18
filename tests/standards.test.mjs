import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';
import { classify } from '../tools/lib/reviewtier.mjs';
import { validateArchive, demoteHeadings, stripFrontmatter, detect, withRequires } from '../tools/lib/standards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
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
  assert.deepEqual(Object.keys(j).sort(), ['archive', 'detected', 'repo', 'standardsFile', 'truncated']);
  assert.equal(j.standardsFile, true);
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
  const r = await run(['standards', 'apply', '--repo', dir, '--stack', 'go', '--stack', 'csharp', '--apply']);
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
  for (const p of ['standards/go.md', 'standards/README.md', 'orchestration/standards.md', 'skills/repo-standards/SKILL.md']) assert.equal(classify([p]).tier, 'Full', p);
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
  const line = "set up each project's coding standards: see orchestration/standards.md in the setup checkout (Claude Code: the repo-standards skill).";
  const dry = await run(['install', '--tool', 'antigravity', '--home', home]);
  assert.equal(dry.out.split('\n').at(-1), `After --apply, next: ${line}`);
  const done = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(done.code, 0);
  assert.equal(done.out.split('\n').at(-1), `Next: ${line}`);
});
