#!/usr/bin/env node
// Writes the sprint story page: the story template with its "sprint-events" JSON block filled from
// sprint-events.json and a meta file (orchestration/sprint.md, polish ladder rung 6).
// Usage: node make-story.mjs --events sprint-events.json --meta story-meta.json [--template <path>] --out docs/story.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node make-story.mjs --events <sprint-events.json> --meta <story-meta.json> [--template <path>] --out <docs/story.html>';
const BLOCK = /(<script type="application\/json" id="sprint-events">)[\s\S]*?(<\/script>)/g;
const KINDS = ['requirement', 'decision', 'build', 'review', 'correction', 'milestone'];
const AC_STATUSES = ['met', 'not met'];
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

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
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v));
const isCount = (v) => Number.isInteger(v) && v >= 0;
const ISO_RULE = 'must be an ISO time with an offset (Z, +HH:MM or -HH:MM)';

// The first violation in the events, or null. Corrections missing caughtBy, fix or guard become warnings.
function checkEvents(events, warnings) {
  if (!Array.isArray(events)) return 'must hold a JSON array';
  for (const [i, e] of events.entries()) {
    const at = `events[${i}]`;
    if (!isObject(e)) return `${at} must be a JSON object`;
    if (!isIso(e.at)) return `${at}.at ${ISO_RULE}`;
    if (!KINDS.includes(e.kind)) return `${at}.kind must be one of ${KINDS.join(', ')}`;
    if (typeof e.title !== 'string' || e.title.trim() === '') return `${at}.title must be a non-empty string`;
    if (e.late !== undefined && typeof e.late !== 'boolean') return `${at}.late must be true or false`;
    if (e.kind === 'correction') {
      const missing = ['caughtBy', 'fix', 'guard'].filter((k) => typeof e[k] !== 'string' || e[k].trim() === '');
      if (missing.length) warnings.push(`${at} (correction) has no ${missing.join(', ')}`);
    }
  }
  return null;
}

// The first violation in the meta, or null.
function checkMeta(meta) {
  if (!isObject(meta)) return 'must hold a JSON object';
  for (const key of ['start', 'deadline', 'coreComplete']) {
    if (meta[key] !== undefined && !isIso(meta[key])) return `meta.${key} ${ISO_RULE}`;
  }
  if (meta.acs !== undefined) {
    if (!Array.isArray(meta.acs)) return 'meta.acs must be an array';
    for (const [i, ac] of meta.acs.entries()) {
      const at = `meta.acs[${i}]`;
      if (!isObject(ac)) return `${at} must be an object with id, text and status`;
      if (typeof ac.id !== 'string' || ac.id.trim() === '') return `${at}.id must be a non-empty string`;
      if (typeof ac.text !== 'string') return `${at}.text must be a string`;
      if (!AC_STATUSES.includes(ac.status)) return `${at}.status must be "met" or "not met"`;
    }
  }
  if (meta.tests !== undefined) {
    if (!isObject(meta.tests)) return 'meta.tests must be an object with passed and total';
    for (const key of ['passed', 'total']) {
      if (!isCount(meta.tests[key])) return `meta.tests.${key} must be a non-negative integer`;
    }
  }
  if (meta.hidden !== undefined) {
    if (!isObject(meta.hidden)) return 'meta.hidden must be an object with found and total';
    for (const key of ['found', 'total']) {
      if (!isCount(meta.hidden[key])) return `meta.hidden.${key} must be a non-negative integer`;
    }
    if (meta.hidden.found > meta.hidden.total) return 'meta.hidden.found must not exceed meta.hidden.total';
  }
  return null;
}

// JSON that is safe inside a <script> element: no "<" (so no "</script>" or "<!--"), and no
// U+2028 or U+2029. JSON.parse reads the escapes back as the same characters.
function inlineJson(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function main(argv) {
  const args = parseArgs(argv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = args.template || path.join(here, 'story-template.html');

  const events = readJson(args.events, 'events');
  const warnings = [];
  const eventError = checkEvents(events, warnings);
  if (eventError) fail(`the events file ${args.events}: ${eventError}`);
  const meta = readJson(args.meta, 'meta');
  const metaError = checkMeta(meta);
  if (metaError) fail(`the meta file ${args.meta}: ${metaError}`);
  for (const w of warnings) process.stderr.write(`make-story: warning: ${w}\n`);

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
  try {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, page);
  } catch (e) {
    fail(`cannot write ${args.out}: ${e instanceof Error ? e.message : String(e)}`);
  }
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
