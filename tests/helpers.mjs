// Shared test helpers (not a test file: node --test runs tests/*.test.mjs only).

// The quoting rule formatCommand (tools/lib/dispatch.mjs) applies to each word of a dry-run `command:` line, written
// out again here so a change to that rule shows up as a failing assertion.
export const q = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : JSON.stringify(a));

// A RegExp source matching `text` literally.
export const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
