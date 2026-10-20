// Headless checks for the bird stickers: "Make a sticker" on lifelist.html (js/lifelist.js + js/stickers.js) and the
// printable sheet on stickers.html. Every outside host is stubbed: Wikipedia summaries and the Commons API answer from
// fixtures for six species, upload.wikimedia.org serves a solid-blue PNG, the Supabase CDN serves nothing (offline mode).
// A solid-amber PNG stands in for the person's own photo (American Robin) and drawing (Northern Cardinal, kind 'art').
// Run from the repo root (Playwright and sharp from /opt/npm-tools on the build box, or `npm i playwright sharp` anywhere):
//   PLAYWRIGHT_DIR=/opt/npm-tools/node_modules/playwright SHARP_DIR=/opt/npm-tools/node_modules/sharp DAYBIRD_SHOTS=/tmp node tests/stickers.ui.mjs
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
require(join(ROOT, 'js/brief.js')); require(join(ROOT, 'data/traits.js')); require(join(ROOT, 'js/lifelist.js')); require(join(ROOT, 'js/stickers.js'));
const TRAITS = globalThis.DAYBIRD_TRAITS, LL = globalThis.DAYBIRD_LIFELIST, ST = globalThis.DAYBIRD_STICKERS;

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
const BLUE = [59, 111, 182], AMBER = [232, 131, 58], PAPER = [246, 243, 236], WHITE = [255, 255, 255];
const WIKI = ['Blue Jay', 'Black-capped Chickadee', 'American Robin', 'Northern Cardinal', 'Tufted Titmouse', 'Mourning Dove'];
const BLUE_PNG = await png(400, 300, BLUE);
const AMBER_DATA = 'data:image/png;base64,' + (await png(200, 200, AMBER)).toString('base64');
const fileOf = (n) => n.replace(/ /g, '_') + '_fixture.jpg';
const summaryFor = (n) => ({
  type: 'standard', titles: { canonical: n.replace(/ /g, '_'), normalized: n },
  thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${fileOf(n)}/320px-${fileOf(n)}`, width: 320, height: 240 },
  originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${fileOf(n)}`, width: 3000, height: 2250 },
  content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${n.replace(/ /g, '_')}` } },
});
const SUMMARIES = { 'Blue_Jay': summaryFor('Blue Jay'), 'Black-capped_chickadee': summaryFor('Black-capped Chickadee'), 'American_Robin': summaryFor('American Robin'),
  'Northern_Cardinal': summaryFor('Northern Cardinal'), 'Tufted_Titmouse': summaryFor('Tufted Titmouse'), 'Mourning_Dove': summaryFor('Mourning Dove') };
const ARTISTS = { 'Blue Jay': ['<a href="//commons.wikimedia.org/wiki/User:Rhododendrites">Rhododendrites</a>', 'CC BY-SA 4.0'], 'Black-capped Chickadee': ['<span class="fn">Mdf</span>', 'CC BY-SA 3.0'],
  'American Robin': ['Dakota L.', 'CC BY-SA 4.0'], 'Northern Cardinal': ['Rhododendrites', 'CC BY-SA 4.0'], 'Tufted Titmouse': ['Cephas', 'CC BY-SA 3.0'], 'Mourning Dove': ['Mdf', 'CC BY-SA 3.0'] };

// ---- the life list: four fixture species plus 26 common birds, every one dated; the titmouse and the dove stay unseen
const SEEN_FIX = ['Blue Jay', 'Black-capped Chickadee', 'American Robin', 'Northern Cardinal'];
const NAMES = [...SEEN_FIX, ...TRAITS.map(t => t[0]).filter(n => !WIKI.includes(n)).slice(0, 26)];
assert.equal(NAMES.length, 30);
const FIRSTS = Object.fromEntries(NAMES.map((n, i) => [n, { first: `${i < 4 ? 2026 : 2020 + (i % 6)}-${String(1 + (i * 5) % 12).padStart(2, '0')}-${String(1 + (i * 7) % 28).padStart(2, '0')}`, loc: ['Mink Brook', 'Boston Lot Lake', 'Wilder Dam', 'Storrs Pond'][i % 4] }]));
const LIFE = { importedAt: '2026-10-01T12:00:00Z', checklists: 40, observations: 500, total: 30, thisYear: 4, yearList: 20, firstDate: '2020-01-08', lastDate: '2026-10-01',
  recentLifers: SEEN_FIX.map(n => ({ name: n, first: FIRSTS[n].first, loc: FIRSTS[n].loc, sightings: 1 })), mostSeen: [], topPlaces: [], byMonth: Array(12).fill(1), allSpecies: [...NAMES].sort(), months: {}, firsts: FIRSTS };
const OWN = { 'American Robin': { data: AMBER_DATA, kind: 'photo', caption: 'Backyard, first light' }, 'Northern Cardinal': { data: AMBER_DATA, kind: 'art', caption: 'Pencil' } };
const byDate = (names) => [...names].sort((a, b) => FIRSTS[b].first.localeCompare(FIRSTS[a].first) || a.localeCompare(b));

// ---- browser helpers
const browser = await chromium.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function stubAll(page) {
  await page.route(/cdn\.jsdelivr\.net/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* no sdk: offline mode */' }));
  await page.route(/supabase\.co|api\.ebird\.org|open-meteo\.com|router\.project-osrm\.org|birdcast/, r => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().url().includes('ebird') ? '[]' : '{}' }));
  await page.route(/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, async r => {
    const title = decodeURIComponent(r.request().url().split('/summary/')[1]);
    const s = SUMMARIES[title];
    if (s) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(s) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found', title: 'Not found.' }) });
  });
  await page.route(/commons\.wikimedia\.org\/w\/api\.php/, async r => {
    const u = new URL(r.request().url()); const file = (u.searchParams.get('titles') || '').replace(/^File:/, '');
    const name = WIKI.find(n => fileOf(n) === file);
    assert.ok(name, 'commons asked about a file we did not hand out: ' + file);
    const [artist, lic] = ARTISTS[name];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: { pages: { 123: { title: 'File:' + file, imageinfo: [{ extmetadata: { Artist: { value: artist }, LicenseShortName: { value: lic } } }] } } } }) });
  });
  await page.route(/upload\.wikimedia\.org/, r => {
    const file = decodeURIComponent(r.request().url().split('/').pop()).replace(/^\d+px-/, '');
    return WIKI.find(n => fileOf(n) === file) ? r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: BLUE_PNG }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/\/data\/brief\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ generated: '2026-10-19T10:00:00Z', word: 'GO', recent: ['Mourning Dove', 'Blue Jay'] }) }));
}
// share: 'stub' records every navigator.share call in window.__shared; 'abort' throws AbortError; undefined leaves the browser as it is (no share → download)
async function newPage(ctx, { life = LIFE, own = OWN, share } = {}) {
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.errors = errors;
  await stubAll(page);
  await page.addInitScript(({ life, own, share }) => {
    if (life) localStorage.setItem('daybird:life', JSON.stringify(life)); else localStorage.removeItem('daybird:life');
    if (own) localStorage.setItem('daybird:birdImages', JSON.stringify(own)); else localStorage.removeItem('daybird:birdImages');
    if (share) {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared.push({ title: d.title, text: d.text, files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })) }); if (share === 'abort') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } };
    }
  }, { life, own, share: share || '' });
  return page;
}
const openSheet = async (page, name, wall = '#wall') => { await page.evaluate(() => { const s = document.getElementById('sheet'); if (s && s.open) s.close(); }); await page.click(`${wall} .tile[data-name="${name}"]`); await page.waitForSelector('dialog.sheet[open]'); };
const closeSheet = async (page) => { await page.click('dialog.sheet #closeSheet'); await page.waitForFunction(() => !document.getElementById('sheet').open); };
const waitMsg = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('dialog.sheet #shareMsg').textContent), re.source);
const lastSpec = (page) => page.evaluate(() => DAYBIRD_STICKERS.lastSpec);
// pixel helpers on a PNG buffer
async function pixels(buf) {
  const img = sharp(buf).ensureAlpha(); const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
  return { w: meta.width, h: meta.height, px, info, data };
}
const near = (a, b, t = 8) => b.every((v, i) => Math.abs(a[i] - v) <= t);
async function checkSticker(buf, { centre, credit, spec }) {
  const P = await pixels(buf);
  assert.equal(P.w, 1024); assert.equal(P.h, 1024);
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) assert.equal(P.px(x, y)[3], 0, `corner ${x},${y} not transparent: ${P.px(x, y)}`);
  assert.ok(near(P.px(512, 512), centre) && P.px(512, 512)[3] === 255, `centre pixel ${P.px(512, 512)} is not ${centre}`);
  // the white die-cut border, 26 px, at the top of the circle; above it only a trace of shadow, if that
  assert.ok(near(P.px(512, spec.circle.cy - spec.circle.r - 13), WHITE) && P.px(512, spec.circle.cy - spec.circle.r - 13)[3] === 255, 'border at the top is white');
  assert.ok(P.px(512, 8)[3] < 40, 'nothing above the border but a trace of shadow: alpha ' + P.px(512, 8)[3]);
  assert.ok(P.px(512, spec.circle.cy - spec.circle.r + 20)[3] === 255 && near(P.px(512, spec.circle.cy - spec.circle.r + 20), centre), 'the picture starts inside the border');
  // the tab: mostly white (the mark, the name and a credit line sit on it)
  const t = spec.tab; let white = 0, n = 0;
  for (let y = t.y + 4; y < t.y + t.h - 4; y += 2) for (let x = t.x + 4; x < t.x + t.w - 4; x += 2) { n++; const p = P.px(x, y); if (p[3] === 255 && p[0] >= 250 && p[1] >= 250 && p[2] >= 250) white++; }
  assert.ok(white / n > 0.7, `tab is ${Math.round(100 * white / n)}% white`);
  assert.ok(white / n < 0.995, 'something is written on the tab');
  if (credit) assert.match(spec.credit || '', credit); else assert.equal(spec.credit, null);
  return P;
}
let failures = 0;
async function step(name, fn) { try { await fn(); console.log('ok   ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); } }

// ======================================================================= node-side: the pure helpers
await step('pick: own pictures first, then newest first; fillers alternate; file names by slug', async () => {
  const entries = LL.entries(LIFE);
  const picks = ST.pick(entries, OWN, 12).map(e => e.name);
  assert.deepEqual(picks.slice(0, 2), byDate(['American Robin', 'Northern Cardinal']));
  assert.deepEqual(picks.slice(2), byDate(NAMES.filter(n => !OWN[n])).slice(0, 10));
  assert.equal(ST.pick(entries, {}, 5).length, 5);
  assert.deepEqual(ST.pick([], OWN), []);
  assert.deepEqual(ST.fillers(3).map(f => f.kind), ['mascot', 'wordmark', 'mascot']);
  assert.deepEqual(ST.fillers(0), []);
  assert.equal(ST.fileName('Black-capped Chickadee'), 'daybird-sticker-black-capped-chickadee.png');
  assert.equal(ST.fileName("Wilson's Snipe"), 'daybird-sticker-wilson-s-snipe.png');
  assert.equal(ST.fileName(''), 'daybird-sticker-bird.png');
  assert.equal(ST.SIZE, 1024); assert.equal(ST.BORDER, 26); assert.equal(ST.R_IMG * 2, 860);
});

// ======================================================================= phone: Make a sticker in the sheet
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await newPage(ctx);
  await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile');
  let wikiSpec = null, ownSpec = null;

  await step('the sheet of a bird on the list has Make a sticker next to Share, and the three-step note', async () => {
    await openSheet(page, 'Blue Jay');
    await page.waitForFunction(() => /Photo: Rhododendrites/.test(document.querySelector('dialog.sheet .credit').textContent));
    const acts = await page.$$eval('dialog.sheet .acts > *', els => els.map(e => e.textContent.trim()));
    assert.deepEqual(acts.slice(0, 2), ['Share', 'Make a sticker']);
    const note = await page.textContent('dialog.sheet .stickerNote');
    assert.match(note, /Save it to Photos/); assert.match(note, /Messages tap \+, Stickers, \+/); assert.match(note, /Add Sticker/); assert.match(note, /On Android, save it and send it as an image\./);
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Use my photo', 'the own-photo flow is still there');
  });
  await step('Wikimedia photo: a 1024 PNG named by slug, transparent corners, the photo in the centre, a white tab with the credit', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-sticker-blue-jay.png');
    const buf = await readFile(await dl.path());
    wikiSpec = await lastSpec(page);
    assert.equal(wikiSpec.kind, 'photo'); assert.equal(wikiSpec.photo, true); assert.deepEqual(wikiSpec.nameLines, ['Blue Jay']);
    await checkSticker(buf, { centre: BLUE, credit: /^Photo: Rhododendrites · CC BY-SA 4\.0$/, spec: wikiSpec });
    assert.ok(wikiSpec.creditSize >= 22 && wikiSpec.creditSize <= 26);
    await waitMsg(page, /^Saved daybird-sticker-blue-jay\.png\./);
    assert.doesNotMatch(await page.textContent('dialog.sheet #shareMsg'), /name on paper/);
    await writeFile(join(OUT, 'sticker-blue-jay.png'), buf);
    await closeSheet(page);
  });
  await step('own photo: amber in the centre, no credit, a shorter tab', async () => {
    await openSheet(page, 'American Robin');
    assert.equal(await page.textContent('dialog.sheet .credit'), 'Your photo · Backyard, first light');
    assert.equal(await page.textContent('dialog.sheet #ownPick'), 'Replace'); assert.ok(await page.$('dialog.sheet #ownRemove'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-sticker-american-robin.png');
    ownSpec = await lastSpec(page);
    await checkSticker(await readFile(await dl.path()), { centre: AMBER, credit: null, spec: ownSpec });
    assert.ok(ownSpec.tab.h < wikiSpec.tab.h, `own tab ${ownSpec.tab.h} should be shorter than the credited one ${wikiSpec.tab.h}`);
    assert.ok(wikiSpec.tab.h - ownSpec.tab.h >= wikiSpec.creditSize, 'the tab grew by at least the credit line');
    assert.equal(ownSpec.tab.h, 150, 'a one-line name without a credit sits at the minimum tab height');
    assert.equal(wikiSpec.tab.h, Math.round(30 + wikiSpec.nameSize * 1.08 + wikiSpec.creditSize * 1.2 + 12 + 30));
    await waitMsg(page, /^Saved daybird-sticker-american-robin\.png\./);
    await closeSheet(page);
  });
  await step('a drawing (kind art) makes a sticker just like a photo', async () => {
    await openSheet(page, 'Northern Cardinal');
    assert.equal(await page.textContent('dialog.sheet .credit'), 'Your drawing · Pencil');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-sticker-northern-cardinal.png');
    const spec = await lastSpec(page);
    await checkSticker(await readFile(await dl.path()), { centre: AMBER, credit: null, spec });
    assert.equal(spec.tab.h, ownSpec.tab.h);
    await closeSheet(page);
  });
  await step('a bird with no picture at all gets the name on paper, and says nothing about a lost photo', async () => {
    const plain = NAMES.find(n => !WIKI.includes(n));
    await openSheet(page, plain);
    await page.waitForFunction(() => /No photo found/.test(document.querySelector('dialog.sheet .credit').textContent));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), ST.fileName(plain));
    const spec = await lastSpec(page);
    assert.equal(spec.kind, 'text'); assert.equal(spec.label, 'daybird'); assert.equal(spec.name, plain);
    const P = await checkSticker(await readFile(await dl.path()), { centre: PAPER, credit: null, spec });
    assert.ok(near(P.px(512, spec.circle.cy - spec.circle.r + 34), AMBER, 12), 'the thin amber ring, 34 px in: ' + P.px(512, spec.circle.cy - spec.circle.r + 34));
    await waitMsg(page, /^Saved /);
    assert.doesNotMatch(await page.textContent('dialog.sheet #shareMsg'), /could not be copied/);
    await closeSheet(page);
  });
  await step('a tainted canvas (toBlob throws) falls back to the name on paper and says so', async () => {
    await page.evaluate(() => { const orig = HTMLCanvasElement.prototype.toBlob; let once = true; HTMLCanvasElement.prototype.toBlob = function (...a) { if (once) { once = false; const e = new Error('Tainted canvases may not be exported.'); e.name = 'SecurityError'; throw e; } return orig.apply(this, a); }; });
    await openSheet(page, 'Blue Jay');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog.sheet #stickerBird')]);
    assert.equal(dl.suggestedFilename(), 'daybird-sticker-blue-jay.png');
    const spec = await lastSpec(page);
    assert.equal(spec.kind, 'text'); assert.equal(spec.photo, false); assert.equal(spec.credit, null);
    await checkSticker(await readFile(await dl.path()), { centre: PAPER, credit: null, spec });
    await waitMsg(page, /The photo could not be copied into it, so the sticker is the name on paper\./);
    await closeSheet(page);
  });
  await step('a not-yet bird has no sticker button', async () => {
    await openSheet(page, 'Tufted Titmouse', '#unseen');
    assert.equal(await page.$('dialog.sheet #stickerBird'), null); assert.equal(await page.$('dialog.sheet .stickerNote'), null);
    assert.equal(await page.$('dialog.sheet #shareBird'), null);
    await closeSheet(page);
  });
  await step('phone screenshot of the sheet with the sticker button', async () => {
    await openSheet(page, 'Blue Jay'); await sleep(300);
    await page.screenshot({ path: join(OUT, 'stickers-sheet-390.png') });
    await closeSheet(page);
  });
  assert.deepEqual(page.errors, [], 'page errors: ' + page.errors.join(' | '));
  await ctx.close();
}

// ======================================================================= share sheet: one PNG File, and a cancelled share
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await step('with navigator.share, the button hands over exactly one PNG File named by slug', async () => {
    const page = await newPage(ctx, { share: 'stub' });
    await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile');
    await openSheet(page, 'American Robin');
    await page.click('dialog.sheet #stickerBird');
    await waitMsg(page, /^Shared\. Save Image puts it in Photos; then add it from Messages\.$/);
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.length, 1); assert.equal(shared[0].files.length, 1);
    assert.equal(shared[0].files[0].name, 'daybird-sticker-american-robin.png'); assert.equal(shared[0].files[0].type, 'image/png'); assert.ok(shared[0].files[0].size > 5000);
    assert.match(shared[0].title, /American Robin sticker/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await step('a cancelled share says nothing and downloads nothing', async () => {
    const page = await newPage(ctx, { share: 'abort' });
    let downloads = 0; page.on('download', () => downloads++);
    await page.goto(base + '/lifelist.html'); await page.waitForSelector('#wall .tile');
    await openSheet(page, 'American Robin');
    await page.click('dialog.sheet #stickerBird');
    await page.waitForFunction(() => !document.querySelector('dialog.sheet #stickerBird').disabled);
    assert.equal(await page.textContent('dialog.sheet #shareMsg'), ''); assert.equal(downloads, 0);
    assert.equal((await page.evaluate(() => window.__shared)).length, 1);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await ctx.close();
}

// ======================================================================= the sheet: stickers.html
const slotInfo = (page) => page.$$eval('#sheet .slot', els => els.map(e => ({ kind: e.dataset.kind, name: e.dataset.name, done: e.classList.contains('done'), photo: e.dataset.photo, img: !!e.querySelector('img') })));
const allDone = (page) => page.waitForFunction(() => { const s = [...document.querySelectorAll('#sheet .slot')]; return s.length === 12 && s.every(e => e.classList.contains('done') && e.querySelector('img') && e.querySelector('img').complete && e.querySelector('img').naturalWidth === 1024); }, null, { timeout: 30000 });
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await newPage(ctx, { share: 'stub' });
  await page.goto(base + '/stickers.html'); await allDone(page);

  await step('twelve stickers: own pictures first, then the newest birds; Wikimedia ones carry the photo, the rest the name on paper', async () => {
    const slots = await slotInfo(page);
    assert.equal(slots.length, 12);
    assert.deepEqual(slots.map(s => s.kind), ['own', 'own', ...Array(10).fill('bird')]);
    assert.deepEqual(slots.slice(0, 2).map(s => s.name), byDate(['American Robin', 'Northern Cardinal']));
    assert.deepEqual(slots.slice(2).map(s => s.name), byDate(NAMES.filter(n => !OWN[n])).slice(0, 10));
    for (const s of slots) assert.equal(s.photo, s.kind === 'own' || WIKI.includes(s.name) ? '1' : '0', `${s.name} photo flag`);
    assert.ok(slots.some(s => s.photo === '1' && s.kind === 'bird'), 'at least one Wikimedia photo on the sheet');
    assert.ok(slots.some(s => s.photo === '0'), 'at least one name on paper');
    assert.equal(await page.$('#empty:not(.hidden)'), null);
    assert.match(await page.textContent('#sub'), /12 of your birds, 2 with your own picture\./);
    assert.equal(await page.textContent('#status'), '');
    assert.equal(await page.$eval('#sheet', e => e.getBoundingClientRect().width), 720, 'the sheet is 7.5in wide at desktop width');
    assert.equal(await page.$$eval('#sheet .slot img', els => els.filter(i => getComputedStyle(i).width === '240px' && getComputedStyle(i).height === '240px').length), 12, 'every sticker is 2.5 inches');
    const css = await page.$eval('style', s => s.textContent);
    assert.match(css, /@page \{ size: letter; margin: \.5in \}/); assert.match(css, /@media print/);
    assert.ok(await page.$('#print'));
    const html = await readFile(join(ROOT, 'stickers.html'), 'utf8');
    assert.doesNotMatch(html, /art\/birds/, 'no species silhouettes'); assert.doesNotMatch(html, /DAYBIRD_ART\b/);
  });
  await step('the own-photo sticker on the sheet is the same drawing as the single one', async () => {
    const b64 = await page.evaluate(async () => { const i = document.querySelector('#sheet .slot[data-kind="own"] img'); const b = await (await fetch(i.src)).blob(); const ab = await b.arrayBuffer(); let s = ''; new Uint8Array(ab).forEach(x => s += String.fromCharCode(x)); return btoa(s); });
    const P = await pixels(Buffer.from(b64, 'base64'));
    assert.equal(P.w, 1024); assert.ok(near(P.px(512, 512), AMBER)); assert.equal(P.px(0, 0)[3], 0);
  });
  await step('Save all hands twelve PNG files to the share sheet, no two with the same name', async () => {
    await page.click('#saveAll');
    await page.waitForFunction(() => /Shared 12 stickers/.test(document.getElementById('status').textContent));
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared.length, 1); assert.equal(shared[0].files.length, 12);
    const names = shared[0].files.map(f => f.name);
    assert.equal(new Set(names).size, 12); assert.ok(names.every(n => /^daybird-sticker-[a-z0-9-]+\.png$/.test(n)));
    assert.ok(names.includes('daybird-sticker-american-robin.png') && names.includes('daybird-sticker-blue-jay.png'));
    assert.ok(shared[0].files.every(f => f.type === 'image/png' && f.size > 3000));
  });
  await step('desktop screenshot', async () => {
    await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
    await page.screenshot({ path: join(OUT, 'stickers-1100.png'), fullPage: false });
  });
  assert.deepEqual(page.errors, [], 'page errors: ' + page.errors.join(' | '));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await step('phone: the sheet scales to the screen, no horizontal scroll; Save all without a share sheet downloads twelve files', async () => {
    const page = await newPage(ctx);
    await page.goto(base + '/stickers.html'); await allDone(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const scale = await page.$eval('#sheet', e => new DOMMatrix(getComputedStyle(e).transform).a);
    assert.ok(scale < 0.6 && scale > 0.4, `scale ${scale}`);
    const names = [];
    page.on('download', d => names.push(d.suggestedFilename()));
    await page.click('#saveAll');
    await page.waitForFunction(() => /Saved 12 PNGs/.test(document.getElementById('status').textContent), null, { timeout: 20000 });
    await sleep(300);
    assert.equal(names.length, 12, `${names.length} downloads: ${names.join(', ')}`);
    assert.equal(new Set(names).size, 12);
    await page.evaluate(() => scrollTo(0, 0)); await sleep(200);
    await page.screenshot({ path: join(OUT, 'stickers-390.png'), fullPage: false });
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await step('a short list: the birds, then the titmouse and the wordmark alternating', async () => {
    const few = NAMES.slice(0, 5);
    const page = await newPage(ctx, { life: { ...LIFE, allSpecies: [...few].sort(), total: 5, firsts: Object.fromEntries(few.map(n => [n, FIRSTS[n]])) } });
    await page.goto(base + '/stickers.html'); await allDone(page);
    const slots = await slotInfo(page);
    assert.deepEqual(slots.slice(0, 5).map(s => s.kind), ['own', 'own', 'bird', 'bird', 'bird']);
    assert.deepEqual(slots.slice(5).map(s => s.kind), ['mascot', 'wordmark', 'mascot', 'wordmark', 'mascot', 'wordmark', 'mascot']);
    assert.match(await page.textContent('#sub'), /5 of your birds, 2 with your own picture, and the titmouse in the other 7\./);
    assert.equal(await page.$('#empty:not(.hidden)'), null);
    // the mascot sticker: paper in the circle, ink in the middle (the titmouse), transparent corners
    const b64 = await page.evaluate(async () => { const i = document.querySelector('#sheet .slot[data-kind="mascot"] img'); const b = await (await fetch(i.src)).blob(); const ab = await b.arrayBuffer(); let s = ''; new Uint8Array(ab).forEach(x => s += String.fromCharCode(x)); return btoa(s); });
    const P = await pixels(Buffer.from(b64, 'base64'));
    assert.equal(P.px(0, 0)[3], 0); assert.ok(near(P.px(140, 300), PAPER), 'paper near the ring: ' + P.px(140, 300));
    let ink = 0; for (let y = 200; y < 700; y += 4) for (let x = 300; x < 720; x += 4) if (near(P.px(x, y), [31, 42, 55], 20)) ink++;
    assert.ok(ink > 1500, `titmouse ink pixels ${ink}`);
    await writeFile(join(OUT, 'sticker-mascot.png'), Buffer.from(b64, 'base64'));
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await step('no life list: mascot and wordmark fill the sheet, with the note to add birds', async () => {
    const page = await newPage(ctx, { life: null, own: null });
    await page.goto(base + '/stickers.html'); await allDone(page);
    const slots = await slotInfo(page);
    assert.deepEqual(slots.map(s => s.kind), Array.from({ length: 12 }, (_, i) => (i % 2 ? 'wordmark' : 'mascot')));
    assert.ok(await page.$('#empty:not(.hidden)'));
    assert.match(await page.textContent('#empty h3'), /Add birds to Your birds to fill this sheet/);
    assert.equal(await page.$eval('#empty a.btn', a => a.getAttribute('href')), 'lifelist.html');
    assert.equal(await page.textContent('#sub'), '');
    await page.evaluate(() => scrollTo(0, 0)); await sleep(200);
    await page.screenshot({ path: join(OUT, 'stickers-empty-390.png'), fullPage: false });
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  await ctx.close();
}

// ======================================================================= the hub entry, the script order, the README
await step('pages.js, lifelist.html script order and the README', async () => {
  const pages = await readFile(join(ROOT, 'data/pages.js'), 'utf8');
  assert.match(pages, /\{ href: 'stickers\.html', title: 'Your stickers', blurb: 'Your birds as die-cut stickers: print a sheet, or save one to Photos and use it in iMessage', group: 'labs' \}/);
  const ll = await readFile(join(ROOT, 'lifelist.html'), 'utf8');
  const tag = (f) => `<script src="${f}"></script>`;
  assert.ok(ll.indexOf(tag('js/stickers.js')) < ll.indexOf(tag('js/lifelist.js')) && ll.indexOf(tag('js/stickers.js')) > ll.indexOf(tag('js/footer.js')), 'stickers.js loads after footer.js and before lifelist.js');
  const st = await readFile(join(ROOT, 'stickers.html'), 'utf8');
  assert.ok(st.indexOf(tag('js/footer.js')) < st.indexOf(tag('js/lifelist.js')) && st.indexOf(tag('js/lifelist.js')) < st.indexOf(tag('js/stickers.js')), 'stickers.html: footer, lifelist, stickers');
  assert.match(st, /<nav class="tabs">\s*<a href="index\.html">Brief<\/a>\s*<a href="id\.html">ID<\/a>\s*<a href="feed\.html">Feed<\/a>\s*<a href="profile\.html">Profile<\/a>\s*<a href="more\.html">More<\/a>/);
  const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /\n## Stickers/); assert.match(readme, /Add Sticker/); assert.match(readme, /taint/i); assert.match(readme, /Photo: <artist> · <license>/);
  assert.doesNotMatch(readme, /each a silhouette on paper with a thin amber ring and a small mark-plus-wordmark lockup/);
});

// ======================================================================= every page loads without a page error
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
  for (const f of pages) {
    await step('loads ' + f, async () => {
      const page = await newPage(ctx);
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
