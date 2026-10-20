// Unit tests for the pure parts of js/stories.js (DAYBIRD_STORIES): no DOM, no network, no packages.
//   node --test tests/stories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('../data/traits.js'); require('../js/canvas-kit.js'); require('../js/stories.js');
const S = globalThis.DAYBIRD_STORIES, K = globalThis.DAYBIRD_KIT;

const NOW = new Date('2026-10-19T15:00:00');
const row = (subId, name, place, iso, n) => ({ subId, userDisplayName: name, numSpecies: n, obsDt: iso.split(' ')[0], isoObsDate: iso, loc: { locId: 'L' + subId, name } , locName: place });

test('dates: eBird shapes, local calendar, today/yesterday', () => {
  assert.equal(S.isoDate('2026-10-18 07:15'), '2026-10-18');
  assert.equal(S.isoDate('18 Oct 2026'), '2026-10-18');
  assert.equal(S.isoDate('18 Oct 2026 07:15'), '2026-10-18');
  assert.equal(S.isoDate('2026-10-18'), '2026-10-18');
  assert.equal(S.isoDate(''), ''); assert.equal(S.isoDate('nonsense'), '');
  assert.equal(S.time24('2026-10-18 07:15'), '07:15'); assert.equal(S.time24('7:05'), '07:05'); assert.equal(S.time24(''), '');
  assert.equal(S.ampm('2026-10-18 07:15'), '7:15 AM'); assert.equal(S.ampm('13:40'), '1:40 PM'); assert.equal(S.ampm('00:05'), '12:05 AM'); assert.equal(S.ampm(''), '');
  assert.equal(S.relation('2026-10-19', NOW), 'today'); assert.equal(S.relation('2026-10-18', NOW), 'yesterday'); assert.equal(S.relation('2026-10-17', NOW), 'other');
  assert.equal(S.localISO(NOW), '2026-10-19');
  assert.equal(S.minutesLabel(65), '65 minutes'); assert.equal(S.minutesLabel(120), '2 hours'); assert.equal(S.minutesLabel(140), '2h 20m'); assert.equal(S.minutesLabel(null), ''); assert.equal(S.minutesLabel(0), '');
});

test('myLists: mine only (case-insensitive), last 14 days, newest first, no duplicates', () => {
  const rows = [
    row('S1', 'Benjamin Morris', 'A', '2026-10-10 07:00', 9),
    row('S2', 'benjamin morris ', 'B', '2026-10-18 06:40', 13),
    row('S3', 'Someone Else', 'C', '2026-10-18 07:00', 4),
    row('S4', 'Benjamin Morris', 'D', '2026-10-01 07:00', 20),     // 18 days ago
    row('S2', 'Benjamin Morris', 'B', '2026-10-18 06:40', 13),     // duplicate (two regions)
    { subId: 'S5', userDisplayName: 'Benjamin Morris', obsDt: '19 Oct 2026', obsTime: '07:12', loc: { name: 'E' }, numSpecies: 2 }, // list-row shape without isoObsDate
  ];
  const mine = S.myLists(rows, 'Benjamin Morris', { now: NOW });
  assert.deepEqual(mine.map(l => l.subId), ['S5', 'S2', 'S1']);
  assert.deepEqual(mine[0], { subId: 'S5', place: 'E', locId: '', date: '2026-10-19', time: '07:12', numSpecies: 2 });
  assert.equal(mine[1].time, '06:40');
  assert.deepEqual(S.myLists(rows, 'nobody', { now: NOW }), []); assert.deepEqual(S.myLists(null, 'x'), []);
  assert.equal(S.myLists(rows, 'Benjamin Morris', { now: NOW, days: 30 }).length, 4);
});

