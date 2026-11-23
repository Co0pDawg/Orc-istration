// Sprint theme picker. Include it once per page, after theme.css:
//   <script type="module" src="/src/theme/theme-picker.js"></script>
// It applies the saved look on load, and opens a picker when someone types "theme" outside a form
// field or presses the .ui-brand button five times. ?theme=<name> applies a look for one page load.
// Modules run after the first paint, so pages also put the README's small head script in <head>.
// The pure logic is exported so it can be tested without a browser; the DOM wiring runs only when
// a document exists.

export const LOOKS = [
  { id: "clean-pro", name: "Clean Pro", note: "Neutral greys and emerald; follows light or dark mode" },
  { id: "neon", name: "Neon", note: "Dark navy, violet-to-cyan glow, glassy cards" },
  { id: "editorial", name: "Editorial", note: "Cream paper, deep ink, serif headings" },
  { id: "playful", name: "Playful", note: "Chunky outlines, hard shadows, bright colour" },
];
const DEFAULT_LOOK = "clean-pro";
const STORAGE_KEY = "sprint-theme";
const KEY_SEQUENCE = "theme";
export const BRAND_PRESSES = 5;
export const BRAND_WINDOW_MS = 3000;
const TITLE_ID = "ui-theme-picker-title";
const EDITABLE = "input, select, textarea, [contenteditable]:not([contenteditable='false'])";
const HINT_SAVED = "Your choice is saved in this browser. Esc closes.";
const HINT_UNSAVED = "This browser blocked saving, so the look applies to this page only. Esc closes.";

export function isLook(id) {
  return LOOKS.some((look) => look.id === id);
}

// The typed-sequence reducer: the letters typed so far, and whether this key completes "theme".
// ignore is true when focus is in a form field or the picker is already open.
export function nextTyped(typed, event, ignore) {
  if (event.key === "Shift") return { typed, open: false };
  if (ignore || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return { typed: "", open: false };
  const key = event.key.toLowerCase();
  const next = key.length === 1 && key >= "a" && key <= "z" ? (typed + key).slice(-KEY_SEQUENCE.length) : "";
  return next === KEY_SEQUENCE ? { typed: "", open: true } : { typed: next, open: false };
}

// The brand press window: presses within BRAND_WINDOW_MS of now, and whether this one opens the picker.
export function nextPresses(presses, now) {
  const kept = [...presses.filter((at) => now - at < BRAND_WINDOW_MS), now];
  return kept.length >= BRAND_PRESSES ? { presses: [], open: true } : { presses: kept, open: false };
}

// A valid ?theme= wins, then a valid stored look. With neither, the host page's data-theme stays.
export function initialLook(requested, stored, host) {
  return [requested, stored].find(isLook) ?? host;
}

// The event's real target: composedPath()[0] sees into an open shadow root, where target is the host.
export function eventPath(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.length > 0 ? path : [event.target];
}

export function isEditable(path) {
  const node = path[0];
  if (node === null || typeof node !== "object" || typeof node.closest !== "function") return false;
  if (node.isContentEditable === true) return true;
  return node.closest(EDITABLE) !== null;
}

function readStoredLook() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Returns false when storage is blocked or full; the look still applies to this page.
function storeLook(id) {
  try {
    if (id === DEFAULT_LOOK) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

function applyLook(id) {
  if (id === DEFAULT_LOOK) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

function currentLook() {
  const id = document.documentElement.dataset.theme;
  return isLook(id) ? id : DEFAULT_LOOK;
}

let dialog = null;
let returnFocus = null;
let typed = "";
let presses = [];

function buildDialog() {
  const el = document.createElement("dialog");
  el.className = "ui-dialog";
  el.setAttribute("aria-labelledby", TITLE_ID);

  const form = document.createElement("form");
  form.method = "dialog";

  const title = document.createElement("h2");
  title.id = TITLE_ID;
  title.className = "ui-heading";
  title.textContent = "Choose a look";

  const hint = document.createElement("p");
  hint.className = "ui-hint";
  hint.textContent = HINT_SAVED;

  const group = document.createElement("fieldset");
  group.className = "ui-radio-group";
  group.setAttribute("aria-labelledby", TITLE_ID);
  for (const look of LOOKS) {
    const label = document.createElement("label");
    label.className = "ui-radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "ui-theme-look";
    input.value = look.id;
    const text = document.createElement("span");
    text.textContent = look.name;
    const note = document.createElement("small");
    note.textContent = look.note;
    text.append(note);
    label.append(input, text);
    group.append(label);
  }
  group.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    applyLook(event.target.value);
    hint.textContent = storeLook(event.target.value) ? HINT_SAVED : HINT_UNSAVED;
  });

  const done = document.createElement("button");
  done.className = "ui-button";
  done.value = "done";
  done.textContent = "Done";

  form.append(title, group, hint, done);
  el.append(form);
  el.addEventListener("close", () => {
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });
  return el;
}

function openPicker() {
  if (dialog?.open) return;
  if (!dialog?.isConnected) {
    dialog = buildDialog();
    document.body.append(dialog);
  }
  const look = currentLook();
  let checked = null;
  for (const input of dialog.querySelectorAll("input[type='radio']")) {
    input.checked = input.value === look;
    if (input.checked) checked = input;
  }
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.showModal();
  checked?.focus();
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    const ignore = Boolean(dialog?.open) || isEditable(eventPath(event));
    const result = nextTyped(typed, event, ignore);
    typed = result.typed;
    if (result.open) openPicker();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || event.target.closest(".ui-brand") === null) return;
    const result = nextPresses(presses, Date.now());
    presses = result.presses;
    if (result.open) openPicker();
  });

  const host = document.documentElement.getAttribute("data-theme");
  const initial = initialLook(new URLSearchParams(window.location.search).get("theme"), readStoredLook(), host);
  if (initial !== host) applyLook(initial);
}
