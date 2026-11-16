#!/usr/bin/env node
// Node port of board-reminder.ps1: reminds the orchestrator to update the board's session doc after a builder,
// refuter or debugger finishes. `mark` (SubagentStop) only leaves a marker, because SubagentStop output goes to the
// finishing agent; `relay` (PostToolUse, UserPromptSubmit) turns the session's markers into context on the main
// session's next dispatch, board write or prompt. It writes nothing to the board.
// Silent without ~/.claude/board.local.md. Any failure exits 0. BOARD_REMINDER_ROOT overrides ~/.claude.
// Usage: node board-reminder.mjs mark|relay  (hook JSON on stdin)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEK = 7 * 24 * 3600 * 1000;
const clean = (s) => String(s ?? '').replace(/[^\w-]/g, '');

export function run(mode, stdinText, root, now = Date.now()) {
  if (!fs.existsSync(path.join(root, 'board.local.md'))) return '';
  const dir = path.join(root, 'board-reminders');
  const any = () => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  // The relay runs on every prompt, so the common case of no markers stops here.
  if (mode === 'relay' && !any()) return '';
  const hook = JSON.parse(stdinText.replace(/^﻿/, ''));
  const session = clean(hook.session_id);
  if (!session) return '';

  if (mode === 'mark') {
    if (!['builder', 'refuter', 'debugger'].includes(String(hook.agent_type ?? ''))) return '';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session}.${clean(hook.agent_id)}`), `${hook.agent_type}\n`);
    // A session that ended before its relay ran leaves its marker behind.
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (now - fs.statSync(p).mtimeMs > WEEK) fs.rmSync(p, { force: true });
    }
    return '';
  }

  // A hook call inside a subagent carries agent_id; the reminder is for the main session.
  if (hook.agent_id) return '';
  const markers = fs.readdirSync(dir).filter((f) => f.startsWith(`${session}.`)).map((f) => path.join(dir, f));
  if (!markers.length) return '';
  const names = [...new Set(markers.map((p) => fs.readFileSync(p, 'utf8').trim()).filter(Boolean))].sort();
  for (const p of markers) fs.rmSync(p, { force: true });
  // A marker killed mid-write is empty: it is cleared without naming an agent.
  const agents = names.length ? names.join(', ') : 'An agent';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: String(hook.hook_event_name ?? ''),
      additionalContext: `Board: ${agents} finished. Update this session's now and events, set the card's tokens from the completion notice, and confirm the agent's stage moved.`,
    },
  });
}

// Real paths on both sides, so the hook still runs when it is started through a junction or symlink.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  try {
    const mode = process.argv[2] ?? 'relay';
    if (!['mark', 'relay'].includes(mode)) throw new Error(`unknown mode ${mode}; use mark or relay`);
    const root = process.env.BOARD_REMINDER_ROOT || path.join(os.homedir(), '.claude');
    let input = '';
    try {
      input = fs.readFileSync(0, 'utf8');
    } catch {
      input = '';
    }
    const out = run(mode, input, root);
    if (out) process.stdout.write(`${out}\n`);
  } catch (e) {
    process.stderr.write(`board-reminder: ${e.message}\n`);
  }
  process.exitCode = 0;
}
