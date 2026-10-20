// Unit tests for scripts/build_expected.mjs ("This week's birds") with fixture checklists and a stubbed fetch,
// plus the wording helpers in js/brief.js and the rule that js/brief.js REGIONS equals data/regions.json.
//   node --test tests/expected.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import * as X from '../scripts/build_expected.mjs';
const require = createRequire(import.meta.url);
require('../js/brief.js');
const B = globalThis.DAYBIRD_BRIEF;
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const NOW = new Date('2026-10-20T13:00:00Z');   // today (UTC) = 2026-10-20; window Oct 11–20; previous Oct 1–10
const TAX = {
  bkcchi: { name: 'Black-capped Chickadee', category: 'species' },
  blujay: { name: 'Blue Jay', category: 'species' },
  amecro: { name: 'American Crow', category: 'species' },
  yerwar: { name: 'Yellow-rumped Warbler', category: 'species' },
  myrwar: { name: 'Yellow-rumped Warbler (Myrtle)', category: 'issf', reportAs: 'yerwar' },
  daejun: { name: 'Dark-eyed Junco', category: 'species' },
  'duck1': { name: 'duck sp.', category: 'spuh' },
  'x00001': { name: 'Mallard x American Black Duck (hybrid)', category: 'hybrid' },
  rocpig1: { name: 'Rock Pigeon (Feral Pigeon)', category: 'domestic', reportAs: 'rocpig' },
  rocpig: { name: 'Rock Pigeon', category: 'species' },
  whtspa: { name: 'White-throated Sparrow', category: 'species' },
};
const list = (subId, d, sp, complete = true, loc = 'L1') => ({ subId, d, loc, name: 'Spot ' + loc, complete, sp });

test('trendOf: thresholds, new before arriving, null without a previous window', () => {
  assert.equal(X.trendOf(0.5, null), null);
  assert.equal(X.trendOf(0.5, 0.4), 'arriving'); assert.equal(X.trendOf(0.5, 0.41), 'steady');
  assert.equal(X.trendOf(0.3, 0.4), 'tapering'); assert.equal(X.trendOf(0.31, 0.4), 'steady');
  assert.equal(X.trendOf(0.1, 0), 'new'); assert.equal(X.trendOf(0.09, 0), 'steady'); assert.equal(X.trendOf(0.5, 0), 'new');
});

test('resolveSpecies: subspecies roll up, non-species drop, unknown codes drop, no duplicates', () => {
  assert.deepEqual([...X.resolveSpecies(['myrwar', 'yerwar', 'duck1', 'x00001', 'rocpig1', 'nope', 'blujay'], TAX)].sort(), ['blujay', 'rocpig', 'yerwar']);
});

