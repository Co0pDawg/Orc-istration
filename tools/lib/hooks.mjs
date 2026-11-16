// Merges only the `hooks` block of an example file into a Claude Code settings.json. It adds a hook entry only when
// no hook under the same event and matcher already runs an identical command; it never removes, reorders or rewrites
// anything. The same command under a different matcher is added, and `otherMatchers` names the existing ones.

// The example files write the home as `C:\Users\<you>` (settings.example.json) or `<home>` (hooks.node.example.json).
export function fillHome(command, home) {
  return command.replaceAll('C:\\Users\\<you>', home).replaceAll('<home>', home.replace(/\\/g, '/'));
}

// Returns {merged, added: [{event, matcher, command, otherMatchers}]}. `settings` is the parsed target (or {}).
export function mergeHooks(settings, example, home) {
  const merged = structuredClone(settings);
  const added = [];
  const source = example.hooks ?? {};
  for (const [event, groups] of Object.entries(source)) {
    const key = (matcher, command) => JSON.stringify([matcher ?? '', command]);
    const have = new Set();
    const matchersOf = new Map();
    for (const g of Array.isArray(merged.hooks?.[event]) ? merged.hooks[event] : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (typeof h?.command !== 'string') continue;
        have.add(key(g.matcher, h.command));
        if (!matchersOf.has(h.command)) matchersOf.set(h.command, []);
        matchersOf.get(h.command).push(g.matcher ?? '');
      }
    }
    for (const group of groups) {
      const hooks = [];
      for (const h of group.hooks ?? []) {
        const entry = { ...h, command: fillHome(h.command, home) };
        if (have.has(key(group.matcher, entry.command))) continue;
        have.add(key(group.matcher, entry.command));
        hooks.push(entry);
        const others = (matchersOf.get(entry.command) ?? []).filter((m) => m !== (group.matcher ?? ''));
        added.push({ event, matcher: group.matcher, command: entry.command, otherMatchers: others });
      }
      if (!hooks.length) continue;
      merged.hooks ??= {};
      if (merged.hooks[event] !== undefined && !Array.isArray(merged.hooks[event])) throw new Error(`hooks.${event} in settings.json is not an array`);
      merged.hooks[event] ??= [];
      merged.hooks[event].push({ ...group, hooks });
    }
  }
  return { merged, added };
}

// Serializes like the input file: its indent, its line ending, its trailing newline.
export function formatLike(original, value) {
  const indent = /\n([ \t]+)"/.exec(original ?? '')?.[1] ?? '  ';
  const eol = (original ?? '').includes('\r\n') ? '\r\n' : '\n';
  const trailing = original === null || original === undefined || /\n$/.test(original) ? eol : '';
  return JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}
