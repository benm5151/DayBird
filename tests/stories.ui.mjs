// Headless checks for stories.html (js/stories.js + js/canvas-kit.js) with every outside host stubbed.
// Run from the repo root (Playwright and sharp from /opt/npm-tools on the build box, or `npm i playwright sharp` anywhere):
//   PLAYWRIGHT_DIR=/opt/npm-tools/node_modules/playwright SHARP_DIR=/opt/npm-tools/node_modules/sharp/dist/index.mjs OUT=/tmp/daybird-stories node tests/stories.ui.mjs
// Without sharp the PNG size and pixel checks are skipped (the rest still runs). Fails on any pageerror on any page.
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const { chromium } = await import(join(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright', 'index.mjs'));
let sharp = null; try { sharp = (await import(process.env.SHARP_DIR || '/opt/npm-tools/node_modules/sharp/dist/index.mjs')).default; } catch (e) { console.log('sharp not found: skipping PNG pixel checks (' + e.message + ')'); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || join(tmpdir(), 'daybird-stories');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png' };

// ---- dates relative to the run (local calendar, same machine as the browser)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const TODAY = daysAgo(0), YESTERDAY = daysAgo(1), THREE = daysAgo(3), OLD = daysAgo(20);

// ---- eBird fixtures: two checklists of mine (13 and 45 species), one of someone else, one of mine too old
const require = (await import('node:module')).createRequire(import.meta.url);
require(join(ROOT, 'data/traits.js'));
const TRAITS = globalThis.DAYBIRD_TRAITS.map(t => t[0]);
const code = (n) => n.toLowerCase().replace(/[^a-z]/g, '') + 'x';
const THIRTEEN = ['Canada Goose', 'Mallard', 'Rock Pigeon', 'Mourning Dove', 'Blue Jay', 'American Crow', 'Black-capped Chickadee', 'Tufted Titmouse', 'American Robin', 'European Starling', 'Chipping Sparrow', 'Savannah Sparrow', 'Northern Cardinal'];
const FORTYFIVE = TRAITS.slice(0, 45);
assert.equal(THIRTEEN.length, 13); assert.equal(FORTYFIVE.length, 45);
const NAMES = Object.fromEntries([...THIRTEEN, ...FORTYFIVE].map(n => [code(n), n]));
const LONG_PLACE = 'Deweys Mill Pond - Hartford (56 acres)';
const row = (subId, name, place, date, n, time = '07:12') => ({ locId: 'L' + subId, subId, userDisplayName: name, numSpecies: n, obsDt: new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, ''), obsTime: time, isoObsDate: `${date} ${time}`, loc: { locId: 'L' + subId, name: place } });
const LISTS = [
  row('S45', 'Benjamin Morris', 'Campbell Flats Road', THREE, 45, '06:40'),
  row('S13', 'Benjamin Morris', LONG_PLACE, YESTERDAY, 13),
  row('S99', 'Someone Else', 'Mink Brook', YESTERDAY, 9),
  row('S77', 'Benjamin Morris', 'Boston Lot Lake', OLD, 21),
];
const view = (subId, names, date, hrs) => ({ subId, obsDt: `${date} 07:12`, durationHrs: hrs, numObservers: 1, locId: 'L' + subId,
  obs: [...names.map(n => ({ speciesCode: code(n), howManyStr: '1' })), { speciesCode: 'duckspx', howManyStr: '3' }] });
const VIEWS = { S13: view('S13', THIRTEEN, YESTERDAY, 1.0833), S45: view('S45', FORTYFIVE, THREE, 2.5) };
let ebirdCalls = 0;

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/data/brief.json')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ generated: new Date().toISOString(), date: TODAY, word: 'GO', grade: 'go', score: 85, whyLine: 'Calm and dry at sunrise.' })); }
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const errors = [];
async function page(width = 1100, init = {}) {
  const pg = await browser.newPage({ viewport: { width, height: 1400 }, acceptDownloads: true });
  pg.on('pageerror', e => errors.push(`${pg.url()}: ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|supabase|404|status of 500/.test(m.text())) errors.push(`${pg.url()}: ${m.text()}`); });
  await pg.addInitScript((init) => {
    try { // each newPage() is its own context, so storage starts empty; seed it once per tab (reloads keep what the page wrote)
      if (sessionStorage.getItem('daybird:test-seeded')) return; sessionStorage.setItem('daybird:test-seeded', '1');
      if (init.settings) localStorage.setItem('daybird:settings', JSON.stringify(init.settings));
      if (init.life) localStorage.setItem('daybird:life', JSON.stringify(init.life));
      for (const [k, v] of Object.entries(init.extra || {})) localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  }, init);
  await pg.route(/supabase\.co|jsdelivr|open-meteo\.com|ebird\.org|googleapis|gstatic/, async route => {
    const u = route.request().url();
    if (u.includes('jsdelivr')) return route.fulfill({ contentType: 'text/javascript', body: '' }); // no Supabase SDK → offline mode
    if (u.includes('api.ebird.org')) {
      ebirdCalls++;
      assert.equal(route.request().headers()['x-ebirdapitoken'], 'k-test', 'eBird calls carry the key');
      const m = u.match(/product\/lists\/([^?]+)/); if (m) return route.fulfill({ json: m[1] === 'US-NH' ? LISTS : [] });
      const v = u.match(/checklist\/view\/(\w+)/); if (v) return VIEWS[v[1]] ? route.fulfill({ json: VIEWS[v[1]] }) : route.fulfill({ status: 404, body: '' });
      if (u.includes('ref/taxonomy/ebird')) { const codes = new URL(u).searchParams.get('species').split(','); return route.fulfill({ json: codes.filter(c => NAMES[c]).map(c => ({ speciesCode: c, comName: NAMES[c], category: 'species' })).concat(codes.includes('duckspx') ? [{ speciesCode: 'duckspx', comName: 'duck sp.', category: 'spuh' }] : []) }); }
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return pg;
}
const SETTINGS = { ebirdKey: 'k-test', ebirdName: 'benjamin morris', ebirdRegions: 'US-NH, US-VT' };
// the shape DB.importLifeList writes (profile.html reads every field)
const LIFE = { total: 148, thisYear: 22, yearList: 96, checklists: 212, observations: 3400, firstDate: '2023-04-02', lastDate: THREE, mostSeen: [], topPlaces: [{ name: 'Mink Brook', n: 40 }], byMonth: Array(12).fill(2), allSpecies: [...new Set([...THIRTEEN, ...FORTYFIVE])].filter(n => n !== 'Savannah Sparrow').sort(),
  recentLifers: [{ name: 'Chipping Sparrow', first: THREE, loc: 'Campbell Flats Road' }, { name: 'Hermit Thrush', first: daysAgo(9), loc: 'Boston Lot Lake' }, { name: 'Pileated Woodpecker', first: daysAgo(30), loc: 'Mink Brook' }] };

// ---- PNG helpers
const near = (a, b, tol = 10) => Math.abs(a - b) <= tol;
async function pngOf(pg, i) { const url = await pg.evaluate((i) => document.querySelectorAll('#strip canvas')[i].toDataURL('image/png'), i); return Buffer.from(url.split(',')[1], 'base64'); }
// counts pixels close to ink (#1F2A37) and amber (#E8833A), optionally within an x range
async function scan(buf, xFrom = 0, xTo = 1080) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let ink = 0, amber = 0, paper = 0;
  for (let y = 0; y < info.height; y++) for (let x = xFrom; x < xTo; x++) {
    const i = (y * info.width + x) * info.channels, r = data[i], g = data[i + 1], b = data[i + 2];
    if (near(r, 0x1F) && near(g, 0x2A) && near(b, 0x37)) ink++;
    if (near(r, 0xE8) && near(g, 0x83) && near(b, 0x3A)) amber++;
    if (near(r, 0xF6) && near(g, 0xF3) && near(b, 0xEC)) paper++;
  }
  return { ink, amber, paper, width: info.width, height: info.height };
}
async function checkPng(buf, label, o = {}) {
  if (!sharp) return;
  const meta = await sharp(buf).metadata();
  assert.equal(meta.width, 1080, `${label} width`); assert.equal(meta.height, 1920, `${label} height`);
  const s = await scan(buf);
  assert.ok(s.ink > 2000, `${label} has ink pixels (${s.ink})`); assert.ok(s.amber > 200, `${label} has amber pixels (${s.amber})`);
  if (o.cleanMargins) { // nothing drawn into the outer 40px on either side (long names shrink instead of overflowing); 'paper' for the navy lifer slide
    const l = await scan(buf, 0, 40), r = await scan(buf, 1040, 1080), c = o.cleanMargins === 'paper' ? 'paper' : 'ink';
    assert.equal(l[c] + r[c], 0, `${label} keeps ${c} out of the side margins (${l[c]}/${r[c]})`);
  }
}
async function save(pg, i, name) { await writeFile(join(OUT, name), await pngOf(pg, i)); }
const kinds = (pg) => pg.$$eval('#strip canvas', cs => cs.map(c => c.dataset.kind));

// =====================================================================================
// 1. From my eBird: two checklists listed (not the other person's, not the 20-day-old one), newest first; picking one draws three slides
let pg = await page(1100, { settings: SETTINGS, life: LIFE });
await pg.goto(`${base}/stories.html`);
await pg.waitForSelector('#loadLists:not([disabled])');
assert.ok(await pg.isHidden('#ebirdGate'), 'gate hidden when key and name are set');
await pg.click('#loadLists');
await pg.waitForSelector('#lists button');
const rows = await pg.$$eval('#lists button', bs => bs.map(b => b.textContent));
assert.equal(rows.length, 2, 'two checklists of mine in the last 14 days');
assert.match(rows[0], /Deweys Mill Pond - Hartford \(56 acres\)/); assert.match(rows[0], /13 species/);
assert.match(rows[1], /Campbell Flats Road/); assert.match(rows[1], /45 species/);
assert.match(await pg.textContent('#listsMsg'), /2 checklists in the last 14 days/);
await pg.click('#lists button:first-child');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 3);
assert.deepEqual(await kinds(pg), ['cover', 'highlight', 'list']);
assert.match(await pg.textContent('#previewTitle'), /^13 species at Deweys Mill Pond/);
assert.match(await pg.textContent('#previewNote'), /Best bird: Savannah Sparrow, a lifer/, 'the one bird not on the life list is the highlight');
const names = await pg.$$eval('#strip .slide .meta', ms => ms.map(m => m.textContent));
assert.deepEqual(names, ['1 of 3', '2 of 3', '3 of 3']);
// layout: the long place name shrank to fit on two lines or fewer, every line inside the 900px column
const cover = await pg.evaluate(() => document.querySelector('#strip canvas')._layout);
assert.ok(cover.place.lines.length <= 2, 'place on at most two lines');
assert.ok(cover.place.widths.every(w => w <= 900), `place lines fit (${cover.place.widths.map(Math.round)})`);
assert.ok(cover.place.size >= 48 && cover.place.size <= 84);
assert.equal(cover.number.lines[0], '13');
const hl = await pg.evaluate(() => document.querySelectorAll('#strip canvas')[1]._layout);
assert.deepEqual(hl.name.lines.join(' '), 'Savannah Sparrow'); assert.ok(hl.name.widths.every(w => w <= 920));
const list = await pg.evaluate(() => document.querySelectorAll('#strip canvas')[2]._layout);
assert.equal(list.rows.length, 13, 'all 13 on one list slide (duck sp. dropped)'); assert.ok(list.rows.every(r => r.width <= list.colW + 0.5), 'every name fits its column');
assert.ok(list.rows.some(r => r.name === 'Savannah Sparrow'));
for (let i = 0; i < 3; i++) { const b = await pngOf(pg, i); await checkPng(b, `ebird slide ${i + 1}`, { cleanMargins: i === 0 }); await writeFile(join(OUT, `ebird-${i + 1}.png`), b); }
// the pick is remembered: reload draws it with no eBird call
const pick = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:storyPick')));
assert.equal(pick.row.subId, 'S13'); assert.equal(pick.outing.species.length, 13); assert.equal(pick.outing.minutes, 65);
const taxon = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:taxon')));
assert.equal(taxon[Object.keys(taxon)[0]].length > 0, true, 'taxonomy cache written');
const before = ebirdCalls;
await pg.reload();
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 3);
assert.equal(ebirdCalls, before, 'no eBird call on reload');
assert.match(await pg.textContent('#previewNote'), /Your last pick, Deweys Mill Pond/);
assert.ok(await pg.isVisible('#ebirdPane'), 'reopens on the eBird source');
// the 45-species checklist: four slides, the fourth says "…and 17 more"
await pg.click('#loadLists'); await pg.waitForSelector('#lists button');
await pg.click('#lists button:nth-child(2)');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 4);
assert.deepEqual(await kinds(pg), ['cover', 'highlight', 'list', 'list']);
const l4 = await pg.evaluate(() => [2, 3].map(i => document.querySelectorAll('#strip canvas')[i]._layout));
assert.equal(l4[0].rows.length, 28); assert.equal(l4[1].rows.length, 17); assert.equal(l4[1].title, '…and 17 more'); assert.equal(l4[0].title, '45 species');
assert.ok(l4[0].rows.concat(l4[1].rows).every(r => r.size >= 30 && r.width <= l4[0].colW + 0.5), 'names never shrink below 30px and never overflow');
assert.ok(new Set(l4[0].rows.map(r => r.size)).size === 1, 'one type size per list page');
await save(pg, 3, 'ebird-45-more.png');
// the cover of a 3-day-old outing is on paper, not the sky (only today or yesterday get the call's sky)
if (sharp) { const s = await scan(await pngOf(pg, 0)); assert.ok(s.amber < 20000, 'paper cover: amber is only the accent, not a sky'); }
await pg.screenshot({ path: join(OUT, 'stories-1100.png'), fullPage: true });
await pg.close();

// =====================================================================================
// 2. Type it in: 1 species and 45 species; "Use my last sit"; without an eBird key the page opens on the typed pane
pg = await page(390, { extra: { 'daybird:lastStory': { place: 'The porch', date: YESTERDAY, minutes: 20, species: ['Tufted Titmouse', 'Blue Jay'], best: 'Blue Jay' } } });
await pg.goto(`${base}/stories.html`);
await pg.waitForSelector('#typedPane:not(.hidden)');
assert.ok(await pg.isVisible('#ebirdGate') === false, 'gate lives in the hidden eBird pane');
await pg.click('#srcEbird'); assert.ok(await pg.isVisible('#ebirdGate'), 'no key: the gate shows'); assert.ok(await pg.isDisabled('#loadLists'));
await pg.click('#srcTyped');
assert.equal(await pg.inputValue('#fPlace'), 'The porch', 'last sit prefilled on open');
assert.equal(await pg.inputValue('#fBest'), 'Blue Jay');
await pg.fill('#fPlace', 'Mink Brook'); await pg.fill('#fDate', TODAY); await pg.fill('#fMinutes', '35');
await pg.fill('#fSpecies', 'Winter Wren\n'); await pg.dispatchEvent('#fSpecies', 'input');
assert.deepEqual(await pg.$$eval('#fBest option', os => os.map(o => o.value)), ['', 'Winter Wren']);
await pg.click('#makeTyped');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 3);
assert.deepEqual(await kinds(pg), ['cover', 'highlight', 'list']);
assert.match(await pg.textContent('#previewTitle'), /^1 species at Mink Brook/);
let lay = await pg.evaluate(() => [...document.querySelectorAll('#strip canvas')].map(c => c._layout));
assert.equal(lay[0].number.lines[0], '1'); assert.equal(lay[1].name.lines.join(' '), 'Winter Wren'); assert.equal(lay[2].rows.length, 1);
for (let i = 0; i < 3; i++) { const b = await pngOf(pg, i); await checkPng(b, `typed-1 slide ${i + 1}`, { cleanMargins: i === 0 }); await writeFile(join(OUT, `typed1-${i + 1}.png`), b); }
if (sharp) { const s = await scan(await pngOf(pg, 0)); assert.ok(s.amber > 200000, 'today: the cover is on the GO sky'); }
const last = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:lastStory')));
assert.deepEqual(last, { place: 'Mink Brook', date: TODAY, minutes: 35, species: ['Winter Wren'], best: '' });
// 45 typed, with a pick for the best bird and a duplicate, a spuh and a blank line to drop
await pg.fill('#fSpecies', FORTYFIVE.concat(['', 'duck sp.', 'Blue Jay', 'Mallard x American Black Duck (hybrid)']).join('\n')); await pg.dispatchEvent('#fSpecies', 'input');
await pg.selectOption('#fBest', 'Hermit Thrush');
await pg.click('#makeTyped');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 4);
lay = await pg.evaluate(() => [...document.querySelectorAll('#strip canvas')].map(c => c._layout));
assert.equal(lay[0].number.lines[0], '45'); assert.equal(lay[1].name.lines.join(' '), 'Hermit Thrush');
assert.equal(lay[2].rows.length, 28); assert.equal(lay[3].rows.length, 17); assert.equal(lay[3].title, '…and 17 more');
assert.match(await pg.textContent('#previewNote'), /Best bird: Hermit Thrush\./);
for (let i = 0; i < 4; i++) { const b = await pngOf(pg, i); await checkPng(b, `typed-45 slide ${i + 1}`); await writeFile(join(OUT, `typed45-${i + 1}.png`), b); }
// "Use my last sit" brings the 45 back after clearing the form
await pg.fill('#fSpecies', ''); await pg.fill('#fPlace', '');
await pg.click('#useLast');
assert.equal(await pg.inputValue('#fPlace'), 'Mink Brook'); assert.equal((await pg.inputValue('#fSpecies')).split('\n').length, 45); assert.equal(await pg.inputValue('#fBest'), 'Hermit Thrush');
await pg.screenshot({ path: join(OUT, 'stories-390.png'), fullPage: true });
await pg.close();

// =====================================================================================
// 3. Share all: no navigator.share → three downloads with dated names; with navigator.share → one call with three files
pg = await page(1100, { settings: SETTINGS, life: LIFE, extra: { 'daybird:storyPick': { row: { subId: 'S13', place: LONG_PLACE }, outing: { source: 'ebird', subId: 'S13', place: LONG_PLACE, date: YESTERDAY, time: '7:12 AM', minutes: 65, observers: 1, species: THIRTEEN, best: null } } } });
await pg.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); window.__dl = []; HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); }; });
await pg.goto(`${base}/stories.html`);
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 3);
await pg.click('#shareAll');
await pg.waitForFunction(() => window.__dl.length === 3);
assert.deepEqual(await pg.evaluate(() => window.__dl), [1, 2, 3].map(i => `daybird-story-${YESTERDAY}-${i}.png`));
assert.match(await pg.textContent('#shareMsg'), /No share sheet in this browser, so all 3 downloaded/);
await pg.click('#strip .slide:nth-child(2) button[data-dl]');
await pg.waitForFunction(() => window.__dl.length === 4);
assert.equal((await pg.evaluate(() => window.__dl))[3], `daybird-story-${YESTERDAY}-2.png`);
await pg.close();
pg = await page(1100, { settings: SETTINGS, life: LIFE, extra: { 'daybird:storyPick': { row: { subId: 'S13', place: LONG_PLACE }, outing: { source: 'ebird', place: LONG_PLACE, date: YESTERDAY, minutes: 65, species: THIRTEEN, best: null } } } });
await pg.addInitScript(() => {
  window.__shared = [];
  Object.defineProperty(navigator, 'canShare', { value: (d) => Array.isArray(d.files), configurable: true });
  Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared.push({ n: d.files.length, names: d.files.map(f => f.name), types: d.files.map(f => f.type), title: d.title, text: d.text }); }, configurable: true });
});
await pg.goto(`${base}/stories.html`);
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 3);
await pg.click('#shareAll');
await pg.waitForFunction(() => window.__shared.length === 1);
const shared = await pg.evaluate(() => window.__shared[0]);
assert.equal(shared.n, 3); assert.deepEqual(shared.types, ['image/png', 'image/png', 'image/png']); assert.deepEqual(shared.names, [1, 2, 3].map(i => `daybird-story-${YESTERDAY}-${i}.png`));
assert.match(shared.text, /^13 species at Deweys Mill Pond - Hartford \(56 acres\), best bird Savannah Sparrow\. day-bird\.com$/);
assert.equal(await pg.textContent('#shareMsg'), 'Shared.');
await pg.click('#strip .slide:nth-child(1) button[data-share]');
await pg.waitForFunction(() => window.__shared.length === 2);
assert.equal((await pg.evaluate(() => window.__shared[1])).n, 1);
// a real download through the browser for one slide
await pg.addInitScript(() => {});
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#strip .slide:nth-child(3) button[data-dl]')]);
assert.equal(dl.suggestedFilename(), `daybird-story-${YESTERDAY}-3.png`);
await pg.close();

// =====================================================================================
// 4. Lifer mode: a fake life list in localStorage; the newest lifer is preselected; Lifer #148; a typed bird not on the list is #149
pg = await page(390, { life: LIFE, extra: { 'daybird:storyMode': 'lifer' } });
await pg.goto(`${base}/stories.html`);
await pg.waitForSelector('#lifer:not(.hidden)');
assert.ok(await pg.isHidden('#outing')); assert.ok(await pg.isHidden('#preview'), 'no story yet in lifer mode');
assert.equal(await pg.inputValue('#lName'), 'Chipping Sparrow'); assert.equal(await pg.inputValue('#lDate'), THREE); assert.equal(await pg.inputValue('#lPlace'), 'Campbell Flats Road');
assert.match(await pg.textContent('#liferNote'), /Your life list has 148 species/);
await pg.click('#makeLifer');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 1);
assert.deepEqual(await kinds(pg), ['lifer']);
assert.match(await pg.textContent('#previewNote'), /Lifer #148 on your list/);
let lf = await pg.evaluate(() => document.querySelector('#strip canvas')._layout);
assert.equal(lf.number, 148); assert.equal(lf.total, 148); assert.equal(lf.name.lines.join(' '), 'Chipping Sparrow');
assert.equal(await pg.$eval('#strip .slide .meta', m => m.textContent), '1 of 1');
assert.equal(await pg.textContent('#shareAll'), 'Share');
let b = await pngOf(pg, 0); await checkPng(b, 'lifer slide', { cleanMargins: 'paper' }); await writeFile(join(OUT, 'lifer.png'), b);
// typed: a bird not on the list yet, with a long name
await pg.selectOption('#lPick', ''); await pg.fill('#lName', "Townsend's Solitaire"); await pg.fill('#lPlace', 'Boston Lot Lake, Lebanon'); await pg.fill('#lDate', TODAY);
await pg.click('#makeLifer');
await pg.waitForFunction(() => /Lifer #149/.test(document.getElementById('previewNote').textContent));
lf = await pg.evaluate(() => document.querySelector('#strip canvas')._layout);
assert.equal(lf.number, 149); assert.equal(lf.total, 149); assert.ok(lf.name.widths.every(w => w <= 920)); assert.ok(lf.name.lines.length <= 3);
b = await pngOf(pg, 0); await checkPng(b, 'lifer slide 2', { cleanMargins: 'paper' }); await writeFile(join(OUT, 'lifer-long.png'), b);
// switching to the outing mode hides the lifer preview; the mode is remembered
await pg.click('#modeOuting'); assert.ok(await pg.isHidden('#preview'));
assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:storyMode'))), 'outing');
await pg.screenshot({ path: join(OUT, 'stories-lifer-390.png'), fullPage: true });
await pg.close();
// no life list: no number, no total, the note says so
pg = await page(1100, { extra: { 'daybird:storyMode': 'lifer' } });
await pg.goto(`${base}/stories.html`);
await pg.waitForSelector('#lifer:not(.hidden)');
assert.match(await pg.textContent('#liferNote'), /No life list yet/);
await pg.fill('#lName', 'Savannah Sparrow'); await pg.click('#makeLifer');
await pg.waitForFunction(() => document.querySelectorAll('#strip canvas').length === 1);
lf = await pg.evaluate(() => document.querySelector('#strip canvas')._layout);
assert.equal(lf.number, null); assert.equal(lf.total, null);
assert.equal(await pg.textContent('#previewNote'), '');
await pg.close();

// =====================================================================================
// 5. The hub lists the page, and every page loads without an error
pg = await page(1100);
await pg.goto(`${base}/more.html`);
await pg.waitForSelector('#hub a[href="stories.html"]');
assert.match(await pg.$eval('.hub[data-group="you"]', c => c.textContent), /Stories/);
await pg.close();
for (const f of (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort()) {
  const p = await page(1100, { settings: SETTINGS, life: LIFE });
  await p.goto(`${base}/${f}`); await p.waitForTimeout(400);
  await p.close();
}

await browser.close(); server.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
console.log(`stories.ui.mjs: all checks passed; pictures in ${OUT}`);