test('compute: shares of checklists, window and previous window, sort, locations, basis', () => {
  const cache = {};
  // window (Oct 11–20): 10 complete lists, so basis = all (fewer than 20 complete) and incidental lists count too
  for (let i = 0; i < 10; i++) cache['W' + i] = list('W' + i, X.addDays('2026-10-20', -i), ['bkcchi', 'blujay', ...(i < 7 ? ['myrwar'] : []), ...(i < 2 ? ['daejun'] : [])], true, 'L' + (i % 3));
  cache.INC = list('INC', '2026-10-15', ['amecro'], false, 'L9');          // incidental: counted when basis is all
  cache.OLD = list('OLD', '2026-10-10', ['bkcchi', 'blujay'], true);        // previous window
  for (let i = 0; i < 9; i++) cache['P' + i] = list('P' + i, X.addDays('2026-10-10', -i), ['bkcchi', ...(i < 5 ? ['blujay'] : []), ...(i < 4 ? ['daejun'] : [])], true);
  cache.ANCIENT = list('ANCIENT', '2026-09-01', ['whtspa'], true);          // outside both windows
  cache.NODATE = { loc: 'L1', name: 'x', complete: true, sp: ['whtspa'] };    // ignored
  const out = X.compute(cache, TAX, '2026-10-20', { code: 'US-TEST', name: 'Test County' });
  assert.deepEqual(out.region, { code: 'US-TEST', name: 'Test County' });
  assert.deepEqual(out.window, { from: '2026-10-11', to: '2026-10-20', lists: 11, locations: 4, basis: 'all', tz: 'UTC' });
  assert.deepEqual(out.prev, { from: '2026-10-01', to: '2026-10-10', lists: 10 });
  const by = Object.fromEntries(out.species.map((s) => [s.code, s]));
  assert.deepEqual(out.species.map((s) => s.code), ['bkcchi', 'blujay', 'yerwar', 'daejun', 'amecro'], 'sorted by share, then lists, then name');
  assert.equal(by.bkcchi.share, Math.round(10 / 11 * 1000) / 1000); assert.equal(by.bkcchi.prevShare, 1); assert.equal(by.bkcchi.trend, 'steady');
  assert.equal(by.yerwar.name, 'Yellow-rumped Warbler'); assert.equal(by.yerwar.lists, 7); assert.equal(by.yerwar.prevShare, 0); assert.equal(by.yerwar.trend, 'new', 'Myrtle rolls up to the species');
  assert.equal(by.daejun.lists, 2); assert.equal(by.daejun.prevShare, 0.4); assert.equal(by.daejun.trend, 'tapering');
  assert.equal(by.blujay.prevShare, 0.6); assert.equal(by.blujay.trend, 'arriving');
  assert.equal(by.amecro.lists, 1); assert.equal(by.amecro.share, Math.round(1 / 11 * 1000) / 1000); assert.equal(by.amecro.trend, 'steady');
  assert.ok(!by.whtspa, 'nothing from outside the window');
});

test('compute: complete lists only once 20 are available; prev null under 10 lists; top 80 cap', () => {
  const cache = {};
  for (let i = 0; i < 25; i++) cache['C' + i] = list('C' + i, X.addDays('2026-10-20', -(i % 10)), ['bkcchi'], true);
  for (let i = 0; i < 30; i++) cache['I' + i] = list('I' + i, X.addDays('2026-10-20', -(i % 10)), ['amecro'], false);
  const out = X.compute(cache, TAX, '2026-10-20', { code: 'R', name: 'R' });
  assert.equal(out.window.basis, 'complete'); assert.equal(out.window.lists, 25);
  assert.deepEqual(out.species.map((s) => s.code), ['bkcchi'], 'incidental lists are left out once there are enough complete ones');
  assert.equal(out.prev, null); assert.equal(out.species[0].prevShare, null); assert.equal(out.species[0].trend, null);
  // many species: only the top 80 are kept
  const tax = {}, codes = [];
  for (let i = 0; i < 120; i++) { tax['s' + i] = { name: 'Species ' + String(i).padStart(3, '0'), category: 'species' }; codes.push('s' + i); }
  const big = { A: list('A', '2026-10-20', codes), B: list('B', '2026-10-19', codes.slice(0, 50)) };
  const o2 = X.compute(big, tax, '2026-10-20', { code: 'R', name: 'R' });
  assert.equal(o2.species.length, 80); assert.equal(o2.species[0].share, 1); assert.equal(o2.species[49].share, 1); assert.equal(o2.species[50].share, 0.5);
});

test('trimCache drops entries older than 28 days and undated ones', () => {
  const c = { a: list('a', '2026-09-21', []), b: list('b', '2026-09-22', []), c: list('c', '2026-10-20', []), d: { sp: [] } };
  assert.deepEqual(Object.keys(X.trimCache(c, '2026-10-20')), ['b', 'c'], 'exactly 28 days old stays');
});

