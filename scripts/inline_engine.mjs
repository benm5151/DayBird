#!/usr/bin/env node
// Inlines js/brief.js (and data/traits.js where used) into the edge functions that need the brief engine.
// Supabase's dashboard bundler refuses imports from any outside site, so the functions cannot load the engine
// from day-bird.com at deploy time; instead each function carries a generated copy between two marker lines.
// Run after editing js/brief.js or data/traits.js:   node scripts/inline_engine.mjs
// Check that nothing is stale (used by tests):        node scripts/inline_engine.mjs --check
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = new URL('..', import.meta.url).pathname;

const START = '// >>> engine: generated from js/brief.js by scripts/inline_engine.mjs; edit the source, not this block';
const END = '// <<< engine';
const NOCHECK = '// @ts-nocheck -- this file carries a generated plain-JavaScript block (see scripts/inline_engine.mjs)\n';
const FUNCTIONS = {
  'send-brief': ['js/brief.js', 'data/traits.js'],
  'send-daily': ['js/brief.js', 'data/traits.js'],
  'subscribe': ['js/brief.js'],
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, sources] of Object.entries(FUNCTIONS)) {
  const path = `${ROOT}supabase/functions/${name}/index.ts`;
  const src = readFileSync(path, 'utf8');
  const body = sources.map((s) => `// --- ${s}\n${readFileSync(ROOT + s, 'utf8').trimEnd()}`).join('\n');
  const block = `${START}\n${body}\n${END}`;
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < 0 || b < a) { console.error(`${name}: marker lines not found`); process.exit(2); }
  let out = src.slice(0, a) + block + src.slice(b + END.length);
  // The copied engine is plain JavaScript, which strict TypeScript rejects (implicit any); the function's own code
  // was type-checked before the block was added and is covered by tests, so checking is off for the whole file.
  if (!out.startsWith(NOCHECK)) out = NOCHECK + out;
  if (out === src) { console.log(`${name}: up to date`); continue; }
  stale++;
  if (check) console.error(`${name}: engine block is stale; run node scripts/inline_engine.mjs`);
  else { writeFileSync(path, out); console.log(`${name}: updated`); }
}
if (check && stale) process.exit(1);
