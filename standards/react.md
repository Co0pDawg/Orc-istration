---
id: react
title: React
kind: framework
detect:
  - "*.jsx"
  - "*.tsx"
requires:
  - typescript
reviewed: 2026-11-18
sources:
  - https://react.dev/reference/rules/rules-of-hooks
  - https://react.dev/learn/you-might-not-need-an-effect
  - https://react.dev/learn/rendering-lists
  - https://react.dev/learn/choosing-the-state-structure
  - https://react.dev/learn/sharing-state-between-components
  - https://react.dev/learn/keeping-components-pure
  - https://react.dev/reference/react-dom/components/common
  - https://react.dev/reference/eslint-plugin-react-hooks
  - https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
  - https://testing-library.com/docs/queries/about/
  - https://testing-library.com/docs/user-event/intro
  - https://react.dev/reference/react/useEffect
  - https://react.dev/learn/updating-objects-in-state
  - https://react.dev/learn/your-first-component
  - https://testing-library.com/docs/guiding-principles
  - https://react.dev/learn/reusing-logic-with-custom-hooks
---

# React

Rules for React function components with hooks. `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y` enforce the mechanical parts; the TypeScript file covers the language.

## Tooling and formatting
- Enable both `eslint-plugin-react-hooks` rules, `rules-of-hooks` and `exhaustive-deps`, for example through the plugin's `recommended` preset. [8]
- Enable `eslint-plugin-jsx-a11y` through `flatConfigs.recommended` (or `strict`) in the ESLint flat config. [9]
- Treat jsx-a11y as a static check only; also test the rendered DOM (for example with `@axe-core/react`) and try the app with assistive technology. [9]
- Do not add `eslint-disable` for `react-hooks/exhaustive-deps`; restructure the effect so the dependency list is truthful. [12]

## Naming
- Name components in `PascalCase`; a lowercase tag is treated as an HTML element, not a component. [14]
- Start every custom hook name with `use` followed by a capital letter, and give that prefix only to functions that call a hook. [16]
- Declare each component at module top level and pass data through props; do not nest one component's definition inside another. [14]

## Language and API usage
- Use function components wherever hooks are needed; hooks cannot be called from class components. [1]
- Call hooks only at the top level of a component or custom hook, ahead of any early return; not inside loops, conditions, nested functions or `try`/`catch`. [1]
- Keep render pure: no mutating props, state, context or outer variables while rendering; local objects created in the render may be mutated. [6]
- Do not depend on render order or on other components having rendered; pass data via props. [6]
- Put side effects in event handlers; reach for an Effect only when no handler fits. [6]
- Never mutate an object held in state; set a fresh copy built with spread syntax instead. [13]
- Copy every level of a nested object from the change point up to the root, since spread is shallow. [13]
- Give every element rendered from a list a `key` taken from the data (an id); keys must differ between siblings and stay the same across renders. [3]
- Never use `Math.random()` or a value generated during render as a key; avoid an array index as the key when items can be inserted, deleted or reordered. [3]
- Put the `key` on the component in the `map` callback, and use `<Fragment key=...>` when an item has several root nodes. [3]
- Wrap multi-line JSX returned from a component in parentheses. [14]
- Compute derived values during render instead of storing them in state plus an Effect. [2]
- Do not copy props into state (`useState(props.x)` ignores later changes); rename it `initialX` if that is truly intended. [4]
- Replace several booleans that can contradict each other with one status value. [4]
- Store an id and look the object up during render rather than keeping a duplicate copy of it in state. [4]
- Keep state flat: prefer records keyed by id over deeply nested arrays. [4]
- Lift shared state to the closest common parent and pass it down with handlers; each piece of state has one owner. [5]
- Reset a component's state on identity change with a `key`, not with an Effect. [2]
- Do not chain Effects that each set state for the next, and do not call a parent's `onChange` from an Effect; compute it in the event handler. [2]
- Use an Effect only to sync with an external system (subscriptions, timers, non-React widgets, browser APIs, fetching tied to the screen). [12]
- Make an Effect's cleanup undo its setup, and give an Effect that fetches a cleanup that ignores stale responses. [12]
- Subscribe to an external store with `useSyncExternalStore`, not a hand-written Effect. [2]
- Memoize with `useMemo` only for a calculation measured as slow; the wrapped function must be pure. [2]
- Give every `<img>` meaningful `alt` text (`jsx-a11y/alt-text`). [9]
- Associate every form control with a text label (`jsx-a11y/label-has-associated-control`). [9]
- Give a click handler on a non-interactive element such as a `div` a `role` and a keyboard handler (`no-static-element-interactions`, `click-events-have-key-events`). [9]

## Testing
- Query by what users perceive, in this order: `getByRole` (with `name`), `getByLabelText`, `getByPlaceholderText`, `getByText`, `getByDisplayValue`, `getByAltText`, `getByTitle`; `getByTestId` last. [10]
- Use `queryBy*` to assert absence and `findBy*` for elements that appear asynchronously; `getBy*` does not retry. [10]
- Drive interactions with `@testing-library/user-event`: call `userEvent.setup()` before rendering and `await` each action; use `fireEvent` only where user-event has no equivalent. [11]
- Call `userEvent.setup()` inside the test or a setup helper it calls, not in shared `before`/`after` hooks. [11]
- Test through DOM nodes and real user interactions, not component instances. [15]

## Security
- Use `dangerouslySetInnerHTML` only with HTML that is both trusted and sanitized. [7]
- Create the `{ __html }` object as close as possible to where the HTML is produced, not inline in JSX. [7]

## Review checklist
- [ ] Hooks are called unconditionally at component/hook top level, and `exhaustive-deps` is clean without a disable comment.
- [ ] No component is declared inside another component; names are `PascalCase`, hooks start with `use`.
- [ ] Every list item has a stable data-derived `key` (no index on dynamic lists, no random keys).
- [ ] No state is mutated in place; no props copied into state; no derived value held in state.
- [ ] Each new `useEffect` syncs an external system, has an accurate dependency list, and has a cleanup where it subscribes or fetches.
- [ ] No Effect that only sets state from other state/props, calls a parent callback, or chains to another Effect.
- [ ] No render-time side effects (no writes to module variables, no mutation of props).
- [ ] Click handlers on non-interactive elements have a role and keyboard handler; images have `alt`; inputs have labels.
- [ ] `dangerouslySetInnerHTML` is absent, or its input is shown to be sanitized and trusted.
- [ ] New tests use role/label queries with `user-event`, and `getByTestId` only where nothing else fits.
