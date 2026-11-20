// Calibration report: per-lane verdict counts and precision from review run logs. Format and procedure:
// review/calibration.md. The metrics capture reads one log through parseRunLog too, so both agree on what a row is.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './text.mjs';

export const DEFAULT_MIN_PRECISION = 0.6;
// Precision is shown only from this many confirmed + false-positive verdicts; fewer is noise.
export const MIN_DENOMINATOR = 5;
// A lane with this many false positives is a recalibration target whatever its precision.
export const FP_TARGET = 3;
// A lane with this many escaped defects is a recalibration target.
export const ESCAPE_TARGET = 2;

const VERDICTS = ['confirmed', 'falsePositive', 'wontFix', 'notActioned', 'pending', 'nonCanonical'];
// A triaged verdict an agent gave is counted apart from these kinds: outside precision, recall and the trigger.
const TRIAGED = ['confirmed', 'falsePositive', 'wontFix'];
// A verdict may end with its source, `(developer)` or `(agent)`. `(agent)` anywhere in the cell marks an agent's
// verdict; otherwise (a `(developer)` suffix, or none) the developer gave it.
const SOURCE = /\s*\((developer|agent)\)\s*$/i;

export function sourceOf(cell) {
  return /\(agent\)/i.test(cell) ? 'agent' : 'developer';
}