// ---------------------------------------------------------------- run() against a stubbed eBird
function world() {
  const S = { calls: [], fail: {}, lists: {}, views: {}, tax: Object.entries(TAX).map(([speciesCode, t]) => ({ speciesCode, comName: t.name, category: t.category, ...(t.reportAs ? { reportAs: t.reportAs } : {}) })) };
  S.fetch = async (url, init = {}) => {
    const u = new URL(url); S.calls.push(u.pathname + u.search);
    assert.equal(init.headers['X-eBirdApiToken'], 'k'); assert.equal(init.headers['User-Agent'], X.UA); assert.equal(init.headers.Accept, 'application/json');
    const ok = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const m = /\/product\/lists\/([^?]+)/.exec(u.pathname);
    if (m) return S.fail.lists ? ok({}, 500) : ok(S.lists[m[1]] || []);
    const v = /\/product\/checklist\/view\/(.+)$/.exec(u.pathname);
    if (v) return S.fail[v[1]] ? ok({}, 500) : ok(S.views[v[1]]);
    if (u.pathname.endsWith('/ref/taxonomy/ebird')) { const want = u.searchParams.get('species').split(','); return ok(S.tax.filter((t) => want.includes(t.speciesCode))); }
    throw new Error('unstubbed ' + url);
  };
  return S;
}
function tmpRoot(regions) {
  const root = mkdtempSync(`${tmpdir()}/daybird-expected-`);
  mkdirSync(`${root}/data`, { recursive: true });
  writeFileSync(`${root}/data/regions.json`, JSON.stringify({ regions }));
  return root;
}
const J = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('run: reads only new checklists, caches them, names species, writes the region file, trims, carries on past failures', async () => {
  const S = world();
  const root = tmpRoot([{ code: 'US-TEST', name: 'Test County', bbox: [0, 0, 1, 1] }]);
  S.lists['US-TEST'] = [
    { subId: 'S1', obsDt: '2026-10-20 07:10', loc: { locId: 'L1', name: 'Mink Brook' }, numSpecies: 3 },
    { subId: 'S2', obsDt: '2026-10-19 08:00', loc: { locId: 'L2', name: 'Wilder Dam' }, numSpecies: 2 },
    { subId: 'S3', obsDt: '2026-10-18 08:00', loc: { locId: 'L2', name: 'Wilder Dam' }, numSpecies: 1 },
    { subId: 'S4', obsDt: '2026-10-05 08:00', loc: { locId: 'L1', name: 'Mink Brook' }, numSpecies: 1 },
    { subId: 'SOLD', obsDt: '2026-08-01 08:00', loc: { locId: 'L1', name: 'Mink Brook' }, numSpecies: 1 },
    { subId: 'SBAD', obsDt: '2026-10-18 08:00', loc: { locId: 'L1', name: 'Mink Brook' }, numSpecies: 1 },
  ];
  S.views.S1 = { subId: 'S1', locId: 'L1', obsDt: '2026-10-20 07:10', allObsReported: true, durationHrs: 1, obs: [{ speciesCode: 'bkcchi' }, { speciesCode: 'myrwar' }, { speciesCode: 'duck1' }] };
  S.views.S2 = { subId: 'S2', locId: 'L2', obsDt: '2026-10-19 08:00', allObsReported: true, durationHrs: 0.5, obs: [{ speciesCode: 'bkcchi' }, { speciesCode: 'yerwar' }] };
  S.views.S3 = { subId: 'S3', locId: 'L2', obsDt: '2026-10-18 08:00', allObsReported: false, obs: [{ speciesCode: 'blujay' }] };
  S.views.S4 = { subId: 'S4', locId: 'L1', obsDt: '2026-10-05 08:00', allObsReported: true, obs: [{ speciesCode: 'bkcchi' }] };
  S.views.SOLD = { subId: 'SOLD', locId: 'L1', obsDt: '2026-08-01 08:00', allObsReported: true, obs: [{ speciesCode: 'whtspa' }] };
  S.fail.SBAD = true;
  const logs = [], warns = [];
  const r = await X.run({ key: 'k', root, fetch: S.fetch, now: NOW, pauseMs: 0, log: (s) => logs.push(s), warn: (s) => warns.push(s) });
  assert.equal(r.today, '2026-10-20');
  assert.equal(S.calls.filter((c) => c.includes('/checklist/view/')).length, 5, 'one view call per listed checklist, none for one too old for any window');
  const cache = J(`${root}/data/expected/cache-US-TEST.json`);
  assert.deepEqual(Object.keys(cache).sort(), ['S1', 'S2', 'S3', 'S4'], 'the failed one is not cached, the old one was never read');
  assert.deepEqual(cache.S1, { d: '2026-10-20', loc: 'L1', name: 'Mink Brook', complete: true, sp: ['bkcchi', 'myrwar', 'duck1'] });
  assert.equal(cache.S3.complete, false);
  const tax = J(`${root}/data/expected/taxonomy.json`);
  assert.equal(tax.myrwar.reportAs, 'yerwar'); assert.equal(tax.yerwar.name, 'Yellow-rumped Warbler'); assert.equal(tax.duck1.category, 'spuh');
  const out = J(`${root}/data/expected/US-TEST.json`);
  assert.equal(out.generated, NOW.toISOString());
  assert.deepEqual(out.region, { code: 'US-TEST', name: 'Test County' });
  assert.deepEqual(out.window, { from: '2026-10-11', to: '2026-10-20', lists: 3, locations: 2, basis: 'all', tz: 'UTC' });
  assert.equal(out.prev, null, 'one list in the ten days before is not enough for a trend');
  assert.deepEqual(out.species.map((s) => [s.name, s.share, s.lists, s.prevShare, s.trend]), [
    ['Black-capped Chickadee', 0.667, 2, null, null], ['Yellow-rumped Warbler', 0.667, 2, null, null], ['Blue Jay', 0.333, 1, null, null],
  ]);
  assert.match(logs[0], /^Test County: 3 lists \(all\), 3 species, 4 new checklists read$/);
  assert.match(warns[0], /US-TEST SBAD: 500 from api\.ebird\.org\/v2\/product\/checklist\/view\/SBAD/);

  // second run: nothing new is fetched for cached checklists; the taxonomy is not asked again
  S.calls.length = 0; S.fail = {};
  S.views.SBAD = { subId: 'SBAD', locId: 'L1', obsDt: '2026-10-18 08:00', allObsReported: true, obs: [{ speciesCode: 'rocpig1' }] };
  await X.run({ key: 'k', root, fetch: S.fetch, now: NOW, pauseMs: 0, log: () => {}, warn: () => {} });
  assert.deepEqual(S.calls.filter((c) => c.includes('/checklist/view/')), ['/v2/product/checklist/view/SBAD'], 'only the one it has not read');
  assert.deepEqual(S.calls.filter((c) => c.includes('/ref/taxonomy/')).map((c) => new URLSearchParams(c.split('?')[1]).get('species')), ['rocpig1', 'rocpig'], 'only the new code is looked up, and its species follows');
  const out2 = J(`${root}/data/expected/US-TEST.json`);
  assert.equal(out2.window.lists, 4);
  assert.ok(out2.species.some((s) => s.name === 'Rock Pigeon'), 'domestic form rolled up to the species through the cached taxonomy');

  // lists endpoint down: the region file is still rebuilt from the cache
  S.calls.length = 0; S.fail.lists = true; const w3 = [];
  const r3 = await X.run({ key: 'k', root, fetch: S.fetch, now: new Date('2026-10-21T13:00:00Z'), pauseMs: 0, log: () => {}, warn: (s) => w3.push(s) });
  assert.match(w3[0], /US-TEST lists: 500/);
  assert.equal(J(`${root}/data/expected/US-TEST.json`).window.to, '2026-10-21');
  assert.equal(r3.errors.length, 1);
});

