// Headless checks for learn.html (learn-and-play group) with the network stubbed.
// Run: node tests/learn.test.mjs   (needs Playwright; path below is the shared install)
// Set OUT to a folder for screenshots. Fails on any page error on learn.html or on any existing page.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || join(ROOT, '.test-out');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

// 40 species in `recent`, as the GitHub Action writes them (engine shape).
const RECENT = ['Black-capped Chickadee', 'Tufted Titmouse', 'White-breasted Nuthatch', 'Downy Woodpecker', 'Hairy Woodpecker', 'Blue Jay', 'American Crow', 'American Robin',
  'Northern Cardinal', 'Dark-eyed Junco', 'White-throated Sparrow', 'Song Sparrow', 'American Goldfinch', 'Purple Finch', 'Mourning Dove', 'Red-tailed Hawk', 'Turkey Vulture', 'Bald Eagle',
  'Mallard', 'Canada Goose', 'Hooded Merganser', 'Common Merganser', 'Wood Duck', 'Great Blue Heron', 'Belted Kingfisher', 'Yellow-rumped Warbler', 'Palm Warbler', 'Ruby-crowned Kinglet',
  'Golden-crowned Kinglet', 'Hermit Thrush', 'Eastern Bluebird', 'Cedar Waxwing', 'Pileated Woodpecker', 'Northern Flicker', 'Red-winged Blackbird', 'Common Grackle', 'Ring-billed Gull',
  'Wild Turkey', 'Pied-billed Grebe', 'Common Loon'];
