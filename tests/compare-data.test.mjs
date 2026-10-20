// Shape checks for data/tells.js (DAYBIRD_TELLS) and data/status.js (DAYBIRD_STATUS), plus the pure helpers in
// js/compare.js (expected-file normalizing, ordering). Run: node --test tests/compare-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
require(join(ROOT, 'data/tells.js'));
require(join(ROOT, 'data/status.js'));
require(join(ROOT, 'data/traits.js'));
require(join(ROOT, 'js/compare.js'));   // no DOM here: it only defines DAYBIRD_COMPARE
const TELLS = globalThis.DAYBIRD_TELLS, STATUS = globalThis.DAYBIRD_STATUS, TRAITS = globalThis.DAYBIRD_TRAITS, C = globalThis.DAYBIRD_COMPARE;
const EXPECTED_GROUPS = ['sparrows', 'ducks', 'warblers', 'woodpeckers', 'hawks', 'finches', 'thrushes', 'flycatchers', 'gulls', 'swallows', 'wrens-and-kinglets', 'blackbirds', 'chickadees-nuthatches-and-creeper'];
const traitNames = new Set(TRAITS.map(t => t[0]));

test('tells: the thirteen groups, in order, each with 3–6 species and the fields filled', () => {
  assert.deepEqual(TELLS.map(g => g.key), EXPECTED_GROUPS);
  for (const g of TELLS) {
    assert.ok(g.title && g.one && g.intro, g.key + ' has title, one and intro');
    assert.ok(g.species.length >= 3 && g.species.length <= 6, `${g.key} has ${g.species.length} species`);
    for (const s of g.species) {
      assert.ok(s.name && s.name.trim(), g.key + ': a species has no name');
      assert.ok(typeof s.look === 'string' && s.look.trim().length > 20, s.name + ' has a look line');
      assert.ok(!/[!]|\p{Extended_Pictographic}/u.test(s.look), s.name + ': no exclamation marks or emoji in the look line');
    }
  }
});

test('tells: species names are unique across groups and match data/traits.js spelling where present', () => {
  const all = TELLS.flatMap(g => g.species.map(s => s.name));
  assert.equal(new Set(all).size, all.length, 'a species appears in two groups: ' + all.filter((n, i) => all.indexOf(n) !== i));
  // a name that differs from traits.js only by case or punctuation is a typo, not a new bird
  const loose = (n) => n.toLowerCase().replace(/[^a-z]/g, '');
  const traitLoose = new Map(TRAITS.map(t => [loose(t[0]), t[0]]));
  for (const n of all) if (!traitNames.has(n) && traitLoose.has(loose(n))) assert.fail(`${n} should be spelled ${traitLoose.get(loose(n))} as in data/traits.js`);
  assert.ok(all.length >= 40, `about 45 species expected, got ${all.length}`);
});

test('tells: every vs key names a species in the same group, both directions exist, no empty lines', () => {
  let pairs = 0;
  for (const g of TELLS) {
    const names = g.species.map(s => s.name);
    for (const s of g.species) {
      const others = names.filter(n => n !== s.name);
      assert.ok(s.vs && typeof s.vs === 'object', s.name + ' has vs');
      for (const [k, line] of Object.entries(s.vs)) {
        assert.ok(names.includes(k), `${s.name}.vs["${k}"]: not in group ${g.key}`);
        assert.notEqual(k, s.name, s.name + ' compares itself');
        assert.ok(typeof line === 'string' && line.trim().length > 15, `${s.name}.vs["${k}"] is empty or too short`);
        assert.ok(!/[!]/.test(line), `${s.name}.vs["${k}"]: no exclamation marks`);
        const back = g.species.find(x => x.name === k);
        assert.ok(back.vs && back.vs[s.name], `${k}.vs["${s.name}"] is missing (the other direction)`);
      }
      for (const o of others) assert.ok(s.vs[o], `${s.name} has no line against ${o}`);
      pairs += others.length;
    }
  }
  pairs /= 2;
  assert.ok(pairs >= 60 && pairs <= 90, `expected about 60–80 pairs, got ${pairs}`);
});

