// Cost-log draft from board data, in the shape of orchestration/README.md "Record format". Read-only: it never
// writes to the board. What the board does not hold is a TODO marker, never a guess.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DISPATCH = /^(\S+) dispatched on #(\S+)/;

export function readBoardExport({ file, board, boardRepo }) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const cli = path.join(boardRepo, 'local', 'board.js');
  if (!fs.existsSync(cli)) throw new Error(`no board CLI at ${cli}`);
  const port = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(board)?.[1];
  if (!port) throw new Error(`--board must be http://localhost:<port>, got ${board}`);
  const r = spawnSync(process.execPath, [cli, 'export'], { encoding: 'utf8', shell: false, env: { ...process.env, ORC_BOARD_PORT: port } });
  if (r.status !== 0) throw new Error(`board export failed: ${(r.stderr || r.error?.message || '').trim()}`);
  return JSON.parse(r.stdout);
}

const minutes = (a, b) => {
  const d = (Date.parse(b) - Date.parse(a)) / 60000;
  return Number.isFinite(d) ? Math.round(d) : null;
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// Rows: one per dispatch event; the span ends at the next top-level event naming the same card.
// Events that are not objects with a text are skipped and counted, never a crash.
export function usableEvents(session) {
  const raw = Array.isArray(session.events) ? session.events : session.events == null ? [] : [session.events];
  const events = raw.filter((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof e.text === 'string');
  return { events, skipped: raw.length - events.length };
}

export function dispatchRows(session) {
  const { events } = usableEvents(session);
  const rows = [];
  events.forEach((e, i) => {
    const m = DISPATCH.exec(e.text);
    if (!m) return;
    const end = e.card ? events.slice(i + 1).find((x) => x.card === e.card) : undefined;
    const span = end ? minutes(e.at, end.at) : null;
    // An end event without usable times still ends the span: its text is the Result, the time is a TODO.
    const time = !end ? 'TODO (no end event)' : span === null ? 'TODO (no time on the start or end event)' : span;
    rows.push({ agent: m[1], task: m[2], card: e.card ?? null, start: e.at, end: end?.at ?? null, minutes: span, time, result: end?.text ?? null });
  });
  return rows;
}

export function costlog(data, sessionId) {
  const session = data.sessions?.[sessionId];
  if (!session) throw new Error(`no session ${sessionId} in the board data`);
  const cards = Object.entries(data.cards ?? {}).filter(([, c]) => c?.session === sessionId).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
  const cardOf = Object.fromEntries(cards);
  const rows = dispatchRows(session);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(sessionId)?.[0] ?? session.started?.slice(0, 10) ?? 'TODO';
  const out = [];
  out.push(`# Cost log draft: ${sessionId}`, '');
  out.push(`- Date: ${date}`);
  out.push('- Project: TODO');
  out.push(`- Branch: ${session.branch || 'TODO'}`);
  out.push(`- Task: ${[session.ticket, session.title].filter(Boolean).join(' ') || 'TODO'}`);
  out.push(`- Outcome: TODO (board status: ${session.status ?? 'unset'}${session.completed ? `, completed ${session.completed}` : ''})`, '');
  out.push('Tokens are recorded per card, not per dispatch, so the Tokens column points at the per-card summary instead of splitting them.', '');
  out.push('| # | Agent | Model | Purpose | Card | Start | Tokens | Tools | Time | Result | Value |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r, i) => {
    const purpose = r.card && cardOf[r.card]?.title ? cardOf[r.card].title : `#${r.task}`;
    out.push(`| ${i + 1} | ${cell(r.agent)} | TODO | ${cell(purpose)} | ${cell(r.card ?? '-')} | ${cell(r.start ?? 'TODO')} | see card | TODO | ${r.time} | ${cell(r.result ?? 'TODO (no end event)')} | TODO |`);
  });
  out.push('', '## Per card', '');
  out.push('| Card | Title | Agent | Dispatches | Tokens | Commit | Stages |');
  out.push('|---|---|---|---|---|---|---|');
  let tokenSum = 0;
  let tokensKnown = cards.length > 0;
  for (const [id, c] of cards) {
    const n = rows.filter((r) => r.card === id).length;
    const stages = Array.isArray(c.stages) ? c.stages.map((s) => `${s.label}: ${s.state}`).join(', ') : '';
    if (typeof c.tokens === 'number') tokenSum += c.tokens;
    else tokensKnown = false;
    out.push(`| ${cell(id)} | ${cell(c.title)} | ${cell(c.agent ?? '')} | ${n} | ${c.tokens ?? 'TODO'} | ${cell(c.commit ?? '')} | ${cell(stages)} |`);
  }
  const mins = rows.reduce((s, r) => s + (r.minutes ?? 0), 0);
  const open = rows.filter((r) => r.result === null).length;
  const { events, skipped } = usableEvents(session);
  const reworks = events.filter((e) => /\brework\b/i.test(e.text)).length;
  out.push('', '## Totals', '');
  out.push(`- Tokens: ${tokensKnown ? tokenSum : 'TODO'} (sum of card tokens${tokensKnown ? '' : '; a card has no numeric tokens'})`);
  out.push(`- Wall clock: ${mins} min across ${rows.length} dispatch(es)${open ? `; ${open} without an end event (TODO)` : ''}`);
  out.push('- Orchestrator context: TODO k → TODO k');
  out.push('- Model per dispatch, Tools, Value: TODO', '');
  if (skipped) out.push(`TODO: ${skipped} board event(s) skipped (not an object with a text)`, '');
  out.push(`## Loop signal`, '', `TODO (board events mentioning rework: ${reworks})`, '');
  out.push('## Spec misses', '', 'TODO', '');
  return out.join('\n');
}
