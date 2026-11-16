// Install manifest: <home>/<tool root>/.orc-manifest.<tool>.json records the sha256 of every file install wrote,
// so a re-install can tell "untouched since install" from "edited by hand" and uninstall deletes only its own files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function manifestFile(home, adapter) {
  return path.join(home, ...adapter.home.root.split('/'), `.orc-manifest.${adapter.id}.json`);
}

// A manifest path must be a plain home-relative path under the tool's root: no `..`, `.`, empty segments,
// absolute paths, drive letters, backslashes or NUL. Checked before anything touches the file system.
export function safeRel(home, rel, root) {
  if (typeof rel !== 'string' || !rel || /[\\\0:]/.test(rel) || rel.startsWith('/')) return null;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  if (!rel.startsWith(`${root}/`) && rel !== root) return null;
  const abs = path.resolve(home, ...parts);
  const rootAbs = path.resolve(home, ...root.split('/'));
  return abs.startsWith(rootAbs + path.sep) || abs === rootAbs ? abs : null;
}

// Returns {manifest: null} when absent, {manifest} when valid, {error} when corrupt or foreign.
export function loadManifest(home, adapter) {
  const file = manifestFile(home, adapter);
  if (!fs.existsSync(file)) return { manifest: null, file };
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `${file}: not valid JSON (${e.message})`, file };
  }
  const bad = (why) => ({ error: `${file}: ${why}; nothing deleted`, file });
  if (!m || typeof m !== 'object' || m.version !== 1) return bad('not a version 1 orc manifest');
  if (m.tool !== adapter.id) return bad(`belongs to tool ${JSON.stringify(m.tool)}, not ${adapter.id}`);
  if (!m.files || typeof m.files !== 'object' || Array.isArray(m.files)) return bad('no files map');
  const root = adapter.home.root;
  for (const [rel, v] of Object.entries(m.files)) {
    if (!safeRel(home, rel, root)) return bad(`path ${JSON.stringify(rel)} is outside ${root}`);
    if (!v || !/^[0-9a-f]{64}$/.test(v.sha256)) return bad(`bad sha256 for ${rel}`);
  }
  const dirs = m.dirs ?? [];
  if (!Array.isArray(dirs) || dirs.some((d) => !safeRel(home, d, root))) return bad('bad dirs list');
  return { manifest: { ...m, dirs }, file };
}

export function writeManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export const diskHash = (abs) => sha256(fs.readFileSync(abs));
