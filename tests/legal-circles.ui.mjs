// Headless checks for the legal pages, footer.js, the settings delete flow, the waiver boxes on passes/host, and circles.html.
// Every outside host is stubbed. The signed-in flows use a small fake of the Supabase SDK served in place of the CDN file.
// Run from the repo root (Playwright from /opt/npm-tools on the build box, or `npm i playwright` anywhere):
//   PLAYWRIGHT_DIR=/opt/npm-tools/node_modules/playwright DAYBIRD_SHOTS=/tmp node tests/legal-circles.ui.mjs
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const { chromium } = await import(join(process.env.PLAYWRIGHT_DIR || '/opt/npm-tools/node_modules/playwright', 'index.mjs'));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DAYBIRD_SHOTS || join(tmpdir(), 'daybird-shots');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  try { res.setHeader('content-type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ---- a fake supabase-js: one signed-in user, an in-memory table store, the rpc()s from migration 9, functions.invoke
const FAKE_SDK = `
window.supabase = { createClient() {
  const user = { id: 'u-me', email: 'ben@example.com' };
  const DBS = window.__FAKE_DB = window.__FAKE_DB || { profiles: [{ id: 'u-me', name: 'Ben' }, { id: 'u-amy', name: 'Amy', photo_url: null }],
    circles: [], circle_members: [], circle_mornings: [], posts: [], likes: [], comments: [], listings: [], bookings: [], listing_private: [] };
  const result = (data, error = null) => ({ data, error });
  const newId = (p) => p + Math.random().toString(36).slice(2, 8);
  class Q {
    constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.sel = '*'; }
    select(s) { if (this.op === 'insert' || this.op === 'upsert') this.returning = true; else this.op = 'select'; this.sel = s || '*'; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
    in(c, a) { this.filters.push(r => a.includes(r[c])); return this; }
    match(o) { Object.entries(o).forEach(([c, v]) => this.filters.push(r => r[c] === v)); return this; }
    order(c, o) { this._order = { c, asc: !o || o.ascending !== false }; return this; }
    limit(n) { this._limit = n; return this; }
    maybeSingle() { this.maybe = true; return this; }
    single() { this.single1 = true; return this; }
    insert(r) { this.op = 'insert'; this.rows = [].concat(r); return this; }
    upsert(r, o) { this.op = 'upsert'; this.rows = [].concat(r); this.keys = ((o && o.onConflict) || 'id').split(','); return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec() {
      const tbl = DBS[this.t] || (DBS[this.t] = []);
      const embed = (r) => { const m = this.sel.match(/profiles\\(([^)]*)\\)/); if (!m) return r; const p = DBS.profiles.find(x => x.id === (r.user_id || r.owner_id || r.host_id)); return { ...r, profiles: p ? Object.fromEntries(m[1].split(',').map(k => [k.trim(), p[k.trim()]])) : null }; };
      if (this.op === 'select') {
        let rows = tbl.filter(r => this.filters.every(f => f(r)));
        // RLS stand-in (migration 9): circle rows are readable only by members of that circle
        if (this.t === 'circles') rows = rows.filter(r => member(r.id));
        if (this.t === 'circle_members' || this.t === 'circle_mornings') rows = rows.filter(r => member(r.circle_id));
        if (this._order) rows.sort((a, b) => (a[this._order.c] > b[this._order.c] ? 1 : a[this._order.c] < b[this._order.c] ? -1 : 0) * (this._order.asc ? 1 : -1));
        if (this._limit) rows = rows.slice(0, this._limit);
        rows = rows.map(embed);
        if (this.single1 || this.maybe) return result(rows[0] || null, this.single1 && !rows[0] ? { message: 'no rows' } : null);
        return result(rows);
      }
      if (this.op === 'insert') { const added = this.rows.map(r => ({ id: newId('id-'), created_at: new Date().toISOString(), ...r })); tbl.push(...added); return result(this.returning ? (this.single1 ? added[0] : added) : null); }
      if (this.op === 'upsert') {
        const added = this.rows.map(r => { const i = tbl.findIndex(x => this.keys.every(k => x[k] === r[k])); if (i >= 0) { tbl[i] = { ...tbl[i], ...r }; return tbl[i]; } const n = { id: newId('id-'), created_at: new Date().toISOString(), ...r }; tbl.push(n); return n; });
        return result(this.returning ? added : null);
      }
      if (this.op === 'delete') { const keep = tbl.filter(r => !this.filters.every(f => f(r))); (window.__FAKE_DELETES = window.__FAKE_DELETES || []).push({ table: this.t, removed: tbl.length - keep.length }); DBS[this.t] = keep; return result(null); }
    }
  }
  const member = (cid) => DBS.circle_members.some(m => m.circle_id === cid && m.user_id === user.id);
  return {
    auth: { async getSession() { return { data: { session: { user } } }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { window.__FAKE_SIGNED_OUT = true; return { error: null }; }, async signInWithOtp() { return { error: null }; } },
    from(t) { return new Q(t); },
    async rpc(name, args) {
      (window.__FAKE_RPC = window.__FAKE_RPC || []).push({ name, args });
      if (name === 'create_circle') { const c = { id: newId('c-'), name: args.p_name, owner_id: user.id, invite_code: 'K7PM2X', created_at: new Date().toISOString() }; DBS.circles.push(c); DBS.circle_members.push({ circle_id: c.id, user_id: user.id, joined_at: new Date().toISOString() }); return result(c); }
      if (name === 'join_circle') { const c = DBS.circles.find(x => x.invite_code === args.p_code); if (!c) return result(null, { message: 'No circle has that code. Check it and try again.' }); if (!member(c.id)) DBS.circle_members.push({ circle_id: c.id, user_id: user.id, joined_at: new Date().toISOString() }); return result(c); }
      return result(null, { message: 'unknown rpc ' + name });
    },
    functions: { async invoke(name, opts) { (window.__FAKE_INVOKES = window.__FAKE_INVOKES || []).push({ name, body: opts && opts.body }); if (name === 'delete-account') return { data: { ok: true, removed: { posts: 1 }, partial: window.__FAKE_PARTIAL || [] }, error: null }; return { data: null, error: { message: 'not stubbed' } }; } },
    storage: { from() { return { async upload() { return { error: null }; }, getPublicUrl(p) { return { data: { publicUrl: 'https://x/' + p } }; } }; } },
  };
} };`;

const browser = await chromium.launch();
const errors = [];
async function page({ width = 1100, online = false } = {}) {
  const pg = await browser.newPage({ viewport: { width, height: 1400 } });
  pg.on('pageerror', e => errors.push(`${pg.url()}: ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|supabase|404|status of 500/.test(m.text())) errors.push(`${pg.url()}: ${m.text()}`); });
  await pg.route(/supabase\.co|jsdelivr|open-meteo\.com|ebird\.org|resend\.com|anthropic\.com/, async route => {
    const u = route.request().url();
    if (u.includes('api.open-meteo.com')) {
      const d0 = new Date().toISOString().slice(0, 10), d1 = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const hrs = (d) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`);
      const col = (a, b) => [...Array(24).fill(a), ...Array(24).fill(b)];
      return route.fulfill({ json: { current: { time: `${d0}T07:30`, temperature_2m: 40 }, hourly: { time: [...hrs(d0), ...hrs(d1)], temperature_2m: col(41, 33), precipitation_probability: col(10, 70), wind_speed_10m: col(5, 20), wind_direction_10m: col(315, 180), cloud_cover: col(20, 90) }, daily: { time: [d0, d1], sunrise: [`${d0}T07:05`, `${d1}T07:06`], sunset: [`${d0}T17:58`, `${d1}T17:56`], temperature_2m_max: [58, 40], temperature_2m_min: [35, 30] } } });
    }
    if (u.includes('geocoding-api')) return route.fulfill({ json: { results: [] } });
    if (u.includes('jsdelivr')) return route.fulfill({ contentType: 'text/javascript', body: online ? FAKE_SDK : '' });
    return route.fulfill({ status: 404, body: '' });
  });
  return pg;
}
const footerCheck = async (pg, label) => {
  const n = await pg.$$eval('footer', f => f.length);
  assert.ok(n >= 1, `${label}: has a footer`);
  const links = await pg.$$eval('footer .legal-links', l => l.map(x => x.textContent));
  assert.equal(links.length, n, `${label}: one legal-links block per footer`);
  assert.equal(links[0], 'Privacy · Terms · Not safety advice', label);
  const hrefs = await pg.$$eval('footer .legal-links a', a => a.map(x => x.getAttribute('href')));
  assert.deepEqual(hrefs.slice(0, 3), ['privacy.html', 'terms.html', 'terms.html#safety'], label);
  const text = await pg.$eval('footer', f => f.textContent);
  assert.equal((text.match(/not safety advice/gi) || []).length, 2, `${label}: the safety sentence once, plus the link once`);
  // idempotent: running it again adds nothing
  await pg.evaluate(() => DAYBIRD_FOOTER.ensure());
  assert.equal(await pg.$$eval('footer .legal-links', l => l.length), n, `${label}: no duplicates after a second run`);
  assert.equal(await pg.$$eval('footer .legal-safety', l => l.length), await pg.$eval('footer', f => /not safety advice/i.test([...f.childNodes].filter(x => !(x.nodeType === 1 && /legal-/.test(x.className))).map(x => x.textContent).join(' ')) ? 0 : 1), `${label}: safety sentence added only when the page lacks it`);
};

