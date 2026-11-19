// Review regression corpus: list the cases and score a panel report against a case's expected findings.
// Format and procedure: review/corpus.md. A case is tests/fixtures/corpus/<id>/ with case.md, diff.patch, expected.md.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './text.mjs';

// Cells split on unescaped pipes only, as in the run logs.
const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const normPath = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
const CASE_ID = /^[a-z0-9][a-z0-9-]*$/;

export function caseDir(root, id) {
  if (!CASE_ID.test(id ?? '')) throw new Error(`corpus: not a case id: ${id}`);
  const dir = path.join(root, id);
  if (!fs.existsSync(path.join(dir, 'expected.md'))) throw new Error(`corpus: no case ${id} (no ${id}/expected.md under ${root})`);
  return dir;
}

// case.md: a `# <title>` heading and a `Lanes: a, b` line.
export function readCase(text) {
  const title = /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? '';
  const lanes = (/^Lanes:\s*(.+?)\s*$/m.exec(text)?.[1] ?? '').split(/,\s*/).filter(Boolean);
  return { title, lanes };
}

export function listCases(root) {
  if (!fs.existsSync(root)) throw new Error(`corpus: no corpus folder at ${root}`);
  const ids = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'case.md'))).sort();
  return ids.map((id) => ({ id, ...readCase(readText(path.join(root, id, 'case.md'))) }));
}

// expected.md: a table `| Id | Lane | File | Lines | Defect |`. Lines is a range `a-b`, one line number, or a comma list
// of either (`9, 15`) when a reviewer could cite the defect at separate places.
export function parseExpected(text) {
  const rows = [];
  let cols = null;
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) {
      cols = null;
      continue;
    }
    const c = cells(line);
    const lower = c.map((x) => x.toLowerCase());
    if (lower[0] === 'id' && lower.includes('file') && lower.includes('lines')) {
      cols = { lane: lower.indexOf('lane'), file: lower.indexOf('file'), lines: lower.indexOf('lines'), defect: lower.indexOf('defect') };
      continue;
    }
    if (!cols || /^-+$/.test(c[0]) || !c[0]) continue;
    const ranges = (c[cols.lines] ?? '').split(',').map((part) => {
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
      if (!m) throw new Error(`corpus: expected row ${c[0]}: Lines must be a-b or a comma list of them, got "${c[cols.lines]}"`);
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (to < from) throw new Error(`corpus: expected row ${c[0]}: Lines ${from}-${to} run backwards`);
      return { from, to };
    });
    rows.push({ id: c[0], lane: cols.lane < 0 ? '' : c[cols.lane], file: normPath(c[cols.file]), ranges, defect: cols.defect < 0 ? '' : c[cols.defect] });
  }
  if (!rows.length) throw new Error('corpus: expected.md has no `| Id | Lane | File | Lines | Defect |` rows');
  return rows;
}

// The findings of a panel report (review/PROCEDURE.md Step 4): `- [lane] text — file:line` bullets (or `* [lane]`)
// under the Must fix, Review before submitting and Suggestions headings, at the start of the line (an indented bullet
// is a sub-item, not a finding). Questions, Runtime checks (repeats of findings) and Refuted by verification are not
// findings. Every `file:line` or `file:a-b` on the bullet's line is a location.
const FINDING_SECTIONS = /^###\s+(Must fix|Review before submitting|Suggestions)/i;

export function parseReport(text) {
  const findings = [];
  let inFindings = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,3}\s/.test(line)) {
      inFindings = FINDING_SECTIONS.test(line);
      continue;
    }
    const m = /^[-*]\s+\[([^\]]+)\]\s*(.*)$/.exec(line);
    if (!inFindings || !m) continue;
    const locations = [...m[2].matchAll(/([\w./\\-]+\.[\w]+):(\d+)(?:-(\d+))?/g)].map((x) => ({
      file: normPath(x[1]),
      from: Number(x[2]),
      to: Number(x[3] ?? x[2]),
    }));
    findings.push({ lanes: m[1].split(/,\s*/).map((s) => s.trim()), text: m[2].trim(), locations });
  }
  return findings;
}

// A location matches by its first line only, so a wide range (`file:1-999`) cannot match every row.
const hits = (f, e) => f.locations.some((l) => l.file === e.file && e.ranges.some((r) => l.from >= r.from && l.from <= r.to));

// A finding matches an expected row when it names the same file with its first line inside one of the row's ranges.
// The lane is shown but need not match.
export function scoreCase(expected, findings) {
  const found = [];
  const missed = [];
  for (const e of expected) {
    const by = findings.filter((f) => hits(f, e));
    if (by.length) found.push({ ...e, by });
    else missed.push(e);
  }
  const extra = findings.filter((f) => !expected.some((e) => hits(f, e)));
  return { found, missed, extra };
}

export function scoreReport(root, id, reportFile) {
  const dir = caseDir(root, id);
  if (!fs.existsSync(reportFile)) throw new Error(`corpus: report not found: ${reportFile}`);
  const expected = parseExpected(readText(path.join(dir, 'expected.md')));
  const findings = parseReport(readText(reportFile));
  const s = scoreCase(expected, findings);
  const range = (e) => e.ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(',');
  const out = [`Corpus case ${id}: ${expected.length} expected, ${s.found.length} found, ${s.missed.length} missed, ${s.extra.length} extra`];
  for (const e of s.found) {
    const lanes = [...new Set(e.by.flatMap((f) => f.lanes))];
    out.push(`FOUND ${e.id} [${e.lane}] ${e.file}:${range(e)} — ${e.defect} — by [${lanes.join(', ')}]${lanes.includes(e.lane) ? '' : ' (other lane)'}`);
  }
  for (const e of s.missed) out.push(`MISSED ${e.id} [${e.lane}] ${e.file}:${range(e)} — ${e.defect}`);
  for (const f of s.extra) out.push(`EXTRA [${f.lanes.join(', ')}] ${f.text}`);
  return { text: out.join('\n') + '\n', missed: s.missed.length };
}