let briefMode = 'json'; // json → a daily brief with 40 recent species | 404 → the sample-data path
let briefGrade = 'go';
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/data/brief.json')) {
    if (briefMode === '404') { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ generated: new Date().toISOString(), word: briefGrade === 'stay' ? 'STAY IN' : 'GO', grade: briefGrade, score: 80, recent: RECENT, spots: [{ name: 'Mink Brook', locId: 'L1', species: 12 }], notable: [], engine: 2 }));
  }
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
let ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, acceptDownloads: true });
async function page(width = 1100) {
  const pg = await ctx.newPage(); if (width !== 1100) await pg.setViewportSize({ width, height: 1400 });
  pg.on('pageerror', (e) => errors.push(`${pg.url()}: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|supabase|404|status of 500/.test(m.text())) errors.push(m.text()); });
  await pg.route(/supabase\.co|jsdelivr|open-meteo\.com|ebird\.org|xeno-canto|allaboutbirds/, async (route) => {
    const u = route.request().url();
    if (u.includes('api.open-meteo.com')) {
      const d0 = new Date().toISOString().slice(0, 10), d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const hrs = (d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
      const col = (a, b) => [...Array(24).fill(a), ...Array(24).fill(b)];
      const rainy = briefGrade === 'stay';
      return route.fulfill({ json: { current: { time: `${d0}T07:30`, temperature_2m: 40 }, hourly: { time: [...hrs(d0), ...hrs(d1)], temperature_2m: col(41, 33), precipitation_probability: col(rainy ? 90 : 10, 70), wind_speed_10m: col(rainy ? 25 : 5, 20), wind_direction_10m: col(315, 180), cloud_cover: col(20, 90) }, daily: { time: [d0, d1], sunrise: [`${d0}T07:05`, `${d1}T07:06`], sunset: [`${d0}T17:58`, `${d1}T17:56`], temperature_2m_max: [58, 40], temperature_2m_min: [35, 30] } } });
    }
    if (u.includes('jsdelivr')) return route.fulfill({ contentType: 'text/javascript', body: '' }); // no SDK → offline mode
    return route.fulfill({ status: 404, body: '' });
  });
  return pg;
}
const settled = async (pg) => { await pg.goto(`${base}/learn.html`); await pg.waitForFunction(() => document.querySelectorAll('#f10cards .card').length > 0 && document.querySelectorAll('#bingoGrid .sq').length > 0); };
const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const shift = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ---- 1. first ten: ten cards, from the daily brief, and a check that persists across reload
let pg = await page();
await settled(pg);
assert.match(await pg.textContent('#source'), /Built from 40 species/);
assert.equal(await pg.$$eval('#f10cards .card', (c) => c.length), 10);
const firstNames = await pg.$$eval('#f10cards h3', (h) => h.map((x) => x.textContent));
assert.ok(firstNames.includes('Black-capped Chickadee') && firstNames.includes('Blue Jay'), `feeder birds lead: ${firstNames}`);
assert.ok(!firstNames.includes('Golden-crowned Kinglet'), 'tiny birds are not in the first ten');
assert.equal(await pg.textContent('#f10count'), '0 of 10');
await pg.click('#f10cards .card:nth-child(1) button[data-k="saw"]');
await pg.click('#f10cards .card:nth-child(2) button[data-k="heard"]');
await pg.click('#f10cards .card:nth-child(2) button[data-k="saw"]');
assert.equal(await pg.textContent('#f10count'), '2 of 10');
await pg.reload(); await pg.waitForSelector('#f10cards .card');
assert.equal(await pg.textContent('#f10count'), '2 of 10');
assert.equal(await pg.$$eval('#f10cards .check.on', (b) => b.length), 3);
const learned = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:learned')));
assert.equal(Object.keys(learned.first10).length, 2, 'stored under daybird:learned');

// ---- 2. this week: five groups from the engine, with tips and members
assert.equal(await pg.$$eval('#weekGroups .card', (c) => c.length), 5);
const weekText = await pg.textContent('#weekGroups');
assert.match(weekText, /feeder birds/); assert.match(weekText, /Follow the chickadees/);
assert.match(await pg.textContent('#weekLead'), /^Week of /);

// ---- 3. bingo: 25 squares, deterministic across loads, marks persist, share downloads a PNG
assert.equal(await pg.$$eval('#bingoGrid .sq', (c) => c.length), 25);
const squares1 = await pg.$$eval('#bingoGrid .sq', (c) => c.map((x) => x.textContent));
assert.equal(new Set(squares1).size, 25, 'no duplicates');
await pg.click('#bingoGrid .sq:nth-child(1)'); await pg.click('#bingoGrid .sq:nth-child(2)');
assert.match(await pg.textContent('#bingoScore'), /^2 of 25/);
await pg.reload(); await pg.waitForSelector('#bingoGrid .sq');
assert.deepEqual(await pg.$$eval('#bingoGrid .sq', (c) => c.map((x) => x.textContent)), squares1, 'same card on the second load');
assert.equal(await pg.$$eval('#bingoGrid .sq.on', (c) => c.length), 2);
// a full row makes a line
for (let i = 3; i <= 5; i++) await pg.click(`#bingoGrid .sq:nth-child(${i})`);
assert.match(await pg.textContent('#bingoScore'), /5 of 25 · one line/);
const [download] = await Promise.all([pg.waitForEvent('download'), pg.click('#bingoShare')]);
assert.match(download.suggestedFilename(), /^daybird-bingo-\d{4}-\d{2}\.png$/);
const pngPath = join(OUT, 'bingo-share.png'); await download.saveAs(pngPath);
const png = await readFile(pngPath); assert.equal(png.subarray(1, 4).toString(), 'PNG');
// a different place (far enough to round differently) gets a different card; the same rounded place does not
const cardsByPlace = await pg.evaluate(() => {
  const L = DAYBIRD_LEARN, R = Array.from(document.querySelectorAll('#bingoGrid .sq'), (x) => x.textContent);
  const a = L.bingoCard(R, DAYBIRD_TRAITS, '2026-10', 43.6423, -72.2518).squares.map((q) => q.name);
  const b = L.bingoCard(R, DAYBIRD_TRAITS, '2026-10', 43.6449, -72.2461).squares.map((q) => q.name);
  const c = L.bingoCard(R, DAYBIRD_TRAITS, '2026-10', 42.36, -71.06).squares.map((q) => q.name);
  const w = L.bingoCard(R, DAYBIRD_TRAITS, '2026-01', 43.6423, -72.2518).squares.map((q) => q.name);
  return { same: a.join() === b.join(), diff: a.join() !== c.join(), winterSkips: !w.some((n) => L.SUMMER_ONLY.includes(n)) };
});
assert.deepEqual(cardsByPlace, { same: true, diff: true, winterSkips: true });
// last month's card is retired into history on load
await pg.evaluate(() => {
  const l = JSON.parse(localStorage.getItem('daybird:learned'));
  l.bingo.cards['2020-01|43.64,-72.25'] = { squares: ['a', 'b', 'c', 'd', 'e', ...Array.from({ length: 20 }, (_, i) => 'x' + i)], marked: ['a', 'b', 'c', 'd', 'e', 'x3'] };
  localStorage.setItem('daybird:learned', JSON.stringify(l));
});
await pg.reload(); await pg.waitForSelector('#bingoGrid .sq');
assert.equal(await pg.textContent('#bingoLast'), 'Last card (January 2020): 6 of 25 squares, one line.');

// ---- 4. bird of the day: stable within a day, links out only
const bird1 = await pg.textContent('#bird h3');
await pg.reload(); await pg.waitForSelector('#bird h3');
assert.equal(await pg.textContent('#bird h3'), bird1);
assert.ok(RECENT.includes(bird1), `bird of the day comes from the reports: ${bird1}`);
const links = await pg.$$eval('#bird a', (a) => a.map((x) => x.href));
assert.match(links[0], /^https:\/\/xeno-canto\.org\/explore\?query=/);
assert.match(links[1], /^https:\/\/www\.allaboutbirds\.org\/guide\/[A-Za-z_-]+\/overview$/);
assert.equal(await pg.$$eval('#bird audio, #bird img', (x) => x.length), 0, 'no embedded media');
const dayStable = await pg.evaluate(() => { const L = DAYBIRD_LEARN; const a = L.birdOfDay(['Mallard', 'Blue Jay', 'American Robin'], DAYBIRD_TRAITS, '2026-10-18'); const b = L.birdOfDay(['Mallard', 'Blue Jay', 'American Robin'], DAYBIRD_TRAITS, '2026-10-18'); return a.name === b.name; });
assert.ok(dayStable);

// ---- 5. challenges: start, mark five, celebrate; persists
assert.equal(await pg.$$eval('#chCards .card', (c) => c.length), 5);
await pg.click('#chCards button[data-start="five-sparrows"]');
await pg.waitForSelector('#chCards button[data-ch="five-sparrows"]');
assert.equal(await pg.$$eval('#chCards button[data-ch="five-sparrows"]', (b) => b.length), 12);
for (let i = 1; i <= 4; i++) await pg.click(`#chCards button[data-ch="five-sparrows"]:nth-of-type(${i})`);
assert.match(await pg.textContent('#chCards'), /4 of 5/);
await pg.click('#chCards button[data-ch="five-sparrows"]:nth-of-type(5)');
await pg.waitForSelector('#chCards .celebrate');
assert.match(await pg.textContent('#chCards .celebrate'), /Five sparrows\. The weedy edge is a different place now\./);
await pg.reload(); await pg.waitForSelector('#chCards .celebrate');
assert.match(await pg.textContent('#chCards .celebrate'), /Done /);

// ---- 7. quiz: five questions, scored
await pg.waitForSelector('#quizCard .q');
assert.equal(await pg.$$eval('#quizCard .q', (q) => q.length), 5);
const answers = await pg.evaluate(() => DAYBIRD_LEARN.quiz(DAYBIRD_TRAITS, Number(document.getElementById('quizCard').dataset.seed)).map((q) => q.answer));
assert.equal(new Set(answers).size, 5, 'distinct answers');
for (let i = 0; i < 5; i++) {
  const opts = await pg.$$eval(`#quizCard button[data-q="${i}"]`, (b) => b.map((x) => x.dataset.opt));
  const pick = i < 3 ? answers[i] : opts.find((o) => o !== answers[i]);
  await pg.click(`#quizCard button[data-q="${i}"][data-opt="${pick.replace(/"/g, '\\"')}"]`);
}
assert.equal(await pg.textContent('#quizScore'), '3 of 5');
assert.match(await pg.textContent('#qmsg4'), /^Not that one\. It's the /);
assert.equal((await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:learned')).quiz)).best, 3);
await pg.click('#quizNext'); await pg.waitForFunction(() => /Set 2/.test(document.getElementById('quizCard').textContent));

// ---- 8. tracks: path has 8 steps, five tracks of 6; a step persists
assert.equal(await pg.$$eval('#pathCard .step', (s) => s.length), 8);
assert.equal(await pg.$$eval('#trackCards details.track', (d) => d.length), 5);
assert.deepEqual(await pg.$$eval('#trackCards details.track', (d) => d.map((x) => x.querySelectorAll('.step').length)), [6, 6, 6, 6, 6]);
await pg.click('#pathCard button[data-track="path"][data-step="0"]');
assert.match(await pg.textContent('#pathProgress'), /1 of 8 steps/);
await pg.click('#trackCards details[data-id="waterfowl"] summary');
await pg.click('#trackCards button[data-track="waterfowl"][data-step="2"]');
assert.ok(await pg.$eval('#trackCards details[data-id="waterfowl"]', (d) => d.open), 'stays open after a click');
await pg.reload(); await pg.waitForSelector('#pathCard .step');
assert.match(await pg.textContent('#pathProgress'), /1 of 8 steps/);
assert.ok(await pg.$eval('#pathCard .step', (s) => s.classList.contains('done')));
assert.match(await pg.$eval('#trackCards details[data-id="waterfowl"] summary', (s) => s.textContent), /1 of 6 steps/);
await pg.screenshot({ path: `${OUT}/learn-desktop.png`, fullPage: true });
await pg.close();

// ---- 6. streak: dates in localStorage, a STAY IN day in the gap does not break it
const T0 = localToday();
pg = await page();
await pg.goto(`${base}/about.html`);
await pg.evaluate(([t]) => {
  const shift = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  localStorage.setItem('daybird:learned', JSON.stringify({ outside: [shift(t, -1), shift(t, -2), shift(t, -4), shift(t, -5), shift(t, -9), shift(t, -8)] }));
  localStorage.setItem('daybird:calls', JSON.stringify([{ date: shift(t, -3), word: 'STAY IN', score: 30, verdict: null }]));
}, [T0]);
await settled(pg);
assert.equal(await pg.textContent('#streakNum'), '4', 'yesterday back through 5 days ago, skipping the STAY IN day');
assert.equal(await pg.textContent('#streakBest'), '4');
assert.match(await pg.textContent('#streakLine'), /Out this morning\?/);
await pg.click('#outBtn');
assert.equal(await pg.textContent('#streakNum'), '5');
assert.ok(await pg.isDisabled('#outBtn'));
assert.equal(await pg.textContent('#outBtn'), 'Went out this morning');
assert.ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:learned')).outside)).includes(T0));
// DB.markOutside is there for other pages too
await pg.goto(`${base}/index.html`); await pg.waitForFunction(() => typeof DB !== 'undefined' && typeof DB.markOutside === 'function');
assert.equal(await pg.evaluate(() => DB.markOutside().current), 5);
// a broken run: two days ago missing, nothing today → 0 now, best remembered
await pg.evaluate(([t]) => {
  const shift = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  localStorage.setItem('daybird:learned', JSON.stringify({ outside: [shift(t, -3), shift(t, -4), shift(t, -5)] })); localStorage.removeItem('daybird:calls');
}, [T0]);
await settled(pg);
assert.equal(await pg.textContent('#streakNum'), '0'); assert.equal(await pg.textContent('#streakBest'), '3');
assert.doesNotMatch(await pg.textContent('#streak'), /lost|broke|missed/i, 'no guilt language');
await pg.close();

// today is a STAY IN day: the streak pauses, the wording says so, and yesterday's run still counts
briefGrade = 'stay';
pg = await page();
await pg.goto(`${base}/about.html`);
await pg.evaluate(([t]) => {
  const shift = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  localStorage.setItem('daybird:learned', JSON.stringify({ outside: [shift(t, -1), shift(t, -2)] }));
}, [T0]);
await settled(pg);
assert.equal(await pg.textContent('#streakNum'), '2');
assert.match(await pg.textContent('#streakLine'), /Streak paused for the weather/);
assert.ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:learned')).paused)).includes(T0));
briefGrade = 'go';
await pg.close();

// ---- the 404 path (no daily brief): sample species, still ten cards and a 25-square card; phone width
briefMode = '404';
ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, acceptDownloads: true });
pg = await page(390);
await settled(pg);
assert.match(await pg.textContent('#source'), /sample species list/);
assert.equal(await pg.$$eval('#f10cards .card', (c) => c.length), 10);
assert.equal(await pg.$$eval('#bingoGrid .sq', (c) => c.length), 25);
assert.ok(await pg.$$eval('#weekGroups .card', (c) => c.length) >= 3);
assert.ok((await pg.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no horizontal scroll on a phone');
await pg.click('#trackCards details[data-id="sparrows"] summary');
await pg.screenshot({ path: `${OUT}/learn-phone.png`, fullPage: true });
await pg.close();
briefMode = 'json';

// ---- every existing page still loads (app.js and profile.html changed)
for (const f of ['index.html', 'id.html', 'passes.html', 'feed.html', 'profile.html', 'host.html', 'settings.html', 'about.html', 'unsubscribe.html', 'learn.html']) {
  pg = await page(390); await pg.goto(`${base}/${f}`); await pg.waitForTimeout(500); await pg.close();
}

await browser.close(); server.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log(`learn.html checks passed; screenshots in ${OUT}`);