// Cells split on unescaped pipes only: a finding may quote code with `\|`. The corpus reads its tables through this too.
export const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function verdictOf(cell) {
  const v = cell.replace(SOURCE, '').replace(/^\*+\s*/, '').toLowerCase();
  if (/^confirmed/.test(v)) return 'confirmed';
  if (/^false[- ]positive/.test(v)) return 'falsePositive';
  if (/^won'?t[- ]fix/.test(v)) return 'wontFix';
  if (/^not[- ]actioned/.test(v)) return 'notActioned';
  if (/^(_pending_|pending)?$/.test(v)) return 'pending';
  return 'nonCanonical';
}

// A `Leads:` or `Verification:` line: each count read by its keyword, so notes elsewhere on the line do not break it.
function countsLine(line, keys, label, warnings) {
  const counts = {};
  for (const k of keys) {
    const m = new RegExp(`(\\d+)\\s*${k}\\b`).exec(line);
    counts[k] = m ? Number(m[1]) : null;
  }
  const missing = keys.filter((k) => counts[k] === null);
  if (missing.length) warnings.push(`the ${label} line has no count for: ${missing.join(', ')}. Line: ${line.trim()}`);
  return counts;
}

const ESCAPE_HEADER = '`| # | Lane | Defect (one line) | Where | Found by | Why missed |`';

// One run log: the Leads: and Verification: lines, whether it has the `# Review Log` heading, the rows of every
// finding table (a header naming Severity, Agent and, last, Verdict) and of every escaped-defects table (a header
// naming Lane, Found by and Why missed). Rows of any other table in the file (Runtime checks, an earlier-run
// comparison) are neither. An escaped-defects row that cannot be read is dropped with a warning, never silently.
export function parseRunLog(text) {
  let leads = null;
  let verification = null;
  let cols = null;
  let esc = null;
  let tables = 0;
  const rows = [];
  const escapes = [];
  const warnings = [];
  const heading = /^# Review Log\b/m.test(text);
  // Escaped defects: inside its section, the rows read and the rows dropped by reason.
  let escSection = false;
  let escRead = 0;
  let escBad = null;
  let inTable = false;
  const dropped = new Map();
  const drop = (why) => dropped.set(why, (dropped.get(why) ?? 0) + 1);
  const endSection = () => {
    if (escSection && !escRead && !dropped.size) warnings.push('the Escaped defects section has no rows');
    escSection = false;
  };
  for (const line of text.split('\n')) {
    if (/^\s*Leads:/.test(line)) {
      leads = countsLine(line, ['raised', 'confirmed', 'plausible', 'refuted'], 'Leads:', warnings);
      continue;
    }
    if (/^\s*Verification:/.test(line)) {
      verification = countsLine(line, ['checked', 'confirmed', 'plausible', 'refuted'], 'Verification:', warnings);
      continue;
    }
    if (!/^\s*\|/.test(line)) {
      if (/^#{1,6}\s/.test(line)) {
        endSection();
        escSection = /^#{1,6}\s+Escaped defects\b/i.test(line);
      }
      cols = null;
      esc = null;
      escBad = null;
      inTable = false;
      continue;
    }
    const c = cells(line);
    const first = !inTable;
    inTable = true;
    if (/^:?-+:?$/.test(c[0])) continue;
    if (c[0] === '#') {
      const lower = c.map((x) => x.toLowerCase());
      const ok = lower.includes('severity') && lower.includes('agent') && lower[lower.length - 1] === 'verdict';
      cols = ok ? { severity: lower.indexOf('severity'), agent: lower.indexOf('agent'), n: c.length } : null;
      if (ok) tables++;
      const isEsc = !ok && lower.includes('lane') && lower.includes('found by') && lower.includes('why missed');
      const at = (re) => lower.findIndex((x) => re.test(x));
      esc = isEsc ? { lane: at(/^lane$/), defect: at(/^defect/), where: at(/^where$/), foundBy: at(/^found by$/), why: at(/^why missed$/), n: c.length } : null;
      escBad = !ok && !isEsc && (escSection || lower.includes('found by') || lower.includes('why missed')) ? `its table header is not ${ESCAPE_HEADER}` : null;
      continue;
    }
    if (first && escSection) {
      // A table under Escaped defects whose header does not start with `#`.
      escBad = `its table header does not start with \`#\` (${ESCAPE_HEADER})`;
      continue;
    }
    if (esc) {
      if (!/^\d+$/.test(c[0])) drop(`its # is not a number ("${c[0]}")`);
      else if (c.length < esc.n) drop(`it has ${c.length} cells, fewer than the header's ${esc.n}`);
      else {
        const get = (i) => (i < 0 ? '' : c[i]);
        escapes.push({
          lanes: c[esc.lane].split(/,\s*/).map((s) => s.trim()).filter(Boolean),
          defect: get(esc.defect),
          where: get(esc.where),
          foundBy: get(esc.foundBy),
          why: get(esc.why),
        });
        escRead++;
      }
      continue;
    }
    if (escBad) {
      drop(escBad);
      continue;
    }
    if (!cols || !/^\d+$/.test(c[0]) || c.length < cols.n) continue;
    const verdict = c[c.length - 1];
    rows.push({
      severity: c[cols.severity].toLowerCase().replace(/:$/, ''),
      lanes: c[cols.agent].split(/,\s*/).map((s) => s.trim()).filter(Boolean),
      verdict,
      kind: verdictOf(verdict),
      source: sourceOf(verdict),
    });
  }
  endSection();
  for (const [why, n] of dropped) warnings.push(`escaped defects: ${n} row(s) dropped: ${why}`);
  return { leads, verification, heading, tables, rows, escapes, warnings };
}

const counter = () => ({ total: 0, ...Object.fromEntries(VERDICTS.map((k) => [k, 0])), agent: 0, escaped: 0 });

// The column a row counts in: a triaged verdict from an agent goes to `agent`, so confirmed, false positive and wont
// fix (and with them precision, recall and the trigger's triaged count) hold developer verdicts only. The metrics
// capture counts through this too, so both tools give the same precision for the same logs.
export const bucket = (r) => (r.source === 'agent' && TRIAGED.includes(r.kind) ? 'agent' : r.kind);

export function aggregate(logs) {
  const byLane = {};
  const bySeverity = {};
  const odd = {};
  for (const { rows, escapes = [] } of logs) {
    for (const r of rows) {
      (bySeverity[r.severity] ??= counter()).total++;
      bySeverity[r.severity][bucket(r)]++;
      if (r.kind === 'nonCanonical') {
        const key = r.verdict.slice(0, 40);
        odd[key] = (odd[key] ?? 0) + 1;
      }
      for (const lane of r.lanes) {
        (byLane[lane] ??= counter()).total++;
        byLane[lane][bucket(r)]++;
      }
    }
    // An escaped defect is not a finding: it adds to Escaped only, never to Findings.
    for (const e of escapes) for (const lane of e.lanes) (byLane[lane] ??= counter()).escaped++;
  }
  return { byLane, bySeverity, odd };
}

export function precision(c) {
  const den = c.confirmed + c.falsePositive;
  return den >= MIN_DENOMINATOR ? c.confirmed / den : null;
}

// Recall = confirmed / (confirmed + escaped), shown only once the lane has an escape recorded and from the same number
// of such rows as precision: with no escape row, nobody has looked for misses, so 100% would claim what is unknown.
export function recall(c) {
  const den = c.confirmed + c.escaped;
  return c.escaped > 0 && den >= MIN_DENOMINATOR ? c.confirmed / den : null;
}

export function readLogs(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`calibration: no run-log folder at ${dir}`);
  const parsed = [];
  const skipped = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    let log;
    try {
      log = parseRunLog(readText(path.join(dir, f)));
    } catch (e) {
      skipped.push({ file: f, why: `unreadable: ${e.message}` });
      continue;
    }
    // A clean review has a heading and no table; a file with neither is not a run log.
    if (!log.tables && !log.heading) skipped.push({ file: f, why: 'not a run log: no "# Review Log" heading and no finding table' });
    else parsed.push({ file: f, ...log });
  }
  return { parsed, skipped };
}

