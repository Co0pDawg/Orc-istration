// Repo coding standards: the cited archive in standards/<id>.md (format: standards/README.md), stack detection in a
// project, and composing the project's STANDARDS.md from archive entries and the user's own files.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './frontmatter.mjs';
import { readText } from './text.mjs';
import { sha256, escapes } from './manifest.mjs';

export const KINDS = ['language', 'framework', 'tool'];
export const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.claude']);
export const ENTRY_CAP = 50000;
const MARKER = /^<!-- orc standards: stacks=([^;]*); imports=(.*); sha256=([0-9a-f]{64}) -->$/;

const archiveFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort() : []);

// Every archive entry, parsed; throws on a file the frontmatter parser cannot read.
export function loadArchive(dir) {
  return archiveFiles(dir).map((f) => {
    const { data, body } = parse(readText(path.join(dir, f)));
    const list = (v) => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);
    return { ...data, file: f, detect: list(data.detect), requires: list(data.requires), sources: list(data.sources), body };
  });
}

// Lines outside fenced code blocks get fn(line); fence lines and fenced content pass through untouched.
function outsideFences(text, fn) {
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]))) {
        fence = fence ? null : m[1];
        return line;
      }
      return fence ? line : fn(line);
    })
    .join('\n');
}

export const demoteHeadings = (text) => outsideFences(text, (l) => (/^#{1,5}(\s|$)/.test(l) ? `#${l}` : l));

export function stripFrontmatter(text) {
  const m = /^---\n[\s\S]*?\n---(\n|$)/.exec(text);
  return m ? text.slice(m[0].length).replace(/^\n+/, '') : text;
}

// [n] citations in prose: fenced code and inline code spans are skipped.
export function citations(body) {
  const prose = [];
  outsideFences(body, (l) => (prose.push(l.replace(/`[^`]*`/g, '')), l));
  return [...prose.join('\n').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

// Problems with the archive, one string each; [] when valid or when the folder is absent.
export function validateArchive(dir) {
  const problems = [];
  const entries = [];
  for (const f of archiveFiles(dir)) {
    try {
      const { data, body } = parse(readText(path.join(dir, f)));
      entries.push({ f, data, body });
    } catch (e) {
      problems.push(`standards/${f}: ${e.message}`);
    }
  }
  const ids = new Set(entries.map((e) => e.data.id));
  for (const { f, data, body } of entries) {
    const bad = (why) => problems.push(`standards/${f}: ${why}`);
    if (data.id !== f.slice(0, -3)) bad(`id ${JSON.stringify(data.id)} does not match the file name`);
    if (!data.title) bad('no title');
    if (!KINDS.includes(data.kind)) bad(`kind ${JSON.stringify(data.kind)} is not one of ${KINDS.join(', ')}`);
    if (!Array.isArray(data.detect) || !data.detect.length) bad('detect must be a non-empty list');
    if (data.requires !== undefined && !Array.isArray(data.requires)) bad('requires must be a list');
    for (const r of Array.isArray(data.requires) ? data.requires : []) if (!ids.has(r)) bad(`requires unknown id ${r}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.reviewed ?? ''))) bad('reviewed must be YYYY-MM-DD');
    const n = Array.isArray(data.sources) ? data.sources.length : 0;
    if (!n) bad('sources must be a non-empty list');
    const out = [...new Set(citations(body).filter((c) => c < 1 || c > n))];
    if (out.length) bad(`citation(s) ${out.map((c) => `[${c}]`).join(' ')} out of range (${n} source(s))`);
    const checklist = /^## Review checklist[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
    if (!checklist) bad('no "## Review checklist" section');
    else if (!/^- \[ \] \S/m.test(checklist[1])) bad('the Review checklist has no "- [ ]" item');
  }
  return problems;
}

export function globRe(glob) {
  const src = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${src}$`, 'i');
}

// Walks repoDir (no symlinks or junctions, SKIP_DIRS by name, at most `cap` entries) and matches base names.
export function detect(repoDir, archive, { cap = ENTRY_CAP } = {}) {
  const res = archive.map((e) => ({ e, res: e.detect.map(globRe), matches: 0, examples: [] }));
  let seen = 0;
  let truncated = false;
  const stack = [''];
  while (stack.length && !truncated) {
    const rel = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(path.join(repoDir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
      continue;
    }
    const subdirs = [];
    for (const d of dirents) {
      if (++seen > cap) {
        truncated = true;
        break;
      }
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) subdirs.push(r);
        continue;
      }
      if (!d.isFile()) continue;
      for (const x of res) {
        if (!x.res.some((re) => re.test(d.name))) continue;
        x.matches++;
        if (x.examples.length < 3) x.examples.push(r);
      }
    }
    stack.push(...subdirs.reverse());
  }
  const direct = res.filter((x) => x.matches).sort((a, b) => b.matches - a.matches || (a.e.id < b.e.id ? -1 : 1));
  const byId = new Map(res.map((x) => [x.e.id, x]));
  const picked = new Map(direct.map((x) => [x.e.id, null]));
  const queue = direct.map((x) => x.e.id);
  while (queue.length) {
    const id = queue.shift();
    for (const r of byId.get(id)?.e.requires ?? []) {
      if (picked.has(r) || !byId.has(r)) continue;
      picked.set(r, id);
      queue.push(r);
    }
  }
  const required = [...picked].filter(([, by]) => by).map(([id]) => byId.get(id));
  const detected = [...direct, ...required].map((x) => ({
    id: x.e.id,
    title: x.e.title,
    kind: x.e.kind,
    matches: x.matches,
    examples: x.examples,
    requiredBy: picked.get(x.e.id),
  }));
  return { detected, truncated, scanned: Math.min(seen, cap) };
}

// The ids plus their requires, transitively; returns {ids, added: [{id, by}]} or throws on an unknown id.
export function withRequires(ids, archive) {
  const byId = new Map(archive.map((e) => [e.id, e]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`unknown stack(s) ${unknown.join(', ')}; known: ${[...byId.keys()].join(', ')}`);
  const out = new Set(ids);
  const added = [];
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift();
    for (const r of byId.get(id).requires) {
      if (out.has(r)) continue;
      out.add(r);
      added.push({ id: r, by: id });
      queue.push(r);
    }
  }
  const rank = (e) => KINDS.indexOf(e.kind);
  const ordered = [...out].map((id) => byId.get(id)).sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
  return { entries: ordered, added };
}

// The composed STANDARDS.md: marker line, header, one section per stack, one per import ({name, text}).
export function compose(entries, imports) {
  const contents = [...entries.map((e) => `- ${e.title} (\`${e.id}\`)`), ...imports.map((i) => `- Imported: ${i.name}`)];
  const parts = [
    '# Coding standards',
    '',
    'Builders follow the sections for the stacks they touch. Refuters check each diff against the Review checklist of every section whose stack the diff touches. The team may edit this file, but a re-apply then needs `orc standards apply --force`, which keeps a backup.',
    '',
    'Contents:',
    '',
    ...contents,
  ];
  for (const e of entries) {
    const body = demoteHeadings(e.body.replace(/\s+$/, ''));
    parts.push('', body, '', '### Sources', '', ...e.sources.map((s, i) => `${i + 1}. ${s}`), '', `Reviewed ${e.reviewed}.`);
  }
  for (const i of imports) parts.push('', `## Imported: ${i.name}`, '', demoteHeadings(stripFrontmatter(i.text).replace(/\s+$/, '')));
  const rest = `${parts.join('\n')}\n`;
  const marker = `<!-- orc standards: stacks=${entries.map((e) => e.id).join(',')}; imports=${imports.map((i) => i.name).join(',')}; sha256=${sha256(rest)} -->`;
  return `${marker}\n${rest}`;
}