test('run: at most MAX_NEW new checklists per region per run; the rest wait for tomorrow', async () => {
  const S = world();
  const root = tmpRoot([{ code: 'R', name: 'R', bbox: [0, 0, 1, 1] }]);
  S.lists.R = Array.from({ length: X.MAX_NEW + 20 }, (_, i) => ({ subId: 'S' + i, obsDt: '2026-10-20 07:00', loc: { locId: 'L', name: 'L' } }));
  for (const l of S.lists.R) S.views[l.subId] = { subId: l.subId, locId: 'L', obsDt: l.obsDt, allObsReported: true, obs: [{ speciesCode: 'blujay' }] };
  const logs = [];
  await X.run({ key: 'k', root, fetch: S.fetch, now: NOW, pauseMs: 0, log: (s) => logs.push(s), warn: () => {} });
  assert.equal(S.calls.filter((c) => c.includes('/checklist/view/')).length, X.MAX_NEW);
  assert.match(logs[0], /20 left for tomorrow/);
  assert.equal(Object.keys(J(`${root}/data/expected/cache-R.json`)).length, X.MAX_NEW);
});

test('the script prints one line and exits 0 without EBIRD_KEY', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [`${ROOT}/scripts/build_expected.mjs`], { env: { ...process.env, EBIRD_KEY: '' }, encoding: 'utf8' });
  assert.equal(out.trim(), 'build_expected: no EBIRD_KEY, nothing built');
  assert.ok(!existsSync(`${ROOT}/data/expected/undefined.json`));
});

