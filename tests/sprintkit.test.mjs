import { test } from 'node:test';
import { isolateHome } from './helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main } from '../tools/orc.mjs';
import { presetRules, detectStacks, removeKitSettings, planKitSettings, kitHookExample, hasGuard, guardStatus, KIT_NOTES, KNOWN_STACKS as KNOWN } from '../tools/lib/sprintkit.mjs';
import { normalizeEol } from '../tools/lib/frontmatter.mjs';

// No test in this file can reach the real home folder: commands that default --home use this scratch one.
isolateHome();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `orc-${name}-`));
// No test reads this machine's ~/.orc: the shared state home is an empty scratch folder, which children inherit.
process.env.ORC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-data-'));
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

// Every file under dir with its bytes, to show a refused run left the home exactly as it was.
const snapshot = (dir) => Object.fromEntries(tree(dir).map((f) => [f, fs.readFileSync(path.join(dir, f)).toString('base64')]));

// A populated home in the real shape of settings.example.json: its keys and hooks (with its PowerShell git guard, or
// without it when guard is false), plus two allow entries of the owner's (one is also in the dotnet preset), and a
// hand-written CLAUDE.md.
function populatedHome({ guard = true } = {}) {
  const home = tempDir('kit-populated');
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude);
  const settings = JSON.parse(fs.readFileSync(path.join(REPO, 'settings.example.json'), 'utf8'));
  settings.permissions.allow = ['Read(./docs/**)', 'Bash(dotnet build *)'];
  const isGuard = (g) => g.hooks.some((h) => /guard\.ps1/.test(h.command));
  if (!guard) settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((g) => !isGuard(g));
  else {
    // The owner's guard script is really there, at the path its hook names. Replace the whole Windows path, not just
    // its prefix: on Linux the example's backslashes would stay literal and the script would read as missing.
    const guardPath = path.join(claude, 'tools', 'guard.ps1');
    for (const h of settings.hooks.PreToolUse.filter(isGuard).flatMap((g) => g.hooks)) h.command = h.command.replace('C:\\Users\\<you>\\.claude\\tools\\guard.ps1', guardPath);
    assert.ok(settings.hooks.PreToolUse.filter(isGuard).every((g) => g.hooks.every((h) => !/guard\.ps1/.test(h.command) || h.command.includes(guardPath))), 'the fixture points the guard hook at the real file');
    fs.mkdirSync(path.join(claude, 'tools'));
    fs.writeFileSync(path.join(claude, 'tools', 'guard.ps1'), '# the owner\'s guard\n');
  }
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
  for (const line of KIT_NOTES) assert.ok(rulebook.includes(`${line}\n`), line);
  assert.match(rulebook, /\*\*Board:\*\* none on this machine \(sprint kit\)/);
  assert.match(rulebook, /only the Node git guard \(`tools\/guard\.mjs`\) is wired; there is no board-reminder hook/);
  assert.match(rulebook, /No subagent model or effort is set in `settings\.json`, so always name `subagent_type`/);
  assert.match(rulebook, /Nothing is pushed unless the user says so/);
  assert.doesNotMatch(rulebook, /@board\.local\.md/, 'no import of a board file the machine does not have');
  assert.doesNotMatch(rulebook, /this machine's board address is/);
  assert.match(rulebook, /# Claude Code\n\n- \*\*Paths:\*\*/);
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

test('sprint kit: an existing settings.json (with the PowerShell guard) and CLAUDE.md are merged and backed up, re-apply is idempotent, uninstall restores both', async () => {
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
  // The owner's PowerShell guard is already wired: no second (Node) guard, and nothing recorded for it.
  assert.deepEqual(after.hooks, settings.hooks, 'hooks untouched');
  assert.deepEqual(manifestOf(home).kit.settings.hooks, []);
  assert.doesNotMatch(r.out, /added to settings\.json PreToolUse/);
  assert.deepEqual(after.permissions.deny, settings.permissions.deny);
  assert.deepEqual(after.permissions.allow.slice(0, 2), ['Read(./docs/**)', 'Bash(dotnet build *)']);
  assert.equal(after.permissions.allow.filter((a) => a === 'Bash(dotnet build *)').length, 1, 'no duplicate of the owner\'s entry');
  for (const rule of presetRules(['dotnet'])) assert.ok(after.permissions.allow.includes(rule), rule);
  assert.ok(!manifestOf(home).kit.settings.allow.includes('Bash(dotnet build *)'), 'an entry the owner had is not recorded as the kit\'s');
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
  assert.deepEqual(tree(claude), ['CLAUDE.md', 'settings.json', 'tools/guard.ps1'], 'no kit file and no backup left; the owner\'s guard stays');
  assert.doesNotMatch(un.out, /^left: /m, 'no backup left to explain');
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
  const { home, claude, text } = populatedHome({ guard: false });
  assert.equal((await kit(home, '--stack', 'python', '--apply')).code, 0);
  const s = settingsOf(home);
  assert.equal(s.hooks.PreToolUse.at(-1).hooks[0].command, guardCommand(home), 'with no guard wired, the kit adds the Node one');
  s.permissions.allow.push('Bash(make *)');
  fs.writeFileSync(path.join(claude, 'settings.json'), `${JSON.stringify(s, null, 2)}\n`);
  fs.appendFileSync(path.join(claude, 'CLAUDE.md'), 'a note from the sprint\n');
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /updated .*settings\.json \(settings\.json changed since install, so only the kit's entries are removed\)/);
  assert.match(un.out, /^left: .*settings\.json\.orc-backup-20261121-093000 \(the settings\.json from before the kit, kept because settings\.json changed since install/m);
  assert.match(un.out, /^left: .*CLAUDE\.md\.orc-backup-20261121-093000 \(the original of .*CLAUDE\.md, not restored because the installed file is kept/m);
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
  ];
  for (const [argv, msg] of cases) {
    const r = await run(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.err, msg, argv.join(' '));
  }
  assert.deepEqual(fs.readdirSync(home), []);
  // With no --home the kit targets the home folder, like a full install: a dry run in a child whose HOME and
  // USERPROFILE are a scratch folder (never the real home), which stays empty.
  const fakeHome = tempDir('kit-defaulthome');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const dry = spawnSync(process.execPath, [path.join(REPO, 'tools', 'orc.mjs'), 'install', '--tool', 'claude-code', '--sprint-kit', '--stack', 'node'], { env, encoding: 'utf8', cwd: tempDir('kit-cwd') });
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(dry.stderr, /refusing/);
  assert.ok(dry.stdout.includes(path.join(fakeHome, '.claude', 'CLAUDE.md')), dry.stdout);
  assert.deepEqual(fs.readdirSync(fakeHome), [], 'the dry run writes nothing');
});

test('sprint kit: refused over a full install (dry run too), home byte-identical; a plain install over a kit stays a kit', async () => {
  const home = tempDir('kit-over-full');
  assert.equal((await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board'])).code, 0);
  assert.equal((await run(['hooks', '--home', home, '--apply'])).code, 0);
  const before = snapshot(home);
  for (const extra of [[], ['--apply']]) {
    const r = await kit(home, '--stack', 'node', ...extra);
    assert.equal(r.code, 1, extra.join(' ') || 'dry run');
    assert.match(r.err, /refused: .*\.orc-manifest\.claude-code\.json records a full orc install, not a sprint kit; nothing written\. The full install already has the roster agents/);
    assert.match(r.err, /For \/sprint, copy .*skills\/sprint to .*skills[\\/]sprint by hand; to switch to a sprint kit, run uninstall/);
    assert.deepEqual(snapshot(home), before, 'nothing written');
  }
  // The reverse: a plain install over a kit reuses the recorded kit, so it neither deletes nor rewires anything.
  const k = tempDir('full-over-kit');
  assert.equal((await kit(k, '--stack', 'node', '--apply')).code, 0);
  const kitBefore = snapshot(k);
  const dry = await run(['install', '--tool', 'claude-code', '--home', k]);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /using the options recorded at install: sprint kit; stack node/);
  assert.doesNotMatch(dry.out, /would (delete|create|replace|add)/);
  const ap = await run(['install', '--tool', 'claude-code', '--home', k, '--apply']);
  assert.equal(ap.code, 0, ap.err);
  const after = snapshot(k);
  const mf = '.claude/.orc-manifest.claude-code.json';
  assert.deepEqual({ ...after, [mf]: null }, { ...kitBefore, [mf]: null }, 'only the manifest timestamp changes');
});

test('sprint kit: the onboarding doc and the starter prompt name the same command and each other', () => {
  // Through normalizeEol: a Windows checkout (text=auto) has CRLF line endings.
  const doc = normalizeEol(fs.readFileSync(path.join(REPO, 'docs', 'interview-machine.md'), 'utf8'));
  const prompts = normalizeEol(fs.readFileSync(path.join(REPO, 'docs', 'example-prompts.md'), 'utf8'));
  for (const text of [doc, prompts]) assert.match(text, /node "<clone>\/tools\/orc\.mjs" install --tool claude-code --sprint-kit (--stack \S+ )?--home "<home>"/);
  assert.match(doc, /node "<clone>\/tools\/orc\.mjs" uninstall --tool claude-code --home "<home>" --apply/);
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
      // Read-only git already runs without a prompt; a git rule would only approve the forms that write.
      assert.doesNotMatch(r, /^(Bash|PowerShell)\(git\b/, r);
      assert.doesNotMatch(r, /\bpip\b/, `${r}: pip outside a venv installs globally`);
    }
  }
  assert.deepEqual(presetRules([]), [], 'no stack, no preset');
  const home = tempDir('kit-unit');
  const mine = { permissions: { allow: ['Bash(git log *)'] }, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const plan = planKitSettings(mine, { example: kitHookExample(REPO), allow: presetRules(['node']), home });
  assert.ok(!plan.allow.includes('Bash(git log *)'));
  assert.deepEqual(plan.containers, [], 'every container already existed');
  assert.deepEqual(removeKitSettings(plan.merged, plan), mine);
  // Either guard variant, at any path, counts as already wired when its script is there.
  const there = { exists: () => true };
  for (const command of ['node "D:/elsewhere/.claude/tools/guard.mjs"', 'powershell -NoProfile -File "C:\\x\\.claude\\tools\\guard.ps1"']) {
    const s = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command }] }] } };
    assert.ok(hasGuard(s, there), command);
    assert.deepEqual(planKitSettings(s, { example: kitHookExample(REPO), allow: [], home, guardExists: () => true }).hooks, [], command);
    assert.ok(!hasGuard(s), `${command}: its script is not on disk, so it guards nothing`);
    assert.ok(planKitSettings(s, { example: kitHookExample(REPO), allow: [], home }).hooks.length > 0, `${command}: the kit adds its own guard beside a stale one`);
  }
  assert.ok(!hasGuard(mine, there));
  // Anything short of a plain invocation on a matcher covering both shells is not a guard: the kit then adds its own.
  const wired = (command, matcher = 'Bash|PowerShell', event = 'PreToolUse') => ({ hooks: { [event]: [{ matcher, hooks: [{ type: 'command', command }] }] } });
  const guard = 'node "D:/x/.claude/tools/guard.mjs"';
  for (const command of ['node "D:/x/.claude/tools/guard.mjs.bak"', 'node D:/x/.claude/tools/guard.mjs-x', 'echo "# node D:/x/.claude/tools/guard.mjs"',
    'ls /x/tools/guard.mjs', 'cat C:\\x\\.claude\\tools\\guard.ps1', `false && ${guard}`, 'node "D:/x/.claude/tools/myguard.mjs"', 'echo guard',
    'echo C:/nodejs/node.exe "C:/x/.claude/tools/guard.mjs"', 'pwsh -c echo C:/x/tools/guard.ps1', 'node -e "" C:/x/tools/guard.mjs',
    'C:/Program Files/nodejs/node.exe "C:/x/.claude/tools/guard.mjs"', 'powershell -Command "& C:/x/tools/guard.ps1"', 'node --eval=1 C:/x/tools/guard.mjs',
    'node C:/x/tools/guard.ps1', 'pwsh -File C:/x/tools/guard.mjs', `node ; ${guard}`,
    // Anything after the script could discard the guard's printed denial.
    `${guard} > /dev/null 2>&1`, `${guard}>/dev/null`, `${guard} | cat`, `${guard} &`, `${guard} ; exit 0`, `${guard}\nexit 0`, `${guard} extra`,
    'pwsh -NoProfile -File C:/x/.claude/tools/guard.ps1 | out-null', 'pwsh -File "C:/x/.claude/tools/guard.ps1" ; exit 0', 'pwsh -File']) {
    assert.ok(!hasGuard(wired(command), there), command);
  }
  assert.ok(!hasGuard(wired(guard, 'Read'), there), 'a matcher that never fires on Bash');
  assert.ok(!hasGuard(wired(guard, 'Bash|PowerShell', 'PostToolUse'), there), 'wrong event');
  for (const matcher of ['Bash', 'PowerShell', 'Bash|Read']) assert.ok(!hasGuard(wired(guard, matcher), there), `matcher ${matcher} leaves a shell unguarded`);
  for (const matcher of ['Bash|PowerShell', 'PowerShell|Bash', '*', '', undefined]) assert.ok(hasGuard(wired(guard, matcher), there), `matcher ${matcher}`);
  assert.ok(hasGuard(wired('"C:\\Program Files\\nodejs\\node.exe" "C:\\x\\.claude\\tools\\guard.mjs"'), there), 'node by quoted path with spaces');
  assert.ok(hasGuard(wired('pwsh -NoProfile -File C:/x/.claude/tools/guard.ps1'), there), 'unquoted script path');
  assert.ok(hasGuard(wired('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Users\\x\\.claude\\tools\\guard.ps1"'), there), 'the settings.example.json form');
  assert.ok(hasGuard(wired(`node --no-warnings ${guard.slice(5)}`), there), 'node options before the script');
  assert.ok(planKitSettings(wired('node "D:/x/.claude/tools/guard.mjs.bak"'), { example: kitHookExample(REPO), allow: [], home, guardExists: () => true }).hooks.length > 0, 'the kit adds its guard beside a look-alike');
  // A guard whose script is gone is reported as stale.
  const st = guardStatus(wired(guard));
  assert.equal(st.guard, false);
  assert.deepEqual(st.stale.map((s) => s.script), ['D:/x/.claude/tools/guard.mjs']);
});