// create | unchanged | replace | REPLACE EDITED | REPLACE HAND-WRITTEN, for existing text (LF) or null.
export function targetState(current, composed) {
  if (current === null) return 'create';
  if (current === composed) return 'unchanged';
  const nl = current.indexOf('\n');
  const m = MARKER.exec(nl < 0 ? current : current.slice(0, nl));
  if (!m) return 'REPLACE HAND-WRITTEN';
  return sha256(nl < 0 ? '' : current.slice(nl + 1)) === m[3] ? 'replace' : 'REPLACE EDITED';
}

// --from paths: a .md file, or a folder whose .md files are taken non-recursively, sorted by name.
export function readImports(paths) {
  const out = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`--from ${p}: not found`);
    const files = fs.statSync(abs).isDirectory()
      ? fs
          .readdirSync(abs, { withFileTypes: true })
          .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
          .map((d) => path.join(abs, d.name))
          .sort()
      : [abs];
    if (!files.length) throw new Error(`--from ${p}: no .md files in that folder`);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.md')) throw new Error(`--from ${p}: not a .md file`);
      out.push({ name: path.basename(f), text: readText(f) });
    }
  }
  return out;
}

function backupPath(target, when) {
  let backup = `${target}.orc-backup-${when}`;
  for (let n = 2; fs.existsSync(backup); n++) backup = `${target}.orc-backup-${when}-${n}`;
  return backup;
}

