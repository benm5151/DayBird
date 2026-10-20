// Headless checks for lifelist.html ("Your birds") and js/lifelist.js. Every outside host is stubbed: Wikipedia summaries and
// the Commons API answer from fixtures for six species, upload.wikimedia.org serves solid-color PNGs, the Supabase CDN
// serves nothing (offline mode), and data/brief.json is replaced with a short `recent` list. The sticker button in the sheet
// (js/stickers.js) gets one check here; tests/stickers.ui.mjs has the rest.
// Run from the repo root (Playwright and sharp from /opt/npm-tools on the build box, or `npm i playwright sharp` anywhere):
//   PLAYWRIGHT_DIR=/opt/npm-tools/node_modules/playwright SHARP_DIR=/opt/npm-tools/node_modules/sharp DAYBIRD_SHOTS=/tmp node tests/lifelist.ui.mjs
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = await import(join(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright', 'index.mjs'));
const sharp = require(process.env.SHARP_DIR || '/opt/npm-tools/node_modules/sharp');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DAYBIRD_SHOTS || join(tmpdir(), 'daybird-shots');
await mkdir(OUT, { recursive: true });
require(join(ROOT, 'js/brief.js')); require(join(ROOT, 'data/traits.js'));
const BRIEF = globalThis.DAYBIRD_BRIEF, TRAITS = globalThis.DAYBIRD_TRAITS;

// ---- static server for the repo
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ---- fixtures
const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
const COLORS = { 'Blue Jay': [59, 111, 182], 'Black-capped Chickadee': [120, 120, 120], 'American Robin': [184, 92, 42], 'Northern Cardinal': [190, 30, 40], 'Tufted Titmouse': [138, 143, 153], 'Mourning Dove': [160, 138, 122] };
const PHOTOS = {}; for (const [n, c] of Object.entries(COLORS)) PHOTOS[n] = await png(400, 300, c);
const AMBER = [232, 131, 58];
const ownFile = join(OUT, 'own-amber.png'); await writeFile(ownFile, await png(200, 200, AMBER));
const fileOf = (n) => n.replace(/ /g, '_') + '_fixture.jpg';
const summaryFor = (n) => ({
  type: 'standard', titles: { canonical: n.replace(/ /g, '_'), normalized: n },
  thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${fileOf(n)}/320px-${fileOf(n)}`, width: 320, height: 240 },
  originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${fileOf(n)}`, width: 3000, height: 2250 },
  content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${n.replace(/ /g, '_')}` } },
});
// Which spelling answers: "Blue_Jay" as typed; the chickadee only in Wikipedia's sentence case (tests the second try).
const SUMMARIES = {
  'Blue_Jay': summaryFor('Blue Jay'), 'Black-capped_chickadee': summaryFor('Black-capped Chickadee'), 'American_Robin': summaryFor('American Robin'),
  'Northern_Cardinal': summaryFor('Northern Cardinal'), 'Tufted_Titmouse': summaryFor('Tufted Titmouse'), 'Mourning_Dove': summaryFor('Mourning Dove'),
};
const ARTISTS = { 'Blue Jay': ['<a href="//commons.wikimedia.org/wiki/User:Rhododendrites">Rhododendrites</a>', 'CC BY-SA 4.0'], 'Black-capped Chickadee': ['<span class="fn">Mdf</span>', 'CC BY-SA 3.0'],
  'American Robin': ['Dakota L.', 'CC BY-SA 4.0'], 'Northern Cardinal': ['Rhododendrites', 'CC BY-SA 4.0'], 'Tufted Titmouse': ['Cephas', 'CC BY-SA 3.0'], 'Mourning Dove': ['Mdf', 'CC BY-SA 3.0'] };

// ---- the life list: 90 trait species + 58 others = 148, with first-seen for 20
const UNSEEN = ['Tufted Titmouse', 'Mourning Dove', ...TRAITS.map(t => t[0]).filter(n => n !== 'Tufted Titmouse' && n !== 'Mourning Dove').slice(-25)];
assert.equal(UNSEEN.length, 27);
const traitSeen = TRAITS.map(t => t[0]).filter(n => !UNSEEN.includes(n));
assert.equal(traitSeen.length, TRAITS.length - 27);
const EXTRA = ['Pine Warbler', 'Magnolia Warbler', 'Blackburnian Warbler', 'Cape May Warbler', 'Bay-breasted Warbler', 'Canada Warbler', 'Mourning Warbler', 'Tennessee Warbler', 'Nashville Warbler', 'Northern Waterthrush',
  'Semipalmated Plover', 'Least Sandpiper', 'Semipalmated Sandpiper', 'Greater Yellowlegs', 'Lesser Yellowlegs', 'Solitary Sandpiper', 'Spotted Sandpiper', 'Wilson\'s Snipe', 'American Woodcock', 'Killdeer',
  'Ring-necked Duck', 'Lesser Scaup', 'Greater Scaup', 'Bufflehead', 'Common Goldeneye', 'Hooded Merganser', 'Common Merganser', 'Red-breasted Merganser', 'Green-winged Teal', 'Blue-winged Teal',
  'Northern Pintail', 'American Wigeon', 'Gadwall', 'Northern Shoveler', 'Ruddy Duck', 'Long-tailed Duck', 'Surf Scoter', 'Black Scoter', 'White-winged Scoter', 'Snow Goose',
  'Peregrine Falcon', 'American Kestrel', 'Northern Harrier', 'Rough-legged Hawk', 'Northern Goshawk', 'Golden Eagle', 'Snowy Owl', 'Northern Saw-whet Owl', 'Eastern Screech-Owl', 'Great Horned Owl',
  'Olive-sided Flycatcher', 'Yellow-bellied Flycatcher', 'Alder Flycatcher', 'Willow Flycatcher', 'Acadian Flycatcher', 'Philadelphia Vireo', 'Blue-headed Vireo', 'Yellow-throated Vireo'];
const traitNames = new Set(TRAITS.map(t => t[0]));
const NAMES = [...new Set([...traitSeen, ...EXTRA.filter(n => !traitNames.has(n))])];
while (NAMES.length < 148) NAMES.push('Test Bird ' + NAMES.length);
NAMES.length = 148;
assert.equal(NAMES.length, 148);
assert.equal(TRAITS.filter(t => !NAMES.includes(t[0])).length, 27, 'twenty-seven common birds stay unseen, so the cap of 24 is exercised');
const DATED = NAMES.slice(0, 20);
const FIRSTS = Object.fromEntries(DATED.map((n, i) => [n, { first: `${2019 + (i % 7)}-${String(1 + (i * 5) % 12).padStart(2, '0')}-${String(1 + (i * 7) % 28).padStart(2, '0')}`, loc: ['Mink Brook', 'Boston Lot Lake', 'Wilder Dam', 'Storrs Pond'][i % 4] }]));
const byDateDesc = Object.entries(FIRSTS).sort((a, b) => b[1].first.localeCompare(a[1].first) || a[0].localeCompare(b[0]));
const LIFE = { importedAt: '2026-10-01T12:00:00Z', checklists: 300, observations: 4000, total: 148, thisYear: 12, yearList: 120, firstDate: '2019-03-02', lastDate: '2026-10-01',
  recentLifers: byDateDesc.slice(0, 10).map(([name, f]) => ({ name, first: f.first, loc: f.loc, sightings: 1 })), mostSeen: [], topPlaces: [], byMonth: Array(12).fill(1),
  allSpecies: [...NAMES].sort(), months: {}, firsts: FIRSTS };
const LIFE_ALL_DATED = { ...LIFE, firsts: Object.fromEntries(NAMES.map((n, i) => [n, { first: `${2019 + (i % 8)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, loc: 'Mink Brook' }])) };
const RECENT = ['Mourning Dove', 'Blue Jay', 'Tufted Titmouse', 'American Robin', UNSEEN[UNSEEN.length - 1], 'Black-capped Chickadee'];

