// Tiny TOML string serialiser (and a matching reader for tests): flat string keys only.

export function tomlString(s) {
  return JSON.stringify(String(s)); // a JSON string is a valid TOML basic string
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

// Multi-line: a literal string ('''...''') when the text allows it, else a basic string ("""...""") with escapes.
export function tomlMultiline(s) {
  const text = String(s).replace(/\r\n/g, '\n');
  const literalOk = !text.includes("'''") && !text.endsWith("'") && !new RegExp(CONTROL.source).test(text);
  if (literalOk) return `'''\n${text}'''`;
  const esc = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(CONTROL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `"""\n${esc}"""`;
}

export function serializeToml(pairs) {
  return (
    Object.entries(pairs)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k} = ${v.multiline !== undefined ? tomlMultiline(v.multiline) : tomlString(v)}`)
      .join('\n') + '\n'
  );
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
const unescape = (s) =>
  s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => (e[0] === 'u' && e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : (ESCAPES[e] ?? e)));

// Reads what serializeToml writes: comments, key = "basic" | '''literal''' | """basic multi-line""".
export function parseToml(src) {
  const out = {};
  const text = src.replace(/\r\n/g, '\n');
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\n') { i++; continue; }
    if (text[i] === '#') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl + 1; continue; }
    const m = /^([A-Za-z_][\w-]*) = /.exec(text.slice(i));
    if (!m) throw new Error(`toml: cannot parse at ${i}`);
    i += m[0].length;
    const rest = text.slice(i);
    let value;
    let len;
    if (rest.startsWith("'''\n")) {
      const end = rest.indexOf("'''", 4);
      value = rest.slice(4, end);
      len = end + 3;
    } else if (rest.startsWith('"""\n')) {
      let j = 4;
      while (!rest.startsWith('"""', j)) j += rest[j] === '\\' ? 2 : 1;
      value = unescape(rest.slice(4, j));
      len = j + 3;
    } else {
      const sm = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
      value = unescape(sm[1]);
      len = sm[0].length;
    }
    out[m[1]] = value;
    i += len;
  }
  return out;
}
