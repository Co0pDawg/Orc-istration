import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';
import { createHash } from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORC = path.join(REPO, 'tools', 'orc.mjs');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
const now = () => new Date(2026, 10, 15, 13, 5, 9);

async function run(argv) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '', now });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function copyRepo() {
  const copy = tempDir('repo');
  for (const p of ['AGENTS.md', 'models.json', 'roles', 'adapters', 'profiles', 'tools/lib']) fs.cpSync(path.join(REPO, p), path.join(copy, p), { recursive: true });
  return copy;
}

// Every file under dir, home-relative with forward slashes.
function tree(dir) {
  return fs.readdirSync(dir, { recursive: true }).map((f) => f.replace(/\\/g, '/')).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
}

const agy = (home, repo, ...rest) => run(['install', '--tool', 'antigravity', '--home', home, '--repo', repo, ...rest]);

test('manifest: written on apply; a role edit re-installs without --force; a hand edit is refused, then forced', async () => {
  const home = tempDir('mf');
  const repo = copyRepo();
  assert.equal((await agy(home, repo, '--apply')).code, 0);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.equal(mf.tool, 'antigravity');
  assert.equal(mf.version, 1);
  assert.ok(mf.files['.gemini/config/agents/scout.md'].sha256.match(/^[0-9a-f]{64}$/));
  assert.deepEqual(tree(home).filter((f) => f.includes('.tmp-')), [], 'no temp file left');
  fs.appendFileSync(path.join(repo, 'roles', 'scout.md'), '\nOne more line.\n');
  const re = await agy(home, repo, '--apply');
  assert.equal(re.code, 0, re.err);
  assert.match(re.out, /applied replace: .*scout\.md/);
  const scout = path.join(home, '.gemini', 'config', 'agents', 'scout.md');
  fs.writeFileSync(scout, `${fs.readFileSync(scout, 'utf8')}hand edit\n`);
  const before = tree(home);
  const refused = await agy(home, repo, '--apply');
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refused \(edited since install; pass --force/);
  assert.deepEqual(tree(home), before, 'nothing written');
  assert.match((await agy(home, repo)).out, /would REPLACE EDITED .*scout\.md/);
  assert.equal((await agy(home, repo, '--apply', '--force')).code, 0);
  assert.doesNotMatch(fs.readFileSync(scout, 'utf8'), /hand edit/);
  assert.ok(tree(home).some((f) => /scout\.md\.orc-backup-20261115-130509/.test(f)));
  const st = await run(['status', '--tool', 'antigravity', '--home', home, '--repo', repo]);
  assert.equal(st.code, 0, st.out);
});

test('manifest: a removed role is deleted on re-install, kept when edited; status names both', async () => {
  const home = tempDir('mf-rm');
  const repo = copyRepo();
  assert.equal((await agy(home, repo, '--apply')).code, 0);
  const agents = path.join(home, '.gemini', 'config', 'agents');
  fs.rmSync(path.join(repo, 'roles', 'scout.md'));
  fs.rmSync(path.join(repo, 'roles', 'researcher.md'));
  fs.appendFileSync(path.join(agents, 'researcher.md'), 'mine\n');
  const st = await run(['status', '--tool', 'antigravity', '--home', home, '--repo', repo]);
  assert.equal(st.code, 1);
  assert.match(st.out, /stale \(role removed\): .*scout\.md/);
  const dry = await agy(home, repo);
  assert.match(dry.out, /would delete \(role removed\): .*scout\.md/);
  assert.match(dry.out, /would keep \(role removed, edited since install\): .*researcher\.md/);
  assert.ok(fs.existsSync(path.join(agents, 'scout.md')), 'dry run deletes nothing');
  const ap = await agy(home, repo, '--apply');
  assert.equal(ap.code, 0, ap.err);
  assert.ok(!fs.existsSync(path.join(agents, 'scout.md')));
  assert.ok(fs.existsSync(path.join(agents, 'researcher.md')));
});

