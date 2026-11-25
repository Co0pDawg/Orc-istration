// The one help table for tools/orc.mjs: every command, its synopsis and its options, one line each.
// tests/tooling.test.mjs checks that this table and the command dispatch name the same commands.
// `repo: true` marks a command that reads this checkout through --repo; its help shows that option.
export const HELP = {
  build: {
    repo: true,
    summary: 'Write every tool\'s generated files to dist/<tool>/ (untracked) and print sizes and gaps',
    synopsis: 'build [--tool <id>|all] [--out <dir>] [--profile <name>]',
    options: {
      '--tool <id>|all': 'one adapter, or all (default all)',
      '--out <dir>': 'output folder, relative to the repo (default dist)',
      '--profile <name>': 'append profiles/<name>.md after the tool notes (repeatable or comma-separated)',
    },
  },
  check: {
    repo: true,
    summary: 'Build every tool, check the caps, models.json and the standards archive, and compare every tool\'s build with tests/golden/<tool>/ (a missing, differing or stale golden file or unowned folder fails, naming the source to edit)',
    synopsis: 'check',
    options: {},
  },
  sync: {
    repo: true,
    summary: 'Rebuild and install every tool in activeTools of ~/.orc/config.json, exactly as install --all does (dry run without --apply); writes nothing into this checkout',
    synopsis: 'sync [--home <dir>] [--apply] [--force] [--profile <name>|--no-profile] [--board <address> --board-repo <dir>|--no-board]',
    options: {
      '--home <dir>': 'home folder (default your home)',
      '--apply': 'write the files (backs up each replaced file)',
      '--force': 'replace hand-written or edited files, with a backup',
      '--profile <name>': 'append profiles/<name>.md (repeatable or comma-separated); recorded in each manifest',
      '--no-profile': 'clear the profiles recorded at install',
      '--board <address>': 'this machine\'s board address (with --board-repo); default: the one recorded at install, else board in ~/.orc/config.json (an artifact address there applies to claude-code only)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--no-board': 'clear the board recorded at install',
    },
  },
  golden: {
    repo: true,
    summary: 'Regenerate tests/golden/<tool>/ from the build the golden test compares against',
    synopsis: 'golden [--tool <id>|all]',
    options: { '--tool <id>|all': 'one adapter, or all (default all)' },
  },
  install: {
    repo: true,
    summary: 'Install one tool\'s generated files, or with --all every active tool\'s (generated agents, and skills and commands from core/procedures.mjs; for claude-code also its hook scripts and orc-permissions skill; for antigravity also tools/guard.mjs), into a home folder (dry run without --apply); the rulebook names this checkout as the setup checkout',
    synopsis: 'install (--tool <id> | --all) [--home <dir>] [--apply] [--force] [--profile <name>|--no-profile] [--board <address> --board-repo <dir>|--no-board] [--sprint-kit [--stack dotnet|node|python]]',
    options: {
      '--tool <id>': 'the adapter to install (this or --all; not all)',
      '--all': 'every tool in activeTools of ~/.orc/config.json, in order; every refusal is checked for every tool before any is written; the last line names any tool that failed',
      '--home <dir>': 'home folder (default your home)',
      '--apply': 'write the files (backs up each replaced file)',
      '--force': 'replace hand-written or edited files, with a backup',
      '--sprint-kit': 'claude-code only: only the sprint skill and review commands of the generated ones, the Node git guard hook and a stack permission preset in settings.json (merged, backed up), no board; uninstall removes it and restores what it replaced (docs/interview-machine.md)',
      '--stack <ids>': 'with --sprint-kit: dotnet, node and/or python (default: detected in the current folder)',
      '--profile <name>': 'append profiles/<name>.md (repeatable or comma-separated); recorded in the manifest',
      '--no-profile': 'clear the profiles recorded at install',
      '--board <address>': 'this machine\'s board address, added to the rulebook (with --board-repo; default: manifest, else board in ~/.orc/config.json; an artifact address applies to claude-code only)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--no-board': 'clear the board recorded at install; the clear is recorded, so the config.json board does not come back (--board sets one)',
    },
  },
  uninstall: {
    repo: true,
    summary: 'Delete the files an install recorded in its manifest (dry run without --apply); for a sprint kit also remove its settings.json entries and restore the files it replaced; for antigravity remind to remove orc-guard from hooks.json when still present',
    synopsis: 'uninstall --tool <id> [--home <dir>] [--apply] [--force]',
    options: {
      '--tool <id>': 'the adapter to uninstall (required; not all)',
      '--home <dir>': 'home folder (default your home)',
      '--apply': 'delete the files',
      '--force': 'also delete files edited since install, after a backup',
    },
  },
  status: {
    repo: true,
    summary: 'Compare an installed copy with what would be generated now, without writing',
    synopsis: 'status (--tool <id> | --all) [--home <dir>] [--profile <name>|--no-profile] [--board <address> --board-repo <dir>|--no-board] [--sprint-kit]',
    options: {
      '--tool <id>': 'the adapter to compare (this or --all; not all)',
      '--all': 'every tool in activeTools of ~/.orc/config.json, in order (exit code: the worst)',
      '--sprint-kit': 'compare with a sprint kit (default: when the manifest records one), settings.json entries included',
      '--home <dir>': 'home folder (default your home)',
      '--profile <name>': 'compare with these profiles appended (default: the ones recorded at install)',
      '--no-profile': 'compare with no profiles',
      '--board <address>': 'compare with this board address (with --board-repo; default: manifest, else board in ~/.orc/config.json; an artifact address applies to claude-code only)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--no-board': 'compare with no board line',
    },
  },
  models: {
    summary: 'Turn the output of "agy models" into a models.local.json fragment (Flash slugs without --family, or one --family)',
    synopsis: 'models --tool antigravity --from-stdin [--family <name>]',
    options: {
      '--tool antigravity': 'the only supported tool',
      '--from-stdin': 'read the model list from stdin',
      '--family <name>': 'pick this family\'s -low, -medium and -high slugs (without it, picks the slugs containing flash); name a family listed in more than one generation with its version, for example --family 4-neon',
    },
  },
  brief: {
    repo: true,
    summary: 'Print the marching-orders template, or lint a brief against it',
    synopsis: 'brief new [--role <name>] [--out <file>] [--force] | brief lint <file> [--role <name>]',
    options: {
      '--role <name>': 'the role the brief is for (items 9 to 11 only for builder, refuter and debugger)',
      '--out <file>': 'write the template to a file instead of printing it',
      '--force': 'overwrite an existing --out file',
    },
  },
  'review-tier': {
    summary: 'Say whether a branch diff is Light-eligible (tests and docs only) or Full',
    synopsis: 'review-tier [--base <ref>] [--repo-dir <dir>]',
    options: {
      '--base <ref>': 'the base to diff against (default origin/main)',
      '--repo-dir <dir>': 'the git repo to read (default the current folder)',
    },
  },
  costlog: {
    summary: 'Draft a cost log for one board session',
    synopsis: 'costlog --session <id> (--board-export <file> | --board <http://localhost:port> --board-repo <dir>) [--out <file>] [--force]',
    options: {
      '--session <id>': 'the board session (required)',
      '--board-export <file>': 'read a board export file',
      '--board <address>': 'read a local board (with --board-repo)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--out <file>': 'write the draft to a file instead of printing it',
      '--force': 'overwrite an existing --out file',
    },
  },
  calibration: {
    summary: 'Per-lane precision and recall of the review panel from its run logs (review/calibration.md)',
    synopsis: 'calibration [--logs <dir>] [--min-precision <0..1>] [--out <file>] [--force]',
    options: {
      '--logs <dir>': 'the run logs (default <repo top>/.orc/reviews)',
      '--min-precision <0..1>': 'flag lanes below this precision',
      '--out <file>': 'write the report to a file instead of printing it',
      '--force': 'overwrite an existing --out file',
    },
  },
  corpus: {
    repo: true,
    summary: 'List the review regression corpus, or score a panel report against one case (review/corpus.md)',
    synopsis: 'corpus list | corpus score --case <id> --report <file>',
    options: {
      '--case <id>': 'score: the case, a folder under tests/fixtures/corpus',
      '--report <file>': 'score: the panel report to score; exits 1 when an expected finding is missed',
    },
  },
  bench: {
    repo: true,
    summary: 'Replay benchmark: run the checkout\'s builder and refuter on fixed cases headlessly, score each run with its tokens and cost, and compare variants (orchestration/bench.md)',
    synopsis: 'bench list | bench run [--case <id>]... [--variant <label>] [--models <file>] [--tool claude-code] [--out <dir>] [--budget-usd <n>] [--timeout <seconds>] [--runs <n>] [--keep] [--keep-output] [--dry-run] | bench report [--dir <dir>] [--out <file>] [--force]',
    options: {
      '--case <id>': 'run: one case, a folder under tests/fixtures/bench (repeatable; default every case)',
      '--variant <label>': 'run: the name the results are filed under (default baseline)',
      '--models <file>': 'run: a models.local.json-shaped file merged over models.json (models.local.json itself is not read)',
      '--tool claude-code': 'run: the only tool with a bench recipe (default)',
      '--out <dir>': 'run: results folder (default <repo top>/.orc/bench); report: write the report to a file',
      '--budget-usd <n>': 'run: spending cap per case run, passed to --max-budget-usd (default 2)',
      '--timeout <seconds>': 'run: kill a case run after this many seconds (1 to 86400; default 900)',
      '--runs <n>': 'run: runs per case (1 to 100; default 1)',
      '--keep': 'run: keep each scratch repo and print its path',
      '--keep-output': 'run: also write the agent\'s final text beside each result as <case>.output.md',
      '--dry-run': 'run: print each case\'s command and start nothing',
      '--dir <dir>': 'report: the results folder (default <repo top>/.orc/bench)',
      '--force': 'report: overwrite an existing --out file',
    },
  },
  queue: {
    repo: true,
    summary: 'Unattended issue queue: run one headless Claude Code session per labelled open issue by an allowed author in a dedicated worktree; the script pushes queue/issue-<n> and opens a draft PR (dry run without --apply). Not a sandbox: the session runs code as you; the backstops are the author allow-list, base-branch protection and review of every draft PR (orchestration/queue.md)',
    synopsis: 'queue list [--repo-dir <dir>] [--label <l>] [--author <login>]... [--state <dir>] | queue run [--repo-dir <dir>] [--label <l>] [--author <login>]... [--base <branch>] [--max <n>] [--until <HH:mm>] [--budget-usd <n>] [--timeout <seconds>] [--model <m>] [--allow <tool rule>]... [--state <dir>] [--issue <n>] [--apply]',
    options: {
      '--repo-dir <dir>': 'the repo whose issues are run (default: the current folder\'s repo); its origin must be on GitHub',
      '--label <l>': 'the label that queues an issue (default orc-queue)',
      '--author <login>': 'an issue author whose issues may run (repeatable; default: the logged-in gh user only)',
      '--state <dir>': 'markers, logs, lock and worktree (default ~/.orc/queue/<owner>/<repo>)',
      '--base <branch>': 'run: the branch to start from and open the PR against (default: the repo\'s default branch)',
      '--max <n>': 'run: issues to run, oldest first (default 1)',
      '--until <HH:mm>': 'run: start no new issue at or after the next HH:mm (local) from the run\'s start (23:00 with 06:00 means tomorrow 06:00; up to an hour late, as at 06:00:30, starts nothing); the scheduler\'s time limit is the outer stop',
      '--budget-usd <n>': 'run: spending cap per issue, passed to --max-budget-usd (default 5)',
      '--timeout <seconds>': 'run: kill an issue\'s run after this many seconds (default 3600); its marker is failed',
      '--model <m>': 'run: the model (default the claude-code high tier in models.json, with models.local.json over it; its effort is passed too)',
      '--allow <tool rule>': 'run: one more allowed tool rule (repeatable): one tool name or one Bash(<command>); refused: push, gh, shells and command runners, shell operators (; & | < > ` $), git beyond status/diff/log/show/add/commit/restore/mv/rm/blame/ls-files, denied tools. Your settings\' allow rules also apply',
      '--issue <n>': 'run: run this issue only, even with a failed marker (label and author still checked); after a failed PR on a pushed branch, open the PR only; after a failed push, push the kept commit and open the PR',
      '--apply': 'run: run the issues (without it, print what would run and change nothing; there is no --dry-run)',
    },
  },
  metrics: {
    summary: 'Capture or report per-run review metrics from Claude Code transcripts (review/metrics.md)',
    synopsis: 'metrics capture --workflow <name> [--session <id> | --transcript <path>] [--log <run log>] [--mode lite|full] [--version <v>] [--out <dir>] [--print] | metrics report [--dir <dir>] [--prices <file>] [--out <file>] [--force]',
    options: {
      '--workflow <name>': 'capture: the workflow that ran (required)',
      '--session <id>': 'capture: the session (default CLAUDE_CODE_SESSION_ID)',
      '--transcript <path>': 'capture: read this transcript instead of the session\'s',
      '--log <run log>': 'capture: the run log to attach',
      '--mode lite|full': 'capture: the run mode',
      '--version <v>': 'capture: the procedure version',
      '--out <dir>': 'capture: output folder; report: output file',
      '--print': 'capture: print the JSON instead of writing it',
      '--dir <dir>': 'report: the metrics folder (default <repo top>/.orc/metrics)',
      '--prices <file>': 'report: a prices JSON file',
      '--force': 'report: overwrite an existing --out file',
    },
  },
  dispatch: {
    repo: true,
    summary: 'Run one role headlessly at its tier (Antigravity, Claude Code and Codex), on --tool or routed by ~/.orc/config.json',
    synopsis: 'dispatch [--tool <id> | --prefer <id>] --role <name> --brief <file> [--model <slug>] [--dry-run] [--timeout <seconds>] [--no-lint]',
    options: {
      '--tool <id>': 'the tool to run, with no fallback (default: the role\'s routing entry, then fallback, in ~/.orc/config.json; the first available tool runs)',
      '--prefer <id>': 'try this tool first, then the role\'s routing entry and fallback (e.g. a second reviewer on another tool); not with --tool',
      '--model <slug>': 'the model to pass to the tool instead of the tier\'s (effort unchanged); dropped when routing falls back to another tool',
      '--role <name>': 'the role to run (required)',
      '--brief <file>': 'the brief (required; linted first)',
      '--dry-run': 'print the command and exit',
      '--timeout <seconds>': 'kill the process tree after this many seconds (1 to 86400; exit 124)',
      '--no-lint': 'skip the brief lint',
    },
  },
  doctor: {
    repo: true,
    summary: 'Check ~/.orc/config.json and models.json, each active tool (install state; for antigravity its hooks.json orc-guard entry; for a tool with a headless recipe also its binary, --version, sign-in and headless models), the routing table, the board and a retired ~/.claude/board.local.md, without writing',
    synopsis: 'doctor [--home <dir>] [--json]',
    options: {
      '--home <dir>': 'the home folder the tools install into (default your home)',
      '--json': 'print one JSON object {ok, checks: [{level, check, detail, tool?}]}',
    },
  },
  hooks: {
    repo: true,
    summary: 'Wire hooks into <home>/.claude/settings.json (default, --tool claude-code) or <home>/.gemini/config/hooks.json (--tool antigravity, orc-guard only; dry run without --apply). For claude-code, merges the example hooks from adapters/claude-code/ and reports stale .claude/tools/{worklog,peon} entries without duplicating them; run it from the checkout you keep',
    synopsis: 'hooks [--tool claude-code|antigravity] --home <dir> [--apply] [--node] [--remove]',
    options: {
      '--tool <id>': 'claude-code (default) or antigravity',
      '--home <dir>': 'home folder (required; no default)',
      '--apply': 'write the file, after a backup',
      '--node': 'claude-code only: use adapters/claude-code/hooks.node.example.json (board reminder and git guard on Node, no PowerShell)',
      '--remove': 'antigravity only: remove the orc-guard hook key from hooks.json, leaving every other named hook untouched',
    },
  },
  standards: {
    summary: 'List, show or detect archive coding standards, or compose a project\'s STANDARDS.md (dry run without --apply)',
    synopsis: 'standards list | show <id> | detect [--repo <dir>] [--json] | apply --repo <dir> (--stack <ids> | --from <path>)... [--out <rel>] [--apply] [--force]',
    options: {
      '--repo <dir>': 'the project (not this checkout); detect defaults to the current folder, apply needs it',
      '--json': 'detect: print JSON, with current (the stacks and imports in the STANDARDS.md marker) and unreadable',
      '--stack <ids>': 'apply: archive ids (repeatable or comma-separated); their requires are added',
      '--from <path>': 'apply: import a .md file, or every .md file in a folder (repeatable); an archive-format file is validated and rendered like a stack',
      '--out <rel>': 'apply: target path relative to the project (default STANDARDS.md)',
      '--apply': 'apply: write the file (the dry run exits 0, also when --apply would refuse)',
      '--force': 'apply: replace an edited or hand-written file, or one whose stacks or imports the new set drops (otherwise --apply exits 1), with a backup',
    },
  },
  help: {
    summary: 'Print this list, or one command\'s options',
    synopsis: 'help [<command>]   (also --help, -h, <command> --help)',
    options: {},
  },
};

export const USAGE = `usage: node tools/orc.mjs ${Object.keys(HELP).join('|')} [options]`;

export function globalHelp() {
  const width = Math.max(...Object.keys(HELP).map((c) => c.length));
  const lines = Object.entries(HELP).map(([c, h]) => `  ${c.padEnd(width)}  ${h.summary}`);
  return [USAGE, '', 'Commands:', ...lines, '', 'Commands that read this checkout take --repo <dir> (default: this one; help <command> says which); for standards it names the project instead.', 'node tools/orc.mjs help <command> lists its options. Reference: docs/cli.md'].join('\n');
}

export function commandHelp(cmd) {
  if (!Object.hasOwn(HELP, cmd)) return null;
  const h = HELP[cmd];
  const opts = Object.entries(h.options);
  const width = Math.max(0, ...opts.map(([o]) => o.length));
  const lines = [`usage: node tools/orc.mjs ${h.synopsis}`, '', h.summary];
  if (opts.length) lines.push('', 'Options:', ...opts.map(([o, d]) => `  ${o.padEnd(width)}  ${d}`));
  if (h.repo) lines.push('', '  --repo <dir>  the Orc-istration checkout to read (default: this one)');
  return lines.join('\n');
}
