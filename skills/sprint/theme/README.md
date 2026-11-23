# Sprint theme

A small, offline UI theme for sprint builds. It gives a project a polished default look, "Clean Pro", and three alternate looks behind a hidden picker. It is two files with no dependencies and no build step: `theme.css` and `theme-picker.js`.

- **Clean Pro** (the default): crisp neutral greys, one emerald brand colour, soft shadows and short transitions. It follows the system light or dark mode through `prefers-color-scheme`.
- **neon**: dark navy, a violet-to-cyan gradient accent, glowing focus rings and glassy cards.
- **editorial**: cream paper, deep ink, serif headings and a terracotta accent.
- **playful**: neo-brutalist, with white, chunky black outlines, hard offset shadows and bright yellow, blue and pink.

Every look uses the same components, so a page reads as one system whichever look is on.

## Use it in a project

1. Copy this folder into the project as `src/theme/`. Copy the files unchanged so they stay identical to this source.
2. Link the stylesheet before the app's own CSS:

   ```html
   <link rel="stylesheet" href="/src/theme/theme.css" />
   <link rel="stylesheet" href="/src/style.css" />
   ```

3. Include the picker once, as a module, at the end of `<body>`:

   ```html
   <script type="module" src="/src/theme/theme-picker.js"></script>
   ```

   A module runs after the first paint, so on its own a saved alternate look would flash Clean Pro first. To stop that, also paste this small script into `<head>`, after the stylesheets. It only reads `?theme=` and the saved look and sets `data-theme`; the picker does everything else. It is inline rather than a file because bundlers such as Vite only bundle `type="module"` scripts.

   ```html
   <script>
     // Sprint theme: apply a ?theme= or saved look before the first paint. theme-picker.js does the rest.
     (() => {
       const looks = ["neon", "editorial", "playful"];
       const requested = new URLSearchParams(location.search).get("theme");
       let stored = null;
       try {
         stored = localStorage.getItem("sprint-theme");
       } catch {
         // Storage blocked: the page keeps its default look.
       }
       const id = requested === "clean-pro" || looks.includes(requested) ? requested : stored;
       if (looks.includes(id)) document.documentElement.dataset.theme = id;
     })();
   </script>
   ```

4. Add a header with the brand slot. The brand text is the app's own; the theme ships none. Use a `<button>` so keyboard users can reach the picker:

   ```html
   <header class="ui-header">
     <div class="ui-header-inner">
       <button type="button" class="ui-brand">
         <span class="ui-brand-mark" aria-hidden="true"><!-- inline SVG icon --></span>
         App name
       </button>
     </div>
   </header>
   ```

5. Put the `ui-` classes on the markup (see Components). Keep layout and app-specific rules in the app's CSS, and give those rules colours, radii and fonts through the tokens (`var(--ui-danger)`), never hard-coded values.

The theme loads no fonts, scripts or images from the network. It uses system font stacks, so it works offline.

## Tokens

Each look sets the same custom properties on `:root`. Clean Pro sets them directly, with its dark values under `@media (prefers-color-scheme: dark)` when no `data-theme` is set. Each alternate is one `:root[data-theme="<name>"]` block that overrides tokens and nothing else. Components read tokens only.

| Group | Tokens |
|---|---|
| Page and surfaces | `--ui-bg`, `--ui-bg-image`, `--ui-surface`, `--ui-surface-2`, `--ui-backdrop-blur` |
| Text | `--ui-text`, `--ui-text-muted` |
| Borders | `--ui-border` (dividers), `--ui-border-strong` (controls), `--ui-border-width` |
| Accent | `--ui-accent`, `--ui-accent-fill` (solid or gradient), `--ui-accent-hover`, `--ui-accent-contrast` (text on the accent), `--ui-accent-text` (accent-coloured text on a surface), `--ui-accent-soft` |
| Status | `--ui-ok`, `--ui-ok-bg`, `--ui-warn`, `--ui-warn-bg`, `--ui-danger`, `--ui-danger-bg`, `--ui-info`, `--ui-info-bg` |
| Focus | `--ui-focus` (ring colour), `--ui-focus-glow` (a `filter` value; only neon applies it, through a rule scoped to `:root[data-theme="neon"]`, so other looks never set `filter` on a focused element) |
| Shape | `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg`, `--ui-radius-pill` |
| Depth | `--ui-shadow-sm`, `--ui-shadow-md`, `--ui-shadow-press` |
| Type | `--ui-font-body`, `--ui-font-display`, `--ui-font-mono`, `--ui-display-weight`, `--ui-display-tracking` |
| Spacing | `--ui-space-1` (0.25rem) to `--ui-space-6` (2rem) |
| Motion | `--ui-duration` (150ms), `--ui-ease` |