test('install (#30): an identical file already in place and in no manifest is the owner\'s; not recorded, uninstall leaves it', async () => {
  // A generated agent copied by hand before the first install: take its content from an install elsewhere.
  const source = tempDir('mf-owner-src');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', source, '--apply'])).code, 0);
  const home = tempDir('mf-owner');
  const scout = path.join(home, '.gemini', 'config', 'agents', 'scout.md');
  fs.mkdirSync(path.dirname(scout), { recursive: true });
  fs.copyFileSync(path.join(source, '.gemini', 'config', 'agents', 'scout.md'), scout);
  const ap = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(ap.code, 0, ap.err);
  assert.match(ap.out, /applied unchanged: .*scout\.md \(already there and not installed by orc: not recorded, uninstall leaves it\)/);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.ok(!('.gemini/config/agents/scout.md' in mf.files), Object.keys(mf.files).join(','));
  assert.ok('.gemini/config/agents/builder.md' in mf.files, 'the files it wrote are recorded');
  const st = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(st.code, 0, st.out);
  const un = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(un.code, 0, un.err);
  assert.ok(fs.existsSync(scout), 'the owner\'s copy stays');
  assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'agents', 'builder.md')), 'the installed files go');
});

test('install (#30): a hand-copied hook script identical to the shipped one stays the owner\'s on a plain claude-code install', async () => {
  const home = tempDir('mf-owner-hook');
  const guard = path.join(home, '.claude', 'tools', 'guard.mjs');
  fs.mkdirSync(path.dirname(guard), { recursive: true });
  fs.writeFileSync(guard, fs.readFileSync(path.join(REPO, 'tools', 'guard.mjs'), 'utf8').replace(/\r\n/g, '\n'));
  const ap = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board']);
  assert.equal(ap.code, 0, ap.err);
  assert.match(ap.out, /applied unchanged: .*guard\.mjs \(already there and not installed by orc/);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.claude', '.orc-manifest.claude-code.json'), 'utf8'));
  assert.ok(!('.claude/tools/guard.mjs' in mf.files));
  assert.equal((await run(['status', '--tool', 'claude-code', '--home', home])).code, 0);
  assert.equal((await run(['uninstall', '--tool', 'claude-code', '--home', home, '--apply'])).code, 0);
  assert.ok(fs.existsSync(guard), 'the owner\'s hook script stays');
});

test('install (#30): a file a previous install recorded keeps its manifest entry on a re-install, and uninstall deletes it', async () => {
  const home = tempDir('mf-reinstall');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  const again = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /applied unchanged: .*scout\.md$/m);
  assert.doesNotMatch(again.out, /not installed by orc/);
  const mf = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.ok('.gemini/config/agents/scout.md' in mf.files);
  assert.equal((await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'agents', 'scout.md')));
});

test('status: one extra file alone makes it out of date and says not installed by orc', async () => {
  const home = tempDir('mf-extra');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  fs.writeFileSync(path.join(home, '.gemini', 'config', 'agents', 'mine.md'), 'x\n');
  const st = await run(['status', '--tool', 'antigravity', '--home', home]);
  assert.equal(st.code, 1, st.out);
  assert.match(st.out, /extra: .*mine\.md \(not installed by orc\)/);
  assert.doesNotMatch(st.out, /differs|missing|stale/);
});