test('sprint kit: preset rules are pinned', () => {
  const twin = (rules) => rules.flatMap((r) => [`Bash(${r})`, `PowerShell(${r})`]);
  assert.deepEqual(presetRules(['dotnet']), twin(['dotnet build *', 'dotnet test *', 'dotnet run *', 'dotnet restore']));
  assert.deepEqual(presetRules(['node']), twin(['npm test *', 'npm run *', 'npm start *', 'npm install', 'npm ci']));
  assert.deepEqual(presetRules(['python']), twin(['pytest *', 'python -m pytest *', 'python -m unittest *']));
  for (const exact of ['dotnet restore', 'npm install', 'npm ci']) {
    for (const r of presetRules(KNOWN)) if (r.includes(`(${exact}`)) assert.doesNotMatch(r, /\*/, r);
  }
});

test('sprint kit: stack detection table; a first run with no stack, then --stack node', async () => {
  const cases = [
    [['package.json'], ['node']],
    [['App.sln'], ['dotnet']],
    [['App.slnx'], ['dotnet']],
    [['pyproject.toml'], ['python']],
    [['readme.md'], []],
  ];
  for (const [names, want] of cases) {
    const dir = tempDir('kit-detect-table');
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x\n');
    assert.deepEqual(detectStacks(dir), want, names.join(','));
  }
  const home = tempDir('kit-later-stack');
  const first = await kit(home, '--apply');
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /no stack detected/);
  assert.equal(settingsOf(home).permissions, undefined, 'no preset yet');
  const later = await kit(home, '--stack', 'node', '--apply');
  assert.equal(later.code, 0, later.err);
  assert.deepEqual(settingsOf(home).permissions.allow, presetRules(['node']));
  assert.ok(!tree(path.join(home, '.claude')).some((f) => f.includes('.orc-backup-')), 'a file the kit created needs no backup');
  assert.equal((await status(home)).code, 0);
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('sprint kit: a plain install\'s rulebook is unchanged (the golden file plus only the Setup checkout line)', async () => {
  const home = tempDir('plain-rulebook');
  assert.equal((await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board'])).code, 0);
  const installed = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
  const golden = normalizeEol(fs.readFileSync(path.join(REPO, 'tests', 'golden', 'claude-code', '.claude', 'CLAUDE.md'), 'utf8'));
  assert.match(installed, /@board\.local\.md/);
  assert.equal(installed.replace(/^- Setup checkout \(this machine\): .*\n/m, ''), golden);
});

// The temp file writeSettings writes first; a folder in its place makes that write fail on every platform.
const blockSettingsWrite = (claude) => {
  const tmp = path.join(claude, `settings.json.orc-tmp-${process.pid}`);
  fs.mkdirSync(tmp);
  return () => fs.rmSync(tmp, { recursive: true });
};

test('sprint kit: an install that stops part way still records the restore map; uninstall puts the home back', async () => {
  const { home, claude } = populatedHome({ guard: false });
  const start = snapshot(home);
  const unblock = blockSettingsWrite(claude);
  const r = await kit(home, '--stack', 'node', '--apply');
  assert.equal(r.code, 1);
  assert.match(r.err, /install stopped: .*records what was written, so uninstall --apply undoes it/);
  assert.match(fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8'), /generated by orc\.mjs/, 'the owner\'s file was already replaced');
  const mf = manifestOf(home);
  assert.equal(mf.kit.restore['.claude/CLAUDE.md'], '.claude/CLAUDE.md.orc-backup-20261121-093000');
  assert.equal(mf.kit.settings, undefined, 'settings.json was not written, so nothing is recorded for it');
  unblock();
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.deepEqual(snapshot(home), start, 'CLAUDE.md and settings.json back byte for byte; no kit file left');
});

test('sprint kit: uninstall does the settings.json step first, so a failed write leaves the home and manifest as they were', async () => {
  const { home, claude } = populatedHome({ guard: false });
  assert.equal((await kit(home, '--stack', 'node', '--apply')).code, 0);
  const s = settingsOf(home);
  s.permissions.allow.push('Bash(make *)');
  fs.writeFileSync(path.join(claude, 'settings.json'), `${JSON.stringify(s, null, 2)}\n`);
  const unblock = blockSettingsWrite(claude);
  const before = snapshot(home);
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 1);
  assert.match(un.err, /nothing deleted: .*settings\.json/);
  assert.deepEqual(snapshot(home), before, 'no file deleted or restored, manifest unchanged');
  unblock();
  assert.equal((await uninstall(home, '--apply')).code, 0);
});

test('sprint kit: an identical file already in place (a hand-copied skill and wired guard) is the owner\'s; uninstall leaves it', async () => {
  const home = tempDir('kit-owner-copies');
  const claude = path.join(home, '.claude');
  const skill = path.join(claude, 'skills', 'sprint', 'SKILL.md');
  const guardFile = path.join(claude, 'tools', 'guard.mjs');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.dirname(guardFile), { recursive: true });
  fs.writeFileSync(skill, normalizeEol(fs.readFileSync(path.join(REPO, 'skills', 'sprint', 'SKILL.md'), 'utf8')));
  fs.writeFileSync(guardFile, normalizeEol(fs.readFileSync(path.join(REPO, 'tools', 'guard.mjs'), 'utf8')));
  const settings = { hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: guardCommand(home), timeout: 10 }] }] } };
  const text = `${JSON.stringify(settings, null, 2)}\n`;
  fs.writeFileSync(path.join(claude, 'settings.json'), text);
  const r = await kit(home, '--stack', 'node', '--apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /applied unchanged: .*SKILL\.md \(already there and in no orc manifest: not recorded, uninstall leaves it\)/);
  assert.match(r.out, /applied unchanged: .*guard\.mjs \(already there and in no orc manifest/);
  assert.doesNotMatch(r.out, /added to settings\.json PreToolUse/, 'the owner\'s guard is wired and on disk');
  const files = Object.keys(manifestOf(home).files);
  assert.ok(!files.includes('.claude/skills/sprint/SKILL.md') && !files.includes('.claude/tools/guard.mjs'), files.join(','));
  assert.equal((await status(home)).code, 0, 'status is still clean');
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.ok(fs.existsSync(skill) && fs.existsSync(guardFile), 'the owner\'s copies stay');
  assert.equal(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), text, 'the owner\'s hook stays');
});

