// Budget and ASCII check for a drafted text (`orc text-check`, workflows/draft-pr.md), once `wc -w -c` and
// `grep -n '[^ -~]'`. Words are runs of non-whitespace as `wc -w` counts them; bytes are the file's length.

// Printable ASCII plus tab; a line ending (\n, or \r\n) is not part of the line.
const NON_ASCII = /[^\t\x20-\x7e]/;

export function textCheck(buf, { maxWords, maxBytes, ascii = false } = {}) {
  const text = buf.toString('utf8');
  const words = text.split(/[ \t\n\r\v\f]+/).filter(Boolean).length;
  const bytes = buf.length;
  const out = [`words=${words} bytes=${bytes}`];
  const problems = [];
  if (maxWords !== undefined && words > maxWords) problems.push(`${words} words, over the limit of ${maxWords}`);
  if (maxBytes !== undefined && bytes > maxBytes) problems.push(`${bytes} bytes, over the limit of ${maxBytes}`);
  if (ascii) {
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const hits = [];
    lines.forEach((l, i) => {
      if (NON_ASCII.test(l)) hits.push(`non-ascii: ${i + 1}: ${l}`);
    });
    out.push(...hits);
    if (hits.length) problems.push(`${hits.length} line(s) hold a character outside printable ASCII`);
  }
  return { out, problems };
}