test('uninstall: shared .gemini keeps two manifests; uninstalling one leaves the other; HOME stays empty', async () => {
  const home = tempDir('mf-un');
  const fakeHome = tempDir('fakehome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const cli = (...a) => spawnSync(process.execPath, [ORC, ...a, '--home', home], { env, encoding: 'utf8' });
  assert.match(cli('uninstall', '--tool', 'antigravity').stderr, /no install manifest .*by hand/);
  assert.equal(cli('install', '--tool', 'antigravity', '--apply').status, 0);
  assert.equal(cli('install', '--tool', 'gemini-cli', '--apply').status, 0);
  assert.ok(fs.existsSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json')));
  assert.ok(fs.existsSync(path.join(home, '.gemini', '.orc-manifest.gemini-cli.json')));
  const gemini = tree(home).filter((f) => f.includes('GEMINI.md') || f.startsWith('.gemini/agents/') || f.includes('gemini-cli'));
  fs.appendFileSync(path.join(home, '.gemini', 'config', 'agents', 'refuter.md'), 'mine\n');
  const before = tree(home);
  const dry = cli('uninstall', '--tool', 'antigravity');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would delete: .*scout\.md/);
  assert.match(dry.stdout, /would keep \(edited since install.*refuter\.md/);
  assert.deepEqual(tree(home), before, 'dry run deletes nothing');
  const ap = cli('uninstall', '--tool', 'antigravity', '--apply');
  assert.equal(ap.status, 0, ap.stderr);
  assert.deepEqual(tree(home), [...gemini, '.gemini/.orc-manifest.antigravity.json', '.gemini/config/agents/refuter.md'].sort(), 'the manifest stays, listing the kept file');
  const kept = JSON.parse(fs.readFileSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json'), 'utf8'));
  assert.deepEqual(Object.keys(kept.files), ['.gemini/config/agents/refuter.md'], 'manifest lists exactly the kept file');
  // The advertised follow-up now works: --force removes the kept file (with a backup) and the manifest.
  const forced = cli('uninstall', '--tool', 'antigravity', '--apply', '--force');
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /deleted \(edited, backed up\): .*refuter\.md/);
  assert.ok(!fs.existsSync(path.join(home, '.gemini', '.orc-manifest.antigravity.json')));
  assert.ok(!fs.existsSync(path.join(home, '.gemini', 'config', 'agents', 'refuter.md')));
  assert.ok(tree(home).some((f) => /config\/agents\/refuter\.md\.orc-backup-/.test(f)));
  assert.equal(cli('status', '--tool', 'gemini-cli').status, 0);
  assert.match(spawnSync(process.execPath, [ORC, 'uninstall', '--tool', 'claude-code'], { env, encoding: 'utf8' }).stderr, /without --home/);
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'the isolated HOME stays empty');
});

test('uninstall --force deletes edited files after a backup and removes the empty dirs it created', async () => {
  const home = tempDir('mf-force');
  assert.equal((await run(['install', '--tool', 'codex', '--home', home, '--apply'])).code, 0);
  fs.writeFileSync(path.join(home, 'keep.txt'), 'x');
  const rule = path.join(home, '.codex', 'AGENTS.md');
  fs.appendFileSync(rule, 'mine\n');
  const r = await run(['uninstall', '--tool', 'codex', '--home', home, '--apply', '--force']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(tree(home), ['.codex/AGENTS.md.orc-backup-20261115-130509', 'keep.txt']);
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'agents')), 'empty agents dir removed');
});

test('a corrupt or foreign manifest is rejected and nothing is deleted or followed outside --home', async () => {
  const outside = tempDir('victim');
  const victim = path.join(outside, 'victim.md');
  const bad = [
    'not json',
    JSON.stringify({ tool: 'codex', version: 1, files: {} }),
    ...['../victim.md', '.gemini/../../victim.md', victim.replace(/\\/g, '/'), 'C:/x.md', '.gemini\\..\\..\\victim.md', '/etc/x', 'other/x.md', '.gemini/x/../AGENTS.md'].map((p) =>
      JSON.stringify({ tool: 'antigravity', version: 1, files: { [p]: { sha256: '0'.repeat(64) } } })),
  ];
  for (const text of bad) {
    const home = tempDir('mf-bad');
    assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
    fs.writeFileSync(victim, 'keep me\n');
    const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
    fs.writeFileSync(mfile, text);
    const before = tree(home);
    for (const argv of [['uninstall', '--apply', '--force'], ['install', '--apply', '--force']]) {
      const r = await run([...argv, '--tool', 'antigravity', '--home', home]);
      assert.equal(r.code, 1, `${text}: ${argv[0]}`);
    }
    assert.deepEqual(tree(home), before, text);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
    assert.match((await run(['status', '--tool', 'antigravity', '--home', home])).err, /WARN .*ignoring it/);
  }
});