test('sprint kit: a stale guard hook (script gone) is warned about and does not stop the kit adding its own', async () => {
  // The stale shape the tool itself leaves: a full install with the PowerShell hooks, then its uninstall.
  const home = tempDir('kit-stale-guard');
  assert.equal((await run(['install', '--tool', 'claude-code', '--home', home, '--apply', '--no-board'])).code, 0);
  assert.equal((await run(['hooks', '--home', home, '--apply'])).code, 0);
  assert.equal((await uninstall(home, '--apply')).code, 0);
  const text = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'tools', 'guard.ps1')));
  const r = await kit(home, '--stack', 'node', '--apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARN .*settings\.json: the PreToolUse hook \[Bash\|PowerShell\] ".*guard\.ps1.*" runs .*guard\.ps1, which is not on disk, so it guards nothing/);
  assert.match(r.out, /added to settings\.json PreToolUse \[Bash\|PowerShell\]: node ".*\/\.claude\/tools\/guard\.mjs"/);
  assert.equal((await status(home)).code, 0);
  assert.equal((await uninstall(home, '--apply')).code, 0);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), text, 'settings.json back byte for byte');
});

test('sprint kit: uninstall refuses a tampered kit record and writes nothing', async () => {
  const tampers = [
    (k) => { k.restore = { '.claude/CLAUDE.md': '../x' }; },
    (k) => { k.restore = '.claude/CLAUDE.md'; },
    (k) => { k.settings.hooks = { PreToolUse: 'x' }; },
    (k) => { k.settings.containers = ['evil']; },
    (k, home) => { k.settings.backup = path.join(home, '.claude', 'settings.json.orc-backup-x'); },
    (k) => { k.copies = ['../x']; },
    (k, home) => { k.copies = [path.join(home, 'x')]; },
    (k) => { k.copies = ['.claude/agents/../../x']; },
    (k) => { k.copies = '.claude/CLAUDE.md.orc-backup-x'; },
    (k) => { k.copies = [7]; },
  ];
  for (const [i, tamper] of tampers.entries()) {
    const { home } = populatedHome({ guard: false });
    assert.equal((await kit(home, '--stack', 'node', '--apply')).code, 0);
    const file = path.join(home, '.claude', '.orc-manifest.claude-code.json');
    const mf = JSON.parse(fs.readFileSync(file, 'utf8'));
    tamper(mf.kit, home);
    fs.writeFileSync(file, `${JSON.stringify(mf, null, 2)}\n`);
    const before = snapshot(home);
    const un = await uninstall(home, '--apply');
    assert.equal(un.code, 1, `tamper ${i}`);
    assert.match(un.err, /refused: /, `tamper ${i}`);
    if (!Array.isArray(mf.kit.copies ?? []) || (mf.kit.copies ?? []).some((v) => typeof v !== 'string')) assert.match(un.err, /kit\.copies is not a list of paths/, `tamper ${i}`);
    assert.deepEqual(snapshot(home), before, `tamper ${i}: nothing written`);
  }
});

