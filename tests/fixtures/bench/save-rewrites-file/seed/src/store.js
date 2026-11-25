import fs from 'node:fs';

// The one save path for a profile file: it keeps the previous file as <file>.bak, drops null fields and sorts the
// keys, so every profile the app writes has the same shape.
export function saveProfile(file, profile) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  const entries = Object.entries(profile).filter(([, v]) => v !== null);
  entries.sort(([a], [b]) => a.localeCompare(b));
  fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
}

export function loadProfile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
