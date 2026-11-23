// skills/sprint/theme/theme-picker.js: the pure logic behind the triggers, imported without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOKS, BRAND_PRESSES, BRAND_WINDOW_MS, isLook, nextTyped, nextPresses, initialLook, eventPath, isEditable,
} from '../skills/sprint/theme/theme-picker.js';

// A tiny element stub. closest() understands only the selector parts the picker uses, and throws on any
// other part, so a change to the picker's selector shows up here.
function node(tag, attrs = {}, parent = null, extra = {}) {
  const n = { tagName: tag.toUpperCase(), attrs, parent, ...extra };
  const matches = (el, part) => {
    if (/^[a-z]+$/.test(part)) return el.tagName === part.toUpperCase();
    if (part === "[contenteditable]:not([contenteditable='false'])") {
      return Object.hasOwn(el.attrs, 'contenteditable') && el.attrs.contenteditable !== 'false';
    }
    throw new Error(`unsupported selector part: ${part}`);
  };
  n.closest = (selector) => {
    const parts = selector.split(',').map((p) => p.trim());
    for (let el = n; el; el = el.parent) if (parts.some((p) => matches(el, p))) return el;
    return null;
  };
  return n;
}

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods });

function typeAll(text, { mods = {}, ignore = false, start = '' } = {}) {
  let typed = start;
  const opened = [];
  for (const k of text) {
    const r = nextTyped(typed, key(k, mods), ignore);
    typed = r.typed;
    opened.push(r.open);
  }
  return { typed, opened };
}

test('theme picker: typing "theme" opens on the last letter, in either case, with Shift ignored', () => {
  assert.deepStrictEqual(typeAll('theme').opened, [false, false, false, false, true]);
  assert.strictEqual(typeAll('theme').typed, '');
  assert.deepStrictEqual(typeAll('THEME').opened.at(-1), true);
  let typed = '';
  for (const k of ['t', 'Shift', 'h', 'e', 'Shift', 'm', 'e']) {
    const r = nextTyped(typed, key(k), false);
    typed = r.typed;
    if (k === 'Shift') assert.strictEqual(r.open, false);
  }
  assert.strictEqual(typed, '', 'the sequence completed through the Shift presses');
});

test('theme picker: the sequence keeps only the last letters and resets on other keys', () => {
  assert.strictEqual(typeAll('xxtheme').opened.at(-1), true);
  assert.strictEqual(typeAll('thXeme').opened.at(-1), false);
  assert.strictEqual(typeAll('th1eme').opened.at(-1), false);
  assert.strictEqual(nextTyped('them', key('Enter'), false).typed, '');
  assert.strictEqual(typeAll('them').typed, 'them');
});

test('theme picker: keys with Ctrl, Alt or Meta, or while composing, reset the sequence', () => {
  for (const mods of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    const r = nextTyped('them', key('e', mods), false);
    assert.deepStrictEqual(r, { typed: '', open: false }, JSON.stringify(mods));
  }
});

test('theme picker: an ignored key (form field or open picker) resets the sequence', () => {
  assert.deepStrictEqual(nextTyped('them', key('e'), true), { typed: '', open: false });
  assert.deepStrictEqual(typeAll('theme', { ignore: true }).opened, [false, false, false, false, false]);
});

test('theme picker: input, select, textarea and contenteditable targets are editable; others are not', () => {
  const body = node('body');
  for (const tag of ['input', 'select', 'textarea']) assert.strictEqual(isEditable([node(tag, {}, body)]), true, tag);
  const editor = node('div', { contenteditable: '' }, body);
  assert.strictEqual(isEditable([node('span', {}, editor)]), true, 'inside a contenteditable');
  assert.strictEqual(isEditable([node('div', { contenteditable: 'false' }, body)]), false, 'contenteditable=false');
  assert.strictEqual(isEditable([node('p', {}, body, { isContentEditable: true })]), true, 'isContentEditable');
  assert.strictEqual(isEditable([node('button', {}, body)]), false);
  assert.strictEqual(isEditable([body]), false);
  assert.strictEqual(isEditable([{}]), false, 'a target without closest (document or window)');
  assert.strictEqual(isEditable([null]), false);
});

test('theme picker: an input inside a shadow root is editable through composedPath, not the retargeted target', () => {
  const host = node('custom-field', {}, node('body'));
  const shadowInput = node('input', {}, null);
  const event = { ...key('t'), target: host, composedPath: () => [shadowInput, host] };
  assert.strictEqual(isEditable([event.target]), false, 'the retargeted host alone is not editable');
  assert.strictEqual(eventPath(event)[0], shadowInput);
  assert.strictEqual(isEditable(eventPath(event)), true);
  // Without composedPath (or with an empty path) the target is used.
  const input = node('input', {}, null);
  assert.strictEqual(eventPath({ target: input })[0], input);
  assert.strictEqual(eventPath({ target: input, composedPath: () => [] })[0], input);
});

test('theme picker: five brand presses within 3 s open it; a press outside the window does not count', () => {
  assert.strictEqual(BRAND_PRESSES, 5);
  assert.strictEqual(BRAND_WINDOW_MS, 3000);
  const pressAll = (times) => {
    let presses = [];
    const opened = [];
    for (const t of times) {
      const r = nextPresses(presses, t);
      presses = r.presses;
      opened.push(r.open);
    }
    return { presses, opened };
  };
  assert.deepStrictEqual(pressAll([0, 500, 1000, 1500, 2999]).opened, [false, false, false, false, true]);
  assert.deepStrictEqual(pressAll([0, 500, 1000, 1500, 2999]).presses, [], 'the window resets after opening');
  // The first press is 3000 ms before the fifth: outside the window, so only four count.
  const late = pressAll([0, 1000, 2000, 2500, 3000]);
  assert.deepStrictEqual(late.opened, [false, false, false, false, false]);
  assert.deepStrictEqual(late.presses, [1000, 2000, 2500, 3000]);
});

test('theme picker: the initial look is ?theme, then the stored look, then the host attribute', () => {
  assert.strictEqual(initialLook('neon', 'editorial', 'playful'), 'neon');
  assert.strictEqual(initialLook('clean-pro', 'editorial', null), 'clean-pro');
  assert.strictEqual(initialLook('bogus', 'editorial', null), 'editorial');
  assert.strictEqual(initialLook(null, 'editorial', 'playful'), 'editorial');
  assert.strictEqual(initialLook(null, 'evil', 'dark'), 'dark', 'an unknown stored look leaves the host attribute');
  assert.strictEqual(initialLook('bogus', null, 'dark'), 'dark');
  assert.strictEqual(initialLook(null, null, null), null);
});

test('theme picker: isLook accepts the four looks only', () => {
  assert.deepStrictEqual(LOOKS.map((l) => l.id), ['clean-pro', 'neon', 'editorial', 'playful']);
  for (const bad of [null, undefined, '', 'dark', 'Neon', 'toString']) assert.strictEqual(isLook(bad), false, String(bad));
});