// ---- 1. every page loads without a pageerror, and footer.js did its job on each
const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
console.log('pages:', pages.join(' '));
for (const f of pages) {
  const pg = await page();
  await pg.goto(`${base}/${f}`);
  await pg.waitForTimeout(400);
  await footerCheck(pg, f);
  await pg.close();
}
assert.deepEqual(errors, [], 'no page errors on any page');

// ---- 2. the legal templates render with their banner
for (const [f, banner] of [['privacy.html', /TEMPLATE — review before publishing/], ['terms.html', /TEMPLATE — review before publishing/], ['waiver.html', /TEMPLATE — attorney review before any paid pass/]]) {
  for (const width of [390, 1100]) {
    const pg = await page({ width });
    await pg.goto(`${base}/${f}`);
    assert.match(await pg.textContent('#templateBanner'), banner, f);
    assert.ok((await pg.$$eval('.placeholder', p => p.length)) > 0, `${f}: has placeholders to fill in`);
    const scrollW = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollW <= width + 1, `${f}: no horizontal scroll at ${width}`);
    await pg.screenshot({ path: `${OUT}/legal-${f.replace('.html', '')}-${width}.png`, fullPage: width === 390 ? false : true });
    await pg.close();
  }
}
let pg = await page();
await pg.goto(`${base}/privacy.html`);
for (const word of ['Supabase', 'Resend', 'eBird', 'Open-Meteo', 'Anthropic', 'does not sell', 'Delete my account', 'local storage', '13 and older', 'not safety advice', '[MAILING_ADDRESS]']) assert.ok((await pg.textContent('.legal')).includes(word), `privacy mentions ${word}`);
await pg.goto(`${base}/terms.html`);
for (const word of ['Not safety advice', 'non-commercial', 'New Hampshire', 'at least 13', 'guest waiver']) assert.ok((await pg.textContent('.legal')).includes(word), `terms mentions ${word}`);
await pg.goto(`${base}/waiver.html`);
for (const word of ['risks of walking on private land', 'Nobody promises birds', "follow the host's rules", 'leave no trace', '13 or older', 'Host agreement']) assert.ok((await pg.textContent('.legal')).includes(word), `waiver mentions ${word}`);
await pg.close();

