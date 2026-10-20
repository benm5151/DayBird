// Headless checks of "This week's birds" on the front door (index.html) with every outside host stubbed:
// Wikipedia, Wikimedia Commons, upload.wikimedia.org, Open-Meteo, eBird, Supabase and jsdelivr. The expected JSON and
// brief.json come from fixtures served by the test's own static server, so the checks do not depend on the day's data.
//   node tests/expected.ui.mjs            (Playwright and sharp from /opt/npm-tools, or PLAYWRIGHT_DIR / SHARP_DIR)
// Screenshots land in $OUT (default: a folder under the OS temp dir).
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import assert from 'node:assert/strict';
const PW = process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright';
const SH = process.env.SHARP_DIR || '/opt/npm-tools/node_modules/sharp';
const { chromium } = await import(`${PW}/index.mjs`);
const sharp = (await import(`${SH}/dist/index.mjs`)).default;

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = process.env.OUT || `${(await import('node:os')).tmpdir()}/daybird-expected-ui`;
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

// ---------------------------------------------------------------- fixtures
const NAMES = ['Blue Jay', 'Black-capped Chickadee', 'American Crow', 'White-breasted Nuthatch', 'Dark-eyed Junco', 'American Goldfinch', 'Tufted Titmouse', 'Downy Woodpecker', 'Mourning Dove', 'Northern Cardinal',
  'White-throated Sparrow', 'Yellow-rumped Warbler', 'American Robin', 'Red-bellied Woodpecker', 'Hairy Woodpecker', 'Song Sparrow', 'Common Raven', 'Golden-crowned Kinglet', 'Pileated Woodpecker', 'Canada Goose',
  'Mallard', 'Red-tailed Hawk', 'Turkey Vulture', 'Blue-headed Vireo', 'Ruby-crowned Kinglet', 'Pine Siskin', 'Cedar Waxwing', 'Hermit Thrush', 'Purple Finch', 'Brown Creeper', 'Eastern Bluebird', 'Bald Eagle'];
