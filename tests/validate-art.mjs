#!/usr/bin/env node
// Checks every SVG in the repo against the art rules. Plain Node, no packages:  node tests/validate-art.mjs
//   - well-formed XML (balanced tags, quoted attributes, no stray < or &)
//   - root <svg> with xmlns, a viewBox (0 0 240 240 for the bird art), role="img" and an aria-label
//   - no <image>, <script>, <foreignObject>, <style>, event handlers or external references
//   - species files (art/birds) hold paths and no text; callouts may add one leader, one dot and short text
//   - at most 5 KB
//   - only ink #1F2A37, amber #E8833A and paper #F6F3EC (plus fill="none"), checked on every color attribute and
//     on every hex value anywhere in the file
//   - the species list in data/art.js matches the files on disk, one callout file per entry flagged callout: true
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#1f2a37', AMBER = '#e8833a', PAPER = '#f6f3ec';
const ALLOWED = new Set([INK, AMBER, PAPER, 'none']);
const LIMIT = 5 * 1024;
let failures = 0;
const fail = (f, msg) => { failures++; console.log(`FAIL ${f}: ${msg}`); };

// Minimal XML well-formedness: tags balance, attributes are quoted, no bare < or & in text.
function wellFormed(src) {
  const stack = [];
  let i = 0;
  const probs = [];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { if (/[<]/.test(src.slice(i))) probs.push('stray <'); if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(src.slice(i))) probs.push('bare &'); break; }
    const text = src.slice(i, lt);
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(text)) probs.push('bare & in text');
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt); if (e < 0) { probs.push('unclosed comment'); break; } i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt); if (e < 0) { probs.push('unclosed PI'); break; } i = e + 2; continue; }
    if (src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); if (e < 0) { probs.push('unclosed declaration'); break; } i = e + 1; continue; }
    // find the end of the tag, honoring quotes
    let j = lt + 1, q = null;
    for (; j < src.length; j++) { const ch = src[j]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '<') { probs.push('< inside a tag'); break; } else if (ch === '>') break; }
    if (j >= src.length) { probs.push('unclosed tag'); break; }
    const tag = src.slice(lt + 1, j);
    if (tag.startsWith('/')) { const name = tag.slice(1).trim(); const open = stack.pop(); if (open !== name) probs.push(`</${name}> closes <${open}>`); }
    else {
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1) : tag;
      const m = body.match(/^([A-Za-z_][\w.:-]*)([\s\S]*)$/);
      if (!m) { probs.push(`bad tag <${tag.slice(0, 20)}>`); }
      else {
        const attrs = m[2].trim();
        if (attrs && !/^(\s*[A-Za-z_:][\w.:-]*\s*=\s*("[^"]*"|'[^']*')\s*)*$/.test(attrs)) probs.push(`unquoted or malformed attributes on <${m[1]}>`);
        if (!selfClosing) stack.push(m[1]);
      }
    }
    i = j + 1;
  }
  if (stack.length) probs.push(`unclosed <${stack.join('>, <')}>`);
  return probs;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (e.name.endsWith('.svg')) out.push(p);
  }
  return out;
}

