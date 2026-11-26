// Shared test helpers (not a test file: node --test runs tests/*.test.mjs only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The quoting rule formatCommand (tools/lib/dispatch.mjs) applies to each word of a dry-run `command:` line, written
// out again here so a change to that rule shows up as a failing assertion.
export const q = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a));

// A RegExp source matching `text` literally.
export const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Call at the top of a test file that runs orc commands in-process: HOME and USERPROFILE point at a scratch folder for
// the whole file, so a command that defaults --home to the user's home (install, uninstall, sync, status, doctor) can
// never reach the real one. Child processes inherit it. Returns the scratch folder.
export function isolateHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orc-test-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