const TREND = { 'Blue Jay': ['arriving', 0.4], 'Dark-eyed Junco': ['new', 0], 'Yellow-rumped Warbler': ['tapering', 0.6], 'Pine Siskin': ['new', 0] };
const EXPECTED = {
  generated: '2026-10-20T09:40:00Z', region: { code: 'US-NH-009', name: 'Grafton County' },
  window: { from: '2026-10-11', to: '2026-10-20', lists: 41, locations: 17, basis: 'complete', tz: 'UTC' }, prev: { from: '2026-10-01', to: '2026-10-10', lists: 30 },
  species: NAMES.map((name, i) => { const share = i === 0 ? 0.683 : i === 1 ? 0.927 : Math.max(0.05, +(0.65 - i * 0.02).toFixed(3)); const [trend, prevShare] = TREND[name] || ['steady', share]; return { code: 'c' + i, name, share, prevShare, trend, lists: Math.round(share * 41) }; }),
};
EXPECTED.species.sort((a, b) => b.share - a.share);   // the file is sorted by share; the chickadee leads
const BRIEF = {
  generated: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), word: 'GO', grade: 'go', score: 95, headline: 'Get out there.', why: [], whyLine: 'Calm and dry at sunrise, 41°. Worth getting out.',
  wx: { temp: 41, wind: 5, windDir: 315, rain: 10, cloud: 20, cloudMid: 20, windMid: 5, high: 58, low: 35, sunrise: '07:05' }, spots: [{ name: 'Mink Brook', locId: 'L1', species: 12 }],
  notable: [{ comName: 'Snow Goose', howMany: 40, locName: 'Wilder Dam', obsDt: '2026-10-19 10:00', subId: 'S1003', locId: 'L333' }, { comName: 'Pine Siskin', locName: 'Hanover feeder', obsDt: '2026-10-18 08:10', subId: 'S1004', locId: 'L334' }],
  recent: ['Red-tailed Hawk', 'Turkey Vulture', 'Mallard', 'American Robin', 'Song Sparrow', 'Blue Jay', 'Common Raven', 'Canada Goose'], engine: 2,
};
const colorOf = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const pngFor = async (name, size) => sharp({ create: { width: size, height: size, channels: 3, background: `hsl(${colorOf(name)}, 45%, 55%)` } }).png().toBuffer();
const WX = () => {
  const d0 = new Date().toISOString().slice(0, 10), d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const hrs = (d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
  const col = (a, b) => [...Array(24).fill(a), ...Array(24).fill(b)];
  return { current: { time: `${d0}T07:30`, temperature_2m: 40 }, hourly: { time: [...hrs(d0), ...hrs(d1)], temperature_2m: col(41, 33), precipitation_probability: col(10, 70), wind_speed_10m: col(5, 20), wind_direction_10m: col(315, 180), cloud_cover: col(20, 90) }, daily: { time: [d0, d1], sunrise: [`${d0}T07:05`, `${d1}T07:06`], sunset: [`${d0}T17:58`, `${d1}T17:56`], temperature_2m_max: [58, 40], temperature_2m_min: [35, 30] } };
};

// ---------------------------------------------------------------- static server with fixture overrides
let expectedMode = 'ok';   // ok → US-NH-009 fixture | none → 404 for every county
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/data/brief.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(BRIEF)); }
  if (path.startsWith('/data/expected/')) {
    if (expectedMode === 'ok' && path === '/data/expected/US-NH-009.json') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(EXPECTED)); }
    res.statusCode = 404; return res.end();
  }
  const p = join(ROOT, path.replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
const wiki = { summaries: 0, commons: 0, thumbs: 0, inflightMax: 0, inflight: 0, titles: [] };
async function page(width = 1100, { settings = null, status = null, dark = false } = {}) {
  const pg = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 1100 }, colorScheme: dark ? 'dark' : 'light' });
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|supabase|404|status of 500/.test(m.text())) errors.push(m.text()); });
  await pg.addInitScript(({ settings, status }) => {
    try { localStorage.setItem('daybird:moreOpen', 'true'); if (settings) localStorage.setItem('daybird:settings', JSON.stringify(settings)); } catch {}
    if (status) globalThis.DAYBIRD_STATUS = { has: (n) => n === 'Blue Jay', now: (n, d) => (n === 'Blue Jay' && d instanceof Date ? 'Jays are moving south in loose flocks this month; the ones at your feeder may be passing through.' : '') };
  }, { settings, status });
  await pg.route(/supabase\.co|jsdelivr|open-meteo\.com|ebird\.org|wikipedia\.org|wikimedia\.org/, async (route) => {
    const u = route.request().url();
    if (u.includes('api.open-meteo.com')) return route.fulfill({ json: WX() });
    if (u.includes('jsdelivr')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.includes('en.wikipedia.org/api/rest_v1/page/summary/')) {
      wiki.summaries++; wiki.inflight++; wiki.inflightMax = Math.max(wiki.inflightMax, wiki.inflight);
      await new Promise((r) => setTimeout(r, 30)); wiki.inflight--;
      const title = decodeURIComponent(u.split('/summary/')[1]).replace(/_/g, ' ');
      wiki.titles.push(title);
      if (/^Brown [Cc]reeper$/.test(title)) return route.fulfill({ status: 404, json: { type: 'not_found' } });   // one bird with no page (either spelling): stays on paper
      if (/^[A-Z][a-z-]+ [A-Z]/.test(title) && title !== 'Blue Jay') return route.fulfill({ status: 404, json: { type: 'not_found' } });   // eBird capitalisation misses; the sentence-case retry hits
      const file = title.replace(/ /g, '_') + '.jpg';
      return route.fulfill({ json: { type: 'standard', titles: { canonical: title.replace(/ /g, '_'), normalized: title }, thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/320px-${file}`, width: 320, height: 240 }, originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, width: 1200, height: 900 }, content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } } } });
    }
    if (u.includes('commons.wikimedia.org/w/api.php')) {
      wiki.commons++;
      const file = decodeURIComponent(new URL(u).searchParams.get('titles')).replace(/^File:/, '');
      return route.fulfill({ json: { query: { pages: { 1: { title: 'File:' + file, imageinfo: [{ extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a><img src=x onerror="alert(1)">' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } } });
    }
    if (u.includes('upload.wikimedia.org')) { wiki.thumbs++; const m = /\/(\d+)px-(.+)$/.exec(u); return route.fulfill({ contentType: 'image/png', body: await pngFor(m ? m[2] : u, m ? Math.min(+m[1], 400) : 400) }); }
    return route.fulfill({ status: 404, body: '' });
  });
  return pg;
}
const rows = (pg) => pg.$$eval('#weekList button.bird', (bs) => bs.map((b) => ({ name: b.querySelector('.who b').textContent, how: (b.querySelector('.how') || {}).textContent || '', trend: (b.querySelector('.trend') || {}).textContent || '', photo: b.querySelector('.thumb').classList.contains('has-photo'), paper: b.querySelector('.thumb span') ? b.querySelector('.thumb span').textContent : '' })));
const weekLoaded = (pg) => pg.waitForFunction(() => document.querySelectorAll('#weekList button.bird').length > 0);

// ---------------------------------------------------------------- 1. phone: the list, the shares, the trend words, show more
let pg = await page(390);
await pg.goto(`${base}/index.html`);
await weekLoaded(pg);
assert.equal(await pg.textContent('#weekTitle'), "This week's birds");
assert.equal(await pg.textContent('#weekLine'), 'Grafton County, 41 checklists, Oct 11–20.');
let r = await rows(pg);
assert.equal(r.length, 15, 'fifteen rows to start');
assert.deepEqual(r.slice(0, 3).map((x) => [x.name, x.how, x.trend]), [
  ['Black-capped Chickadee', 'on almost every checklist', ''],
  ['Blue Jay', 'on 7 in 10 checklists', 'arriving'],
  ['American Crow', 'on 6 in 10 checklists', ''],
]);
assert.ok(r.some((x) => x.name === 'Dark-eyed Junco' && x.trend === 'new' && x.how === 'on 6 in 10 checklists'));
assert.ok(r.some((x) => x.name === 'Yellow-rumped Warbler' && x.trend === 'tapering'));
assert.ok(r.every((x) => /^on (\d in 10 checklists|almost every checklist)$/.test(x.how)), 'every row says how many checklists');
assert.ok(r.every((x) => ['', 'arriving', 'new', 'tapering'].includes(x.trend)), 'steady shows no word');
assert.equal(await pg.textContent('#weekMoreBtn'), 'Show 15 more');
// the card sits right after the front door and before the fold, and no row is a table
assert.deepEqual(await pg.$$eval('.wrap > *', (els) => els.map((e) => e.id).filter((s) => ['door', 'banner', 'weekcard', 'birdSheet', 'moreWrap'].includes(s))), ['door', 'banner', 'weekcard', 'birdSheet', 'moreWrap']);
assert.equal(await pg.$$eval('#weekcard table', (t) => t.length), 0);
// placeholders are the name on paper; photos arrive lazily for the rows on screen, at most four lookups at a time
assert.ok(r.filter((x) => !x.photo).every((x) => x.paper === x.name), 'name-on-paper placeholder');
await pg.waitForFunction(() => document.querySelectorAll('#weekList .thumb.has-photo').length >= 4, null, { timeout: 15000 });
r = await rows(pg);
assert.ok(r[0].photo && r[1].photo, 'the first rows have their photo');
assert.ok(wiki.inflightMax <= 4, `at most four Wikipedia lookups in flight (saw ${wiki.inflightMax})`);
assert.ok(await pg.$$eval('#weekList img', (imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)), 'no broken images');
await pg.screenshot({ path: `${OUT}/week-390.png`, fullPage: false });
await pg.click('#weekMoreBtn');
r = await rows(pg);
assert.equal(r.length, 30, 'thirty after Show 15 more');
assert.equal(await pg.$eval('#weekMore', (p) => p.hidden), true, 'nothing more to show');
assert.equal(r[29].how, 'on 1 in 10 checklists', 'the bottom end reads 1 in 10');
assert.ok(r.some((x) => x.name === 'Pine Siskin' && x.trend === 'new'));
await pg.evaluate(() => document.getElementById('weekcard').scrollIntoView());
await pg.screenshot({ path: `${OUT}/week-390-full.png`, fullPage: true });

// ---------------------------------------------------------------- 2. the sheet: photo, status sentence, credit, links, the status hook
await pg.close();
pg = await page(390, { status: true });
await pg.goto(`${base}/index.html`);
await weekLoaded(pg);
await pg.click('#weekList li:nth-child(2) button.bird');          // Blue Jay
await pg.waitForFunction(() => document.getElementById('birdSheet').open && /Jane Doe/.test(document.getElementById('birdSheet').textContent));
assert.equal(await pg.textContent('#birdSheetName'), 'Blue Jay');
assert.equal(await pg.textContent('#birdSheet .status'), 'On 68% of 41 checklists in Grafton County over Oct 11–20, up from 40% the ten days before: arriving.');
assert.equal(await pg.textContent('#birdSheet .credit'), 'Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons');
assert.ok(!/onerror=|<img src=x/.test(await pg.content()), 'artist HTML is stripped, never injected');
assert.equal(await pg.getAttribute('#birdSheet .credit a', 'href'), 'https://commons.wikimedia.org/wiki/File:Blue_Jay.jpg');
assert.equal(await pg.getAttribute('#birdSheet .acts a:nth-child(1)', 'href'), 'https://en.wikipedia.org/wiki/Blue_Jay');
assert.equal(await pg.textContent('#birdSheet .acts a:nth-child(2)'), "What it's up to this season");
assert.equal(await pg.getAttribute('#birdSheet .acts a:nth-child(2)', 'href'), 'bird.html?name=Blue%20Jay');
assert.equal(await pg.getAttribute('#birdSheet .status-note', 'data-species'), 'Blue Jay');
assert.match(await pg.textContent('#birdSheet .status-note'), /^Jays are moving south/, 'DAYBIRD_STATUS hook renders when present');
assert.ok(await pg.$eval('#birdSheet .pic img', (i) => i.complete && i.naturalWidth > 0), 'the big photo loaded');
await pg.screenshot({ path: `${OUT}/week-sheet-390.png` });
await pg.click('#sheetClose');
assert.equal(await pg.$eval('#birdSheet', (d) => d.open), false);
// a bird with no page: name on paper in the sheet, Wikipedia link still offered, no status note from the hook
await pg.click('#weekMoreBtn');
await pg.click('#weekList button.bird[data-name="Brown Creeper"]');
await pg.waitForFunction(() => document.getElementById('birdSheet').open && /No free photo/.test(document.getElementById('birdSheet').textContent));
assert.equal(await pg.textContent('#birdSheet .pic .nm'), 'Brown Creeper');
assert.equal(await pg.textContent('#birdSheet .status-note'), '', 'hook knows only the jay');
assert.equal(await pg.getAttribute('#birdSheet .acts a:nth-child(1)', 'href'), 'https://en.wikipedia.org/wiki/Brown_Creeper');
await pg.keyboard.press('Escape');
assert.equal(await pg.$eval('#birdSheet', (d) => d.open), false);
// the cache is shared with lifelist.js: same key, same record shape (misses included, once the lookup has finished)
await pg.waitForFunction(() => /Brown Creeper/.test(localStorage.getItem('daybird:photos') || ''));
const cache = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:photos')));
assert.deepEqual(Object.keys(cache['Blue Jay']).sort(), ['artist', 'at', 'image', 'license', 'page', 'thumb', 'title', 'wiki'], 'the record shape js/lifelist.js reads');
assert.deepEqual(cache['Brown Creeper'], { none: true, at: new Date().toISOString().slice(0, 10) });
assert.equal(cache['Blue Jay'].thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Blue_Jay.jpg/400px-Blue_Jay.jpg');
// a reload makes no Wikipedia requests for cached species (let the lookups still queued finish first)
const settle = async () => { for (let n = wiki.summaries; ; n = wiki.summaries) { await new Promise((r) => setTimeout(r, 400)); if (wiki.summaries === n && wiki.inflight === 0) return; } };
await settle();
const known = Object.keys(await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:photos')))).map((n) => n.toLowerCase());
const before = wiki.titles.length;
await pg.reload(); await weekLoaded(pg);
await pg.waitForFunction(() => document.querySelectorAll('#weekList .thumb.has-photo').length >= 4, null, { timeout: 15000 });
await settle();
const fresh = wiki.titles.slice(before);
assert.ok(fresh.every((t) => !known.includes(t.toLowerCase())), 'cached species are not looked up again after a reload: ' + fresh.join(', '));
assert.ok(known.length >= 10 && (await pg.$$eval('#weekList .thumb.has-photo', (t) => t.length)) >= 4, 'photos came back from the cache');
await pg.close();

// ---------------------------------------------------------------- 3. notable nearby: thumb + context line, links kept
pg = await page(1100);
await pg.goto(`${base}/index.html`);
await weekLoaded(pg);
const notable = await pg.$$eval('#notable .notable-row', (rs) => rs.map((x) => ({ name: x.querySelector('.who b').textContent, link: (x.querySelector('.who b a') && x.querySelector('.who b a').getAttribute('href')) || '', ctx: x.querySelector('.ctx').textContent, where: x.querySelector('.where').textContent, thumb: !!x.querySelector('.thumb') })));
const month = new Date().toLocaleDateString('en-US', { month: 'long' });
assert.deepEqual(notable, [
  { name: 'Snow Goose ×40', link: 'https://ebird.org/checklist/S1003', ctx: `Not usually here in ${month}`, where: 'Wilder Dam · 2026-10-19 10:00', thumb: true },
  { name: 'Pine Siskin', link: 'https://ebird.org/checklist/S1004', ctx: 'Uncommon here, but around', where: 'Hanover feeder · 2026-10-18 08:10', thumb: true },
]);
await pg.waitForFunction(() => document.querySelectorAll('#weekList .thumb.has-photo').length >= 8, null, { timeout: 15000 });
await pg.screenshot({ path: `${OUT}/week-1100.png` });
await pg.evaluate(() => document.getElementById('notable').scrollIntoView());
await pg.screenshot({ path: `${OUT}/notable-1100.png` });
await pg.close();

// ---------------------------------------------------------------- 4. fallbacks: outside the counties; inside but not built yet
pg = await page(390, { settings: { lat: 42.36, lng: -71.06, placeLabel: 'Boston, Massachusetts' } });
await pg.goto(`${base}/index.html`);
await weekLoaded(pg);
assert.equal(await pg.textContent('#weekTitle'), 'Reported near you lately');
assert.equal(await pg.textContent('#weekLine'), 'Daybird counts checklists for the Upper Valley so far.');
r = await rows(pg);
assert.deepEqual(r.map((x) => x.name), BRIEF.recent, "the brief's recent names, in order");
assert.ok(r.every((x) => x.how === '' && x.trend === ''), 'no shares, no trend words');
assert.equal(await pg.$eval('#weekMore', (p) => p.hidden), true);
assert.equal(await pg.$$eval('#notable .ctx', (c) => c.length), 0, 'no context line without a county list');
await pg.click('#weekList li:nth-child(1) button.bird');
await pg.waitForFunction(() => document.getElementById('birdSheet').open);
assert.equal(await pg.$$eval('#birdSheet .status', (s) => s.length), 0, 'no status sentence without shares');
await pg.keyboard.press('Escape');
await pg.evaluate(() => document.getElementById('weekcard').scrollIntoView());
await pg.screenshot({ path: `${OUT}/week-fallback-390.png` });
await pg.close();
expectedMode = 'none';
pg = await page(390);
await pg.goto(`${base}/index.html`);
await weekLoaded(pg);
assert.equal(await pg.textContent('#weekTitle'), 'Reported near you lately');
assert.equal(await pg.textContent('#weekLine'), "Daybird hasn't counted this week's checklists for Grafton County yet.");
await pg.close();
expectedMode = 'ok';

// ---------------------------------------------------------------- 5. dark mode, and every page still loads without a page error
pg = await page(390, { dark: true });
await pg.goto(`${base}/index.html`); await weekLoaded(pg);
await pg.waitForFunction(() => document.querySelectorAll('#weekList .thumb.has-photo').length >= 4, null, { timeout: 15000 });
await pg.evaluate(() => document.getElementById('weekcard').scrollIntoView());
await pg.screenshot({ path: `${OUT}/week-390-dark.png` });
await pg.close();
const pages = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
for (const f of pages) { pg = await page(1100); await pg.goto(`${base}/${f}`); await pg.waitForTimeout(350); await pg.close(); }

await browser.close(); server.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log(`This week's birds UI checks passed (${pages.length} pages loaded clean); screenshots in ${OUT}`);