test('tells helpers: groupOf and get', () => {
  assert.equal(TELLS.groupOf('Song Sparrow').key, 'sparrows');
  assert.equal(TELLS.groupOf('Nope'), null);
  assert.equal(TELLS.get('Downy Woodpecker').group, 'woodpeckers');
  assert.match(TELLS.get('Downy Woodpecker').look, /bill/i);
});

test('status: at least 40 species, 4 seasons each, months within 1–12, types valid, names match traits.js', () => {
  const names = STATUS.names();
  assert.ok(names.length >= 40, `got ${names.length}`);
  assert.equal(new Set(names).size, names.length, 'names unique');
  for (const n of names) {
    const e = STATUS.species[n];
    assert.ok(['resident', 'summer', 'winter', 'migrant'].includes(e.type), n + ' type');
    assert.ok(Array.isArray(e.months) && e.months.length >= 1 && e.months.length <= 12, n + ' months');
    for (const m of e.months) assert.ok(Number.isInteger(m) && m >= 1 && m <= 12, `${n}: month ${m}`);
    assert.equal(new Set(e.months).size, e.months.length, n + ' months unique');
    if (e.type === 'resident') assert.equal(e.months.length, 12, n + ' resident has all months');
    assert.deepEqual(Object.keys(e.seasons).sort(), ['fall', 'spring', 'summer', 'winter'], n + ' four seasons');
    for (const [s, line] of Object.entries(e.seasons)) {
      assert.ok(typeof line === 'string' && line.trim().length > 25, `${n}.${s} empty`);
      assert.ok(!/[!]/.test(line), `${n}.${s}: no exclamation marks`);
    }
    assert.ok(traitNames.has(n), n + ' is spelled as in data/traits.js');
  }
  // every tells species that is a feeder/yard/edge bird in traits should have a status entry (so bird.html has something to say)
  const tellNames = TELLS.flatMap(g => g.species.map(s => s.name));
  const missing = tellNames.filter(n => traitNames.has(n) && !STATUS.species[n] && TRAITS.find(t => t[0] === n)[3].some(h => ['feeder', 'yard'].includes(h)));
  assert.deepEqual(missing, [], 'feeder/yard birds on compare.html without a status entry');
});

test('status.now: season lines and the status word from type and months', () => {
  const oct = new Date(2026, 9, 20), jan = new Date(2026, 0, 15), apr = new Date(2026, 3, 10), jul = new Date(2026, 6, 4), sep = new Date(2026, 8, 15), nov = new Date(2026, 10, 15);
  const ws = STATUS.now('White-throated Sparrow', oct);
  assert.equal(ws.season, 'fall'); assert.equal(ws.word, 'Peaking'); assert.equal(ws.present, true);
  assert.equal(ws.line, STATUS.species['White-throated Sparrow'].seasons.fall);
  assert.equal(STATUS.now('White-throated Sparrow', sep).word, 'Arriving');
  assert.equal(STATUS.now('White-throated Sparrow', nov).word, 'Leaving');
  assert.equal(STATUS.now('White-throated Sparrow', apr).word, 'Passing through');
  assert.equal(STATUS.now('White-throated Sparrow', jan).word, 'Gone until April');
  assert.equal(STATUS.now('Black-capped Chickadee', jan).word, 'Here all year');
  assert.equal(STATUS.now('Dark-eyed Junco', jan).word, 'Here for the winter');
  assert.equal(STATUS.now('Dark-eyed Junco', sep).word, 'Arriving');
  assert.equal(STATUS.now('Dark-eyed Junco', apr).word, 'Leaving');
  assert.equal(STATUS.now('Dark-eyed Junco', jul).word, 'Gone until September');
  assert.equal(STATUS.now('Baltimore Oriole', jul).word, 'Here for the summer');
  assert.equal(STATUS.now('Baltimore Oriole', new Date(2026, 4, 1)).word, 'Arriving');
  assert.equal(STATUS.now('Baltimore Oriole', oct).word, 'Gone until May');
  assert.equal(STATUS.now('Not A Bird', oct), null);
  assert.deepEqual(STATUS.now('Mallard', oct).months.length, 12);
  assert.equal(STATUS.seasonOf(12), 'winter'); assert.equal(STATUS.seasonOf(2), 'winter'); assert.equal(STATUS.seasonOf(3), 'spring'); assert.equal(STATUS.seasonOf(8), 'summer');
});

