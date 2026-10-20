// Headless checks for compare.html, bird.html and marks.html (js/compare.js, js/bird.js). Every outside host is stubbed:
// Wikipedia summaries and the Commons API answer from fixtures for eight species, upload.wikimedia.org serves solid-color
// PNGs, the Supabase CDN serves nothing (offline mode). data/regions.json and data/expected/<code>.json are stubbed
// present or absent per test, since neither file is in this branch. Also loads every other .html page once and fails on
// any pageerror. Screenshots at 390 and 1100 px go to DAYBIRD_SHOTS (default: a temp folder).
// Run from the repo root (Playwright and sharp from /opt/npm-tools on the build box, or `npm i playwright sharp`):
//   PLAYWRIGHT_DIR=/opt/npm-tools/node_modules/playwright SHARP_DIR=/opt/npm-tools/node_modules/sharp DAYBIRD_SHOTS=/tmp/shots node tests/compare.ui.mjs
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = await import(join(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright', 'index.mjs'));
const sharp = require(process.env.SHARP_DIR || '/opt/npm-tools/node_modules/sharp');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DAYBIRD_SHOTS || join(tmpdir(), 'daybird-compare-shots');
await mkdir(OUT, { recursive: true });
require(join(ROOT, 'data/tells.js')); require(join(ROOT, 'data/status.js'));
const TELLS = globalThis.DAYBIRD_TELLS, STATUS = globalThis.DAYBIRD_STATUS;
const SPARROWS = TELLS.find(g => g.key === 'sparrows').species.map(s => s.name);
const DUCKS = TELLS.find(g => g.key === 'ducks').species.map(s => s.name);

// ---- static server for the repo (regions/expected are handled by page.route so each test picks present or absent)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ---- fixtures: eight species with photos (five sparrows, a duck, the robin, the cardinal, the starling, the jay)
const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer();
const COLORS = { 'White-throated Sparrow': [140, 110, 80], 'Song Sparrow': [120, 95, 70], 'Dark-eyed Junco': [90, 95, 105], 'Chipping Sparrow': [150, 120, 90], 'House Sparrow': [130, 115, 100],
  'Mallard': [40, 90, 60], 'American Robin': [184, 92, 42], 'Northern Cardinal': [190, 30, 40], 'European Starling': [50, 50, 60], 'Blue Jay': [59, 111, 182] };
const PHOTOS = {}; for (const [n, c] of Object.entries(COLORS)) PHOTOS[n] = await png(400, 300, c);
const fileOf = (n) => n.replace(/ /g, '_') + '_fixture.jpg';
const summaryFor = (n) => ({
  type: 'standard', titles: { canonical: n.replace(/ /g, '_'), normalized: n },
  thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${fileOf(n)}/320px-${fileOf(n)}`, width: 320, height: 240 },
  originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${fileOf(n)}`, width: 3000, height: 2250 },
  content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${n.replace(/ /g, '_')}` } },
});
// the junco answers only in Wikipedia's sentence case (the second try); the others as typed
const SUMMARIES = {};
for (const n of Object.keys(COLORS)) SUMMARIES[n === 'Dark-eyed Junco' ? 'Dark-eyed_junco' : n.replace(/ /g, '_')] = summaryFor(n);
const ARTIST = (n) => [`<a href="//commons.wikimedia.org/wiki/User:Test">Photographer of the ${n}</a>`, 'CC BY-SA 4.0'];

// regions / expected fixtures. The default location (DB.settings) is Lebanon NH: 43.6423, -72.2518
const REGIONS = [{ code: 'US-NH-009', name: 'Grafton County', bbox: [-72.4, 43.3, -71.5, 44.3] }, { code: 'US-VT-027', name: 'Windsor County', bbox: [-73.0, 43.3, -72.4, 43.9] }];
const EXPECTED = { name: 'Grafton County', from: '2026-10-10', to: '2026-10-20', checklists: 41,
  species: { 'Dark-eyed Junco': 0.80, 'White-throated Sparrow': 0.68, 'Song Sparrow': 0.20, 'House Sparrow': 0.05, 'Mallard': 0.4, 'Blue Jay': 0.9 } };

// ---- browser helpers
const browser = await chromium.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const counters = () => ({ inflight: 0, max: 0, api: 0, byTitle: {}, images: 0, regions: 0, expected: 0 });
async function stubAll(page, C, { expected = true, apiDelay = 40 } = {}) {
  await page.route(/cdn\.jsdelivr\.net/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* no sdk: offline mode */' }));
  await page.route(/supabase\.co|api\.ebird\.org|open-meteo\.com|birdcast|nominatim|photon/, r => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().url().includes('ebird') ? '[]' : '{}' }));
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
    const [artist, lic] = ARTIST(name);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { pages: { 123: { title: 'File:' + file, imageinfo: [{ extmetadata: { Artist: { value: artist }, LicenseShortName: { value: lic } } }] } } } }) });
  });
  await page.route(/upload\.wikimedia\.org/, r => {
    C.images++;
    const file = decodeURIComponent(r.request().url().split('/').pop()).replace(/^\d+px-/, '');
    const name = Object.keys(PHOTOS).find(n => fileOf(n) === file);
    return name ? r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PHOTOS[name] }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/\/data\/regions\.json/, r => { C.regions++; return expected ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REGIONS) }) : r.fulfill({ status: 404, body: '' }); });
  await page.route(/\/data\/expected\/[^/]+\.json/, r => {
    C.expected++;
    const code = decodeURIComponent(r.request().url().split('/expected/')[1].replace(/\.json.*$/, ''));
    return expected && code === 'US-NH-009' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EXPECTED) }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/\/data\/brief\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generated: '2026-10-19T10:00:00Z', word: 'GO', recent: [] }) }));
}
async function newPage(ctx, C, opts = {}) {
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.errors = errors;
  await stubAll(page, C, opts);
  if (opts.init) await page.addInitScript(opts.init);
  return page;
}
async function settle(C, quiet = 400, limit = 20000) {
  const t0 = Date.now(); let last = C.api, lastAt = Date.now();
  while (Date.now() - t0 < limit) { await sleep(40); if (C.api !== last) { last = C.api; lastAt = Date.now(); } if (C.inflight === 0 && Date.now() - lastAt > quiet) return; }
  throw new Error('network did not settle');
}
const cardNames = (page) => page.$$eval('#rail .ccard', els => els.map(e => e.dataset.name));
const noBroken = async (page) => assert.equal(await page.$$eval('img', els => els.filter(i => i.complete && !i.naturalWidth && !/mark\.svg|icon\.svg/.test(i.src)).length), 0, 'a broken image is showing');
let failures = 0;
async function step(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); } }
const AT = '2026-10-20';   // a fixed "today" for ordering and the month strip

// ======================================================================= phone: compare.html with the local counts present
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const C = counters();
  const page = await newPage(ctx, C, { expected: true });
  await page.goto(base + `/compare.html?at=${AT}`); await page.waitForSelector('#rail .ccard');
  await settle(C);

  await step('sparrows by default; the title asks the question; the intro and the caveat are there', async () => {
    assert.equal(await page.textContent('#title'), 'Which sparrow is that?');
    assert.equal(await page.title(), 'Daybird — Which sparrow is that?');
    assert.ok((await page.textContent('#intro')).length > 40);
    assert.match(await page.textContent('.caveat'), /not yet checked by an expert birder/);
    assert.equal(await page.getAttribute('.caveat a', 'href'), 'about.html');
    assert.equal(await page.getAttribute('#chips button[aria-pressed=true]', 'data-g'), 'sparrows');
    assert.equal((await page.$$('#chips button')).length, TELLS.length);
  });
  await step('with expected data: cards are ordered by how often each was reported, with likely/possible chips', async () => {
    const names = await cardNames(page);
    assert.deepEqual(names.slice(0, 4), ['Dark-eyed Junco', 'White-throated Sparrow', 'Song Sparrow', 'House Sparrow']);
    assert.equal(names.length, SPARROWS.length);
    const chips = await page.$$eval('#rail .ccard', els => els.map(e => (e.querySelector('.when') || {}).textContent || ''));
    assert.deepEqual(chips.slice(0, 4), ['likely this week', 'likely this week', 'likely this week', 'possible this week']);
    assert.ok(chips.slice(4).every(c => c === ''));
    assert.match(await page.textContent('#where'), /Grafton County, Oct 10–20/);
    assert.equal(C.regions, 1); assert.equal(C.expected, 1);
  });
  await step('each card: photo + credit (or the name on paper), the name linking to bird.html, the look line, vs lines with the neighbours first', async () => {
    const first = await page.$('#rail .ccard[data-i="0"]');
    assert.ok(await first.$('.pic.has-photo img'), 'the junco has its photo (found in sentence case)');
    assert.equal(C.byTitle['Dark-eyed_Junco'], 1); assert.equal(C.byTitle['Dark-eyed_junco'], 1);
    assert.match(await first.$eval('.credit', e => e.textContent), /Photographer of the Dark-eyed Junco · CC BY-SA 4.0 · Wikimedia Commons/);
    assert.equal(await first.$eval('h2 a', a => a.getAttribute('href')), 'bird.html?name=Dark-eyed%20Junco');
    assert.equal(await first.$eval('.look', e => e.textContent), TELLS.find(g => g.key === 'sparrows').species.find(s => s.name === 'Dark-eyed Junco').look);
    const vsNames = await first.$$eval('.vs b', bs => bs.map(b => b.textContent));
    assert.equal(vsNames.length, SPARROWS.length - 1);
    assert.deepEqual(vsNames.slice(0, 2).sort(), ['White-crowned Sparrow', 'White-throated Sparrow'].sort(), 'previous (last card) and next card come first');
    // the two neighbours are in view; the other three fold under a summary
    assert.equal(await first.$$eval('.vs > div', ds => ds.length), 2);
    assert.equal(await first.$eval('.morevs summary', e => e.textContent), 'vs the other 3 sparrows');
    assert.equal(await first.$$eval('.morevs .fold > div', ds => ds.length), 3);
    assert.equal(await first.$eval('.morevs .fold', e => e.checkVisibility()), false, 'folded lines are hidden until opened');
    await first.$eval('.morevs summary', e => e.click());
    assert.equal(await first.$eval('.morevs .fold', e => e.checkVisibility()), true, 'opened');
    await first.$eval('.morevs summary', e => e.click());
    // a species without a fixture photo keeps its name on paper, no broken image
    const wc = await page.$('#rail .ccard[data-name="White-crowned Sparrow"] .pic');
    assert.ok(!(await wc.$('img')), 'no img for a species with no photo');
    assert.equal(await wc.$eval('.paper', e => getComputedStyle(e).display), 'block');
    await noBroken(page);
    assert.ok(C.max <= 4, 'at most 4 lookups in flight, saw ' + C.max);
  });
  await step('the cache is shared with lifelist.js: daybird:photos holds the records', async () => {
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('daybird:photos')));
    const j = cache['Dark-eyed Junco'];
    assert.ok(j.thumb && j.image && j.artist && j.license && j.page && j.at, 'record shape');
    assert.equal(cache['White-crowned Sparrow'].none, true, 'a miss is cached too');
  });
  await step('phone carousel: one card about 82% wide, the next peeking in, dots under', async () => {
    const w = await page.$eval('#rail .ccard[data-i="0"]', e => e.getBoundingClientRect().width);
    assert.ok(w > 280 && w < 310, 'card width ' + w);
    assert.equal((await page.$$('#dots button')).length, SPARROWS.length);
    assert.equal(await page.getAttribute('#dots button[data-i="0"]', 'aria-current'), 'true');
    await page.screenshot({ path: join(OUT, 'compare-390.png'), fullPage: true });
    await page.click('#dots button[data-i="2"]'); await sleep(700);
    assert.equal(await page.getAttribute('#dots button[data-i="2"]', 'aria-current'), 'true');
    await page.screenshot({ path: join(OUT, 'compare-390-card3.png') });
  });
  await step('chips switch groups, the URL and localStorage remember it', async () => {
    await page.click('#chips button[data-g="ducks"]'); await page.waitForFunction(() => document.querySelector('#rail .ccard').dataset.name !== 'Dark-eyed Junco');
    assert.equal(await page.textContent('#title'), 'Which duck is that?');
    assert.deepEqual((await cardNames(page)).sort(), DUCKS.slice().sort());
    assert.equal((await cardNames(page))[0], 'Mallard', 'the only duck with a count comes first');
    assert.equal(await page.evaluate(() => localStorage.getItem('daybird:compareGroup')), 'ducks');
    assert.match(page.url(), /g=ducks/);
    await settle(C);
    assert.equal(await page.textContent('#dots button[data-i="0"]'), '');
  });
  await step('quiz me: a photo with the name hidden, three names from the group, tapping the right one is marked right', async () => {
    await page.click('#chips button[data-g="sparrows"]'); await page.waitForFunction(() => document.querySelector('#rail .ccard').dataset.name === 'Dark-eyed Junco');
    await settle(C);
    await page.click('#quizBtn'); await page.waitForSelector('#quiz .qopts button');
    assert.equal(await page.$eval('#deck', e => e.hidden), true);
    assert.equal(await page.$eval('#dots', e => getComputedStyle(e).display), 'none', 'the dots hide with the cards');
    const answer = await page.getAttribute('#quiz', 'data-answer');
    assert.ok(SPARROWS.includes(answer));
    assert.equal(await page.$eval('#quiz img', i => i.alt), 'A mystery sparrow', 'the alt does not give it away');
    assert.ok(!(await page.textContent('#quiz .qask')).includes(answer));
    const opts = await page.$$eval('#quiz .qopts button', bs => bs.map(b => b.textContent));
    assert.equal(opts.length, 3); assert.ok(opts.includes(answer)); assert.ok(opts.every(o => SPARROWS.includes(o)));
    assert.match(await page.textContent('#quiz .credit'), /Photographer of the/);
    // a wrong answer first: it is marked wrong, the right one shown, and the vs line explains the split
    const wrong = opts.find(o => o !== answer);
    await page.click(`#quiz .qopts button[data-pick="${wrong}"]`);
    assert.match(await page.textContent('#quiz .qmsg'), new RegExp(`Not that one\\. It's the ${answer}`));
    assert.equal(await page.$eval(`#quiz .qopts button[data-pick="${answer}"]`, b => b.className), 'right');
    assert.equal(await page.textContent('#quiz .qscore'), '0 of 1 right');
    await page.click('#qNext'); await page.waitForFunction(() => document.querySelector('#quiz .qopts button') && !document.querySelector('#quiz .qopts button').disabled);
    const a2 = await page.getAttribute('#quiz', 'data-answer');
    await page.click(`#quiz .qopts button[data-pick="${a2}"]`);
    assert.match(await page.textContent('#quiz .qmsg'), /^Right\./);
    assert.equal(await page.textContent('#quiz .qscore'), '1 of 2 right');
    await page.screenshot({ path: join(OUT, 'compare-390-quiz.png') });
    await page.click('#qBack');
    assert.equal(await page.$eval('#deck', e => e.hidden), false);
    assert.equal(await page.textContent('#quizBtn'), 'Quiz me');
  });
  await step('no page errors on compare.html (phone)', () => assert.deepEqual(page.errors, []));
  await ctx.close();
}