// ---------------------------------------------------------------- js/brief.js side
test('REGIONS in js/brief.js equals data/regions.json', () => {
  const file = J(`${ROOT}/data/regions.json`).regions.map((r) => ({ code: r.code, name: r.name, bbox: r.bbox }));
  assert.deepEqual(B.REGIONS, file);
  for (const r of file) { const [s, w, n, e] = r.bbox; assert.ok(s < n && w < e && s > 42 && n < 46 && w > -74 && e < -70, r.code); }
});

test('regionFor: the Upper Valley towns land in their county; a point in two boxes goes to the nearer center; outside is null', () => {
  const at = (lat, lng) => (B.regionFor(lat, lng) || {}).code;
  assert.equal(at(43.6423, -72.2518), 'US-NH-009', 'Lebanon');
  assert.equal(at(43.7022, -72.2896), 'US-NH-009', 'Hanover');
  assert.equal(at(44.306, -71.77), 'US-NH-009', 'Littleton');
  assert.equal(at(43.7153, -72.3098), 'US-VT-027', 'Norwich');
  assert.equal(at(43.6489, -72.3193), 'US-VT-027', 'White River Junction');
  assert.equal(at(43.62, -72.52), 'US-VT-027', 'Woodstock');
  assert.equal(at(43.3767, -72.3467), 'US-NH-019', 'Claremont');
  assert.equal(at(43.365, -72.17), 'US-NH-019', 'Newport');
  assert.equal(at(43.92, -72.66), 'US-VT-017', 'Randolph');
  assert.equal(at(43.82, -72.25), 'US-VT-017', 'Thetford');
  assert.equal(at(42.36, -71.06), undefined, 'Boston');
  assert.equal(at('x', null), undefined);
  assert.equal(B.regionFor(0.9, 0.9, [{ code: 'A', bbox: [0, 0, 1, 1] }, { code: 'B', bbox: [0.4, 0.4, 2, 2] }]).code, 'B', 'nearer center wins');
  assert.equal(B.regionFor(0.5, 0.5, [{ code: 'A', bbox: [0, 0, 1, 1] }, { code: 'B', bbox: [0.4, 0.4, 2, 2] }]).code, 'A');
});

