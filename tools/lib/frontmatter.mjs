// Tiny frontmatter parser/serialiser: flat keys, strings, booleans, string lists. No YAML library.

export function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n');
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
  }
  return v;
}

export function parse(text) {
  const src = normalizeEol(text);
  if (!src.startsWith('---\n')) throw new Error('frontmatter: file does not start with ---');
  const end = src.indexOf('\n---\n', 3);
  if (end < 0) throw new Error('frontmatter: no closing ---');
  const lines = src.slice(4, end).split('\n');
  const data = {};
  let listKey = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      if (!listKey) throw new Error(`frontmatter: list item without a key: ${line}`);
      data[listKey].push(parseScalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s(.*))?$/.exec(line);
    if (!kv) throw new Error(`frontmatter: cannot parse line: ${line}`);
    const [, key, rest] = kv;
    if (rest === undefined || rest.trim() === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = parseScalar(rest);
      listKey = null;
    }
  }
  let body = src.slice(end + 5);
  if (body.startsWith('\n')) body = body.slice(1);
  return { data, body };
}

function needsQuote(s) {
  return (
    s === '' ||
    /^[\s'"\[\]{}>|*&!%@`#,?:-]/.test(s) ||
    /\s$/.test(s) ||
    s.includes(': ') ||
    s.includes(' #') ||
    s.includes('\n') ||
    /^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s)
  );
}

function scalar(v) {
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  return needsQuote(s) ? JSON.stringify(s) : s;
}

export function serialize(data, body) {
  let out = '---\n';
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out += `${key}:\n`;
      for (const item of value) out += `  - ${scalar(item)}\n`;
    } else {
      out += `${key}: ${scalar(value)}\n`;
    }
  }
  return `${out}---\n\n${normalizeEol(body)}`;
}