// ======================================================================= phone: compare.html with no regions/expected files (the fallback)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const C = counters();
  const page = await newPage(ctx, C, { expected: false, init: () => localStorage.setItem('daybird:compareGroup', 'finches') });
  await page.goto(base + `/compare.html?at=${AT}`); await page.waitForSelector('#rail .ccard'); await settle(C);
  await step('the remembered group opens; without local counts the hand-written order stands and the where line says so', async () => {
    assert.equal(await page.textContent('#title'), 'Which finch is that?');
    assert.deepEqual(await cardNames(page), TELLS.find(g => g.key === 'finches').species.map(s => s.name));
    assert.match(await page.textContent('#where'), /No local counts for your spot yet/);
    assert.equal(await page.$$eval('#rail .when', els => els.length), 0, 'no chips: every finch is around in October');
  });
  await step('?g= beats the remembered group; a bird that is away this month gets a soft "gone until" chip and goes last', async () => {
    await page.goto(base + '/compare.html?g=sparrows&at=2026-01-15'); await page.waitForSelector('#rail .ccard'); await settle(C);
    const names = await cardNames(page);
    assert.deepEqual(names.slice(0, 2).sort(), ['Dark-eyed Junco', 'House Sparrow']);
    const chip = await page.$eval('#rail .ccard[data-name="Chipping Sparrow"] .when', e => e.textContent + '|' + e.className);
    assert.equal(chip, 'Gone until April|when soft');
    assert.equal(await page.evaluate(() => localStorage.getItem('daybird:compareGroup')), 'sparrows');
  });
  await step('no page errors on compare.html (fallback)', () => assert.deepEqual(page.errors, []));
  await ctx.close();
}

