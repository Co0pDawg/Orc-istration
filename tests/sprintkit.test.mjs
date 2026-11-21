import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/orc.mjs';
import { presetRules, detectStacks, removeKitSettings, planKitSettings, kitHookExample, KIT_NOTE } from '../tools/lib/sprintkit.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
const now = () => new Date(2026, 10, 21, 9, 30, 0);

async function run(argv, { cwd = tempDir('cwd') } = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s), stdin: () => '', now, cwd: () => cwd });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

// The last argument may be run() options ({cwd}).
const kit = (home, ...rest) => {
  const o = typeof rest.at(-1) === 'object' ? rest.pop() : {};
  return run(['install', '--tool', 'claude-code', '--sprint-kit', '--home', home, ...rest], o);
};
const uninstall = (home, ...rest) => run(['uninstall', '--tool', 'claude-code', '--home', home, ...rest]);
const status = (home) => run(['status', '--tool', 'claude-code', '--home', home]);

// Every file under dir, relative with forward slashes.
function tree(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map((f) => f.replace(/\\/g, '/')).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
}

const settingsOf = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8').replace(/^﻿/, ''));
const manifestOf = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', '.orc-manifest.claude-code.json'), 'utf8'));
const guardCommand = (home) => `node "${home.replace(/\\/g, '/')}/.claude/tools/guard.mjs"`;

// A populated home in the real shape of settings.example.json: its keys and hooks, plus two allow entries of the
// owner's (one is also in the dotnet preset), and a hand-written CLAUDE.md.
function populatedHome() {
  const home = tempDir('kit-populated');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude);
  const settings = JSON.parse(fs.readFileSync(path.join(REPO, 'settings.example.json'), 'utf8'));
  settings.permissions.allow = ['Read(./docs/**)', 'Bash(git status *)'];
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  fs.writeFileSync(path.join(claude, 'settings.json'), text);
  fs.writeFileSync(path.join(claude, 'CLAUDE.md'), '# My own rules\n\nBe brief.\n');
  return { home, claude, settings, text };
}

test('sprint kit: a home with no .claude gets the roster, the skill, the guard and the preset; uninstall leaves it empty', async () => {
  const home = tempDir('kit-empty');
  const dry = await kit(home, '--stack', 'dotnet');
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /would create: .*skills[\\/]sprint[\\/]SKILL\.md/);
  assert.match(dry.out, /would add to settings\.json permissions\.allow: Bash\(dotnet build \*\)/);
  assert.deepEqual(tree(home), [], 'the dry run writes nothing');
  const r = await kit(home, '--stack', 'dotnet', '--apply');
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /board address is not set/);
  assert.match(r.out, /Next: start a fresh Claude Code session/);
  const files = tree(path.join(home, '.claude'));
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'agents/builder.md', 'agents/refuter.md', 'agents/scout.md', 'skills/sprint/SKILL.md', 'tools/guard.mjs', 'settings.json']) assert.ok(files.includes(f), f);
  assert.deepEqual(files.filter((f) => f.includes('board-reminder')), [], 'no board reminder on the machine');
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'skills', 'sprint', 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(REPO, 'skills', 'sprint', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n'));
  const rulebook = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  assert.ok(rulebook.includes(KIT_NOTE), 'the rulebook says there is no board');
  assert.doesNotMatch(rulebook, /this machine's board address is/);
  assert.match(rulebook, /Setup checkout \(this machine\)/);
  const settings = settingsOf(home);
  assert.deepEqual(Object.keys(settings).sort(), ['hooks', 'permissions']);
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: guardCommand(home), timeout: 10 }] }]);
  assert.deepEqual(settings.permissions.allow, presetRules(['dotnet']));
  assert.equal(manifestOf(home).options.sprintKit, true);
  const st = await status(home);
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /sprint kit entries present/);
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.deepEqual(fs.readdirSync(home), [], 'nothing left behind');
});