test('compare: bounding boxes in the shapes regions.json might use', () => {
  const b = C._box;
  assert.deepEqual(b([43.4, -72.6, 44.1, -71.9]), { s: 43.4, w: -72.6, n: 44.1, e: -71.9 }); // Daybird order: south, west, north, east
  assert.deepEqual(b({ south: 43.4, west: -72.6, north: 44.1, east: -71.9 }), { s: 43.4, w: -72.6, n: 44.1, e: -71.9 });
  assert.deepEqual(b({ s: 43.4, w: -72.6, n: 44.1, e: -71.9 }), { s: 43.4, w: -72.6, n: 44.1, e: -71.9 });
  assert.deepEqual(b({ minLat: 43.4, minLng: -72.6, maxLat: 44.1, maxLng: -71.9 }), { s: 43.4, w: -72.6, n: 44.1, e: -71.9 });
  assert.equal(b({ foo: 1 }), null); assert.equal(b(null), null);
});

test('compare: normalizing an expected file and the count line', () => {
  const ex = C._normalize({ name: 'Grafton County', from: '2026-10-10', to: '2026-10-20', checklists: 41, species: { 'White-throated Sparrow': 0.68, 'Song Sparrow': { freq: 12, n: 5 }, 'Dark-eyed Junco': { frequency: 0.3 } } }, { name: 'x' }, 'US-NH-009');
  assert.equal(ex.name, 'Grafton County'); assert.equal(ex.window, 'Oct 10–20'); assert.equal(ex.checklists, 41);
  assert.equal(ex.freq('White-throated Sparrow'), 0.68); assert.equal(ex.freq('Song Sparrow'), 0.12); assert.equal(ex.freq('Dark-eyed Junco'), 0.3);
  assert.equal(ex.freq('Veery'), null); assert.equal(ex.has('Veery'), false);
  assert.equal(C.countLine(ex, 'White-throated Sparrow'), 'On 68% of 41 checklists in Grafton County, Oct 10–20');
  assert.equal(C.countLine(ex, 'Veery'), ''); assert.equal(C.countLine(null, 'Veery'), '');
  const arr = C._normalize({ region: 'Windsor County', start: '2026-10-28', end: '2026-11-04', n: 7, species: [{ comName: 'Blue Jay', pct: 71 }] }, null, 'US-VT-027');
  assert.equal(arr.window, 'Oct 28–Nov 4'); assert.equal(arr.freq('Blue Jay'), 0.71); assert.equal(C.countLine(arr, 'Blue Jay'), 'On 71% of 7 checklists in Windsor County, Oct 28–Nov 4');
  assert.equal(C._windowLabel('', ''), '');
});

test('compare.order: with expected data the most-reported bird comes first and gets the chip; without it, birds that are away go last', () => {
  const sparrows = TELLS.find(g => g.key === 'sparrows');
  const ex = C._normalize({ name: 'Grafton County', checklists: 41, species: { 'Dark-eyed Junco': 0.8, 'White-throated Sparrow': 0.68, 'Song Sparrow': 0.1, 'Chipping Sparrow': 0.01 } }, null, 'X');
  const withEx = C.order(sparrows, ex, new Date(2026, 9, 20));
  assert.deepEqual(withEx.slice(0, 3).map(s => s.name), ['Dark-eyed Junco', 'White-throated Sparrow', 'Song Sparrow']);
  assert.deepEqual(withEx.slice(0, 4).map(s => s.chip), ['likely this week', 'likely this week', 'possible this week', null]);
  assert.ok(withEx.slice(3).every(s => s.chip === null));
  const without = C.order(sparrows, null, new Date(2026, 0, 15));   // January: only the junco and the house sparrow are around
  assert.deepEqual(without.slice(0, 2).map(s => s.name).sort(), ['Dark-eyed Junco', 'House Sparrow']);
  assert.equal(without.find(s => s.name === 'Chipping Sparrow').chip, 'Gone until April');
  assert.equal(without.find(s => s.name === 'Dark-eyed Junco').chip, null);
  const octNo = C.order(sparrows, null, new Date(2026, 9, 20));
  assert.deepEqual(octNo.map(s => s.name), sparrows.species.map(s => s.name), 'in October everyone is around, so the hand-written order stands');
});