// ---- 3. footer.js survives a page rewriting its footer (feed.html does that after sign-in)
pg = await page();
await pg.goto(`${base}/feed.html`);
await pg.waitForTimeout(300);
await pg.evaluate(() => { document.getElementById('foot').textContent = 'Shared feed. Be kind.'; });
await pg.waitForFunction(() => document.querySelectorAll('footer .legal-links').length === 1 && document.querySelectorAll('footer .legal-safety').length === 1);
await pg.close();

// ---- 4. passes: booking is blocked until the waiver box is ticked (offline, sample listing)
pg = await page({ width: 1100 });
await pg.goto(`${base}/passes.html`);
await pg.waitForSelector('#list button[data-id]');
const firstId = await pg.$eval('#list button[data-id]', b => b.dataset.id);
assert.ok(await pg.isDisabled(`button[data-id="${firstId}"]`), 'Book disabled before the waiver');
await pg.evaluate((id) => document.querySelector(`button[data-id="${id}"]`).click(), firstId); // a forced click on a disabled button
await pg.waitForTimeout(200);
assert.equal(await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:bookings') || '[]').length), 0, 'nothing booked without the waiver');
assert.equal(await pg.$$eval('#mine .row', r => r.length), 0);
await pg.check(`#w-${firstId}`);
assert.ok(await pg.isEnabled(`button[data-id="${firstId}"]`), 'Book enabled after ticking');
await pg.uncheck(`#w-${firstId}`);
assert.ok(await pg.isDisabled(`button[data-id="${firstId}"]`), 'unticking disables again');
await pg.check(`#w-${firstId}`);
await pg.click(`button[data-id="${firstId}"]`);
await pg.waitForSelector('#mine .row');
const booked = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:bookings')));
assert.equal(booked.length, 1);
assert.match(booked[0].waiverAt, /^\d{4}-\d{2}-\d{2}T/, 'waiver time stored with the booking');
assert.match(await pg.textContent('#list'), /guest waiver \(template\)/);
await pg.screenshot({ path: `${OUT}/passes-waiver-1100.png`, fullPage: false });
await pg.close();

// ---- 5. host: publish is blocked until the host agreement is ticked; the time is stored
pg = await page();
await pg.goto(`${base}/host.html`);
assert.ok(await pg.isDisabled('#save'));
assert.match(await pg.textContent('#storeNotice'), /^What we store when you publish:/);
await pg.fill('#title', 'Back Pasture Pond');
await pg.check('#hostWaiver');
assert.ok(await pg.isEnabled('#save'));
await pg.click('#save');
await pg.waitForURL(/passes\.html/);
const listing = await pg.evaluate(() => JSON.parse(localStorage.getItem('daybird:hostListings'))[0]);
assert.equal(listing.title, 'Back Pasture Pond');
assert.match(listing.hostWaiverAcceptedAt, /^\d{4}-/);
await pg.close();

// ---- 6. profile: the "what we store" line sits by the save button
pg = await page();
await pg.goto(`${base}/profile.html`);
await pg.waitForFunction(() => document.getElementById('storeNotice').textContent.length > 0);
assert.match(await pg.textContent('#storeNotice'), /^What we store when you save:.*Privacy\.$/);
assert.equal(await pg.$eval('#storeNotice a', a => a.getAttribute('href')), 'privacy.html');
await pg.close();

// ---- 7. settings: delete flow needs DELETE typed; offline shows the explanation instead
pg = await page();
await pg.goto(`${base}/settings.html`);
await pg.waitForFunction(() => /Offline mode/.test(document.getElementById('deleteIntro').textContent));
assert.ok(await pg.isHidden('#deleteForm'));
await pg.close();

pg = await page({ online: true });
await pg.goto(`${base}/settings.html`);
await pg.waitForSelector('#deleteForm:not(.hidden)');
assert.match(await pg.textContent('#deleteIntro'), /Signed in as ben@example\.com/);
assert.match(await pg.textContent('#deleteForm'), /hosts are not notified/);
assert.ok(await pg.isDisabled('#deleteBtn'));
await pg.fill('#deleteConfirm', 'delete');
assert.ok(await pg.isDisabled('#deleteBtn'), 'lowercase does not count');
await pg.fill('#deleteConfirm', 'DELET');
assert.ok(await pg.isDisabled('#deleteBtn'));
await pg.fill('#deleteConfirm', 'DELETE');
assert.ok(await pg.isEnabled('#deleteBtn'));
assert.equal(await pg.evaluate(() => (window.__FAKE_INVOKES || []).length), 0, 'nothing called before the click');
await pg.evaluate(() => localStorage.setItem('daybird:life', '{"total":1}'));
await pg.screenshot({ path: `${OUT}/settings-delete-1100.png`, fullPage: true });
await pg.click('#deleteBtn');
await pg.waitForFunction(() => /gone/.test(document.getElementById('deleteMsg').textContent));
assert.deepEqual(await pg.evaluate(() => window.__FAKE_INVOKES), [{ name: 'delete-account', body: { confirm: 'DELETE' } }]);
assert.equal(await pg.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('daybird:')).length), 0, 'browser data cleared');
assert.equal(await pg.evaluate(() => window.__FAKE_SIGNED_OUT), true);
assert.ok(await pg.isDisabled('#deleteBtn'));
assert.ok(await pg.isVisible('#deleteMsg'), 'the result message stays visible after sign-out');
await pg.close();