test('sprint kit: an existing settings.json and CLAUDE.md are merged and backed up, re-apply is idempotent, uninstall restores both', async () => {
  const { home, claude, settings, text } = populatedHome();
  const originalRules = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8');
  const dry = await kit(home, '--stack', 'dotnet');
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /would replace \(hand-written; backed up, uninstall restores it\): .*CLAUDE\.md/);
  assert.match(dry.out, /would update .*settings\.json, after a backup/);
  const r = await kit(home, '--stack', 'dotnet', '--apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /backed up: .*settings\.json\.orc-backup-20261121-093000/);
  const after = settingsOf(home);
  // Every existing key, hook and entry survives in place; the kit only appends.
  assert.deepEqual(Object.keys(after), Object.keys(settings));
  for (const k of Object.keys(settings).filter((x) => !['hooks', 'permissions'].includes(x))) assert.deepEqual(after[k], settings[k], k);
  for (const [event, groups] of Object.entries(settings.hooks)) assert.deepEqual(after.hooks[event].slice(0, groups.length), groups, event);
  assert.deepEqual(after.hooks.PreToolUse.at(-1).hooks[0].command, guardCommand(home));
  assert.deepEqual(after.permissions.deny, settings.permissions.deny);
  assert.deepEqual(after.permissions.allow.slice(0, 2), ['Read(./docs/**)', 'Bash(git status *)']);
  assert.equal(after.permissions.allow.filter((a) => a === 'Bash(git status *)').length, 1, 'no duplicate of the owner\'s entry');
  for (const rule of presetRules(['dotnet'])) assert.ok(after.permissions.allow.includes(rule), rule);
  assert.ok(!manifestOf(home).kit.settings.allow.includes('Bash(git status *)'), 'an entry the owner had is not recorded as the kit\'s');
  assert.equal(fs.readFileSync(path.join(claude, 'settings.json.orc-backup-20261121-093000'), 'utf8'), text, 'the backup holds the original bytes');
  assert.equal(fs.readFileSync(path.join(claude, 'CLAUDE.md.orc-backup-20261121-093000'), 'utf8'), originalRules);
  assert.match(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), /generated by orc\.mjs/);
  assert.equal((await status(home)).code, 0);
  // A second apply changes nothing and makes no second backup.
  const settingsBytes = fs.readFileSync(path.join(claude, 'settings.json'), 'utf8');
  const kitBefore = manifestOf(home).kit;
  const filesBefore = tree(claude);
  const withBoard = await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--board', 'https://claude.ai/artifact/x']);
  assert.equal(withBoard.code, 1, 'a recorded kit refuses a board too');
  assert.match(withBoard.err, /the sprint kit installs no board/);
  const again = await run(['install', '--tool', 'claude-code', '--home', home, '--apply']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /using the options recorded at install: sprint kit; stack dotnet/);
  assert.match(again.out, /settings\.json: nothing to add/);
  assert.equal(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), settingsBytes);
  assert.deepEqual(tree(claude), filesBefore, 'no new file or backup');
  assert.deepEqual(manifestOf(home).kit, kitBefore, 'the restore records survive a re-install');
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /restored .*CLAUDE\.md from .*CLAUDE\.md\.orc-backup-/);
  assert.equal(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), text, 'settings.json is back byte for byte');
  assert.equal(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), originalRules);
  assert.deepEqual(tree(claude), ['CLAUDE.md', 'settings.json'], 'no kit file and no backup left');
});

test('sprint kit: an invalid settings.json refuses the install and writes nothing', async () => {
  const home = tempDir('kit-invalid');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude);
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ "model": "x", }\n');
  const before = tree(home);
  const r = await kit(home, '--stack', 'node', '--apply');
  assert.equal(r.code, 1);
  assert.match(r.err, /refused: .*settings\.json is not valid JSON .*nothing written/);
  assert.deepEqual(tree(home), before);
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ "permissions": { "allow": "Bash(ls)" } }\n');
  const shape = await kit(home, '--apply');
  assert.equal(shape.code, 1);
  assert.match(shape.err, /permissions\.allow in settings\.json is not an array; nothing written/);
  assert.deepEqual(tree(home), before);
});

test('sprint kit: changes made after install survive uninstall; an edited rulebook is kept and not restored over', async () => {
  const { home, claude, text } = populatedHome();
  assert.equal((await kit(home, '--stack', 'python', '--apply')).code, 0);
  const s = settingsOf(home);
  s.permissions.allow.push('Bash(make *)');
  fs.writeFileSync(path.join(claude, 'settings.json'), `${JSON.stringify(s, null, 2)}\n`);
  fs.appendFileSync(path.join(claude, 'CLAUDE.md'), 'a note from the sprint\n');
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /changed since install, so only the kit's entries are removed; the original stays at .*orc-backup/);
  assert.match(un.out, /not restored \(the installed file is kept\): .*CLAUDE\.md/);
  const left = settingsOf(home);
  const original = JSON.parse(text);
  assert.deepEqual(left.permissions.allow, [...original.permissions.allow, 'Bash(make *)']);
  assert.deepEqual(left.hooks, original.hooks, 'the kit\'s guard hook is gone, the owner\'s hooks stay');
  assert.match(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), /a note from the sprint/);
  assert.deepEqual(manifestOf(home).kit, { restore: { '.claude/CLAUDE.md': '.claude/CLAUDE.md.orc-backup-20261121-093000' } });
  // --force deletes the edited copy after a backup and puts the original back.
  const forced = await uninstall(home, '--apply', '--force');
  assert.equal(forced.code, 0, forced.err);
  assert.equal(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), '# My own rules\n\nBe brief.\n');
  assert.ok(!fs.existsSync(path.join(claude, '.orc-manifest.claude-code.json')));
});

