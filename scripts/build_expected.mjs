#!/usr/bin/env node
// Build "This week's birds": for each county in data/regions.json, the species on the most checklists over the
// last ten days, with real shares and a trend against the ten days before.
//   node scripts/build_expected.mjs            (needs EBIRD_KEY; runs daily from .github/workflows/brief.yml)
// Writes data/expected/{code}.json (what the site and the emails read), data/expected/cache-{code}.json (one entry per
// checklist already read, kept 28 days, so a run only fetches checklists it has not seen) and data/expected/taxonomy.json
// (species code → name, cached for good).
//
// eBird gives the latest 200 checklists per region (product/lists), then one call per checklist for its species
// (product/checklist/view). Calls are sequential with a short pause, at most MAX_NEW new checklists per region per run.
// Subspecies and forms roll up to their species (taxonomy reportAs); spuhs, slashes, hybrids and domestics are dropped.
// Dates are UTC calendar days: "today" is the UTC date when the run starts, and the window is the ten days ending today.
// The computation is exported so tests/expected.test.mjs can run it on fixture checklists with a stubbed fetch.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const UA = 'Daybird/1.0 (+https://day-bird.com; birding brief for newer birders)';
export const API = 'https://api.ebird.org/v2';
export const WINDOW_DAYS = 10;   // the list covers the ten days ending today
export const KEEP_DAYS = 28;     // cache entries older than this are dropped
export const MAX_NEW = 250;      // new checklists read per region per run
export const PAUSE_MS = 150;     // between eBird calls
export const TOP = 80;           // species kept per region
export const MIN_COMPLETE = 20;  // use complete checklists only when at least this many are in the window
export const MIN_PREV = 10;      // compute the trend only when the previous ten days have at least this many lists
export const MAX_LISTS = 200;    // the most product/lists returns

export const headers = (key) => ({ 'X-eBirdApiToken': key, 'User-Agent': UA, 'Accept': 'application/json' });

// ---------------------------------------------------------------- dates (UTC calendar days)
export const isoDay = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || '').trim()); return m ? m[1] : ''; };
export const todayUTC = (now = new Date()) => new Date(now).toISOString().slice(0, 10);
export function addDays(iso, n) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------------------------------------------------------------- the computation
// share − prevShare ≥ 0.10 arriving; ≤ −0.10 tapering; prevShare 0 and share ≥ 0.1 new (checked first, it is the
// more useful word); otherwise steady; null when there is no previous window to compare with.
export function trendOf(share, prevShare) {
  if (prevShare == null) return null;
  if (prevShare === 0 && share >= 0.1) return 'new';
  const d = Math.round((share - prevShare) * 1000) / 1000;   // 0.5 − 0.4 is 0.09999… in floating point
  if (d >= 0.10) return 'arriving';
  if (d <= -0.10) return 'tapering';
  return 'steady';
}
// A checklist's species, resolved through the taxonomy: subspecies/forms count as their species (reportAs), anything
// that is not a species (spuh, slash, hybrid, domestic) or is unknown to the taxonomy is left out.
export function resolveSpecies(codes, tax) {
  const out = new Set();
  for (const c of codes || []) {
    let t = tax[c], code = c, hops = 0;
    while (t && t.category !== 'species' && t.reportAs && tax[t.reportAs] && hops++ < 3) { code = t.reportAs; t = tax[code]; }
    if (t && t.category === 'species' && t.name) out.add(code);
  }
  return out;
}
const r3 = (x) => Math.round(x * 1000) / 1000;
// cache: { subId: { d, loc, name, complete, sp } }; tax: { code: { name, category, reportAs? } }; today: 'YYYY-MM-DD'
export function compute(cache, tax, today, region) {
  const from = addDays(today, -(WINDOW_DAYS - 1)), to = today;
  const pFrom = addDays(today, -(2 * WINDOW_DAYS - 1)), pTo = addDays(today, -WINDOW_DAYS);
  const all = Object.values(cache || {}).filter((e) => e && e.d);
  const inRange = (a, b) => all.filter((e) => e.d >= a && e.d <= b);
  const win = inRange(from, to), winComplete = win.filter((e) => e.complete);
  const useComplete = winComplete.length >= MIN_COMPLETE;
  const lists = useComplete ? winComplete : win;
  const prevAll = inRange(pFrom, pTo), prevLists = useComplete ? prevAll.filter((e) => e.complete) : prevAll;
  const prev = prevLists.length >= MIN_PREV ? prevLists : null;
  const count = (ls) => { const n = {}; for (const l of ls) for (const c of resolveSpecies(l.sp, tax)) n[c] = (n[c] || 0) + 1; return n; };
  const now = count(lists), before = prev ? count(prev) : null;
  const species = Object.keys(now).map((code) => {
    const share = r3(now[code] / lists.length);
    const prevShare = before ? r3((before[code] || 0) / prev.length) : null;
    return { code, name: tax[code].name, share, prevShare, trend: trendOf(share, prevShare), lists: now[code] };
  }).sort((a, b) => b.share - a.share || b.lists - a.lists || a.name.localeCompare(b.name)).slice(0, TOP);
  return {
    region: { code: region.code, name: region.name },
    window: { from, to, lists: lists.length, locations: new Set(lists.map((l) => l.loc).filter(Boolean)).size, basis: useComplete ? 'complete' : 'all', tz: 'UTC' },
    prev: prev ? { from: pFrom, to: pTo, lists: prev.length } : null,
    species,
  };
}
export function trimCache(cache, today) {
  const cutoff = addDays(today, -KEEP_DAYS);
  const out = {};
  for (const [id, e] of Object.entries(cache || {})) if (e && e.d && e.d >= cutoff) out[id] = e;
  return out;
}

