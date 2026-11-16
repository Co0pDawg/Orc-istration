// The one reader for text the user hands the tool (briefs, models files, board exports, roles, stdin): strips a
// UTF-8 BOM, decodes UTF-16 LE/BE with a BOM (Windows PowerShell 5.1 writes and pipes UTF-16), normalizes EOL.
import fs from 'node:fs';
import { normalizeEol } from './frontmatter.mjs';

export function decodeText(buf) {
  if (typeof buf === 'string') return normalizeEol(buf.replace(/^\uFEFF/, ''));
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  else text = buf.toString('utf8').replace(/^\uFEFF/, '');
  return normalizeEol(text);
}

export const readText = (file) => decodeText(fs.readFileSync(file));
