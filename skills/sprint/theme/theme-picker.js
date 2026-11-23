// Sprint theme picker. Include it once per page, after theme.css:
//   <script type="module" src="/src/theme/theme-picker.js"></script>
// It applies the saved look on load, and opens a picker when someone types "theme" outside a form
// field or presses the .ui-brand button five times. ?theme=<name> applies a look for one page load.
// Modules run after the first paint, so pages also put the README's small head script in <head>.

const LOOKS = [
  { id: "clean-pro", name: "Clean Pro", note: "Neutral greys and emerald; follows light or dark mode" },
  { id: "neon", name: "Neon", note: "Dark navy, violet-to-cyan glow, glassy cards" },
  { id: "editorial", name: "Editorial", note: "Cream paper, deep ink, serif headings" },
  { id: "playful", name: "Playful", note: "Chunky outlines, hard shadows, bright colour" },
];
const DEFAULT_LOOK = "clean-pro";
const STORAGE_KEY = "sprint-theme";
const KEY_SEQUENCE = "theme";
const BRAND_PRESSES = 5;
const BRAND_WINDOW_MS = 3000;
const TITLE_ID = "ui-theme-picker-title";

let dialog = null;
let returnFocus = null;
let typed = "";
let presses = [];

function isLook(id) {
  return LOOKS.some((look) => look.id === id);
}

function readStoredLook() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLook(id) {
  try {
    if (id === DEFAULT_LOOK) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked or full: the look still applies to this page.
  }
}

function applyLook(id) {
  if (id === DEFAULT_LOOK) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

function currentLook() {
  const id = document.documentElement.dataset.theme;
  return id !== undefined && isLook(id) ? id : DEFAULT_LOOK;
}

function isEditable(target) {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])") !== null;
}

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
    storeLook(event.target.value);
  });

  const hint = document.createElement("p");
  hint.className = "ui-hint";
  hint.textContent = "Your choice is saved in this browser. Esc closes.";

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

document.addEventListener("keydown", (event) => {
  if (event.key === "Shift") return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || dialog?.open || isEditable(event.target)) {
    typed = "";
    return;
  }
  const key = event.key.toLowerCase();
  typed = key.length === 1 && key >= "a" && key <= "z" ? (typed + key).slice(-KEY_SEQUENCE.length) : "";
  if (typed === KEY_SEQUENCE) {
    typed = "";
    openPicker();
  }
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || event.target.closest(".ui-brand") === null) return;
  const now = Date.now();
  presses = [...presses.filter((at) => now - at < BRAND_WINDOW_MS), now];
  if (presses.length >= BRAND_PRESSES) {
    presses = [];
    openPicker();
  }
});

// A valid ?theme= wins, then a valid stored look. With neither, a data-theme the host page set stays.
const requested = new URLSearchParams(window.location.search).get("theme");
const stored = readStoredLook();
const initial = requested !== null && isLook(requested) ? requested : stored !== null && isLook(stored) ? stored : null;
if (initial !== null) applyLook(initial);