// ---- browser helpers
const browser = await chromium.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const counters = () => ({ inflight: 0, max: 0, api: 0, byTitle: {}, images: 0 });
async function stubAll(page, C, { apiDelay = 60 } = {}) {
  await page.route(/cdn\.jsdelivr\.net/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* no sdk: offline mode */' }));
  await page.route(/supabase\.co|api\.ebird\.org|open-meteo\.com|router\.project-osrm\.org|birdcast/, r => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().url().includes('ebird') ? '[]' : '{}' }));
  await page.route(/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, async r => {
    C.api++; C.inflight++; C.max = Math.max(C.max, C.inflight); await sleep(apiDelay); C.inflight--;
    const title = decodeURIComponent(r.request().url().split('/summary/')[1]);
    C.byTitle[title] = (C.byTitle[title] || 0) + 1;
    const s = SUMMARIES[title];
    if (s) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(s) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found', title: 'Not found.' }) });
  });
  await page.route(/commons\.wikimedia\.org\/w\/api\.php/, async r => {
    C.api++; C.inflight++; C.max = Math.max(C.max, C.inflight); await sleep(apiDelay); C.inflight--;
    const u = new URL(r.request().url()); const file = (u.searchParams.get('titles') || '').replace(/^File:/, '');
    const name = Object.keys(PHOTOS).find(n => fileOf(n) === file);
    assert.ok(name, 'commons asked about a file we did not hand out: ' + file);
    assert.equal(u.searchParams.get('origin'), '*');
    const [artist, lic] = ARTISTS[name];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { pages: { 123: { title: 'File:' + file, imageinfo: [{ extmetadata: { Artist: { value: artist }, LicenseShortName: { value: lic } } }] } } } }) });
  });
  await page.route(/upload\.wikimedia\.org/, r => {
    C.images++;
    const file = decodeURIComponent(r.request().url().split('/').pop()).replace(/^\d+px-/, '');
    const name = Object.keys(PHOTOS).find(n => fileOf(n) === file);
    return name ? r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PHOTOS[name] }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/\/data\/brief\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generated: '2026-10-19T10:00:00Z', word: 'GO', recent: RECENT }) }));
}
async function newPage(ctx, C, { life = LIFE, extraInit = '' } = {}) {
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.errors = errors;
  await stubAll(page, C);
  await page.addInitScript(({ life, extraInit }) => { if (life) localStorage.setItem('daybird:life', JSON.stringify(life)); else localStorage.removeItem('daybird:life'); if (extraInit) new Function(extraInit)(); }, { life, extraInit });
  return page;
}
const tileNames = (page, sel = '#wall') => page.$$eval(`${sel} .tile`, els => els.map(e => e.dataset.name));
// wait until no API request is in flight and none has started for `quiet` ms
async function settle(C, quiet = 500, limit = 30000) {
  const t0 = Date.now(); let last = C.api, lastAt = Date.now();
  while (Date.now() - t0 < limit) { await sleep(50); if (C.api !== last) { last = C.api; lastAt = Date.now(); } if (C.inflight === 0 && Date.now() - lastAt > quiet) return; }
  throw new Error('network did not settle');
}
// scroll through the whole page slowly enough that every tile gets its turn
async function scrollThrough(page, C) {
  let y = 0;
  for (;;) {
    const { h, vh } = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight }));
    await page.evaluate(y => scrollTo(0, y), y);
    await settle(C, 300);
    if (y >= h - vh) break;
    y += Math.floor(vh * 0.6);
  }
  await page.evaluate(() => scrollTo(0, 0)); await settle(C, 300);
}
const noBroken = async (page) => assert.equal(await page.$$eval('.tile img, .sheet img', els => els.filter(i => i.complete && !i.naturalWidth).length), 0, 'a broken image is showing');
let failures = 0;
async function step(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); } }