test('outingFromChecklist: names from codes, non-species dropped, subspecies collapsed, minutes from durationHrs', () => {
  const view = { subId: 'S2', obsDt: '2026-10-18 06:40', durationHrs: 1.0833, numObservers: 2, locId: 'L2',
    obs: [{ speciesCode: 'cangoo' }, { speciesCode: 'duck1' }, { speciesCode: 'deejun1' }, { speciesCode: 'deejun2' }, { comName: 'Mallard x American Black Duck (hybrid)' }, { speciesCode: 'x' }, { speciesCode: 'cangoo' }, { comName: 'Mallard (Domestic type)' }] };
  const names = { cangoo: 'Canada Goose', duck1: 'duck sp.', deejun1: 'Dark-eyed Junco (Slate-colored)', deejun2: 'Dark-eyed Junco (Oregon)' };
  const o = S.outingFromChecklist(view, { subId: 'S2', place: 'Deweys Mill Pond - Hartford (56 acres)', date: '2026-10-18', time: '06:40' }, names);
  assert.deepEqual(o.species, ['Canada Goose', 'Dark-eyed Junco']);
  assert.equal(o.minutes, 65); assert.equal(o.observers, 2); assert.equal(o.date, '2026-10-18'); assert.equal(o.time, '6:40 AM'); assert.equal(o.place, 'Deweys Mill Pond - Hartford (56 acres)'); assert.equal(o.source, 'ebird');
  const bare = S.outingFromChecklist({ obs: [] }, { subId: 'S9', place: 'P', date: '2026-10-01' }, {});
  assert.deepEqual(bare.species, []); assert.equal(bare.minutes, null); assert.equal(bare.date, '2026-10-01'); assert.equal(bare.subId, 'S9');
});