test('sprint kit: status reports missing settings entries and unreadable settings; a re-apply repairs with no second backup', async () => {
  const { home, claude } = populatedHome({ guard: false });
  assert.equal((await kit(home, '--stack', 'dotnet', '--apply')).code, 0);
  // A later stack replaces options.stacks; status still checks every rule the kit ever added.
  assert.equal((await kit(home, '--stack', 'node', '--apply')).code, 0);
  const s = settingsOf(home);
  s.hooks.PreToolUse = s.hooks.PreToolUse.filter((g) => !g.hooks.some((h) => /guard\.mjs/.test(h.command)));
  s.permissions.allow = s.permissions.allow.filter((r) => r !== 'Bash(dotnet test *)');
  fs.writeFileSync(path.join(claude, 'settings.json'), `${JSON.stringify(s, null, 2)}\n`);
  const st = await status(home);
  assert.equal(st.code, 1);
  assert.match(st.out, /missing in settings\.json: PreToolUse \[Bash\|PowerShell\]: node ".*guard\.mjs"/);
  assert.match(st.out, /missing in settings\.json: permissions\.allow: Bash\(dotnet test \*\)/);
  const good = fs.readFileSync(path.join(claude, 'settings.json'), 'utf8');
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ broken\n');
  const bad = await status(home);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /missing in settings\.json: unreadable/);
  fs.writeFileSync(path.join(claude, 'settings.json'), good);
  // A re-apply naming only the latest stack puts the earlier stack's rule back too, as status asked.
  const fix = await kit(home, '--stack', 'node', '--apply');
  assert.equal(fix.code, 0, fix.err);
  assert.match(fix.out, /added to settings\.json permissions\.allow: Bash\(dotnet test \*\)/);
  assert.equal((await status(home)).code, 0);
  assert.equal(tree(claude).filter((f) => f.startsWith('settings.json.orc-backup-')).length, 1, 'still the one backup from before the first change');
});