// ======================================================================= phone: the grid, sorts, search, lazy loading, cache
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const C = counters();
  const page = await newPage(ctx, C);
  await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile');

  await step('grid count equals the list; header shows the number', async () => {
    assert.equal((await tileNames(page)).length, 148);
    assert.match(await page.textContent('#count'), /148\s*birds/);
    assert.match(await page.textContent('#sub'), /12 new in \d{4}/);
    assert.match(await page.textContent('#hint'), /First-seen dates show for 20 of 148/);
    assert.equal(await page.$('#empty.hidden') !== null, true);
  });
  await step('default sort is date seen, newest first, undated after', async () => {
    const names = await tileNames(page);
    assert.deepEqual(names.slice(0, 20), byDateDesc.map(([n]) => n));
    const rest = names.slice(20); assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)));
    assert.equal(await page.$eval('#controls [data-sort=date]', b => b.getAttribute('aria-pressed')), 'true');
    assert.equal((await page.$$('#wall h2')).length, 0);
    assert.match(await page.$eval(`#wall .tile[data-name="${byDateDesc[0][0]}"] .mini`, e => e.textContent), /\b20\d\d\b/, 'tiny first-seen date on the tile');
  });
  await step('A–Z sort', async () => {
    await page.click('#controls [data-sort=az]');
    const names = await tileNames(page);
    assert.deepEqual(names, [...NAMES].sort((a, b) => a.localeCompare(b)));
    assert.equal((await page.$$('#wall h2')).length, 0);
  });
  await step('family sort groups with headers, biggest family first', async () => {
    await page.click('#controls [data-sort=family]');
    const heads = await page.$$eval('#wall h2', hs => hs.map(h => h.firstChild.textContent.trim()));
    const n = {}; NAMES.forEach(x => { const g = BRIEF.groupOf(x) || 'other birds'; n[g] = (n[g] || 0) + 1; });
    const expected = Object.keys(n).sort((a, b) => (a === 'other birds' ? 1 : b === 'other birds' ? -1 : n[b] - n[a] || a.localeCompare(b))).map(g => g[0].toUpperCase() + g.slice(1));
    assert.deepEqual(heads, expected);
    const counts = await page.$$eval('#wall h2 span', ss => ss.map(s => +s.textContent));
    assert.equal(counts.reduce((a, b) => a + b, 0), 148);
    // the first tile after the first header belongs to that family
    const first = await page.$eval('#wall h2 + .tile', t => t.dataset.name);
    assert.equal((BRIEF.groupOf(first) || 'other birds'), heads[0].toLowerCase());
    assert.equal(await page.evaluate(() => localStorage.getItem('daybird:lifelistSort')), 'family');
    await page.click('#controls [data-sort=date]');
  });
  await step('search filters by name', async () => {
    await page.fill('#q', 'chick');
    const names = await tileNames(page);
    assert.deepEqual(names, NAMES.filter(x => /chick/i.test(x)).sort((a, b) => (FIRSTS[b]?.first || '').localeCompare(FIRSTS[a]?.first || '') || a.localeCompare(b)));
    assert.match(await page.textContent('#shown'), new RegExp(`${names.length} of 148`));
    await page.fill('#q', 'zzzz'); assert.match(await page.textContent('#wall'), /No bird on your list matches/);
    await page.fill('#q', ''); assert.equal((await tileNames(page)).length, 148);
  });
  await step('photos load lazily, at most 4 requests at once, credited, never broken', async () => {
    await scrollThrough(page, C);
    assert.ok(C.api > 0, 'no lookups happened');
    assert.ok(C.max <= 4, `${C.max} requests in flight at once`);
    // the chickadee needed the sentence-case title; the jay did not
    assert.equal(C.byTitle['Black-capped_Chickadee'], 1); assert.equal(C.byTitle['Black-capped_chickadee'], 1); assert.equal(C.byTitle['Blue_Jay'], 1); assert.equal(C.byTitle['Blue_jay'], undefined);
    for (const n of ['Blue Jay', 'Black-capped Chickadee', 'American Robin', 'Northern Cardinal']) {
      await page.waitForSelector(`#wall .tile[data-name="${n}"].has-photo`, { timeout: 5000 });
      assert.equal(await page.$eval(`#wall .tile[data-name="${n}"] .chip`, c => c.textContent), 'wiki');
    }
    assert.equal(await page.$(`#wall .tile[data-name="Pine Warbler"].has-photo`), null, 'a miss stays on paper');
    await noBroken(page);
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('daybird:photos')));
    assert.equal(Object.keys(cache).length, 148 + 24, 'every tile cached (hits and misses)');
    assert.equal(cache['Blue Jay'].artist, 'Rhododendrites'); assert.equal(cache['Blue Jay'].license, 'CC BY-SA 4.0');
    assert.equal(cache['Blue Jay'].page, 'https://commons.wikimedia.org/wiki/File:Blue_Jay_fixture.jpg');
    assert.match(cache['Blue Jay'].thumb, /400px-Blue_Jay_fixture\.jpg$/); assert.match(cache['Blue Jay'].image, /1000px-Blue_Jay_fixture\.jpg$/, 'large original → 1000px thumb');
    assert.ok(cache['Pine Warbler'].none && cache['Pine Warbler'].at);
  });
  await step('not yet: at most 24, the recent ones first, grayed, with the hint on tap', async () => {
    const names = await tileNames(page, '#unseen');
    assert.ok(names.length <= 24 && names.length === 24, `${names.length} unseen tiles`);
    const have = new Set(NAMES), rec = new Set(RECENT);
    const expected = TRAITS.filter(t => !have.has(t[0])).map((t, i) => ({ n: t[0], s: (rec.has(t[0]) ? 2 : 0) + (t[3].some(h => ['feeder', 'yard', 'edge'].includes(h)) ? 1 : 0), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 24).map(x => x.n);
    assert.deepEqual(names, expected);
    assert.ok(names.indexOf('Mourning Dove') < 3 && names.indexOf('Tufted Titmouse') < 3, 'the ones reported this week come first');
    assert.equal(await page.$eval('#unseen .tile[data-name="Tufted Titmouse"] img', i => getComputedStyle(i).filter.includes('grayscale')), true);
    assert.match(await page.$eval('#unseen .tile[data-name="Tufted Titmouse"] .band small', e => e.textContent), /not yet/);
    await page.click('#unseen .tile[data-name="Tufted Titmouse"]');
    await page.waitForSelector('dialog.sheet[open]');
    assert.match(await page.textContent('dialog.sheet .seen'), /Not on your list yet, and reported near you this week/);
    assert.match(await page.textContent('dialog.sheet .hint'), /Gray with a crest, peach flanks/);
    assert.equal(await page.$('dialog.sheet #shareBird'), null, 'no share for a bird you have not seen');
    await page.click('dialog.sheet #closeSheet'); await page.waitForFunction(() => !document.getElementById('sheet').open);
  });
  await step('detail sheet shows the credit and first-seen', async () => {
    await page.click('#wall .tile[data-name="Blue Jay"]');
    await page.waitForSelector('dialog.sheet[open]');
    assert.equal(await page.textContent('dialog.sheet h2'), 'Blue Jay');
    assert.match(await page.textContent('dialog.sheet .credit'), /^Photo: Rhododendrites · CC BY-SA 4\.0 · Wikimedia Commons$/);
    assert.equal(await page.$eval('dialog.sheet .credit a', a => a.href), 'https://commons.wikimedia.org/wiki/File:Blue_Jay_fixture.jpg');
    assert.equal(await page.$eval('dialog.sheet a.btn', a => a.href), 'https://en.wikipedia.org/wiki/Blue_Jay');
    assert.match(await page.textContent('dialog.sheet .seen'), /First seen/);
    assert.doesNotMatch(await page.textContent('dialog.sheet .seen'), /bird #/, 'no rank when not every bird has a date');
    await page.waitForFunction(() => { const i = document.querySelector('dialog.sheet .pic img'); return i && i.complete && i.naturalWidth > 0; });
    await noBroken(page);
  });
  await step('share draws a 1080×1920 slide with ink, amber and the photo', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #shareBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-blue-jay.png');
    const buf = await readFile(await dl.path());
    const img = sharp(buf); const meta = await img.metadata();
    assert.equal(meta.width, 1080); assert.equal(meta.height, 1920);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const near = (a, b, t = 28) => a.every((v, i) => Math.abs(v - b[i]) <= t);
    let ink = 0, amber = 0, paper = 0;
    for (let y = 0; y < info.height; y += 4) for (let x = 0; x < info.width; x += 4) { const p = px(x, y); if (near(p, [31, 42, 55])) ink++; else if (near(p, AMBER)) amber++; else if (near(p, [246, 243, 236])) paper++; }
    assert.ok(ink > 600, `ink pixels ${ink}`); assert.ok(amber > 300, `amber pixels ${amber}`); assert.ok(paper > 20000, `paper pixels ${paper}`);
    assert.ok(near(px(540, 1020), COLORS['Blue Jay']), 'the photo fills the frame: ' + px(540, 1020));
    assert.ok(near(px(20, 20), [246, 243, 236]), 'paper corner');
    assert.match(await page.textContent('dialog.sheet #shareMsg'), /Saved a picture/);
    await writeFile(join(OUT, 'lifelist-slide.png'), buf);
    await page.click('dialog.sheet #closeSheet');
  });
  await step('make a sticker: the button and the note in the sheet, a 1024 PNG named by slug, transparent corners, the photo, the credit', async () => {
    await page.click('#wall .tile[data-name="Blue Jay"]'); await page.waitForSelector('dialog.sheet[open]');
    assert.deepEqual(await page.$$eval('dialog.sheet .acts > *', els => els.slice(0, 2).map(e => e.textContent.trim())), ['Share', 'Make a sticker']);
    assert.match(await page.textContent('dialog.sheet .stickerNote'), /Save it to Photos, then in Messages tap \+, Stickers, \+ and pick it .* On Android, save it and send it as an image\./);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-sticker-blue-jay.png');
    const img = sharp(await readFile(await dl.path())).ensureAlpha(); const meta = await img.metadata();
    assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    const near = (a, b, t = 8) => b.every((v, i) => Math.abs(a[i] - v) <= t);
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) assert.equal(px(x, y)[3], 0, `corner ${x},${y} transparent`);
    assert.ok(near(px(512, 512), COLORS['Blue Jay']) && px(512, 512)[3] === 255, 'the photo fills the circle: ' + px(512, 512));
    const spec = await page.evaluate(() => DAYBIRD_STICKERS.lastSpec);
    assert.equal(spec.credit, 'Photo: Rhododendrites · CC BY-SA 4.0'); assert.equal(spec.photo, true);
    assert.ok(near(px(512, spec.tab.y + 6), [255, 255, 255]), 'the tab is white');
    await page.waitForFunction(() => /^Saved daybird-sticker-blue-jay\.png\./.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    await page.click('dialog.sheet #closeSheet');
  });
  await step('phone screenshot', async () => {
    await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
    await page.screenshot({ path: join(OUT, 'lifelist-390.png'), fullPage: false });
  });
  await step('reload: cached species make no requests', async () => {
    const before = C.api;
    await page.reload(); await page.waitForSelector('#wall .tile'); await settle(C, 600);
    await scrollThrough(page, C);
    assert.equal(C.api - before, 0, `${C.api - before} requests after reload`);
    await page.waitForSelector('#wall .tile[data-name="Blue Jay"].has-photo');
    await noBroken(page);
  });
  assert.deepEqual(page.errors, [], 'page errors: ' + page.errors.join(' | '));
  await ctx.close();
}

// ======================================================================= desktop: rank line, own photos, size cap, screenshot
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const C = counters();
  const page = await newPage(ctx, C, { life: LIFE_ALL_DATED });
  await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile'); await settle(C, 400);

  await step('5 across at 1100 px, no horizontal scroll', async () => {
    const cols = await page.$eval('#wall', w => getComputedStyle(w).gridTemplateColumns.split(' ').length);
    assert.ok(cols >= 5 && cols <= 6, `${cols} columns`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.textContent('#hint'), '', 'no re-import hint when every bird has a date');
  });
  await step('with every bird dated, the sheet says bird #N of 148', async () => {
    await page.click('#wall .tile[data-name="Blue Jay"]'); await page.waitForSelector('dialog.sheet[open]');
    const all = Object.entries(LIFE_ALL_DATED.firsts).sort((a, b) => a[1].first.localeCompare(b[1].first) || a[0].localeCompare(b[0]));
    const n = all.findIndex(([x]) => x === 'Blue Jay') + 1;
    assert.match(await page.textContent('dialog.sheet .seen'), new RegExp(`Mink Brook · .* · bird #${n} of 148`));
    await page.click('dialog.sheet #closeSheet');
  });
  await step('own photo: pick, caption, save → tile, chip and credit change; survives reload', async () => {
    // the robin sits far down the dated list, so it has not scrolled into view: the sheet looks it up on open
    assert.equal(await page.$('#wall .tile[data-name="American Robin"].has-photo'), null);
    await page.click('#wall .tile[data-name="American Robin"]'); await page.waitForSelector('dialog.sheet[open]');
    assert.match(await page.textContent('dialog.sheet .credit'), /Looking for a photo/);
    await page.waitForFunction(() => /Photo: Dakota L\./.test(document.querySelector('dialog.sheet .credit').textContent));
    await page.waitForSelector('#wall .tile[data-name="American Robin"].has-photo');
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Use my photo');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('dialog.sheet #ownPick')]);
    assert.equal(await chooser.element().getAttribute('accept'), 'image/*');
    await chooser.setFiles(ownFile);
    await page.waitForSelector('dialog.sheet .ownEdit');
    assert.match(await page.textContent('dialog.sheet .credit'), /not saved yet/);
    assert.equal(await page.$eval('dialog.sheet .ownEdit [data-kind=photo]', b => b.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('dialog.sheet #ownCaption', i => i.placeholder), 'Where or how you got it');
    await page.fill('dialog.sheet #ownCaption', 'Backyard, first light');
    await page.click('dialog.sheet #ownSave');
    await page.waitForFunction(() => /^Saved\./.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    assert.equal(await page.textContent('dialog.sheet .credit'), 'Your photo · Backyard, first light');
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Replace');
    assert.ok(await page.$('dialog.sheet #ownRemove'));
    assert.match(await page.$eval('dialog.sheet .pic img', i => i.src), /^data:image\/jpeg/);
    await page.click('dialog.sheet #closeSheet');
    await page.waitForSelector('#wall .tile[data-name="American Robin"].has-photo.own');
    assert.equal(await page.$eval('#wall .tile[data-name="American Robin"] .chip', c => c.textContent), 'yours');
    assert.match(await page.$eval('#wall .tile[data-name="American Robin"] img', i => i.src), /^data:image\/jpeg/);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('daybird:birdImages')));
    assert.equal(stored['American Robin'].kind, 'photo'); assert.equal(stored['American Robin'].caption, 'Backyard, first light');
    assert.ok(stored['American Robin'].data.length < 60000, 'stored small');
    await page.reload(); await page.waitForSelector('#wall .tile[data-name="American Robin"].has-photo.own'); await settle(C, 400);
    assert.equal(await page.$eval('#wall .tile[data-name="American Robin"] .chip', c => c.textContent), 'yours');
  });
  await step('own photo on the share slide, credited to the person, no Wikimedia line', async () => {
    const b64 = await page.evaluate(async () => {
      const img = JSON.parse(localStorage.getItem('daybird:birdImages'))['American Robin'];
      const { blob, photo } = await DAYBIRD_LIFELIST.slideBlob({ name: 'American Robin', first: '2024-05-03', loc: 'Backyard', n: 7, total: 148, image: img.data, credit: 'Photo: Ben · Backyard, first light' });
      if (!photo) throw new Error('slide went out without the photo');
      const ab = await blob.arrayBuffer(); let s = ''; new Uint8Array(ab).forEach(b => s += String.fromCharCode(b)); return btoa(s);
    });
    const { data, info } = await sharp(Buffer.from(b64, 'base64')).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1080); assert.equal(info.height, 1920);
    const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    const near = (a, b, t = 20) => a.every((v, i) => Math.abs(v - b[i]) <= t);
    for (const [x, y] of [[540, 1020], [300, 800], [800, 1300]]) assert.ok(near(px(x, y), AMBER), `own photo color at ${x},${y}: ${px(x, y)}`);
  });
  await step('kind toggle to Drawing changes the credit', async () => {
    await page.click('#wall .tile[data-name="American Robin"]'); await page.waitForSelector('dialog.sheet[open]');
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Replace');
    await page.setInputFiles('dialog.sheet #ownFile', ownFile);
    await page.waitForSelector('dialog.sheet .ownEdit');
    assert.equal(await page.$eval('dialog.sheet #ownCaption', i => i.value), 'Backyard, first light', 'caption carried over on replace');
    await page.click('dialog.sheet .ownEdit [data-kind=art]');
    await page.fill('dialog.sheet #ownCaption', 'Pencil, from a photo');
    await page.click('dialog.sheet #ownSave');
    await page.waitForFunction(() => /^Saved\./.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    assert.equal(await page.textContent('dialog.sheet .credit'), 'Your drawing · Pencil, from a photo');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('daybird:birdImages'))['American Robin'].kind)), 'art');
  });
  await step('remove falls back to the Wikimedia photo', async () => {
    await page.click('dialog.sheet #ownRemove');
    await page.waitForFunction(() => /^Removed/.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    assert.match(await page.textContent('dialog.sheet .credit'), /^Photo: Dakota L\. · CC BY-SA 4\.0 · Wikimedia Commons$/);
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Use my photo');
    assert.equal(await page.$('dialog.sheet #ownRemove'), null);
    await page.click('dialog.sheet #closeSheet');
    await page.waitForSelector('#wall .tile[data-name="American Robin"].has-photo:not(.own)');
    assert.equal(await page.$eval('#wall .tile[data-name="American Robin"] .chip', c => c.textContent), 'wiki');
    assert.match(await page.$eval('#wall .tile[data-name="American Robin"] img', i => i.src), /upload\.wikimedia\.org/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('daybird:birdImages'))), {});
  });
  await step('own picture on a not-yet bird too', async () => {
    await page.click('#unseen .tile[data-name="Mourning Dove"]'); await page.waitForSelector('dialog.sheet[open]');
    await page.setInputFiles('dialog.sheet #ownFile', ownFile); await page.waitForSelector('dialog.sheet .ownEdit');
    await page.click('dialog.sheet .ownEdit [data-kind=art]'); await page.click('dialog.sheet #ownSave');
    await page.waitForFunction(() => /^Saved\./.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    assert.equal(await page.textContent('dialog.sheet .credit'), 'Your drawing');
    await page.click('dialog.sheet #closeSheet');
    await page.waitForSelector('#unseen .tile[data-name="Mourning Dove"].own');
    assert.equal(await page.$eval('#unseen .tile[data-name="Mourning Dove"] img', i => getComputedStyle(i).filter), 'none', 'your own drawing is not grayed');
    await page.click('#unseen .tile[data-name="Mourning Dove"]'); await page.waitForSelector('dialog.sheet[open]');
    await page.click('dialog.sheet #ownRemove'); await page.waitForFunction(() => /^Removed/.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    await page.click('dialog.sheet #closeSheet');
  });
  await step('desktop screenshot', async () => {
    await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
    await page.screenshot({ path: join(OUT, 'lifelist-1100.png'), fullPage: false });
  });
  assert.deepEqual(page.errors, [], 'page errors: ' + page.errors.join(' | '));
  await ctx.close();
}

// ======================================================================= size cap, empty state
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await step('the local store refuses a save past the cap with a plain message', async () => {
    const C = counters();
    const page = await newPage(ctx, C, { extraInit: `localStorage.setItem('daybird:birdImages', JSON.stringify({ 'Blue Jay': { data: 'data:image/jpeg;base64,' + 'A'.repeat(3499000), kind: 'photo', caption: '' } }))` });
    await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile');
    await page.click('#wall .tile[data-name="Northern Cardinal"]'); await page.waitForSelector('dialog.sheet[open]');
    await page.setInputFiles('dialog.sheet #ownFile', ownFile); await page.waitForSelector('dialog.sheet .ownEdit');
    await page.click('dialog.sheet #ownSave');
    await page.waitForFunction(() => /about 20 photos/.test(document.querySelector('dialog.sheet #shareMsg').textContent));
    assert.equal(await page.textContent('dialog.sheet #shareMsg'), 'This browser can hold about 20 photos. Sign in to keep more and have them follow you.');
    assert.ok(await page.$('dialog.sheet .ownEdit'), 'editor stays open');
    assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('daybird:birdImages'))).length), 1, 'nothing extra stored');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await step('empty state when there is no list', async () => {
    const C = counters();
    const page = await newPage(ctx, C, { life: null });
    await page.goto(base + '/lifelist.html'); await page.waitForSelector('#empty:not(.hidden)');
    assert.match(await page.textContent('#empty'), /MyEBirdData\.csv/);
    assert.equal(await page.$eval('#empty a.btn', a => a.getAttribute('href')), 'profile.html');
    assert.match(await page.textContent('#count'), /0\s*birds/);
    assert.ok(await page.$('#controls.hidden'));
    assert.equal((await tileNames(page)).length, 0);
    assert.equal((await tileNames(page, '#unseen')).length, 24, 'the not-yet wall still gives a new birder somewhere to start');
    await settle(C, 400);
    await page.screenshot({ path: join(OUT, 'lifelist-empty.png') });
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await ctx.close();
}

// ======================================================================= migration-10.sql parses as plain SQL; CLOUD exports
await step('migration-10.sql is plain SQL and CLOUD/DB export the new names', async () => {
  const sql = await readFile(join(ROOT, 'migration-10.sql'), 'utf8');
  assert.doesNotMatch(sql, /[‘’“”]/, 'smart quotes');
  assert.match(sql, /create table if not exists public\.bird_images/);
  assert.match(sql, /primary key \(user_id, species\)/);
  assert.match(sql, /check \(kind in \('photo', 'art'\)\)/);
  assert.match(sql, /enable row level security/);
  for (const p of ['select', 'insert', 'update', 'delete']) assert.match(sql, new RegExp(`create policy "bird_images ${p} own" on public\\.bird_images for ${p}`));
  assert.match(sql, /create policy "photos delete" on storage\.objects for delete using \(bucket_id = 'photos' and auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]\)/);
  // every statement ends with a semicolon and parentheses balance
  const body = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.equal((body.match(/\(/g) || []).length, (body.match(/\)/g) || []).length);
  for (const st of body.split(';').map(s => s.trim()).filter(Boolean)) assert.match(st, /^(create|alter|drop)\b/i, 'statement: ' + st.slice(0, 40));
  const schema = await readFile(join(ROOT, 'schema.sql'), 'utf8');
  assert.match(schema, /create table if not exists public\.bird_images/); assert.match(schema, /"photos delete"/);
  const cloud = await readFile(join(ROOT, 'js/cloud.js'), 'utf8');
  for (const n of ['listBirdImages', 'setBirdImage', 'removeBirdImage']) assert.match(cloud, new RegExp(`async function ${n}\\(`)), assert.match(cloud.slice(cloud.lastIndexOf('return {')), new RegExp(`\\b${n}\\b`));
  const app = await readFile(join(ROOT, 'js/app.js'), 'utf8');
  for (const n of ['birdImages', 'localBirdImages', 'setBirdImage', 'removeBirdImage']) assert.match(app.slice(app.lastIndexOf('return { ready')), new RegExp(`\\b${n}\\b`));
  assert.match(await readFile(join(ROOT, 'js/notice.js'), 'utf8'), /the photos you put on your birds/);
  assert.match(await readFile(join(ROOT, 'data/pages.js'), 'utf8'), /lifelist\.html/);
});

// ======================================================================= every page loads without a page error
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
  for (const f of pages) {
    await step('loads ' + f, async () => {
      const C = counters();
      const page = await newPage(ctx, C);
      await page.route(/wikipedia\.org|wikimedia\.org/, r => r.fulfill({ status: 404, body: '' }));
      await page.route(url => !url.href.startsWith(base) && !/jsdelivr|supabase|ebird|open-meteo|wiki|osrm|birdcast/.test(url.href), r => r.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
      await page.goto(base + '/' + f, { waitUntil: 'load' }); await sleep(700);
      assert.deepEqual(page.errors, [], f + ': ' + page.errors.join(' | '));
      await page.close();
    });
  }
  await ctx.close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