test('outingFromForm: one per line, blanks and non-species dropped, duplicates merged, best must be on the list', () => {
  const o = S.outingFromForm({ place: '  Mink Brook ', date: '2026-10-19', minutes: '35.4', species: 'Winter Wren\n\n  blue jay\nBlue Jay\nduck sp.\nWinter Wren (hybrid)\nHermit Thrush; Veery', best: 'Veery' });
  assert.deepEqual(o.species, ['Winter Wren', 'blue jay', 'Hermit Thrush', 'Veery']);
  assert.equal(o.place, 'Mink Brook'); assert.equal(o.minutes, 35); assert.equal(o.best, 'Veery'); assert.equal(o.source, 'typed');
  const d = S.outingFromForm({ species: 'A', best: 'Zzz', minutes: '-3' });
  assert.equal(d.place, 'Somewhere'); assert.equal(d.best, null); assert.equal(d.minutes, null); assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('pickBest and plan: the pick, else a lifer, else the first non-everyday bird; list pages of 28', () => {
  const sp = ['Canada Goose', 'Mallard', 'Rock Pigeon', 'Mourning Dove', 'Blue Jay', 'American Crow', 'Savannah Sparrow', 'Northern Cardinal'];
  assert.equal(S.pickBest(sp), 'Savannah Sparrow');
  assert.equal(S.pickBest(sp, { best: 'Mallard' }), 'Mallard');
  assert.equal(S.pickBest(sp, { best: 'Not Here' }), 'Savannah Sparrow');
  assert.equal(S.pickBest(sp, { have: new Set(sp.filter(n => n !== 'Northern Cardinal')) }), 'Northern Cardinal', 'a lifer wins');
  assert.equal(S.pickBest(sp, { have: new Set(sp) }), 'Savannah Sparrow', 'nothing new: first non-everyday');
  assert.equal(S.pickBest(sp, { have: new Set() }), 'Savannah Sparrow', 'an empty set is no list');
  assert.equal(S.pickBest(['Mallard', 'American Robin']), 'Mallard', 'all everyday: the first');
  assert.equal(S.pickBest([]), null); assert.equal(S.pickBest(null), null);
  assert.ok(S.isEveryday('European Starling') && S.isEveryday('house sparrow') && !S.isEveryday('Savannah Sparrow'));
  assert.ok(S.isLifer('Zzz', new Set(['A'])) && !S.isLifer('A', new Set(['A'])) && !S.isLifer('A', new Set()) && !S.isLifer('A', null));
  const many = Array.from({ length: 45 }, (_, i) => `Bird ${i + 1}`);
  const p = S.plan({ species: many, best: 'Bird 40' }, { have: new Set(many.slice(0, 44)) });
  assert.equal(p.best, 'Bird 40');
  assert.deepEqual(p.slides.map(s => s.kind), ['cover', 'highlight', 'list', 'list']);
  assert.equal(p.slides[1].lifer, false); assert.equal(p.slides[2].names.length, 28); assert.equal(p.slides[3].names.length, 17); assert.equal(p.slides[3].more, true); assert.equal(p.slides[2].more, false);
  const one = S.plan({ species: ['Bird 45'] }, { have: new Set(many.slice(0, 44)) });
  assert.deepEqual(one.slides.map(s => s.kind), ['cover', 'highlight', 'list']); assert.equal(one.slides[1].lifer, true);
  assert.deepEqual(S.plan({ species: [] }).slides.map(s => s.kind), ['cover', 'list']);
  assert.deepEqual(S.chunk([1, 2, 3], 2), [[1, 2], [3]]); assert.deepEqual(S.chunk([], 2), [[]]);
  assert.equal(S.PER_SLIDE, 28);
});

test('hints, lifer numbers and file names', () => {
  assert.equal(S.hintFor('savannah sparrow'), 'streaky, yellow in front of eye');
  assert.equal(S.hintFor('Zzz Bird'), '');
  const L = { total: 148, allSpecies: ['Chipping Sparrow', 'Hermit Thrush', 'Blue Jay'], recentLifers: [{ name: 'Chipping Sparrow' }, { name: 'Hermit Thrush' }] };
  assert.equal(S.liferNumber('Chipping Sparrow', L), 148); assert.equal(S.liferNumber('Hermit Thrush', L), 147);
  assert.equal(S.liferNumber('Blue Jay', L), null, 'on the list but not among the recent ten: unknown');
  assert.equal(S.liferNumber('Savannah Sparrow', L), 149, 'not on the list yet');
  assert.equal(S.liferNumber('Savannah Sparrow', null), null); assert.equal(S.liferNumber('x', { total: 0 }), null);
  assert.equal(S.liferTotal('Blue Jay', L), 148); assert.equal(S.liferTotal('Savannah Sparrow', L), 149); assert.equal(S.liferTotal('x', null), null);
  assert.equal(S.fileName({ date: '2026-10-19' }, 0), 'daybird-story-2026-10-19-1.png');
  assert.equal(S.liferFileName({ name: "Townsend's Solitaire" }), 'daybird-lifer-townsend-s-solitaire.png');
  assert.equal(S.slug(''), 'bird');
  assert.equal(S.shareText({ species: ['a', 'b'], place: 'Mink Brook' }, 'Veery'), '2 species at Mink Brook, best bird Veery. day-bird.com');
  assert.equal(S.shareText({ species: [], place: 'P' }, null), '0 species at P. day-bird.com');
});

test('canvas kit: wrap, ellipsize and fit with a fake measuring context', () => {
  // 10px per character at any size × size/10, so widths are predictable
  const ctx = { font: '', measureText: (t) => ({ width: t.length * (parseInt(ctx.font.match(/(\d+)px/)[1], 10) / 10) * 10 }) };
  ctx.font = '700 10px x';
  assert.deepEqual(K.wrap(ctx, 'Deweys Mill Pond - Hartford', 120), ['Deweys Mill', 'Pond -', 'Hartford']);
  assert.deepEqual(K.wrap(ctx, 'Supercalifragilistic word', 100), ['Supercalifragilistic', 'word'], 'a long word gets its own line');
  assert.equal(K.ellipsize(ctx, 'Deweys Mill Pond', 80), 'Deweys…'); assert.equal(K.ellipsize(ctx, 'short', 80), 'short');
  const f = K.fit(ctx, 'Deweys Mill Pond - Hartford (56 acres)', { family: 'x', maxW: 900, start: 84, min: 48, maxLines: 2 });
  assert.ok(f.size >= 48 && f.size <= 84); assert.ok(f.lines.length <= 2); assert.ok(f.widths.every(w => w <= 900));
  const g = K.fit(ctx, 'x'.repeat(200), { family: 'x', maxW: 900, start: 84, min: 48, maxLines: 1 });
  assert.equal(g.size, 48); assert.ok(g.lines[0].endsWith('…')); assert.ok(g.widths[0] <= 900, 'even a 200-letter word is cut, never overflowing');
  assert.equal(K.SKY.go.length, 3); assert.equal(K.SKY_INK.stay, K.PAPER); assert.equal(K.SKY_ACCENT.go, K.INK, 'navy carries the accent on the amber sky');
});

test('shareFiles: unsupported without navigator.share or File, cancelled on AbortError, shared otherwise', async () => {
  const files = [new File(['x'], 'a.png', { type: 'image/png' })];
  assert.equal(await K.shareFiles(files, { navigator: {} }), 'unsupported');
  assert.equal(await K.shareFiles([], { navigator: { share: async () => {} } }), 'unsupported');
  assert.equal(await K.shareFiles(files, { navigator: { share: async () => {}, canShare: () => false } }), 'unsupported');
  assert.equal(await K.shareFiles(files, { navigator: { share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } } }), 'cancelled');
  assert.equal(await K.shareFiles(files, { navigator: { share: async () => { throw new Error('nope'); } } }), 'unsupported');
  let got = null;
  assert.equal(await K.shareFiles(files, { navigator: { share: async (d) => { got = d; }, canShare: () => true }, title: 'T', text: 'x' }), 'shared');
  assert.equal(got.files.length, 1); assert.equal(got.title, 'T');
});