// `standards list|show|detect|apply`. opt: parsed args; archiveDir: the checkout's standards/; when: backup stamp.
export function runStandards(opt, io, { archiveDir, when, cap }) {
  const fail = (msg) => {
    io.err(msg);
    return 1;
  };
  const [, sub, ...rest] = opt._;
  let archive;
  try {
    archive = loadArchive(archiveDir);
  } catch (e) {
    return fail(`standards archive: ${e.message}`);
  }
  if (sub === 'list' && !rest.length) {
    for (const e of archive) io.out(`${e.id}  ${e.kind}  ${e.title}  (reviewed ${e.reviewed})`);
    return 0;
  }
  if (sub === 'show' && rest.length === 1) {
    const e = archive.find((x) => x.id === rest[0]);
    if (!e) return fail(`unknown standard ${rest[0]}; known: ${archive.map((x) => x.id).join(', ')}`);
    io.out(readText(path.join(archiveDir, e.file)).replace(/\n$/, ''));
    return 0;
  }
  if (sub === 'detect' && !rest.length) {
    const repo = path.resolve(opt.repo ?? process.cwd());
    if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) return fail(`no folder at ${repo}`);
    const { detected, truncated } = detect(repo, archive, { cap });
    const standardsFile = fs.existsSync(path.join(repo, 'STANDARDS.md'));
    if (truncated) io.err(`WARN stopped after ${cap ?? ENTRY_CAP} entries; the results are partial`);
    if (opt.json) {
      io.out(JSON.stringify({ repo, standardsFile, detected, archive: archive.map((e) => e.id), truncated }, null, 2));
      return 0;
    }
    io.out(`repo: ${repo}`);
    io.out(`STANDARDS.md: ${standardsFile ? 'present' : 'absent'}`);
    if (!detected.length) io.out('no archive stacks detected');
    for (const d of detected) {
      const how = d.requiredBy ? `required by ${d.requiredBy}` : `${d.matches} match(es), e.g. ${d.examples.join(', ')}`;
      io.out(`  ${d.id}  ${d.kind}  ${how}`);
    }
    io.out(`archive: ${archive.map((e) => e.id).join(', ')}`);
    return 0;
  }
  if (sub === 'apply' && !rest.length) {
    if (!opt.repo) return fail('standards apply needs --repo <dir> (the project)');
    const stacks = opt.stack ?? [];
    const froms = opt.from ?? [];
    if (!stacks.length && !froms.length) return fail('standards apply needs --stack <ids> or --from <path>');
    const out = opt.out ?? 'STANDARDS.md';
    if (path.isAbsolute(out) || /^[a-zA-Z]:/.test(out)) return fail(`--out must be relative to the repo: ${out}`);
    const repoDir = path.resolve(opt.repo);
    if (!fs.existsSync(repoDir) || !fs.statSync(repoDir).isDirectory()) return fail(`no folder at ${repoDir}`);
    const repo = fs.realpathSync(repoDir);
    const target = path.resolve(repo, out);
    const rel = path.relative(repo, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return fail(`--out ${out} is outside the repo ${repo}`);
    if (rel.split(path.sep).some((s) => s.toLowerCase() === '.git')) return fail(`--out ${out} is inside .git; refusing`);
    for (let d = path.dirname(target); d !== repo; d = path.dirname(d)) {
      if (fs.existsSync(d) && !fs.statSync(d).isDirectory()) return fail(`refused: ${d} is a file, not a folder; nothing written`);
    }
    const unsafe = escapes(repo, '.', target);
    if (unsafe) return fail(`refused: ${unsafe}; nothing written`);
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) return fail(`refused: ${target} is not a regular file`);
    let entries;
    let imports;
    try {
      const r = withRequires([...new Set(stacks)], archive);
      entries = r.entries;
      for (const a of r.added) io.out(`added ${a.id} (required by ${a.by})`);
      imports = readImports(froms);
    } catch (e) {
      return fail(e.message);
    }
    const composed = compose(entries, imports);
    const exists = fs.existsSync(target);
    const state = targetState(exists ? readText(target) : null, composed);
    io.out(`target: ${target} (${state})`);
    io.out('sections:');
    for (const e of entries) io.out(`  ${e.id}  ${e.title}`);
    for (const i of imports) io.out(`  Imported: ${i.name}`);
    const refused = state.startsWith('REPLACE') && !opt.force;
    const why = state === 'REPLACE EDITED' ? 'edited since it was applied' : 'hand-written (no orc standards marker)';
    if (!opt.apply) {
      io.out('dry run; add --apply to write');
      if (refused) io.out(`--apply would refuse: the file is ${why} (pass --force to replace it, with a backup)`);
      return 0;
    }
    if (refused) return fail(`refused: ${target} is ${why}; pass --force to replace it, with a backup`);
    if (state === 'unchanged') {
      io.out(`unchanged: ${target}`);
      return 0;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (state.startsWith('REPLACE')) {
      const backup = backupPath(target, when);
      fs.copyFileSync(target, backup);
      io.out(`backed up: ${backup}`);
    }
    fs.writeFileSync(target, Buffer.from(composed, 'utf8'));
    io.out(`applied ${state}: ${target}`);
    return 0;
  }
  return fail('usage: standards list | show <id> | detect [--repo <dir>] [--json] | apply --repo <dir> (--stack <ids> | --from <path>)... [--out <rel>] [--apply] [--force]');
}