With `prefers-reduced-motion: reduce`, `--ui-duration` is 0, and every transition and animation on the page runs in 0.01ms, once. Animations still end in their final state, so an element that fades in with `animation-fill-mode: forwards` still appears.

The alternates override only the tokens that differ. Every look defines its own colours: the colour tokens in the Page and surfaces, Text, Borders, Accent, Status and Focus rows. The effect tokens (`--ui-bg-image`, `--ui-backdrop-blur`, `--ui-accent-fill`, `--ui-focus-glow`, `--ui-border-width`) and the shape, type, spacing and motion tokens that a look leaves out come from Clean Pro by design. Clean Pro dark also keeps the light accent fill (`--ui-accent`, `--ui-accent-hover`, `--ui-accent-contrast`), since white on `#047857` passes in both modes.

## Components

All classes start with `ui-`, so they do not collide with app CSS. The theme also styles `body` (background, text colour, font) and `:focus-visible` (the focus ring).

| Component | Classes |
|---|---|
| App shell | `.ui-header`, `.ui-header-inner`, `.ui-brand` (a button), `.ui-brand-mark` |
| Page heading | `.ui-title`, `.ui-subtitle`, `.ui-heading` (section heading) |
| Card | `.ui-card` |
| Field | `.ui-field`, `.ui-label`, `.ui-input`, `.ui-select`, `.ui-hint`, `.ui-field-error`; `aria-invalid="true"` marks an input in the danger colour |
| Button | `.ui-button` (primary), `.ui-button.ui-button--secondary`; `:disabled` is styled |
| Chip or badge | `.ui-chip`, with `.ui-chip--ok`, `--warn`, `--danger` or `--info` |
| Alert | `.ui-alert`, with `.ui-alert--ok`, `--warn`, `--danger` or `--info` |
| List | `.ui-list` on a `<ul>` or `<ol>`; each `<li>` is a row |
| Timeline | `.ui-timeline` (an `<ol>`), `.ui-timeline-item` with `data-kind`, `.ui-timeline-time`, `.ui-timeline-kind`, `.ui-timeline-text` |
| Dialog | `.ui-dialog`, `.ui-radio-group`, `.ui-radio` (used by the picker) |

Status chips and alerts never rely on colour alone. Each variant adds an icon (a tick, an exclamation mark, a cross or an "i") through CSS, with empty alternative text so screen readers read only the words. Write the meaning in the text as well, such as "Taken: ..." or "This slot is free."

A timeline item looks like this:

```html
<ol class="ui-timeline">
  <li class="ui-timeline-item" data-kind="correction">
    <time class="ui-timeline-time">10:42</time>
    <span class="ui-timeline-kind">Correction</span>
    <p class="ui-timeline-text">The overlap check treated back-to-back slots as a clash; fixed and tested.</p>
  </li>
</ol>
```

The kinds are `requirement`, `decision`, `build`, `review` and `correction`. A `correction` item stands out: a danger-coloured border, a tinted background, a filled marker and a warning icon on its badge.

## The picker

The picker lets someone switch looks during a demo without any visible control on the page.

- **Type `theme`.** Type the letters t, h, e, m, e in sequence while focus is not in a form field. Keys typed in an input, select, textarea or editable element are ignored, as are keys with Ctrl, Alt or Meta.
- **Press the brand five times.** Click or press Enter on the `.ui-brand` button five times within three seconds.
- **`?theme=<name>` in the URL** applies a look for that page load without saving it. The names are `clean-pro`, `neon`, `editorial` and `playful`.

The picker is a native `<dialog>` with a labelled group of four radio buttons. Choosing a look applies it at once. Esc or the Done button closes it, and focus returns to where it was. The choice is saved in the `localStorage` key `sprint-theme` and applied as `data-theme` on `<html>`; choosing Clean Pro removes the attribute and the saved value. On load, a valid `?theme=` wins, then a valid saved look; with neither, the picker leaves any `data-theme` the page set itself. Unknown names are ignored. If storage is blocked, the look still applies to the page. The picker builds its dialog with DOM methods and never writes HTML strings.

## The contrast rule

Every look must pass WCAG AA in every state it styles:

- text at least 4.5:1 against its background, including muted text, chip text, field errors and text on filled buttons;
- control borders, focus rings and other meaningful non-text marks at least 3:1 against their background.

Check both ends of a gradient. Bright brand colours often fail with white text: emerald `#10b981` gives white text only 2.5:1, so Clean Pro fills buttons with `#047857` (5.5:1). When you add or change a token, check each pair it takes part in, then run a Lighthouse accessibility audit in each look; it should score 100.
