// Marching-orders briefs: the template and the lint both read the numbered list under the rulebook's
// "Marching orders" heading, so neither can drift from AGENTS.md.

export const WRITER_ROLES = ['builder', 'refuter', 'debugger'];

// [{n, text, label, writerOnly}] from AGENTS.md.
export function parseMarchingOrders(agentsMd) {
  const lines = agentsMd.split('\n');
  const start = lines.findIndex((l) => /^#+\s+Marching orders\b/i.test(l));
  if (start < 0) throw new Error('AGENTS.md has no "Marching orders" heading');
  const items = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#/.test(l)) break;
    const m = /^(\d+)\.\s+(.*)$/.exec(l);
    if (!m) continue;
    const label = (/^\*\*(.+?)\*\*/.exec(m[2])?.[1] ?? m[2]).replace(/[.:]+$/, '');
    items.push({ n: Number(m[1]), text: m[2], label, writerOnly: /\(builders?\/refuters?\)/i.test(m[2]) });
  }
  if (!items.length) throw new Error('AGENTS.md "Marching orders" has no numbered items');
  return items;
}

const forRole = (items, role) => (role && !WRITER_ROLES.includes(role) ? items.filter((i) => !i.writerOnly) : items);

export function briefTemplate(items, role) {
  const out = [];
  forRole(items, role).forEach((item, i) => {
    out.push(`${i + 1}. ${item.text}`);
    out.push(/^board\b/i.test(item.label) ? '   BOARD: <board address> card cards/<card id> stage <label>' : '   <fill in>');
  });
  return `${out.join('\n')}\n`;
}

const firstWord = (label) => label.split(/[\s/]+/)[0].toLowerCase();
// A command is a code span, a fence, or a line that starts with a runner word followed by an argument, so
// "Make sure the node tests pass" names no command.
const COMMAND = /`[^`\n]+`|^\s*```|^\s*(?:[-*]\s+)?(npm|npx|node|git|python3?|pytest|dotnet|pwsh|powershell|cargo|go|make|gradle|mvn|yarn|pnpm|bash|sh)\s+\S/m;
const CAP = /\d+\s*(lines?|words|characters|chars|bytes|tokens|items)\b|\b(cap|max(imum)?|at most)\b[^\n]*\d/i;
const BOARD = /^BOARD: (?:none$|\S+(?: slug \S+)? card cards\/[\w.:@+~-]+ stage \S.*$)/;

// Returns one string per problem. Items: the rulebook's; with a role that is not a writer, writer-only items are
// not required. Without a role every item is checked when present and the writer-only items are optional.
export function lintBrief(text, items, role) {
  const problems = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const found = [];
  // Content outside the items: before item 1 only blank lines and one leading title heading; no item numbered past
  // the rulebook's. Every line after an item's number belongs to that item until the next numbered line, indented
  // or not: real briefs put unindented bullets and lettered sub-steps under an item.
  const firstText = lines.findIndex((x) => x.trim());
  let fence = false;
  lines.forEach((l, i) => {
    const outside = (why) => problems.push(`line ${i + 1}: ${why}: "${l.trim().slice(0, 40)}"`);
    const m = fence ? null : /^(\d+)\.\s+(.*)$/.exec(l);
    if (m) {
      if (Number(m[1]) > items.length) outside(`item ${m[1]} is past the rulebook's ${items.length} items`);
      found.push({ n: Number(m[1]), body: [m[2]] });
      return;
    }
    if (!found.length) {
      if (l.trim() && !(i === firstText && /^#\s/.test(l))) outside('text before item 1');
      return;
    }
    if (/^\s*```/.test(l)) fence = !fence;
    found.at(-1).body.push(l);
  });
  const expected = role ? forRole(items, role) : items;
  const required = role ? expected : items.filter((i) => !i.writerOnly);
  expected.forEach((item, i) => {
    const n = i + 1;
    const got = found[i];
    if (!got) {
      if (i < required.length) problems.push(`item ${n} (${item.label}) is missing`);
      return;
    }
    if (got.n !== n) problems.push(`item ${n} (${item.label}) is numbered ${got.n}; items must be 1..${expected.length} in order`);
    let head = got.body[0];
    if (head.startsWith(item.text)) head = head.slice(item.text.length);
    else {
      const word = firstWord(item.label);
      const plain = head.replace(/^\*\*/, '');
      if (!plain.toLowerCase().startsWith(word)) {
        problems.push(`item ${n} should be ${item.label}, found "${head.slice(0, 40)}"`);
        return;
      }
      head = /^[^:*]*?(\*\*|:)/.test(plain) ? plain.replace(/^[^:*]*?(\*\*|:)/, '') : plain.slice(word.length);
    }
    const body = [head, ...got.body.slice(1)].join('\n');
    if (!/\w/.test(body.replace(/<[^>\n]*>/g, ''))) problems.push(`item ${n} (${item.label}) is empty`);
    if (/^must verify/i.test(item.label) && !COMMAND.test(body)) problems.push(`item ${n} (${item.label}) names no command`);
    if (/^output/i.test(item.label) && !CAP.test(body)) problems.push(`item ${n} (${item.label}) states no cap`);
  });
  for (const l of lines) {
    if (/^\s*BOARD:/.test(l) && !BOARD.test(l.trim())) {
      problems.push(`BOARD line does not match "BOARD: <address> card cards/<id> stage <label>": ${l.trim()}`);
    }
  }
  return problems;
}