// ======================================================================= desktop: three cards visible, arrows
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const C = counters();
  const page = await newPage(ctx, C, { expected: true });
  await page.goto(base + `/compare.html?g=sparrows&at=${AT}`); await page.waitForSelector('#rail .ccard'); await settle(C);
  await step('1100 px: three cards in view, arrow buttons shown, the next arrow scrolls', async () => {
    const rects = await page.$$eval('#rail .ccard', els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    const railR = await page.$eval('#rail', e => e.getBoundingClientRect().right);
    assert.equal(rects.filter(([l, r]) => l >= 0 && r <= railR + 1).length, 3, 'three fully visible cards: ' + JSON.stringify(rects));
    assert.equal(await page.$eval('#next', e => getComputedStyle(e).display), 'grid');
    assert.equal(await page.$eval('#prev', e => e.disabled), true);
    await page.screenshot({ path: join(OUT, 'compare-1100.png'), fullPage: true });
    await page.click('#next'); await sleep(700);
    assert.equal(await page.getAttribute('#dots button[data-i="1"]', 'aria-current'), 'true');
    assert.equal(await page.$eval('#prev', e => e.disabled), false);
  });
  await step('no page errors on compare.html (desktop)', () => assert.deepEqual(page.errors, []));
  await ctx.close();
}