// A precision or recall as a whole percent, n/a when there is none. The metrics report formats through this too.
export const pct = (p) => (p === null ? 'n/a' : `${Math.round(p * 100)}%`);

export function calibrationReport(dir, minPrecision = DEFAULT_MIN_PRECISION) {
  const { parsed, skipped } = readLogs(dir);
  const { byLane, bySeverity, odd } = aggregate(parsed);
  const rows = parsed.reduce((n, l) => n + l.rows.length, 0);
  const triaged = Object.values(bySeverity).reduce((n, c) => n + c.confirmed + c.falsePositive + c.wontFix, 0);
  const agent = Object.values(bySeverity).reduce((n, c) => n + c.agent, 0);
  const escaped = parsed.reduce((n, l) => n + l.escapes.length, 0);
  const out = ['# Calibration report', ''];
  out.push(`${parsed.length} run log(s) parsed, ${skipped.length} skipped, ${rows} finding(s). Triaged verdicts (confirmed, false-positive, wont-fix): ${triaged}. Agent verdicts: ${agent}. Escaped defects: ${escaped}.`);
  out.push(`Precision = confirmed / (confirmed + false-positive), shown from ${MIN_DENOMINATOR} such verdicts; flagged below ${pct(minPrecision)} or at ${FP_TARGET}+ false positives. Unverdicted = pending plus non-canonical verdicts.`);
  out.push(`Confirmed, false positive, wont fix, precision, recall and the triaged count hold developer verdicts only; a verdict carrying \`(agent)\` counts under Agent verdicts. Recall = confirmed / (confirmed + escaped), shown once a lane has an escape and ${MIN_DENOMINATOR} such rows; flagged at ${ESCAPE_TARGET}+ escaped defects.`, '');
  out.push('## Lanes', '');
  out.push('| Lane | Findings | Confirmed | False positive | Wont fix | Not actioned | Unverdicted | Precision | Flag | Agent verdicts | Escaped | Recall |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const lane of Object.keys(byLane).sort()) {
    const c = byLane[lane];
    const p = precision(c);
    const flags = [];
    if (p !== null && p < minPrecision) flags.push('below threshold');
    if (c.falsePositive >= FP_TARGET) flags.push(`${c.falsePositive} false positives`);
    if (c.escaped >= ESCAPE_TARGET) flags.push(`${c.escaped} escaped`);
    out.push(`| ${lane.replace(/\|/g, '\\|')} | ${c.total} | ${c.confirmed} | ${c.falsePositive} | ${c.wontFix} | ${c.notActioned} | ${c.pending + c.nonCanonical} | ${pct(p)} | ${flags.join('; ')} | ${c.agent} | ${c.escaped} | ${pct(recall(c))} |`);
  }
  out.push('', '## Severities', '');
  out.push('| Severity | Findings | Confirmed | False positive | Wont fix | Not actioned | Unverdicted | Agent verdicts |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const s of Object.keys(bySeverity).sort()) {
    const c = bySeverity[s];
    out.push(`| ${s.replace(/\|/g, '\\|')} | ${c.total} | ${c.confirmed} | ${c.falsePositive} | ${c.wontFix} | ${c.notActioned} | ${c.pending + c.nonCanonical} | ${c.agent} |`);
  }
  const oddKeys = Object.keys(odd).sort((a, b) => odd[b] - odd[a] || a.localeCompare(b));
  if (oddKeys.length) {
    out.push('', '## Non-canonical verdicts', '', 'Counted as unverdicted until normalized (review/calibration.md "Verdicts"):', '');
    for (const k of oddKeys) out.push(`- ${odd[k]} x \`${k.replace(/`/g, "'")}\``);
  }
  if (skipped.length) {
    out.push('', '## Skipped files', '');
    for (const s of skipped) out.push(`- ${s.file}: ${s.why}`);
  }
  const warned = parsed.flatMap((l) => l.warnings.map((w) => `- ${l.file}: ${w}`));
  if (warned.length) out.push('', '## Parser warnings', '', 'Lines the counts above could not use:', '', ...warned);
  return out.join('\n') + '\n';
}
