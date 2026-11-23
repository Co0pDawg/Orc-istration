#!/usr/bin/env node
// Writes the sprint story page: the story template with its "sprint-events" JSON block filled from
// sprint-events.json and a meta file (orchestration/sprint.md, polish ladder rung 6).
// Usage: node make-story.mjs --events sprint-events.json --meta story-meta.json [--template <path>] --out docs/story.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node make-story.mjs --events <sprint-events.json> --meta <story-meta.json> [--template <path>] --out <docs/story.html>';
const BLOCK = /(<script type="application\/json" id="sprint-events">)[\s\S]*?(<\/script>)/g;
const BACKSLASH = String.fromCharCode(92);

function fail(message) {
  process.stderr.write(`make-story: ${message}\n${USAGE}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const known = new Set(['--events', '--meta', '--template', '--out']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!known.has(flag)) fail(`unknown argument "${flag}"`);
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`);
    args[flag.slice(2)] = value;
  }
  for (const name of ['events', 'meta', 'out']) {
    if (!args[name]) fail(`--${name} is required`);
  }
  return args;
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read the ${label} file ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    fail(`the ${label} file ${file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return undefined;
}

// JSON that is safe inside a <script> element: no "<" (so no "</script>" or "<!--"), and no
// U+2028 or U+2029. JSON.parse reads the escapes back as the same characters.
export function inlineJson(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, `${BACKSLASH}u003c`)
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), `${BACKSLASH}u2028`)
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), `${BACKSLASH}u2029`);
}

function main(argv) {
  const args = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = args.template || path.join(here, 'story-template.html');

  const events = readJson(args.events, 'events');
  if (!Array.isArray(events)) fail(`the events file ${args.events} must hold a JSON array`);
  if (!events.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e))) {
    fail(`every entry in ${args.events} must be a JSON object`);
  }
  const meta = readJson(args.meta, 'meta');
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    fail(`the meta file ${args.meta} must hold a JSON object`);
  }

  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (e) {
    fail(`cannot read the template ${templatePath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const blocks = template.match(BLOCK) || [];
  if (blocks.length !== 1) {
    fail(`the template ${templatePath} must have exactly one sprint-events block; found ${blocks.length}`);
  }

  const payload = inlineJson({ meta, events });
  const page = template.replace(BLOCK, (_, open, close) => `${open}\n${payload}\n${close}`);
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, page);
  process.stdout.write(`make-story: wrote ${args.out} (${events.length} events)\n`);
}

// Real paths on both sides, as the other tools do, so a run through a junction or symlink still runs.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2));
}