// ======================================================================= bird.html
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const C = counters();
  const page = await newPage(ctx, C, { expected: true });
  await page.goto(base + `/bird.html?name=${encodeURIComponent('White-throated Sparrow')}&at=${AT}`); await page.waitForSelector('#name'); await settle(C);
  await step('bird.html: photo + credit, the name, the status word, the month strip, the current line big, the other three small', async () => {
    assert.equal(await page.textContent('#name'), 'White-throated Sparrow');
    assert.equal(await page.title(), 'Daybird — White-throated Sparrow');
    assert.equal(await page.textContent('#word'), 'Peaking');
    assert.ok(await page.$('#pic.has-photo img'));
    assert.match(await page.textContent('#credit'), /Photographer of the White-throated Sparrow · CC BY-SA 4.0/);
    const cells = await page.$$eval('.months div', els => els.map(e => e.className.trim()));
    assert.equal(cells.length, 12);
    assert.deepEqual(cells.map(c => c.includes('on')), [4, 5, 9, 10, 11].reduce((a, m) => (a[m - 1] = true, a), Array(12).fill(false)));
    assert.equal(cells.filter(c => c.includes('now')).length, 1); assert.ok(cells[9].includes('now'), 'October is ringed');
    assert.equal(await page.textContent('#now'), 'October: ' + STATUS.species['White-throated Sparrow'].seasons.fall);
    const nowSize = await page.$eval('#now', e => parseFloat(getComputedStyle(e).fontSize)), otherSize = await page.$eval('#others p', e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(nowSize > otherSize, 'the current season is bigger');
    assert.equal((await page.$$('#others p')).length, 3);
    assert.match(await page.textContent('#others'), /spring.*summer.*winter/s);
  });
  await step('bird.html: the tell with a link to its group, the count line, Wikipedia and All About Birds links, the caveat', async () => {
    assert.match(await page.textContent('#tell'), /yellow spot between the bill and the eye/i);
    assert.equal(await page.getAttribute('#tell a', 'href'), 'compare.html?g=sparrows');
    assert.equal(await page.textContent('#count'), 'On 68% of 41 checklists in Grafton County, Oct 10–20.');
    assert.equal(await page.getAttribute('#links a[href*="allaboutbirds"]', 'href'), 'https://www.allaboutbirds.org/guide/White-throated_Sparrow');
    assert.equal(await page.getAttribute('#wikiLink', 'href'), 'https://en.wikipedia.org/wiki/White-throated_Sparrow');
    assert.match(await page.textContent('.caveat'), /not yet checked by an expert birder/);
    await page.screenshot({ path: join(OUT, 'bird-390.png'), fullPage: true });
  });
  await step('bird.html: a species with no status entry shows photo, name, links and the fallback line; no count line without data', async () => {
    const C2 = counters(); const p2 = await newPage(ctx, C2, { expected: false });
    await p2.goto(base + `/bird.html?name=${encodeURIComponent('Blue Jay')}&at=${AT}`); await p2.waitForSelector('#name'); await settle(C2);
    // Blue Jay has a status entry; use a name we have not written up
    await p2.goto(base + `/bird.html?name=${encodeURIComponent('Great Black-backed Gull')}&at=${AT}`); await p2.waitForSelector('#name'); await settle(C2);
    assert.equal(await p2.textContent('#name'), 'Great Black-backed Gull');
    assert.equal(await p2.textContent('#notyet'), "We haven't written this one up yet.");
    assert.equal(await p2.$('#word'), null); assert.equal(await p2.$('.months'), null); assert.equal(await p2.$('#now'), null);
    assert.ok(await p2.$('#pic .paper'), 'name on paper (no fixture photo)'); assert.equal(await p2.$('#pic img'), null);
    assert.equal(await p2.getAttribute('#links a[href*="allaboutbirds"]', 'href'), 'https://www.allaboutbirds.org/guide/Great_Black-backed_Gull');
    assert.ok(await p2.$('#tell'), 'the tell still shows: the gull is in the gulls group'); assert.equal(await p2.getAttribute('#tell a', 'href'), 'compare.html?g=gulls');
    assert.equal(await p2.textContent('#count'), '');
    await p2.screenshot({ path: join(OUT, 'bird-390-notyet.png'), fullPage: true });
    assert.deepEqual(p2.errors, []);
    // a bird with status but no tells group: no tell card
    await p2.goto(base + `/bird.html?name=${encodeURIComponent('Blue Jay')}&at=${AT}`); await p2.waitForSelector('#name');
    assert.equal(await p2.textContent('#word'), 'Here all year'); assert.equal(await p2.$('#tell'), null);
    assert.equal(await p2.$$eval('.months div.on', e => e.length), 12);
    // an apostrophe in the name: All About Birds drops it
    await p2.goto(base + `/bird.html?name=${encodeURIComponent("Cooper's Hawk")}&at=${AT}`); await p2.waitForSelector('#name');
    assert.equal(await p2.getAttribute('#links a[href*="allaboutbirds"]', 'href'), 'https://www.allaboutbirds.org/guide/Coopers_Hawk');
    // no name: the index
    await p2.goto(base + '/bird.html'); await p2.waitForSelector('.index');
    assert.ok((await p2.$$('.index a')).length >= 40);
    assert.deepEqual(p2.errors, []);
  });
  await step('no page errors on bird.html', () => assert.deepEqual(page.errors, []));
  const d = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const C3 = counters(); const p3 = await newPage(d, C3, { expected: true });
  await p3.goto(base + `/bird.html?name=${encodeURIComponent('White-throated Sparrow')}&at=${AT}`); await p3.waitForSelector('#pic.has-photo'); await settle(C3);
  await p3.screenshot({ path: join(OUT, 'bird-1100.png'), fullPage: true });
  assert.deepEqual(p3.errors, []);
  await d.close();
  await ctx.close();
}

