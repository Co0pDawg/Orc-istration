// orchestration/sprint/theme: the token layer stays consistent across looks, and the theme stays offline and safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THEME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'orchestration', 'sprint', 'theme');
const read = (name) => fs.readFileSync(path.join(THEME, name), 'utf8');
const css = read('theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const picker = read('theme-picker.js');
const readme = read('README.md');

// The block for a selector, alone or first in a selector list: its full selector text and its body.
const blockOf = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(${escaped}\\s*(?:,[^{]*)?)\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `block ${selector} exists`);
  return { selectors: m[1], body: m[2] };
};
const tokensIn = (selector) => new Set([...blockOf(selector).body.matchAll(/(--ui-[\w-]+)\s*:/g)].map((d) => d[1]));
const valuesIn = (selector) =>
  Object.fromEntries([...blockOf(selector).body.matchAll(/(--ui-[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));

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
  assert.match(blockOf(':root:not([data-theme])').selectors, /:root\[data-theme="clean-pro"\]/, 'an explicit clean-pro gets dark mode too');
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

test('sprint theme: the README head script lists exactly the picker alternates', () => {
  const m = /const looks = \[([^\]]*)\];/.exec(readme);
  assert.ok(m, 'the head script declares its looks');
  assert.deepStrictEqual([...m[1].matchAll(/"([\w-]+)"/g)].map((d) => d[1]), alternates);
});

test('sprint theme: reduced motion zeroes the duration token and shortens every animation and transition', () => {
  const m = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(m, 'a prefers-reduced-motion block exists');
  assert.match(m[1], /--ui-duration:\s*0ms/);
  assert.match(m[1], /animation-duration:\s*0\.01ms !important/);
  assert.match(m[1], /transition-duration:\s*0\.01ms !important/);
});

// WCAG 2 contrast from the token values, in pure JS. Translucent colours are composited over --ui-bg.
const parseColour = (value) => {
  let m = /^#([0-9a-f]{6})$/i.exec(value);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`cannot parse colour ${value}`);
};
const resolve = (tokens, name) => {
  const v = tokens[name];
  const ref = /^var\((--ui-[\w-]+)\)$/.exec(v ?? '');
  return ref ? resolve(tokens, ref[1]) : v;
};
const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
const luminance = ([r, g, b]) => {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (tokens, fg, bg) => {
  const page = parseColour(resolve(tokens, '--ui-bg'));
  const back = over(parseColour(resolve(tokens, bg)), page);
  const front = over(parseColour(resolve(tokens, fg)), back);
  const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

test('sprint theme: every look meets WCAG AA for its text, accent, focus and timeline badge pairs', () => {
  const light = valuesIn(':root');
  const tokenSets = {
    'clean-pro light': light,
    'clean-pro dark': { ...light, ...valuesIn(':root:not([data-theme])') },
    ...Object.fromEntries(alternates.map((id) => [id, { ...light, ...valuesIn(`:root[data-theme="${id}"]`) }])),
  };
  assert.strictEqual(Object.keys(tokenSets).length, 5);
  const TEXT = [
    ['--ui-text', '--ui-bg'], ['--ui-text', '--ui-surface'], ['--ui-text-muted', '--ui-surface'],
    ['--ui-accent-contrast', '--ui-accent'],
    // Timeline badges: requirement, decision, review, build, milestone, correction.
    ['--ui-info', '--ui-info-bg'], ['--ui-accent-text', '--ui-accent-soft'], ['--ui-warn', '--ui-warn-bg'],
    ['--ui-ok', '--ui-ok-bg'], ['--ui-text', '--ui-surface'], ['--ui-danger', '--ui-surface'],
  ];
  const NON_TEXT = [
    ['--ui-focus', '--ui-bg'],
    // Badge outlines (currentColor) against the timeline item's surface.
    ['--ui-ok', '--ui-surface'], ['--ui-accent-text', '--ui-surface'], ['--ui-text', '--ui-surface'],
    // The milestone marker sits outside the item, on the page background.
    ['--ui-accent-text', '--ui-bg'],
  ];
  const failures = [];
  for (const [look, tokens] of Object.entries(tokenSets)) {
    for (const [pairs, min] of [[TEXT, 4.5], [NON_TEXT, 3]]) {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(tokens, fg, bg);
        if (ratio < min) failures.push(`${look}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  }
  assert.deepStrictEqual(failures, []);
});

test('sprint theme: the contrast function matches known WCAG values', () => {
  const t = { '--ui-bg': '#ffffff', '--ui-a': '#000000', '--ui-b': '#ffffff', '--ui-c': '#777777', '--ui-d': 'rgb(0 0 0 / 0.5)' };
  assert.strictEqual(contrast(t, '--ui-a', '--ui-b').toFixed(1), '21.0');
  assert.strictEqual(contrast(t, '--ui-c', '--ui-b').toFixed(2), '4.48');
  assert.strictEqual(contrast(t, '--ui-b', '--ui-b').toFixed(1), '1.0');
  assert.ok(contrast(t, '--ui-d', '--ui-b') > 3 && contrast(t, '--ui-d', '--ui-b') < 4.5, 'half-black over white composites');
});