const files = (await walk(ROOT)).sort();
for (const p of files) {
  const f = relative(ROOT, p), src = await readFile(p, 'utf8'), size = (await stat(p)).size;
  const isBird = f.startsWith('art/birds/'), isCallout = f.startsWith('art/callouts/');
  for (const pr of wellFormed(src)) fail(f, pr);
  if (size > LIMIT) fail(f, `${size} bytes, over ${LIMIT}`);
  const root = src.match(/<svg\b[^>]*>/);
  if (!root) { fail(f, 'no <svg> root'); continue; }
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(root[0])) fail(f, 'root lacks the SVG xmlns');
  const vb = root[0].match(/viewBox="([^"]*)"/);
  if (!vb) fail(f, 'no viewBox');
  else if ((isBird || isCallout) && vb[1] !== '0 0 240 240') fail(f, `viewBox is "${vb[1]}", expected "0 0 240 240"`);
  if (isBird || isCallout) { if (!/role="img"/.test(root[0])) fail(f, 'root lacks role="img"'); if (!/aria-label="[^"]+"/.test(root[0])) fail(f, 'root lacks an aria-label'); }
  for (const bad of ['image', 'script', 'foreignObject', 'style', 'use', 'a']) if (new RegExp(`<${bad}\\b`).test(src)) fail(f, `contains <${bad}>`);
  if (/\son[a-z]+\s*=/i.test(src)) fail(f, 'has an event handler attribute');
  if (/(xlink:)?href\s*=/.test(src)) fail(f, 'has an href (external reference)');
  if (/url\(/.test(src)) fail(f, 'has a url() reference');
  if (isBird && /<text\b/.test(src)) fail(f, 'species art must not contain text');
  if (isBird) { const tags = [...src.matchAll(/<([a-zA-Z]+)\b/g)].map(m => m[1]).filter(t => t !== 'svg'); const odd = tags.filter(t => t !== 'path'); if (odd.length) fail(f, `species art must be paths only, found <${[...new Set(odd)].join('>, <')}>`); }
  if (isCallout) { if (!/<text\b/.test(src)) fail(f, 'callout has no label'); const texts = [...src.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(m => m[1]); for (const t of texts) if (t.length > 16) fail(f, `label "${t}" is longer than 16 characters`); if (!/stroke="#E8833A" stroke-width="1.5"/.test(src)) fail(f, 'callout has no thin amber leader'); }
  // colors
  for (const m of src.matchAll(/\b(fill|stroke|stop-color|color|flood-color|lighting-color)="([^"]*)"/g)) { const v = m[2].trim().toLowerCase(); if (!ALLOWED.has(v)) fail(f, `${m[1]}="${m[2]}" is not ink, amber, paper or none`); }
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) { const v = m[0].toLowerCase(); if (!ALLOWED.has(v)) fail(f, `color ${m[0]} is not in the palette`); }
  if (/rgba?\(|hsla?\(/.test(src)) fail(f, 'uses rgb()/hsl() colors');
  if (/\b(fill|stroke)="(red|blue|green|black|white|gray|grey|orange|yellow)"/i.test(src)) fail(f, 'uses a named color');
}

// data/art.js ↔ files on disk
const artSrc = await readFile(join(ROOT, 'data/art.js'), 'utf8');
const g = {}; new Function('globalThis', artSrc)(g);
const ART = g.DAYBIRD_ART || [];
if (ART.length !== 12) fail('data/art.js', `expected 12 species, found ${ART.length}`);
const birdFiles = new Set(files.filter(p => p.includes('/art/birds/')).map(p => p.split('/').pop().replace('.svg', '')));
const calloutFiles = new Set(files.filter(p => p.includes('/art/callouts/')).map(p => p.split('/').pop().replace('.svg', '')));
for (const b of ART) {
  for (const k of ['slug', 'name', 'mark', 'hint']) if (!b[k]) fail('data/art.js', `${b.slug || '?'} lacks ${k}`);
  if (!birdFiles.has(b.slug)) fail('data/art.js', `no art/birds/${b.slug}.svg`);
  if (b.callout && !calloutFiles.has(b.slug)) fail('data/art.js', `callout: true but no art/callouts/${b.slug}.svg`);
  if (!b.callout && calloutFiles.has(b.slug)) fail('data/art.js', `art/callouts/${b.slug}.svg exists but callout is not true`);
  if (/[!]/.test(b.hint)) fail('data/art.js', `${b.slug} hint has an exclamation mark`);
}
for (const s of birdFiles) if (!ART.find(b => b.slug === s)) fail('art/birds', `${s}.svg is not listed in data/art.js`);
const nCallouts = ART.filter(b => b.callout).length;
if (nCallouts !== 6) fail('data/art.js', `expected 6 callouts, found ${nCallouts}`);

console.log(`${files.length} SVG files checked, ${ART.length} species, ${nCallouts} callouts: ${failures ? failures + ' problem(s)' : 'all good'}`);
process.exit(failures ? 1 : 0);