test('wording: shares, window label, the line, the status sentence, compose carries the top ten', () => {
  assert.equal(B.shareWords(0.68), 'on 7 in 10 checklists'); assert.equal(B.shareWords(0.04), 'on 1 in 10 checklists'); assert.equal(B.shareWords(0.9), 'on almost every checklist'); assert.equal(B.shareWords(0.949), 'on almost every checklist');
  assert.equal(B.shareShort(0.25), '3 in 10'); assert.equal(B.shareShort(0.24), '2 in 10'); assert.equal(B.shareShort(1), 'almost every');
  assert.equal(B.windowLabel('2026-10-11', '2026-10-20'), 'Oct 11–20'); assert.equal(B.windowLabel('2026-09-28', '2026-10-07'), 'Sep 28–Oct 7'); assert.equal(B.windowLabel('', '2026-10-07'), '');
  const exp = { region: { code: 'US-NH-009', name: 'Grafton County' }, window: { from: '2026-10-11', to: '2026-10-20', lists: 41 }, prev: { lists: 30 },
    species: Array.from({ length: 15 }, (_, i) => ({ code: 'c' + i, name: 'Bird ' + i, share: 0.9 - i * 0.05, prevShare: i === 0 ? 0.4 : i === 1 ? 0 : i === 2 ? null : 0.8, trend: ['arriving', 'new', null, 'tapering', 'steady'][Math.min(i, 4)], lists: 41 - i })) };
  assert.equal(B.expectedLine(exp), 'Grafton County, 41 checklists, Oct 11–20.');
  assert.equal(B.statusSentence(exp.species[0], exp), 'On 90% of 41 checklists in Grafton County over Oct 11–20, up from 40% the ten days before: arriving.');
  assert.equal(B.statusSentence(exp.species[1], exp), 'On 85% of 41 checklists in Grafton County over Oct 11–20, not reported the ten days before: new.');
  assert.equal(B.statusSentence(exp.species[2], exp), 'On 80% of 41 checklists in Grafton County over Oct 11–20.');
  assert.equal(B.statusSentence(exp.species[3], exp), 'On 75% of 41 checklists in Grafton County over Oct 11–20, down from 80% the ten days before: tapering.');
  assert.equal(B.statusSentence(exp.species[4], exp), 'On 70% of 41 checklists in Grafton County over Oct 11–20, about the same as the ten days before (80%): steady.');
  const b = B.compose({ place: 'Lebanon', date: '2026-10-20', wx: { temp: 41, wind: 5, windDir: 315, rain: 10, cloud: 20, cloudMid: 20, windMid: 5, high: 58, low: 35, sunrise: '07:05' }, expected: exp });
  assert.equal(b.expected.species.length, 10); assert.deepEqual(b.expected.species[0], { name: 'Bird 0', share: 0.9, trend: 'arriving' });
  const t = B.text(b);
  assert.match(t, /This week's birds \(Grafton County, 41 checklists, Oct 11–20\):\n- Bird 0 — almost every, arriving\n- Bird 1 — 9 in 10, new\n- Bird 2 — 8 in 10\n- Bird 3 — 8 in 10, tapering\n- Bird 4 — 7 in 10\n/);
  assert.ok(t.indexOf("This week's birds") > t.indexOf('First song') && t.indexOf("This week's birds") < t.indexOf('Where to go'), 'after the header lines, before the spots');
  const h = B.emailHtml(b);
  assert.match(h, /This week&#39;s birds<\/h3><p[^>]*>Grafton County, 41 checklists, Oct 11–20\. The share of eBird checklists each bird was on\.<\/p>/);
  assert.match(h, /<b>Bird 0<\/b> <span style="color:#5f6b63">— almost every<\/span> <span style="color:#E8833A;font-size:13px">arriving<\/span>/);
  assert.ok(!/<b>Bird 4<\/b>[^<]*<\/b> <span[^>]*>— 7 in 10<\/span> <span/.test(h), 'steady gets no word');
  assert.equal(B.compose({ place: 'x', date: '2026-10-20' }).expected, null);
  assert.equal(B.compose({ place: 'x', date: '2026-10-20', expected: { window: {}, species: [] } }).expected, null);
  assert.ok(!B.text(B.compose({ place: 'x', date: '2026-10-20' })).includes("This week's birds"));
});