test('sprint kit: uninstall over an invalid settings.json is refused with nothing deleted', async () => {
  const { home, claude } = populatedHome({ guard: false });
  assert.equal((await kit(home, '--stack', 'node', '--apply')).code, 0);
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ "hooks": ');
  const before = snapshot(home);
  const un = await uninstall(home, '--apply');
  assert.equal(un.code, 1);
  assert.match(un.err, /refused: .*settings\.json: cannot remove the sprint kit's entries \(not valid JSON/);
  assert.deepEqual(snapshot(home), before);
});

test('sprint kit: uninstall dry run, a gone backup, a gone settings.json and a restore target in the way', async () => {
  // Dry run: lists what it would do, writes nothing.
  const a = populatedHome({ guard: false });
  assert.equal((await kit(a.home, '--stack', 'node', '--apply')).code, 0);
  const before = snapshot(a.home);
  const dry = await uninstall(a.home);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /would restore .*CLAUDE\.md from .*CLAUDE\.md\.orc-backup-/);
  assert.match(dry.out, /would remove from settings\.json permissions\.allow: Bash\(npm test \*\)/);
  assert.match(dry.out, /would restore .*settings\.json from .*settings\.json\.orc-backup-/);
  assert.deepEqual(snapshot(a.home), before);
  // The kit's settings backup is gone: the real cause is named, and only the kit's entries are removed.
  fs.rmSync(path.join(a.claude, 'settings.json.orc-backup-20261121-093000'));
  fs.rmSync(path.join(a.claude, 'CLAUDE.md.orc-backup-20261121-093000'));
  const un = await uninstall(a.home, '--apply');
  assert.equal(un.code, 0, un.err);
  assert.match(un.err, /WARN the kit's backup .*settings\.json\.orc-backup-20261121-093000 is gone; only the kit's entries are removed/);
  assert.match(un.err, /WARN cannot restore .*CLAUDE\.md: its backup .* is gone/);
  assert.equal(fs.readFileSync(path.join(a.claude, 'settings.json'), 'utf8'), a.text, 'same content after removing only the kit\'s entries');
  // settings.json is gone after install: the owner's original goes back from the kit's backup.
  const b = populatedHome({ guard: false });
  assert.equal((await kit(b.home, '--stack', 'node', '--apply')).code, 0);
  fs.rmSync(path.join(b.claude, 'settings.json'));
  const unB = await uninstall(b.home, '--apply');
  assert.equal(unB.code, 0, unB.err);
  assert.match(unB.out, /restored .*settings\.json from .*orc-backup-20261121-093000 \(settings\.json was gone\)/);
  assert.equal(fs.readFileSync(path.join(b.claude, 'settings.json'), 'utf8'), b.text);
  // A restore target that is not the kit's file any more (taken out of the manifest) and is in the way: WARN, kept.
  const c = populatedHome({ guard: false });
  assert.equal((await kit(c.home, '--stack', 'node', '--apply')).code, 0);
  const file = path.join(c.claude, '.orc-manifest.claude-code.json');
  const mf = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete mf.files['.claude/CLAUDE.md'];
  fs.writeFileSync(file, `${JSON.stringify(mf, null, 2)}\n`);
  const unC = await uninstall(c.home, '--apply');
  assert.equal(unC.code, 0, unC.err);
  assert.match(unC.err, /WARN not restored: .*CLAUDE\.md exists; the original is .*CLAUDE\.md\.orc-backup-20261121-093000/);
  assert.match(unC.out, /^left: .*CLAUDE\.md\.orc-backup-20261121-093000 \(the original of .*CLAUDE\.md, not restored because .* exists\)/m);
  // A backup the kit did not make is named as possibly the owner's and left alone.
  const d = populatedHome({ guard: false });
  fs.writeFileSync(path.join(d.claude, 'AGENTS.md.orc-backup-20200101-000000'), 'someone else\'s\n');
  assert.equal((await kit(d.home, '--stack', 'node', '--apply')).code, 0);
  const unD = await uninstall(d.home, '--apply');
  assert.equal(unD.code, 0, unD.err);
  assert.match(unD.out, /^left: .*AGENTS\.md\.orc-backup-20200101-000000 \(not made by this kit \(it may be the owner's\); left alone\)/m);
});

test('sprint kit: an uninstall that stops after the settings.json step is finished by a rerun, with nothing redone', async () => {
  const { home, claude } = populatedHome({ guard: false });
  const start = snapshot(home);
  assert.equal((await kit(home, '--stack', 'node', '--apply')).code, 0);
  // Stop at the first file delete, which comes after the settings.json step.
  const io = { out: (s) => { if (/^deleted: /.test(s)) throw new Error('stopped'); }, err: () => {}, stdin: () => '', now, cwd: () => claude };
  await assert.rejects(main(['uninstall', '--tool', 'claude-code', '--home', home, '--apply'], io), /stopped/);
  assert.equal(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), start['.claude/settings.json'] && Buffer.from(start['.claude/settings.json'], 'base64').toString('utf8'), 'settings.json is already back');
  assert.equal(manifestOf(home).kit.settings, undefined, 'the finished settings step is no longer recorded');
  const again = await uninstall(home, '--apply');
  assert.equal(again.code, 0, again.err);
  assert.equal(again.err, '', 'no warning about a settings backup that is already restored');
  assert.deepEqual(snapshot(home), start);
});
