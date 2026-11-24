import fs from 'node:fs';

// The settings the app understands, with their defaults. Keys it does not know are dropped.
export function normalizeSettings(raw) {
  return {
    theme: raw.theme ?? 'light',
    fontSize: raw.fontSize ?? 12,
    features: { ...(raw.features ?? {}) },
  };
}

// What the app reads at start-up.
export function loadSettings(file) {
  return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Writes a settings object as two-space indented JSON with a trailing newline.
export function writeSettings(file, settings) {
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