test('sprint kit: the stack is detected from the current folder, never from the checkout', async () => {
  const proj = tempDir('kit-proj');
  fs.writeFileSync(path.join(proj, 'App.csproj'), '<Project />\n');
  assert.deepEqual(detectStacks(proj), ['dotnet']);
  fs.writeFileSync(path.join(proj, 'requirements.txt'), 'flask\n');
  assert.deepEqual(detectStacks(proj), ['dotnet', 'python']);
  assert.deepEqual(detectStacks(tempDir('kit-none')), []);
  const home = tempDir('kit-detect');
  const r = await kit(home, '--apply', { cwd: proj });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /sprint kit: stack dotnet,python \(detected in /);
  assert.ok(settingsOf(home).permissions.allow.includes('Bash(python -m pytest *)'));
  const inCheckout = await kit(tempDir('kit-checkout'), { cwd: REPO });
  assert.match(inCheckout.out, /no stack detected \(the current folder is the Orc-istration checkout\)/);
  assert.doesNotMatch(inCheckout.out, /permissions\.allow/);
  const none = await kit(tempDir('kit-nostack'));
  assert.match(none.out, /no stack detected in .*; no permission preset/);
});

test('sprint kit: option gates', async () => {
  const home = tempDir('kit-gates');
  const cases = [
    [['install', '--tool', 'claude-code', '--home', home, '--stack', 'dotnet'], /--stack, --from and --json apply to standards only/],
    [['install', '--tool', 'antigravity', '--home', home, '--sprint-kit'], /--sprint-kit is for --tool claude-code only/],
    [['install', '--tool', 'claude-code', '--home', home, '--sprint-kit', '--board', 'https://claude.ai/artifact/x'], /the sprint kit installs no board/],
    [['install', '--tool', 'claude-code', '--home', home, '--sprint-kit', '--stack', 'cobol'], /unknown stack\(s\) cobol for the sprint kit; known: dotnet, node, python/],
    [['uninstall', '--tool', 'claude-code', '--home', home, '--sprint-kit'], /--sprint-kit applies to install and status only/],
    [['install', '--tool', 'claude-code', '--sprint-kit'], /refusing --tool claude-code without --home/],
  ];
  for (const [argv, msg] of cases) {
    const r = await run(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, msg, argv.join(' '));
  }
  assert.deepEqual(fs.readdirSync(home), []);
});

test('sprint kit: the onboarding doc and the starter prompt name the same command and each other', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'interview-machine.md'), 'utf8');
  const prompts = fs.readFileSync(path.join(REPO, 'docs', 'example-prompts.md'), 'utf8');
  for (const text of [doc, prompts]) assert.match(text, /node tools\/orc\.mjs install --tool claude-code --sprint-kit --stack \S+ --home/);
  assert.match(doc, /node tools\/orc\.mjs uninstall --tool claude-code --home "<home>" --apply/);
  assert.match(doc, /\(example-prompts\.md#starter-prompt-interview-machine\)/);
  assert.match(prompts, /## Starter prompt: interview machine\n[\s\S]*follow `docs\/interview-machine\.md`/);
  for (const heading of ['Prerequisites', 'Dry run', 'Apply', 'Verify', 'Start the sprint', 'Clean up afterwards', 'The no-Node path']) assert.match(doc, new RegExp(`^## (\\d\\. )?${heading}`, 'm'), heading);
});

test('sprint kit: presets hold no delete, push or global install; removal takes only recorded entries', () => {
  for (const stack of ['dotnet', 'node', 'python']) {
    const rules = presetRules([stack]);
    assert.ok(rules.length > 0);
    for (const r of rules) {
      assert.match(r, /^(Bash|PowerShell)\([^()]+\)$/, r);
      assert.doesNotMatch(r, /\b(rm|del|push|reset|clean|-g|--global|uninstall)\b/, r);
      if (/install/.test(r)) assert.doesNotMatch(r, /\*/, `${r}: a restore rule is exact`);
    }
  }
  assert.deepEqual(presetRules([]), [], 'no stack, no preset (not even git)');
  const home = tempDir('kit-unit');
  const mine = { permissions: { allow: ['Bash(git log *)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const plan = planKitSettings(mine, { example: kitHookExample(REPO), allow: presetRules(['node']), home });
  assert.ok(!plan.allow.includes('Bash(git log *)'));
  assert.deepEqual(plan.containers, [], 'every container already existed');
  assert.deepEqual(removeKitSettings(plan.merged, plan), mine);
});