// A junction below the tool root that points outside the home must never be followed.
function junctionHome(name) {
  const home = tempDir(name);
  const outside = tempDir(`${name}-outside`);
  const canary = path.join(outside, 'victim.txt');
  fs.writeFileSync(canary, 'keep me\n');
  return { home, outside, canary };
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
const skip = canJunction ? false : 'this platform cannot create a junction or directory symlink';

test('junction: uninstall and stale-role delete refuse a manifest path through a junction; the canary survives', { skip }, async () => {
  const { home, outside, canary } = junctionHome('junc');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  fs.symlinkSync(outside, path.join(home, '.gemini', 'link'), 'junction');
  const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
  const mf = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  mf.files['.gemini/link/victim.txt'] = { sha256: createHash('sha256').update(fs.readFileSync(canary)).digest('hex') };
  fs.writeFileSync(mfile, JSON.stringify(mf));
  const before = tree(path.join(home, '.gemini', 'config'));
  const st = await run(['install', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(st.code, 1);
  assert.match(st.err, /refused: .*victim\.txt resolves outside/);
  const un = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply', '--force']);
  assert.equal(un.code, 1);
  assert.match(un.err, /refused: .*victim\.txt resolves outside/);
  assert.equal(fs.readFileSync(canary, 'utf8'), 'keep me\n');
  assert.deepEqual(tree(path.join(home, '.gemini', 'config')), before, 'nothing deleted inside the home either');
  assert.ok(fs.existsSync(mfile));
});

test('junction: the tool root itself as a junction refuses install, uninstall and hooks; nothing is written or deleted outside the home', { skip }, async () => {
  // Fresh install into a home whose .gemini is a junction to an outside folder.
  const a = junctionHome('junc-root');
  fs.symlinkSync(a.outside, path.join(a.home, '.gemini'), 'junction');
  for (const extra of [[], ['--force']]) {
    const r = await run(['install', '--tool', 'antigravity', '--home', a.home, '--apply', ...extra]);
    assert.equal(r.code, 1, extra.join(' '));
    assert.match(r.err, /\.gemini is a symlink or junction; refusing to follow it/);
    assert.deepEqual(fs.readdirSync(a.outside), ['victim.txt'], 'nothing written outside the home');
  }
  // A real install, moved outside and replaced by a junction: uninstall must not delete through it.
  const b = junctionHome('junc-root-un');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', b.home, '--apply'])).code, 0);
  const moved = path.join(b.outside, 'gemini');
  fs.cpSync(path.join(b.home, '.gemini'), moved, { recursive: true });
  fs.rmSync(path.join(b.home, '.gemini'), { recursive: true });
  fs.symlinkSync(moved, path.join(b.home, '.gemini'), 'junction');
  const before = tree(moved);
  for (const extra of [[], ['--force']]) {
    const r = await run(['uninstall', '--tool', 'antigravity', '--home', b.home, '--apply', ...extra]);
    assert.equal(r.code, 1, extra.join(' '));
    assert.deepEqual(tree(moved), before, 'nothing deleted outside the home');
  }
  assert.equal(fs.readFileSync(b.canary, 'utf8'), 'keep me\n');
  // hooks writes <home>/.claude/settings.json: a .claude junction is refused the same way.
  const c = junctionHome('junc-claude');
  fs.symlinkSync(c.outside, path.join(c.home, '.claude'), 'junction');
  const h = await run(['hooks', '--home', c.home, '--apply']);
  assert.equal(h.code, 1);
  assert.match(h.err, /\.claude is a symlink or junction/);
  assert.deepEqual(fs.readdirSync(c.outside), ['victim.txt']);
});

test('junction: a home that is itself reached through a junction still installs and uninstalls', { skip }, async () => {
  const real = tempDir('realhome');
  const link = path.join(tempDir('linkparent'), 'home');
  fs.symlinkSync(real, link, 'junction');
  assert.equal((await run(['install', '--tool', 'codex', '--home', link, '--apply'])).code, 0);
  assert.ok(fs.existsSync(path.join(real, '.codex', 'AGENTS.md')));
  assert.equal((await run(['status', '--tool', 'codex', '--home', link])).code, 0);
  assert.equal((await run(['uninstall', '--tool', 'codex', '--home', link, '--apply'])).code, 0);
  assert.ok(!fs.existsSync(path.join(real, '.codex', 'AGENTS.md')));
});

test('a manifest that lists a manifest file is rejected and nothing is deleted', async () => {
  const home = tempDir('mf-self');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
  const mf = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  mf.files['.gemini/.orc-manifest.antigravity.json'] = { sha256: 'a'.repeat(64) };
  fs.writeFileSync(mfile, JSON.stringify(mf));
  const before = tree(path.join(home, '.gemini'));
  const r = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply', '--force']);
  assert.equal(r.code, 1);
  assert.match(r.err, /names a manifest file/);
  assert.deepEqual(tree(path.join(home, '.gemini')), before);
});

test('junction: install refuses to write through a junction planted at the agents dir', { skip }, async () => {
  const { home, outside, canary } = junctionHome('junc-w');
  fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
  fs.symlinkSync(outside, path.join(home, '.gemini', 'config', 'agents'), 'junction');
  const r = await run(['install', '--tool', 'antigravity', '--home', home, '--apply', '--force']);
  assert.equal(r.code, 1);
  assert.match(r.err, /refused: .*resolves outside/);
  assert.deepEqual(fs.readdirSync(outside), ['victim.txt']);
  assert.equal(fs.readFileSync(canary, 'utf8'), 'keep me\n');
  assert.ok(!fs.existsSync(path.join(home, '.gemini', 'AGENTS.md')), 'all or nothing');
});

test('a manifest entry that is a directory refuses uninstall and the stale delete before anything is deleted', async () => {
  const home = tempDir('mf-dir');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  fs.mkdirSync(path.join(home, '.gemini', 'adir'));
  const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
  const mf = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  mf.files['.gemini/adir'] = { sha256: '0'.repeat(64) };
  fs.writeFileSync(mfile, JSON.stringify(mf));
  const before = tree(home);
  for (const argv of [['uninstall', '--apply'], ['install', '--apply']]) {
    const r = await run([...argv, '--tool', 'antigravity', '--home', home]);
    assert.equal(r.code, 1, argv[0]);
    assert.match(r.err, /adir \(in the manifest\) is not a regular file/);
  }
  assert.deepEqual(tree(home), before);
});

test('manifest: a rulebook edited since install is REPLACE EDITED even with its marker', async () => {
  const home = tempDir('mf-marker');
  assert.equal((await run(['install', '--tool', 'codex', '--home', home, '--apply'])).code, 0);
  const rule = path.join(home, '.codex', 'AGENTS.md');
  fs.appendFileSync(rule, 'my edit\n');
  const r = await run(['install', '--tool', 'codex', '--home', home, '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /refused \(edited since install.*AGENTS\.md/);
  assert.match(fs.readFileSync(rule, 'utf8'), /my edit/);
});

test('junction: a link that stays inside the tool root is still refused', { skip }, async () => {
  const home = tempDir('junc-in');
  assert.equal((await run(['install', '--tool', 'antigravity', '--home', home, '--apply'])).code, 0);
  fs.symlinkSync(path.join(home, '.gemini', 'config'), path.join(home, '.gemini', 'inner'), 'junction');
  const mfile = path.join(home, '.gemini', '.orc-manifest.antigravity.json');
  const mf = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  mf.files['.gemini/inner/agents/scout.md'] = mf.files['.gemini/config/agents/scout.md'];
  fs.writeFileSync(mfile, JSON.stringify(mf));
  const r = await run(['uninstall', '--tool', 'antigravity', '--home', home, '--apply']);
  assert.equal(r.code, 1);
  assert.match(r.err, /refused: .*inner is a symlink or junction/);
  assert.ok(fs.existsSync(path.join(home, '.gemini', 'config', 'agents', 'scout.md')));
});