// ======================================================================= marks.html
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const C = counters();
  const page = await newPage(ctx, C, { expected: true });
  await page.goto(base + '/marks.html'); await page.waitForSelector('.mark'); await settle(C);
  await step('marks.html: six sections, five credited photos and the wing diagram, one takeaway each, the caveat', async () => {
    assert.equal((await page.$$('.mark')).length, 6);
    assert.equal((await page.$$('.mark .take')).length, 6);
    assert.equal((await page.$$('.mark .pic.has-photo img')).length, 5);
    assert.equal((await page.$$('.mark .pic.has-photo .credit a')).length, 5);
    assert.ok(await page.$('#wing svg'), 'the wing diagram is inline SVG');
    assert.match(await page.textContent('#wing svg'), /Primaries.*Secondaries.*Coverts/s);
    const words = await page.$$eval('.mark .body > p:not(.n):not(.take)', ps => ps.map(p => p.textContent.trim().split(/\s+/).length));
    assert.ok(words.every(n => n >= 80 && n <= 120), 'each section is 80–120 words: ' + words);
    assert.match(await page.textContent('.caveat'), /not yet checked by an expert birder/);
    await noBroken(page);
    await page.screenshot({ path: join(OUT, 'marks-390.png'), fullPage: true });
  });
  await step('no page errors on marks.html', () => assert.deepEqual(page.errors, []));
  const d = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const C3 = counters(); const p3 = await newPage(d, C3, { expected: true });
  await p3.goto(base + '/marks.html'); await p3.waitForSelector('.mark .pic.has-photo'); await settle(C3);
  await p3.screenshot({ path: join(OUT, 'marks-1100.png'), fullPage: true });
  assert.deepEqual(p3.errors, []);
  await d.close();
  await ctx.close();
}

// ======================================================================= more.html lists the two pages; every page loads without errors
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const C = counters();
  await step('more.html lists compare and marks under Learn; bird.html is not listed', async () => {
    const page = await newPage(ctx, C);
    await page.goto(base + '/more.html'); await page.waitForSelector('#hub .card');
    const learn = await page.$eval('#hub .card[data-group="learn"]', e => e.textContent);
    assert.match(learn, /Which sparrow is that\?/); assert.match(learn, /Why the bird doesn't match the book/);
    assert.equal(await page.$('#hub a[href="bird.html"]'), null);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await step('every .html page loads without a pageerror', async () => {
    const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html'));
    const bad = [];
    for (const f of pages) {
      const page = await newPage(ctx, C);
      try { await page.goto(base + '/' + f, { waitUntil: 'load' }); await sleep(500); } catch (e) { bad.push(f + ': ' + e.message); }
      if (page.errors.length) bad.push(f + ': ' + page.errors.join(' | '));
      await page.close();
    }
    assert.deepEqual(bad, []);
    console.log('     ' + pages.length + ' pages loaded');
  });
  await ctx.close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
console.log('screenshots in ' + OUT);
process.exit(failures ? 1 : 0);
