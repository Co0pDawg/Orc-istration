// skills/sprint/theme: the token layer stays consistent across looks, and the theme stays offline and safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THEME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'sprint', 'theme');
const read = (name) => fs.readFileSync(path.join(THEME, name), 'utf8');
const css = read('theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const picker = read('theme-picker.js');
const readme = read('README.md');

const tokensIn = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `block ${selector} exists`);
  return new Set([...m[1].matchAll(/(--ui-[\w-]+)\s*:/g)].map((d) => d[1]));
};

const root = tokensIn(':root');
const looks = [...picker.matchAll(/\{\s*id:\s*"([\w-]+)"/g)].map((m) => m[1]);
const alternates = looks.filter((id) => id !== 'clean-pro');

// Colours are defined by every look. Effects, shape, type, spacing and motion inherit from Clean Pro by design.
const COLOUR = /^--ui-(bg|surface|surface-2|text|text-muted|border|border-strong|accent|accent-hover|accent-contrast|accent-text|accent-soft|ok|ok-bg|warn|warn-bg|danger|danger-bg|info|info-bg|focus)$/;
const colours = [...root].filter((t) => COLOUR.test(t));
// Clean Pro dark keeps the light accent fill, which passes with white text in both modes.
const DARK_INHERITS = new Set(['--ui-accent', '--ui-accent-hover', '--ui-accent-contrast']);

test('sprint theme: the picker offers Clean Pro and three alternates', () => {
  assert.deepEqual(looks, ['clean-pro', 'neon', 'editorial', 'playful']);
  assert.equal(colours.length, 21);
});

test('sprint theme: every alternate defines every colour token, and only tokens Clean Pro defines', () => {
  for (const id of alternates) {
    const own = tokensIn(`:root[data-theme="${id}"]`);
    assert.deepEqual(colours.filter((t) => !own.has(t)), [], `${id} is missing colour tokens`);
    assert.deepEqual([...own].filter((t) => !root.has(t)), [], `${id} defines tokens Clean Pro lacks`);
  }
});

test('sprint theme: Clean Pro dark defines every colour token except the shared accent fill', () => {
  const dark = tokensIn(':root:not([data-theme])');
  assert.deepEqual(colours.filter((t) => !dark.has(t) && !DARK_INHERITS.has(t)), []);
  assert.deepEqual([...dark].filter((t) => !root.has(t)), []);
});

test('sprint theme: every var(--ui-*) used is defined', () => {
  const defined = new Set([...css.matchAll(/(--ui-[\w-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--ui-[\w-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((t) => !defined.has(t)), []);
});

test('sprint theme: nothing loads from the network', () => {
  for (const [name, text] of [['theme.css', read('theme.css')], ['theme-picker.js', picker]]) {
    assert.doesNotMatch(text, /https?:\/\/|@import/, name);
  }
});

test('sprint theme: the picker never writes HTML strings', () => {
  assert.doesNotMatch(picker, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('sprint theme: the README names every look the picker offers', () => {
  for (const id of looks) assert.match(readme, new RegExp(`\`${id}\``), id);
});