// ---------------------------------------------------------------- the run (network and files)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function run({ key, root, fetch: f = globalThis.fetch, now = new Date(), pauseMs = PAUSE_MS, log = (s) => process.stdout.write(s + '\n'), warn = (s) => process.stderr.write(s + '\n') } = {}) {
  const dir = `${root}/data/expected`;
  mkdirSync(dir, { recursive: true });
  const readJSON = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
  const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
  const regions = readJSON(`${root}/data/regions.json`, { regions: [] }).regions || [];
  const H = headers(key);
  async function get(url) {
    const r = await f(url, { headers: H, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}${new URL(url).pathname}`);
    return r.json();
  }
  const today = todayUTC(now);
  const taxPath = `${dir}/taxonomy.json`;
  const tax = readJSON(taxPath, {});
  const errors = [], summary = [];

  // Names for codes the taxonomy cache does not have yet, in batches; a subspecies brings its species along.
  async function learn(codes) {
    let want = [...new Set(codes)].filter((c) => c && !tax[c]);
    for (let round = 0; want.length && round < 3; round++) {
      for (let i = 0; i < want.length; i += 100) {
        const batch = want.slice(i, i + 100);
        try {
          const rows = await get(`${API}/ref/taxonomy/ebird?fmt=json&species=${batch.join(',')}`);
          for (const t of rows || []) if (t && t.speciesCode) tax[t.speciesCode] = { name: String(t.comName || ''), category: String(t.category || ''), ...(t.reportAs ? { reportAs: t.reportAs } : {}) };
          for (const c of batch) if (!tax[c]) tax[c] = { name: '', category: 'unknown' };   // not in the taxonomy: remember the miss, never ask again
        } catch (e) { errors.push(`taxonomy: ${e.message}`); return; }
        await sleep(pauseMs);
      }
      want = [...new Set(Object.values(tax).map((t) => t.reportAs).filter((c) => c && !tax[c]))];
    }
  }

  for (const region of regions) {
    const cachePath = `${dir}/cache-${region.code}.json`;
    let cache = trimCache(readJSON(cachePath, {}), today);
    let fetched = 0, skipped = 0;
    const cutoff = addDays(today, -KEEP_DAYS);
    try {
      const lists = await get(`${API}/product/lists/${region.code}?maxResults=${MAX_LISTS}`);
      await sleep(pauseMs);
      for (const l of lists || []) {
        if (!l || !l.subId || cache[l.subId]) continue;
        const listed = isoDay(l.obsDt) || isoDay(l.isoObsDate);
        if (listed && listed < cutoff) continue;   // a back-dated checklist from months ago: too old for any window, never read
        if (fetched >= MAX_NEW) { skipped++; continue; }
        try {
          const v = await get(`${API}/product/checklist/view/${encodeURIComponent(l.subId)}`);
          fetched++;
          const d = isoDay(v.obsDt) || isoDay(l.obsDt) || isoDay(l.isoObsDate);
          if (!d) continue;
          cache[l.subId] = { d, loc: String(v.locId || l.locId || (l.loc && l.loc.locId) || ''), name: String((l.loc && l.loc.name) || l.locName || '').slice(0, 80), complete: v.allObsReported === true, sp: [...new Set((v.obs || []).map((o) => o && o.speciesCode).filter(Boolean))] };
        } catch (e) { errors.push(`${region.code} ${l.subId}: ${e.message}`); }
        await sleep(pauseMs);
      }
    } catch (e) { errors.push(`${region.code} lists: ${e.message}`); }
    cache = trimCache(cache, today);
    writeJSON(cachePath, cache);
    await learn(Object.values(cache).flatMap((e) => e.sp || []));
    const out = compute(cache, tax, today, region);
    writeJSON(`${dir}/${region.code}.json`, { generated: new Date(now).toISOString(), ...out });
    summary.push(`${region.name}: ${out.window.lists} lists (${out.window.basis}), ${out.species.length} species, ${fetched} new checklists read${skipped ? `, ${skipped} left for tomorrow` : ''}`);
  }
  writeJSON(taxPath, tax);
  summary.forEach(log);
  if (errors.length) warn(`build_expected: ${errors.length} problem${errors.length > 1 ? 's' : ''}: ${errors.slice(0, 8).join('; ')}${errors.length > 8 ? '; …' : ''}`);
  return { today, summary, errors };
}

// Run as a script (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = (process.env.EBIRD_KEY || '').trim();
  if (!key) { console.log('build_expected: no EBIRD_KEY, nothing built'); process.exit(0); }
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
  run({ key, root }).catch((e) => { console.error('build_expected failed:', e); process.exit(0); });   // never block the brief commit
}
