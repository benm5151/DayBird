/* Daybird learn-and-play engine — the pure half of learn.html.
   Picks the "first 10" birds, the weekly groups, the monthly bingo card, the bird of the day and the quick quiz
   from whatever species are being reported nearby (data/brief.json `recent`, else data/mock.js) and the trait
   table (data/traits.js). Also the streak arithmetic. No network, no DOM, no storage: learn.html and js/app.js
   hold the state, this file decides. Loads as a plain <script> or a Node require (it only sets a global). */
(function (root) {
  const B = () => root.DAYBIRD_BRIEF;

  // ---------------------------------------------------------------- season rules (hand-written; edit here)
  // Month → what the bingo card leans toward. `prefer` habitats/behaviors add a point each when picking fill-in
  // species; `skip` names species that are simply not here in that season, so they never land on a card.
  // Northeast US. Keep it blunt: a card is a game, not a range map.
  const SUMMER_ONLY = ['Yellow Warbler', 'Common Yellowthroat', 'Black-throated Green Warbler', 'Black-and-white Warbler', 'American Redstart',
    'Ovenbird', 'Northern Waterthrush', 'Magnolia Warbler', 'Palm Warbler', 'Yellow-rumped Warbler', 'Pine Warbler', 'Blue-headed Vireo', 'Red-eyed Vireo', 'Scarlet Tanager', 'Indigo Bunting',
    'Baltimore Oriole', 'Bobolink', 'Eastern Meadowlark', 'Rose-breasted Grosbeak', 'Ruby-throated Hummingbird', 'Tree Swallow', 'Barn Swallow', 'Bank Swallow', 'Chimney Swift',
    'Eastern Phoebe', 'Eastern Kingbird', 'Eastern Wood-Pewee', 'Wood Thrush', 'Veery', 'Hermit Thrush', 'Gray Catbird', 'Brown Thrasher', 'House Wren', 'Chipping Sparrow', 'Field Sparrow',
    'Savannah Sparrow', 'Swamp Sparrow', 'Eastern Towhee', 'Osprey', 'Broad-winged Hawk', 'Green Heron', 'Spotted Sandpiper', 'Solitary Sandpiper', 'Killdeer', 'Wilson\'s Snipe',
    'American Woodcock', 'Wood Duck', 'Pied-billed Grebe', 'Common Loon', 'Double-crested Cormorant', 'Ruby-crowned Kinglet', 'Sandhill Crane', 'American Pipit', 'Red-winged Blackbird', 'Common Grackle', 'Brown-headed Cowbird'];
  const WINTER_ONLY = ['Snow Bunting', 'Common Redpoll', 'Pine Siskin', 'Evening Grosbeak', 'Horned Lark', 'Dark-eyed Junco', 'White-throated Sparrow', 'White-crowned Sparrow', 'Rusty Blackbird', 'Golden-crowned Kinglet', 'Winter Wren'];
  const SEASON_RULES = {
    winter: { months: [12, 1, 2],   label: 'winter',      prefer: ['feeder', 'yard', 'field', 'river', 'lake', 'flocking'], skip: SUMMER_ONLY },
    spring: { months: [3, 4, 5],    label: 'spring',      prefer: ['edge', 'marsh', 'pond', 'forest', 'singing'],           skip: ['Snow Bunting', 'Common Redpoll', 'Horned Lark'] },
    summer: { months: [6, 7, 8],    label: 'summer',      prefer: ['forest', 'field', 'marsh', 'yard', 'singing', 'flying'], skip: WINTER_ONLY },
    fall:   { months: [9, 10, 11],  label: 'fall',        prefer: ['edge', 'field', 'sky', 'pond', 'lake', 'flocking', 'soaring'], skip: ['Snow Bunting', 'Common Redpoll', 'Horned Lark', 'Yellow Warbler', 'Baltimore Oriole', 'Bobolink', 'Chimney Swift'] },
  };
  function seasonOf(month) { return Object.values(SEASON_RULES).find((s) => s.months.includes(Number(month))) || SEASON_RULES.fall; }

  // ---------------------------------------------------------------- small tools
  // FNV-1a: the same string always gives the same 32-bit number, in every browser.
  function hash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  // mulberry32: a tiny seeded random, so a card seeded the same way shuffles the same way.
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function shuffle(arr, rand) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const names = (recent) => { const out = [], seen = new Set(); for (const r of recent || []) { const n = typeof r === 'string' ? r : r && r.comName; if (n && !seen.has(n)) { seen.add(n); out.push(n); } } return out; };
  function byName(traits) { const m = new Map(); (traits || []).forEach((r) => m.set(r[0], r)); return m; }
  const row = (r) => ({ name: r[0], size: r[1], colors: r[2], habitats: r[3], behaviors: r[4], hint: r[5], group: B() ? B().groupOf(r[0]) : null });
  const SIZE_WORD = { tiny: 'tiny', sparrow: 'sparrow-sized', robin: 'robin-sized', jay: 'jay-sized', crow: 'crow-sized', hawk: 'hawk-sized', goose: 'goose-sized' };
  const sizeWord = (s) => SIZE_WORD[s] || s;
  const WHERE = { feeder: 'at the feeder', yard: 'in the yard', forest: 'in the woods', edge: 'where trees meet open ground', field: 'over fields', marsh: 'in the marsh', pond: 'on a pond', river: 'along the river', lake: 'on the lake', shore: 'on the shoreline', sky: 'overhead' };
  const whereLine = (habitats) => (habitats || []).slice(0, 3).map((h) => WHERE[h] || h).join(', ');

  // ---------------------------------------------------------------- 1. first ten birds
  // "Learnable": easy to see (feeder, yard, edge), not tiny, with a hint a beginner can hold onto.
  function learnScore(r) {
    let s = 0; const hab = r[3] || [], beh = r[4] || [], hint = r[5] || '';
    if (hab.includes('feeder')) s += 3; if (hab.includes('yard')) s += 2; if (hab.includes('edge')) s += 1; if (hab.includes('field')) s += 1;
    if (beh.includes('feeder')) s += 2; if (beh.includes('ground')) s += 1; if (beh.includes('singing')) s += 1; if (beh.includes('perched')) s += 1;
    if (r[1] === 'tiny') s -= 2; if (r[1] === 'hawk' || r[1] === 'goose') s += 1;
    if (/'/.test(hint)) s += 1;               // a sound you can say out loud
    if (/male|female/.test(hint)) s -= 1;    // two looks to learn, not one
    return s;
  }
  function firstTen(recent, traits, n = 10) {
    const T = byName(traits); const near = names(recent).map((nm) => T.get(nm)).filter(Boolean);
    const rank = (rows) => rows.map((r, i) => ({ r, s: learnScore(r), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
    const picked = rank(near).slice(0, n);
    if (picked.length < n) { const have = new Set(picked.map((r) => r[0])); for (const r of rank(traits || [])) { if (picked.length >= n) break; if (!have.has(r[0])) { picked.push(r); have.add(r[0]); } } }
    return picked.map((r) => ({ ...row(r), sizeWord: sizeWord(r[1]), where: whereLine(r[3]), nearby: near.includes(r) }));
  }

  // ---------------------------------------------------------------- 2. this week
  // Top groups from the engine, with the engine's own tip at the user's level, and 2–3 named birds from the reports.
  function groupTip(key, sampleName, level) {
    const g = B().lookFor([sampleName], 'any', level)[0];
    return g && g.key === key ? g.tip : '';
  }
  function weekGroups(recent, traits, level = 'new', n = 5) {
    const T = byName(traits);
    return B().groups(names(recent)).slice(0, n).map((g) => {
      const known = g.species.filter((s) => T.has(s)).slice(0, 3).map((s) => row(T.get(s)));
      const members = known.length ? known : g.species.slice(0, 3).map((s) => ({ name: s, hint: '' }));
      return { key: g.key, count: g.count, tip: groupTip(g.key, g.species[0], level), members };
    });
  }
  // Monday of the week that holds `date` (YYYY-MM-DD).
  function weekOf(date) { const d = new Date(`${date}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }

  // ---------------------------------------------------------------- 3. bingo
  // Same month + same rounded place = same 25 squares. Reported species first, season-friendly fill after.
  const placeKey = (lat, lng) => `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
  function bingoKey(yyyymm, lat, lng) { return `${yyyymm}|${placeKey(lat, lng)}`; }
  function bingoCard(recent, traits, yyyymm, lat, lng, n = 25) {
    const key = bingoKey(yyyymm, lat, lng), rand = rng(hash(key)), season = seasonOf(Number(yyyymm.slice(5, 7)));
    const skip = new Set(season.skip); const T = byName(traits);
    const pref = (r) => (r[3] || []).concat(r[4] || []).filter((x) => season.prefer.includes(x)).length;
    const near = shuffle(names(recent).filter((nm) => T.has(nm) && !skip.has(nm)), rand);
    const picked = near.slice(0, n); const have = new Set(picked);
    if (picked.length < n) {
      const rest = (traits || []).filter((r) => !have.has(r[0]) && !skip.has(r[0]));
      // bucket by preference so likelier birds come first, shuffled within each bucket
      const buckets = {}; rest.forEach((r) => (buckets[pref(r)] = buckets[pref(r)] || []).push(r[0]));
      for (const k of Object.keys(buckets).map(Number).sort((a, b) => b - a)) for (const nm of shuffle(buckets[k], rand)) { if (picked.length >= n) break; picked.push(nm); }
    }
    const squares = picked.slice(0, n).map((nm) => { const r = T.get(nm); return r ? { ...row(r), nearby: near.includes(nm) } : { name: nm, hint: '', nearby: true }; });
    return { key, month: yyyymm, season: season.label, place: placeKey(lat, lng), squares };
  }
  // Completed rows, columns and diagonals on a 5×5 card, given the marked names.
  function bingoLines(squares, marked) {
    const m = new Set(marked || []); const at = (i) => squares[i] && m.has(squares[i].name);
    const lines = []; const size = Math.round(Math.sqrt(squares.length)) || 5;
    for (let r = 0; r < size; r++) if (Array.from({ length: size }, (_, c) => at(r * size + c)).every(Boolean)) lines.push(`row ${r + 1}`);
    for (let c = 0; c < size; c++) if (Array.from({ length: size }, (_, r) => at(r * size + c)).every(Boolean)) lines.push(`column ${c + 1}`);
    if (Array.from({ length: size }, (_, i) => at(i * size + i)).every(Boolean)) lines.push('diagonal');
    if (Array.from({ length: size }, (_, i) => at(i * size + (size - 1 - i))).every(Boolean)) lines.push('diagonal');
    return lines;
  }

  // ---------------------------------------------------------------- 4. bird of the day
  function birdOfDay(recent, traits, date) {
    const T = byName(traits); const pool = names(recent).filter((nm) => T.has(nm));
    const rows = pool.length ? pool.map((nm) => T.get(nm)) : (traits || []);
    if (!rows.length) return null;
    const r = rows[hash(`bird-of-the-day|${date}`) % rows.length];
    return { ...row(r), sizeWord: sizeWord(r[1]), where: whereLine(r[3]), date, nearby: pool.length > 0, song: xenoCantoUrl(r[0]), photos: allAboutBirdsUrl(r[0]) };
  }
  const xenoCantoUrl = (name) => `https://xeno-canto.org/explore?query=${encodeURIComponent(name)}`;
  // All About Birds slugs are the name with spaces as underscores and punctuation dropped: "Wilsons_Snipe". A few may 404.
  const allAboutBirdsUrl = (name) => `https://www.allaboutbirds.org/guide/${encodeURIComponent(String(name).replace(/['’.]/g, '').replace(/\s+/g, '_'))}/overview`;

  // ---------------------------------------------------------------- 5. challenges (data/challenges.js)
  function challengeSpecies(ch, traits) {
    if (ch.species) return ch.species.map((nm) => byName(traits).get(nm)).filter(Boolean).map(row);
    return (traits || []).filter((r) => (!ch.group || B().groupOf(r[0]) === ch.group) && (!ch.behavior || (r[4] || []).includes(ch.behavior)) && (!ch.habitat || (r[3] || []).some((h) => ch.habitat.includes(h))))
      .map(row).slice(0, ch.limit || 12);
  }

  // ---------------------------------------------------------------- 6. streak: lives in js/app.js (DB.streak, DB.markOutside) so every page can call it

  // ---------------------------------------------------------------- 7. quick quiz
  // Five stay-in style questions from the engine, with distinct answers. seed + i walks the trait table.
  function quiz(traits, seed, n = 5) {
    const qs = [], used = new Set(); let s = seed >>> 0, tries = 0;
    while (qs.length < n && tries++ < 200) {
      const q = B().stayIn(traits, s++); if (q && !used.has(q.answer)) { used.add(q.answer); qs.push({ question: q.question, options: q.options, answer: q.answer }); }
    }
    return qs;
  }

  root.DAYBIRD_LEARN = { SEASON_RULES, SUMMER_ONLY, WINTER_ONLY, seasonOf, hash, rng, names, byName, row, sizeWord, whereLine, learnScore, firstTen, weekGroups, weekOf, groupTip,
    bingoKey, bingoCard, bingoLines, birdOfDay, xenoCantoUrl, allAboutBirdsUrl, challengeSpecies, quiz };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