// partial result wording
pg = await page({ online: true });
await pg.addInitScript(() => { window.__FAKE_PARTIAL = ['photos']; });
await pg.goto(`${base}/settings.html`);
await pg.waitForSelector('#deleteForm:not(.hidden)');
await pg.fill('#deleteConfirm', 'DELETE'); await pg.click('#deleteBtn');
await pg.waitForFunction(() => /could not be removed automatically \(photos\)/.test(document.getElementById('deleteMsg').textContent));
await pg.close();

// ---- 8. circles: signed out → gate; signed in → create (code shown), join, post this morning (grid cell), leave
pg = await page();
await pg.goto(`${base}/circles.html`);
await pg.waitForFunction(() => /Offline mode/.test(document.getElementById('gate').textContent));
assert.ok(await pg.isDisabled('#createBtn'));
await footerCheck(pg, 'circles.html offline');
await pg.close();

const yesterday = new Date(Date.now() - 864e5); const yd = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
for (const width of [390, 1100]) {
  pg = await page({ width, online: true });
  // Amy already has a circle with a morning posted yesterday; we will join it later
  await pg.addInitScript((yd) => {
    window.__FAKE_DB = { profiles: [{ id: 'u-me', name: 'Ben' }, { id: 'u-amy', name: 'Amy' }], posts: [], likes: [], comments: [], listings: [], bookings: [], listing_private: [],
      circles: [{ id: 'c-amy', name: 'Mink Brook regulars', owner_id: 'u-amy', invite_code: 'AMY234', created_at: '2026-10-01T00:00:00Z' }],
      circle_members: [{ circle_id: 'c-amy', user_id: 'u-amy', joined_at: '2026-10-01T00:00:00Z' }],
      circle_mornings: [{ id: 'm1', circle_id: 'c-amy', user_id: 'u-amy', date: yd, word: 'MAYBE', note: 'Quiet, one kingfisher.', spot: 'Mink Brook', created_at: yd + 'T12:00:00Z' }] };
  }, yd);
  await pg.goto(`${base}/circles.html`);
  await pg.waitForFunction(() => document.getElementById('gate').textContent === '' && /No circles yet/.test(document.getElementById('circleView').textContent));
  // RLS stand-in: the fake store holds Amy's circle, but list() only shows circles we are in → none yet
  assert.equal(await pg.$$eval('#circleTabs button', b => b.length), 0);

  // create → code shown
  await pg.fill('#newName', 'Tuesday dawn crew');
  await pg.click('#createBtn');
  await pg.waitForSelector('#inviteCode');
  assert.equal(await pg.textContent('#inviteCode'), 'K7PM2X');
  assert.match(await pg.textContent('#createMsg'), /Its code is K7PM2X/);
  assert.deepEqual(await pg.$$eval('#circleTabs button', b => b.map(x => x.textContent)), ['Tuesday dawn crew']);
  assert.match(await pg.textContent('#members'), /Ben/);
  assert.match(await pg.textContent('#circleView'), /1 member · you started it/);
  assert.match(await pg.textContent('#circleView'), /Delete circle/);
  assert.equal(await pg.$$eval('#grid thead th', th => th.length), 15, '14 day columns plus the name column');
  assert.equal(await pg.$$eval('#grid tbody tr', tr => tr.length), 1);
  assert.equal(await pg.$$eval('#grid .dot[data-cell]', d => d.length), 0, 'no mornings yet');
  // today's brief preselects the call (stubbed weather → GO)
  assert.match(await pg.textContent('#circleView'), /Today's brief says GO/);
  assert.equal(await pg.$eval('#words .on', b => b.dataset.word), 'GO');
  assert.ok((await pg.$$eval('#spotList option', o => o.length)) > 0, 'brief spots offered as suggestions');

  // join by code (lowercase with a space; the page cleans it) → Amy's circle appears with both members
  await pg.fill('#joinCode', 'amy 234');
  await pg.click('#joinBtn');
  await pg.waitForFunction(() => /You're in "Mink Brook regulars"/.test(document.getElementById('joinMsg').textContent));
  assert.deepEqual(await pg.evaluate(() => window.__FAKE_RPC.map(r => r.name + ':' + Object.values(r.args)[0])), ['create_circle:Tuesday dawn crew', 'join_circle:AMY234']);
  assert.deepEqual(await pg.$$eval('#circleTabs button', b => b.map(x => x.textContent)), ['Mink Brook regulars', 'Tuesday dawn crew']);
  assert.equal(await pg.$eval('#circleTabs button.on', b => b.textContent), 'Mink Brook regulars');
  assert.deepEqual(await pg.$$eval('#members > span', s => s.map(x => x.lastChild.textContent)), ['Amy', 'Ben'], 'display names come from profiles');
  assert.equal(await pg.textContent('#inviteCode'), 'AMY234');
  assert.match(await pg.textContent('#circleView'), /Leave circle/);
  // Amy's morning from yesterday is in the grid and in the lines
  assert.deepEqual(await pg.$$eval('#grid .dot[data-cell]', d => d.map(x => [x.getAttribute('data-cell'), x.textContent, x.className])), [[`u-amy|${yd}`, 'M', 'dot maybe']]);
  assert.match(await pg.textContent('#lines'), /Amy.*MAYBE.*Mink Brook.*Quiet, one kingfisher\./s);

  // bad code
  await pg.fill('#joinCode', 'ZZZZZZ'); await pg.click('#joinBtn');
  await pg.waitForFunction(() => /No circle has that code/.test(document.getElementById('joinMsg').textContent));

  // post this morning → my cell for today appears, with the note
  await pg.click('#words button[data-word="STAY"]');
  await pg.fill('#spot', 'Porch');
  await pg.fill('#note', 'Coffee and a chickadee at the feeder.');
  assert.equal(await pg.textContent('#noteCount'), '37');
  await pg.click('#postBtn');
  await pg.waitForFunction(() => document.querySelectorAll('#grid .dot[data-cell]').length === 2);
  const today = await pg.evaluate(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const mine = await pg.$eval(`#grid .dot[data-cell="u-me|${today}"]`, d => ({ cls: d.className, text: d.textContent, title: d.title }));
  assert.equal(mine.cls, 'dot stay'); assert.equal(mine.text, 'S');
  assert.match(mine.title, /Ben · .* · STAY IN · Porch · Coffee and a chickadee at the feeder\./);
  assert.equal(await pg.textContent('#postBtn'), 'Update this morning');
  assert.match(await pg.textContent('#lines'), /Ben.*STAY IN.*Porch/s);
  const stored = await pg.evaluate(() => window.__FAKE_DB.circle_mornings.filter(m => m.user_id === 'u-me'));
  assert.equal(stored.length, 1);
  assert.deepEqual({ ...stored[0], id: 0, created_at: 0 }, { id: 0, created_at: 0, circle_id: 'c-amy', user_id: 'u-me', date: today, word: 'STAY', note: 'Coffee and a chickadee at the feeder.', spot: 'Porch' });
  // posting again the same day replaces, not duplicates
  await pg.click('#words button[data-word="GO"]'); await pg.click('#postBtn');
  await pg.waitForFunction(() => document.querySelector('#grid .dot[data-cell^="u-me|"]')?.className === 'dot go');
  assert.equal(await pg.evaluate(() => window.__FAKE_DB.circle_mornings.filter(m => m.user_id === 'u-me').length), 1);
  assert.match(await pg.textContent('#storeNotice'), /^What we store: the circle name/);
  const scrollW = await pg.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(scrollW <= width + 1, `circles: no horizontal scroll at ${width}`);
  await pg.screenshot({ path: `${OUT}/circles-${width}.png`, fullPage: true });

  // leave: inline confirm, no dialogs; the member row goes, the other circle stays
  await pg.click('#leaveBtn');
  assert.ok(await pg.isVisible('#leaveConfirm'));
  await pg.click('#leaveNo');
  assert.ok(await pg.isHidden('#leaveConfirm'));
  await pg.click('#leaveBtn'); await pg.click('#leaveYes');
  await pg.waitForFunction(() => document.querySelectorAll('#circleTabs button').length === 1);
  assert.deepEqual(await pg.evaluate(() => window.__FAKE_DELETES), [{ table: 'circle_members', removed: 1 }]);
  assert.equal(await pg.textContent('#inviteCode'), 'K7PM2X');
  // owner "leaving" deletes the circle
  await pg.click('#leaveBtn'); await pg.click('#leaveYes');
  await pg.waitForFunction(() => /No circles yet/.test(document.getElementById('circleView').textContent));
  assert.deepEqual(await pg.evaluate(() => window.__FAKE_DELETES.at(-1)), { table: 'circles', removed: 1 });
  await pg.close();
}

assert.deepEqual(errors, [], 'no page errors anywhere');
await browser.close();
server.close();
console.log('legal-circles UI: all checks passed. Screenshots in', OUT);
