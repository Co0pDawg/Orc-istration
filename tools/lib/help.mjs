// The one help table for tools/orc.mjs: every command, its synopsis and its options, one line each.
// tests/tooling.test.mjs checks that this table and the command dispatch name the same commands.
export const HELP = {
  build: {
    summary: 'Write every tool\'s generated files to dist/<tool>/ (untracked) and print sizes and gaps',
    synopsis: 'build [--tool <id>|all] [--out <dir>] [--profile <name>]',
    options: {
      '--tool <id>|all': 'one adapter, or all (default all)',
      '--out <dir>': 'output folder, relative to the repo (default dist)',
      '--profile <name>': 'append profiles/<name>.md after the tool notes (repeatable or comma-separated)',
    },
  },
  check: {
    summary: 'Build every tool, check the caps and models.json, and compare CLAUDE.md and agents/*.md with the build',
    synopsis: 'check',
    options: {},
  },
  sync: {
    summary: 'Regenerate the checked-in CLAUDE.md and agents/*.md; delete generated agents with no role',
    synopsis: 'sync',
    options: {},
  },
  golden: {
    summary: 'Regenerate tests/golden/<tool>/ from the build the golden test compares against',
    synopsis: 'golden [--tool <id>|all]',
    options: { '--tool <id>|all': 'one adapter, or all (default all)' },
  },
  install: {
    summary: 'Install one tool\'s generated files into a home folder (dry run without --apply)',
    synopsis: 'install --tool <id> [--home <dir>] [--apply] [--force] [--profile <name>|--no-profile] [--board <address> --board-repo <dir>|--no-board]',
    options: {
      '--tool <id>': 'the adapter to install (required; not all)',
      '--home <dir>': 'home folder (default your home; required for claude-code)',
      '--apply': 'write the files (backs up each replaced file)',
      '--force': 'replace hand-written or edited files, with a backup',
      '--profile <name>': 'append profiles/<name>.md (repeatable or comma-separated); recorded in the manifest',
      '--no-profile': 'clear the profiles recorded at install',
      '--board <address>': 'this machine\'s board address, added to the rulebook (with --board-repo)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--no-board': 'clear the board recorded at install',
    },
  },
  uninstall: {
    summary: 'Delete the files an install recorded in its manifest (dry run without --apply)',
    synopsis: 'uninstall --tool <id> [--home <dir>] [--apply] [--force]',
    options: {
      '--tool <id>': 'the adapter to uninstall (required; not all)',
      '--home <dir>': 'home folder (default your home; required for claude-code)',
      '--apply': 'delete the files',
      '--force': 'also delete files edited since install, after a backup',
    },
  },
  status: {
    summary: 'Compare an installed copy with what would be generated now, without writing',
    synopsis: 'status --tool <id> [--home <dir>] [--profile <name>|--no-profile] [--board <address> --board-repo <dir>|--no-board]',
    options: {
      '--tool <id>': 'the adapter to compare (required; not all)',
      '--home <dir>': 'home folder (default your home)',
      '--profile <name>': 'compare with these profiles appended (default: the ones recorded at install)',
      '--no-profile': 'compare with no profiles',
      '--board <address>': 'compare with this board address (with --board-repo)',
      '--board-repo <dir>': 'the Orc-Dashboard checkout (with --board)',
      '--no-board': 'compare with no board line',
    },
  },
  models: {
    summary: 'Turn the output of "agy models" into a models.local.json fragment',
    synopsis: 'models --tool antigravity --from-stdin',
    options: {
      '--tool antigravity': 'the only supported tool',
      '--from-stdin': 'read the model list from stdin',
    },
  },
  brief: {
    summary: 'Print the marching-orders template, or lint a brief against it',
    synopsis: 'brief new [--role <name>] [--out <file>] [--force] | brief lint <file> [--role <name>]',
    options: {
      '--role <name>': 'the role the brief is for (items 9 and 10 only for builder, refuter and debugger)',
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
    summary: 'Per-lane precision of the review panel from its run logs (review/calibration.md)',
    synopsis: 'calibration [--logs <dir>] [--min-precision <0..1>] [--out <file>]',
    options: {
      '--logs <dir>': 'the run logs (default <repo top>/.orc/reviews)',
      '--min-precision <0..1>': 'flag lanes below this precision',
      '--out <file>': 'write the report to a file instead of printing it',
    },
  },
  metrics: {
    summary: 'Capture or report per-run review metrics from Claude Code transcripts (review/metrics.md)',
    synopsis: 'metrics capture --workflow <name> [--session <id> | --transcript <path>] [--log <run log>] [--mode lite|full] [--version <v>] [--out <dir>] [--print] | metrics report [--dir <dir>] [--prices <file>] [--out <file>]',
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
    },
  },
  dispatch: {
    summary: 'Run one role headlessly at its tier (Antigravity and Claude Code)',
    synopsis: 'dispatch --tool <id> --role <name> --brief <file> [--dry-run] [--timeout <seconds>] [--no-lint]',
    options: {
      '--tool <id>': 'the tool to run (required)',
      '--role <name>': 'the role to run (required)',
      '--brief <file>': 'the brief (required; linted first)',
      '--dry-run': 'print the command and exit',
      '--timeout <seconds>': 'kill the process tree after this many seconds (1 to 86400; exit 124)',
      '--no-lint': 'skip the brief lint',
    },
  },
  hooks: {
    summary: 'Merge the example hooks into <home>/.claude/settings.json (dry run without --apply)',
    synopsis: 'hooks --home <dir> [--apply] [--node]',
    options: {
      '--home <dir>': 'home folder (required; no default)',
      '--apply': 'write the file, after a backup',
      '--node': 'use hooks.node.example.json (board reminder on Node, no PowerShell)',
    },
  },
  standards: {
    summary: 'List, show or detect archive coding standards, or compose a project\'s STANDARDS.md (dry run without --apply)',
    synopsis: 'standards list | show <id> | detect [--repo <dir>] [--json] | apply --repo <dir> (--stack <ids> | --from <path>)... [--out <rel>] [--apply] [--force]',
    options: {
      '--repo <dir>': 'the project (not this checkout); detect defaults to the current folder, apply needs it',
      '--json': 'detect: print JSON',
      '--stack <ids>': 'apply: archive ids (repeatable or comma-separated); their requires are added',
      '--from <path>': 'apply: import a .md file, or every .md file in a folder (repeatable)',
      '--out <rel>': 'apply: target path relative to the project (default STANDARDS.md)',
      '--apply': 'apply: write the file (the dry run exits 0, also when --apply would refuse)',
      '--force': 'apply: replace an edited or hand-written file (otherwise --apply exits 1), with a backup',
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
  return [USAGE, '', 'Commands:', ...lines, '', 'Every command takes --repo <dir> (default: this checkout); for standards it names the project instead.', 'node tools/orc.mjs help <command> lists its options. Reference: docs/cli.md'].join('\n');
}

export function commandHelp(cmd) {
  const h = HELP[cmd];
  if (!h) return null;
  const opts = Object.entries(h.options);
  const width = Math.max(0, ...opts.map(([o]) => o.length));
  const lines = [`usage: node tools/orc.mjs ${h.synopsis}`, '', h.summary];
  if (opts.length) lines.push('', 'Options:', ...opts.map(([o, d]) => `  ${o.padEnd(width)}  ${d}`));
  if (!h.options['--repo <dir>']) lines.push('', '  --repo <dir>  the Orc-istration checkout to read (default: this one)');
  return lines.join('\n');
}
