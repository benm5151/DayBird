/* Daybird "Your birds" (lifelist.html): the life list as a wall of photos, plus the common local birds not on it yet.
   Loaded after js/app.js and js/footer.js.

   Data: DB.lifeList() (allSpecies names; first-seen date and place from life.firsts, which app.js stores on CSV import
   and on eBird sync, or from recentLifers for older imports). Nothing here writes to the life list.
   Pictures, in order of preference per species:
     1. the person's own photo or drawing (DB.birdImages: localStorage signed out, bird_images + the photos bucket signed in)
     2. approved Daybird art (data/art.js, `approved: true`; a hook, nothing is approved yet)
     3. one free-licensed photo from Wikimedia: Wikipedia's page summary gives the thumbnail and file name, the Commons
        API the photographer and license, which the page always shows
     4. the name on paper with a thin amber ring
   Wikimedia lookups run as tiles scroll into view, at most MAX_INFLIGHT at a time, and are cached in localStorage
   ('daybird:photos', 30 days, misses included) so a return visit makes no requests. Every network failure is silent.

   DAYBIRD_LIFELIST = { photos: { lookup, cached, request, cancel, fileName, thumbAt, sentence, stripHtml, clearCache, ownArt },
                        entries, order, sections, rank, unseen, hintOf, fmtMonth, fmtLong, drawSlide, slideBlob, share, mount } */
const DAYBIRD_LIFELIST = (() => {
  const PAPER = '#F6F3EC', INK = '#1F2A37', AMBER = '#E8833A', MUTED = '#5f6b63';
  const CACHE_KEY = 'daybird:photos', TTL_DAYS = 30, MAX_INFLIGHT = 4;
  const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&origin=*&titles=';
  const B = () => globalThis.DAYBIRD_BRIEF;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- hook: commissioned art
  // When Daybird has its own approved drawing of a species, prefer it over the Wikimedia photo. Not wired to anything
  // yet: data/art.js entries carry no `approved` flag until the expert review on art.html is done, so this returns
  // null for every species today and nothing from art/birds/ is shown. To turn it on later: add `approved: true` to a
  // reviewed entry in data/art.js (and nothing else).
  function ownArt(name) {
    const A = globalThis.DAYBIRD_ART;
    if (!Array.isArray(A)) return null;
    const e = A.find(a => a && a.approved === true && a.name === name);
    return e ? { thumb: `art/birds/${e.slug}.svg`, image: `art/birds/${e.slug}.svg`, artist: 'Daybird', license: 'Daybird art', page: 'art.html', wiki: '', own: true } : null;
  }

  // ---------------------------------------------------------------- cache (localStorage, 30 days)
  const today = () => new Date().toISOString().slice(0, 10);
  let mem = null;
  function all() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { mem = {}; }
    if (typeof mem !== 'object' || Array.isArray(mem)) mem = {};
    return mem;
  }
  const fresh = (e) => !!(e && e.at && (Date.now() - new Date(e.at).getTime()) < TTL_DAYS * 864e5);
  function cached(name) { const e = all()[name]; return fresh(e) ? e : null; }
  function remember(name, e) {
    all()[name] = { ...e, at: today() };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all())); } catch { /* full or blocked: the memory copy still serves this visit */ }
  }
  function clearCache() { mem = {}; try { localStorage.removeItem(CACHE_KEY); } catch {} }

  // ---------------------------------------------------------------- Wikimedia lookups
  const titleOf = (name) => String(name || '').trim().replace(/\s+/g, '_');
  // Wikipedia titles are sentence case ("Black-capped chickadee"); eBird names capitalize every word.
  const sentence = (name) => { const [a, ...r] = String(name || '').trim().split(' '); return [a, ...r.map(w => w.toLowerCase())].join(' '); };
  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
  // The Commons file name from a thumbnail or original URL: last path segment, URL-decoded, without the "320px-" prefix
  // (and the page/lossy prefixes Commons adds for TIFF and PDF thumbnails, and the ".png" it adds to SVG thumbnails).
  function fileName(url) {
    let last = String(url || '').split('?')[0].split('#')[0].split('/').pop() || '';
    try { last = decodeURIComponent(last); } catch {}
    last = last.replace(/^(lossy|lossless)-page\d+-/, '').replace(/^\d+px-/, '');
    if (/\.(svg|tiff?|pdf|webm|ogv)\.(png|jpe?g)$/i.test(last)) last = last.replace(/\.(png|jpe?g)$/i, '');
    return last;
  }
  // The same Commons thumbnail at another width (thumb URLs end in /<width>px-<file>). Non-thumb URLs come back as they are.
  const thumbAt = (url, w) => String(url || '').replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
  const isThumb = (url) => /\/thumb\/.*\/\d+px-[^/]+$/.test(String(url || ''));
  // Artist fields on Commons are HTML (links, spans). DOMParser documents are inert, so this never runs anything.
  function stripHtml(h) {
    const s = String(h || '');
    try { return new DOMParser().parseFromString(s, 'text/html').body.textContent.replace(/\s+/g, ' ').trim(); }
    catch { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
  }
  async function summary(name) {
    const tries = [...new Set([String(name).trim(), sentence(name)])];
    for (const t of tries) {
      try {
        const j = await getJSON(SUMMARY + encodeURIComponent(titleOf(t)));
        if (j && j.type !== 'disambiguation' && j.thumbnail && j.thumbnail.source) return j;
      } catch { /* try the next spelling */ }
    }
    return null;
  }
  async function credit(file) {
    try {
      const j = await getJSON(COMMONS + encodeURIComponent('File:' + file));
      const page = Object.values((j.query && j.query.pages) || {})[0];
      const m = (page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].extmetadata) || {};
      const artist = stripHtml(m.Artist && m.Artist.value), license = stripHtml(m.LicenseShortName && m.LicenseShortName.value);
      return { artist: artist || 'Unknown photographer', license: license || 'see Wikimedia Commons' };
    } catch { return { artist: 'See Wikimedia Commons', license: '' }; }
  }
  // One species → { thumb, image, artist, license, page, wiki, title } or null. Cached either way.
  async function lookup(name) {
    const own = ownArt(name); if (own) return own;
    const hit = cached(name); if (hit) return hit.none ? null : hit;
    const s = await summary(name);
    if (!s) { remember(name, { none: true }); return null; }
    const thumb = s.thumbnail.source, orig = s.originalimage || {};
    const w = +orig.width || 0;
    // tile: a 400 px thumbnail (sharp at 2x on a phone); sheet and slide: the original when it is modest, else a 1000 px thumbnail
    const tile = isThumb(thumb) && (!w || w >= 400) ? thumbAt(thumb, 400) : thumb;
    const image = orig.source && w && w <= 1400 ? orig.source : (isThumb(thumb) && (!w || w >= 1000) ? thumbAt(thumb, 1000) : (orig.source || thumb));
    const file = fileName(orig.source || thumb);
    const c = await credit(file);
    const e = {
      thumb: tile, image, artist: c.artist, license: c.license,
      page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file).replace(/%20/g, '_'),
      wiki: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent((s.titles && s.titles.canonical) || titleOf(name))),
      title: (s.titles && s.titles.normalized) || String(name),
    };
    remember(name, e);
    return e;
  }

  // ---------------------------------------------------------------- the queue: at most MAX_INFLIGHT lookups at once
  const queue = [], pending = new Set(), waiters = {}; let inflight = 0;
  function request(name) {
    return new Promise(res => {
      (waiters[name] = waiters[name] || []).push(res);
      if (!pending.has(name)) { pending.add(name); queue.push(name); pump(); }
    });
  }
  // A tile that scrolled away before its turn leaves the queue (resolves undefined); it is asked for again when it comes back.
  function cancel(name) {
    const i = queue.indexOf(name); if (i < 0) return;
    queue.splice(i, 1); pending.delete(name);
    (waiters[name] || []).forEach(f => f(undefined)); delete waiters[name];
  }
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const name = queue.shift(); inflight++;
      lookup(name).catch(() => null).then(e => {
        inflight--; pending.delete(name);
        (waiters[name] || []).forEach(f => f(e)); delete waiters[name];
        pump();
      });
    }
  }

  // ---------------------------------------------------------------- the list
  const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const fmtMonth = (s) => { const d = parseDate(s); return d ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : String(s || ''); };
  const fmtLong = (s) => { const d = parseDate(s); return d ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : String(s || ''); };
  const firstOf = (L, name) => (L && L.firsts && L.firsts[name]) || ((L && L.recentLifers) || []).find(x => x && x.name === name) || null;
  const groupName = (name) => (B() && B().groupOf(name)) || 'other birds';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // [{ name, first, loc, group }] for every species on the list
  function entries(L) {
    return ((L && L.allSpecies) || []).map(name => { const f = firstOf(L, name); return { name, first: (f && f.first) || '', loc: (f && f.loc) || '', group: groupName(name) }; });
  }
  // by: 'date' (newest first, undated last A–Z) | 'az' | 'family' (biggest family first, A–Z inside)
  function order(list, by) {
    const a = [...list];
    if (by === 'az') return a.sort((x, y) => x.name.localeCompare(y.name));
    if (by === 'family') {
      const n = {}; a.forEach(e => n[e.group] = (n[e.group] || 0) + 1);
      return a.sort((x, y) => (x.group === y.group ? 0 : x.group === 'other birds' ? 1 : y.group === 'other birds' ? -1 : n[y.group] - n[x.group] || x.group.localeCompare(y.group)) || x.name.localeCompare(y.name));
    }
    return a.sort((x, y) => (y.first || '').localeCompare(x.first || '') || x.name.localeCompare(y.name));
  }
  // [{ title, items }]: one untitled section, or one per family
  function sections(list, by) {
    const sorted = order(list, by);
    if (by !== 'family') return [{ title: null, items: sorted }];
    const out = [];
    for (const e of sorted) { const last = out[out.length - 1]; if (last && last.key === e.group) last.items.push(e); else out.push({ key: e.group, title: cap(e.group), items: [e] }); }
    return out;
  }
  // "bird #N": the species' place in first-seen order, only when every species has a date (older imports do not)
  function rank(L, name) {
    const es = entries(L);
    if (!es.length || es.some(e => !e.first)) return null;
    es.sort((x, y) => x.first.localeCompare(y.first) || x.name.localeCompare(y.name));
    const i = es.findIndex(e => e.name === name);
    return i < 0 ? null : i + 1;
  }
  // Common local birds (DAYBIRD_TRAITS) not on the list: the ones in this morning's recent list first, then feeder,
  // yard and edge birds, then the rest in table order.
  function unseen(L, recent, limit = 24) {
    const have = new Set((L && L.allSpecies) || []), rec = new Set(recent || []);
    const T = globalThis.DAYBIRD_TRAITS || [];
    const score = (t) => (rec.has(t[0]) ? 2 : 0) + ((t[3] || []).some(h => h === 'feeder' || h === 'yard' || h === 'edge') ? 1 : 0);
    return T.filter(t => t && !have.has(t[0])).map((t, i) => ({ name: t[0], hint: t[5] || '', habitats: t[3] || [], around: rec.has(t[0]), score: score(t), i, group: groupName(t[0]) }))
      .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit);
  }
  const hintOf = (name) => { const t = (globalThis.DAYBIRD_TRAITS || []).find(r => r && r[0] === name); return t ? t[5] || '' : ''; };

  // ---------------------------------------------------------------- the story slide (1080×1920, drawn in the browser)
  const W = 1080, H = 1920;
  function fonts() {
    let serif = '', sans = '';
    try { const cs = getComputedStyle(document.documentElement); serif = cs.getPropertyValue('--serif').trim(); sans = cs.getPropertyValue('--sans').trim(); } catch {}
    return { serif: serif || '"Iowan Old Style","Palatino Linotype",Georgia,serif', sans: sans || 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif' };
  }
  function wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }
  function loadImage(src, cors) {
    return new Promise((res, rej) => {
      const i = new Image(); if (cors && !/^data:|^blob:/.test(src)) i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + src)); i.src = src;
    });
  }
  let markImg = null;
  // mark.svg has a viewBox and no width/height; give it a size so every browser can draw it on a canvas.
  async function mark(base = '') {
    if (markImg) return markImg;
    const r = await fetch(base + 'mark.svg'); if (!r.ok) throw new Error('no mark');
    let t = await r.text(); if (!/<svg[^>]*\swidth=/.test(t)) t = t.replace(/<svg\s/, '<svg width="320" height="320" ');
    const url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
    try { return (markImg = await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // d: { name, first, loc, n, total, photo (Image or null), credit (the whole credit line), note, site }. opts.theme: 'paper' | 'navy'.
  // Returns the canvas. Draws nothing from the network itself; pass the photo already loaded (crossOrigin anonymous).
  async function drawSlide(d, opts = {}) {
    const F = fonts(), navy = opts.theme === 'navy';
    const bg = navy ? INK : PAPER, ink = navy ? PAPER : INK, muted = navy ? 'rgba(246,243,236,.72)' : MUTED;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    // top line: bird #N of 148
    ctx.fillStyle = AMBER; ctx.font = `600 34px ${F.sans}`;
    const top = d.n && d.total ? `BIRD  #${d.n}  OF  ${d.total}` : d.total ? `ONE  OF  ${d.total}  BIRDS` : 'ON  MY  LIST';
    ctx.fillText(top.replace(/  /g, '  '), W / 2, 170);
    // the name, as big as fits in the band between 230 and 540
    ctx.fillStyle = ink;
    let size = 128, lines = [];
    for (const s of [128, 108, 92, 80]) { size = s; ctx.font = `700 ${s}px ${F.serif}`; lines = wrap(ctx, d.name, W - 140); if (lines.length <= (s > 100 ? 2 : 3)) break; }
    const hasPhoto = !!d.photo;
    const lh = size * 1.06, blockH = lines.length * lh;
    const bandTop = hasPhoto ? 230 : 560, bandBottom = hasPhoto ? 540 : 1000;
    let y = bandTop + (bandBottom - bandTop - blockH) / 2 + size * 0.82;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += lh; }
    if (hasPhoto) {
      // the photo in a rounded frame with a thin amber ring, cover-cropped
      const px = 100, py = 580, ps = 880, r = 56, img = d.photo;
      ctx.save(); roundRect(ctx, px, py, ps, ps, r); ctx.clip();
      const k = Math.max(ps / img.naturalWidth, ps / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      ctx.drawImage(img, px + (ps - dw) / 2, py + (ps - dh) / 2, dw, dh);
      ctx.restore();
      ctx.strokeStyle = AMBER; ctx.lineWidth = 6; roundRect(ctx, px, py, ps, ps, r); ctx.stroke();
      // credit, small, under the frame
      ctx.fillStyle = muted; ctx.font = `400 28px ${F.sans}`;
      let cy = 1512; for (const l of wrap(ctx, d.credit || '', W - 200).slice(0, 2)) { ctx.fillText(l, W / 2, cy); cy += 36; }
    } else {
      // text-only slide: a big amber ring where the photo would be, and why
      ctx.strokeStyle = AMBER; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(W / 2, 1230, 150, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ink; ctx.font = `700 150px ${F.serif}`; ctx.fillText(d.name.trim().charAt(0).toUpperCase(), W / 2, 1284);
      if (d.note) { ctx.fillStyle = muted; ctx.font = `400 28px ${F.sans}`; ctx.fillText(d.note, W / 2, 1512); }
    }
    // first seen
    ctx.fillStyle = muted; ctx.font = `600 28px ${F.sans}`;
    ctx.fillText('F I R S T   S E E N', W / 2, 1620);
    ctx.fillStyle = ink; ctx.font = `400 44px ${F.sans}`;
    const seen = [d.loc, d.first ? fmtLong(d.first) : ''].filter(Boolean).join(', ') || 'date and place unknown';
    let sy = 1680; for (const l of wrap(ctx, seen, W - 160).slice(0, 2)) { ctx.fillText(l, W / 2, sy); sy += 54; }
    // bottom lockup: the titmouse mark, the wordmark, the site
    try {
      const m = await mark(opts.base || '');
      if (navy) { ctx.fillStyle = PAPER; roundRect(ctx, W / 2 - 160, 1762, 90, 90, 22); ctx.fill(); }
      ctx.drawImage(m, W / 2 - 154, 1768, 78, 78);
    } catch { /* no mark: the wordmark still says who made it */ }
    ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.font = `700 60px ${F.serif}`; ctx.fillText('daybird', W / 2 - 56, 1828);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2 - 50, 1846); ctx.quadraticCurveTo(W / 2 + 60, 1838, W / 2 + 170, 1846); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = muted; ctx.font = `400 28px ${F.sans}`; ctx.fillText(d.site || 'day-bird.com', W / 2, 1888);
    return c;
  }
  const toBlob = (c) => new Promise((res, rej) => { try { c.toBlob(b => (b ? res(b) : rej(new Error('no picture'))), 'image/png'); } catch (e) { rej(e); } });
  // Loads the picture with crossOrigin so the canvas stays clean (upload.wikimedia.org and Supabase storage both allow
  // it); if it still taints (toBlob throws) or fails to load, the slide goes out without it and says so.
  // d.image: URL or data URL; d.credit: the credit line to print under the frame. Returns { blob, photo: true|false }.
  async function slideBlob(d, opts = {}) {
    let photo = null;
    if (d.image) { try { photo = await loadImage(d.image, true); } catch { photo = null; } }
    if (photo) {
      try { return { blob: await toBlob(await drawSlide({ ...d, photo }, opts)), photo: true }; }
      catch { /* tainted canvas: fall through to the text-only slide */ }
    }
    return { blob: await toBlob(await drawSlide({ ...d, photo: null, note: 'Photo left out: it could not be copied into the picture.' }, opts)), photo: false };
  }
  const slug = (s) => String(s || 'bird').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Native share sheet when the browser offers one for files (phones), else a download. { how: 'shared'|'downloaded'|'cancelled', photo }
  async function share(d, opts = {}) {
    const { blob, photo } = await slideBlob(d, opts);
    const name = `daybird-${slug(d.name)}.png`;
    let file = null; try { file = new File([blob], name, { type: 'image/png' }); } catch {}
    const nav = opts.navigator || navigator;
    if (file && nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: `${d.name} · Daybird`, text: `${d.name}, bird ${d.n ? '#' + d.n + ' ' : ''}on my list. ${d.site || 'day-bird.com'}` }); return { how: 'shared', photo }; }
      catch (e) { if (e && e.name === 'AbortError') return { how: 'cancelled', photo }; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { how: 'downloaded', photo };
  }

  // ---------------------------------------------------------------- the page
  // Expects these ids in the document: count, sub, hint, controls, q, wall, shown, unseen, unseenWrap, empty, sheet, migrate.
  // life: DB.lifeList(); recent: names from data/brief.json; images: DB.birdImages(); db: DB (for saving own images).
  function mount({ life, recent = [], images = {}, db = globalThis.DB, site = 'day-bird.com' }) {
    const $ = (id) => document.getElementById(id);
    const L = life && Array.isArray(life.allSpecies) && life.allSpecies.length ? life : null;
    const list = L ? entries(L) : [];
    const total = L ? (L.total != null ? L.total : list.length) : 0;
    const photos = {};   // name → Wikimedia entry (this page's copy of what lookup returned, for the sheet)
    const own = { ...(images || {}) };   // name → { url | data, kind, caption }
    const ownSrc = (o) => (o && (o.url || o.data)) || '';
    const whoami = () => { try { return (db && db.settings && db.settings().name) || 'me'; } catch { return 'me'; } };
    let sortBy = 'date', q = '';
    try { const s = localStorage.getItem('daybird:lifelistSort'); if (['date', 'az', 'family'].includes(s)) sortBy = s; } catch {}

    // header
    if (L) {
      $('count').innerHTML = `${total} <span>bird${total === 1 ? '' : 's'}</span>`;
      const yr = new Date().getFullYear();
      const bits = [];
      if (L.thisYear) bits.push(`${L.thisYear} new in ${yr}`);
      if (L.firstDate) bits.push(`listing since ${fmtMonth(L.firstDate)}`);
      $('sub').textContent = bits.join(' · ');
      const dated = list.filter(e => e.first).length;
      $('hint').textContent = dated < list.length ? `First-seen dates show for ${dated} of ${list.length} birds. Re-import your eBird CSV on your profile and every tile gets one.` : '';
    } else {
      $('count').innerHTML = `0 <span>birds</span>`;
      $('sub').textContent = '';
      $('controls').classList.add('hidden');
      $('empty').classList.remove('hidden');
    }

    // tiles
    const tile = (e, kind) => `<button type="button" class="tile ${kind}" data-name="${esc(e.name)}" aria-label="${esc(e.name)}${kind === 'unseen' ? ', not seen yet' : ''}">
        <span class="face"><span class="nm">${esc(e.name)}</span></span>
        ${kind === 'unseen' ? '<span class="mini">not yet</span>' : e.first ? `<span class="mini">${esc(fmtMonth(e.first))}</span>` : ''}
        <span class="band"><b>${esc(e.name)}</b><small>${kind === 'unseen' ? 'not yet' : esc(e.first ? fmtMonth(e.first) : '')}</small></span>
        <span class="chip">wiki</span></button>`;
    // Put a picture on a tile once it has actually loaded; a failed load leaves the name on paper (never a broken image).
    const applyPhoto = (el, src, chip) => {
      if (!el || !src || el.classList.contains('has-photo') || el.dataset.tried) return;
      el.dataset.tried = '1';
      const img = new Image(); img.alt = ''; img.decoding = 'async';
      img.onload = () => { if (!el.isConnected) return; el.insertBefore(img, el.firstChild); el.classList.add('has-photo'); el.querySelector('.chip').textContent = chip; if (chip === 'yours') el.classList.add('own'); };
      img.onerror = () => { delete el.dataset.tried; };
      img.src = src;
    };
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
      for (const x of es) {
        const el = x.target, name = el.dataset.name;
        if (x.isIntersecting) {
          request(name).then(p => { if (p) { photos[name] = p; applyPhoto(el, p.thumb, 'wiki'); } if (p !== undefined) io.unobserve(el); });
        } else cancel(name);
      }
    }, { rootMargin: '240px 0px' }) : null;
    function watch(root) {
      for (const el of root.querySelectorAll('.tile')) {
        const name = el.dataset.name;
        if (own[name]) { applyPhoto(el, ownSrc(own[name]), 'yours'); continue; }   // own image first, no lookup needed
        const hit = photos[name] || cached(name);
        if (hit && !hit.none) { photos[name] = hit; applyPhoto(el, hit.thumb, 'wiki'); }
        else if (hit && hit.none) { /* known miss: stays on paper */ }
        else if (io) io.observe(el);
        else request(name).then(p => { if (p) { photos[name] = p; applyPhoto(el, p.thumb, 'wiki'); } });
      }
    }
    function renderWall() {
      if (!L) { $('wall').innerHTML = ''; return; }
      const needle = q.trim().toLowerCase();
      const items = needle ? list.filter(e => e.name.toLowerCase().includes(needle)) : list;
      $('shown').textContent = needle ? `${items.length} of ${total}` : '';
      const secs = sections(items, sortBy);
      $('wall').innerHTML = items.length
        ? secs.map(s => (s.title ? `<h2>${esc(s.title)} <span>${s.items.length}</span></h2>` : '') + s.items.map(e => tile(e, 'seen')).join('')).join('')
        : `<p class="meta nomatch">No bird on your list matches "${esc(q.trim())}".</p>`;
      watch($('wall'));
    }
    const missing = unseen(L, recent);
    function renderUnseen() {
      if (!missing.length) { $('unseenWrap').classList.add('hidden'); return; }
      $('unseen').innerHTML = missing.map(e => tile(e, 'unseen')).join('');
      watch($('unseen'));
    }
    // Redraw one tile after its own image changed (both walls may hold it).
    function refreshTile(name) {
      for (const el of document.querySelectorAll('.tile')) {
        if (el.dataset.name !== name) continue;
        const kind = el.classList.contains('unseen') ? 'unseen' : 'seen';
        const e = list.find(x => x.name === name) || missing.find(x => x.name === name) || { name };
        const fresh = document.createElement('div'); fresh.innerHTML = tile(e, kind);
        el.replaceWith(fresh.firstElementChild);
      }
      watch(document);
    }
    renderWall(); renderUnseen();

    // controls
    for (const b of document.querySelectorAll('#controls .seg button')) {
      b.setAttribute('aria-pressed', String(b.dataset.sort === sortBy));
      b.onclick = () => {
        sortBy = b.dataset.sort; try { localStorage.setItem('daybird:lifelistSort', sortBy); } catch {}
        document.querySelectorAll('#controls .seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        renderWall();
      };
    }
    $('q').addEventListener('input', () => { q = $('q').value; renderWall(); });

    // photos saved in this browser before signing in: offer to move them to the account (one line, one tap, no automatic move)
    const migrate = $('migrate');
    function offerMigrate() {
      if (!migrate || !db || !db.online || !db.online()) return;
      const local = (db.localBirdImages && db.localBirdImages()) || {}; const n = Object.keys(local).length;
      if (!n) { migrate.classList.add('hidden'); return; }
      migrate.classList.remove('hidden');
      migrate.innerHTML = `You have ${n} photo${n === 1 ? '' : 's'} saved in this browser. <button type="button" class="small ghost" id="migrateBtn">Upload ${n === 1 ? 'it' : 'them'} to your account</button> <span class="meta" id="migrateMsg"></span>`;
      $('migrateBtn').onclick = async () => {
        $('migrateBtn').disabled = true; let done = 0, failed = 0;
        for (const [name, img] of Object.entries(local)) {
          $('migrateMsg').textContent = `Uploading ${name}…`;
          const r = await db.setBirdImage(name, { data: img.data, kind: img.kind, caption: img.caption });
          if (r.ok) { done++; own[name] = r.image; refreshTile(name); } else failed++;
        }
        migrate.innerHTML = `<span class="meta">Uploaded ${done} photo${done === 1 ? '' : 's'} to your account${failed ? `; ${failed} could not be uploaded and stay in this browser` : ''}.</span>`;
      };
    }
    offerMigrate();
    document.addEventListener('daybird:auth', offerMigrate);

    // detail sheet
    const sheet = $('sheet');
    const creditOf = (o, p, looking) => {
      if (o) return `${o.kind === 'art' ? 'Your drawing' : 'Your photo'}${o.caption ? ' · ' + esc(o.caption) : ''}`;
      if (p && !p.none) return `Photo: ${esc(p.artist)}${p.license ? ' · ' + esc(p.license) : ''}${p.own ? '' : ` · <a href="${esc(p.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`}`;
      return looking ? 'Looking for a photo on Wikimedia…' : 'No photo found for this name on Wikimedia. You can add your own.';
    };
    let showing = null;   // the species the sheet is open for
    function openSheet(name, kind, state = {}) {
      showing = name;
      const e = list.find(x => x.name === name) || missing.find(x => x.name === name) || { name };
      const o = own[name] || null, p = photos[name] || cached(name);
      const hasWiki = !!(p && !p.none);
      // a tile opened before it scrolled into view has not been looked up yet: do it now and redraw the sheet when it lands
      const looking = !o && !p;
      if (looking) request(name).then(r => {
        if (r) { photos[name] = r; for (const el of document.querySelectorAll('.tile')) if (el.dataset.name === name && !own[name]) applyPhoto(el, r.thumb, 'wiki'); }
        if (r !== undefined && showing === name && sheet.open && !sheet.querySelector('.ownEdit')) openSheet(name, kind, { msg: $('shareMsg') ? $('shareMsg').textContent : '' });
      });
      const src = state.pending || ownSrc(o) || (hasWiki ? (p.image || p.thumb) : '');
      const n = kind === 'seen' && L ? rank(L, name) : null;
      const hint = hintOf(name);
      const editing = !!state.pending;
      sheet.innerHTML = `
        <div class="pic">${src ? `<img src="${esc(src)}" alt="${esc(name)}">` : `<span class="nm">${esc(name)}</span>`}</div>
        <div class="body">
          <h2 id="sheetName">${esc(name)}</h2>
          <p class="meta seen">${kind === 'unseen' ? (e.around ? 'Not on your list yet, and reported near you this week.' : 'Not on your list yet.')
            : (e.first || e.loc) ? `First seen ${[esc(e.loc), e.first ? esc(fmtLong(e.first)) : ''].filter(Boolean).join(' · ')}${n ? ` · bird #${n} of ${total}` : ''}` : 'On your list. First-seen date not in this import.'}</p>
          ${hint ? `<p class="hint">${esc(cap(hint))}.</p>` : ''}
          <p class="credit">${editing ? 'Your picture, not saved yet.' : creditOf(o, p, looking)}</p>
          ${editing ? `
          <div class="ownEdit">
            <div class="seg" role="group" aria-label="Photo or drawing">
              <button type="button" data-kind="photo" aria-pressed="${state.kind !== 'art'}">Photo</button>
              <button type="button" data-kind="art" aria-pressed="${state.kind === 'art'}">Drawing</button>
            </div>
            <input id="ownCaption" maxlength="120" placeholder="Where or how you got it" value="${esc(state.caption || '')}" aria-label="Caption">
            <div class="acts"><button type="button" id="ownSave">Save</button><button type="button" class="ghost" id="ownCancel">Cancel</button></div>
          </div>` : `
          <div class="acts">
            ${kind === 'seen' ? '<button type="button" id="shareBird">Share</button>' : ''}
            <a class="btn ghost" href="${esc(hasWiki && p.wiki ? p.wiki : 'https://en.wikipedia.org/wiki/' + encodeURIComponent(titleOf(name)))}" target="_blank" rel="noopener">Wikipedia</a>
            ${db && db.setBirdImage ? `<button type="button" class="ghost" id="ownPick">${o ? 'Replace' : 'Use my photo'}</button>${o ? '<button type="button" class="ghost" id="ownRemove">Remove</button>' : ''}` : ''}
            <button type="button" class="ghost" id="closeSheet">Close</button>
          </div>`}
          <input type="file" id="ownFile" accept="image/*" class="hidden" aria-hidden="true" tabindex="-1">
          <p class="meta" id="shareMsg" role="status" aria-live="polite">${esc(state.msg || '')}</p>
        </div>`;
      const say = (t) => { $('shareMsg').textContent = t; };
      const pi = sheet.querySelector('.pic img');   // a picture that fails to load gives way to the name, never a broken image
      if (pi) pi.onerror = () => { const s = document.createElement('span'); s.className = 'nm'; s.textContent = name; pi.replaceWith(s); };
      const close = $('closeSheet'); if (close) close.onclick = () => sheet.close();
      const sb = $('shareBird');
      if (sb) sb.onclick = async () => {
        sb.disabled = true; say('Drawing…');
        try {
          const image = ownSrc(o) || (hasWiki ? (p.image || p.thumb) : null);
          const credit = o ? `${o.kind === 'art' ? 'Drawing' : 'Photo'}: ${whoami()}${o.caption ? ' · ' + o.caption : ''}`
            : hasWiki ? ['Photo: ' + (p.artist || 'Wikimedia Commons'), p.license].filter(Boolean).join(' · ') + (p.own ? '' : ' · Wikimedia Commons') : '';
          const r = await share({ name, first: e.first, loc: e.loc, n, total, image, credit, site }, { navigator });
          say(({ shared: 'Shared.', downloaded: 'Saved a picture of this bird. Post it anywhere.', cancelled: '' })[r.how] + (r.how !== 'cancelled' && !r.photo && image ? ' The photo could not be copied into it, so the picture is text only.' : ''));
        } catch (err) { say("Couldn't make the picture: " + err.message); }
        sb.disabled = false;
      };
      // own image: pick → preview + kind + caption → save; replace; remove
      const pick = $('ownPick'), file = $('ownFile');
      if (pick) pick.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files && file.files[0]; if (!f) return;
        say('Reading the picture…');
        try { const data = await db.fileToDataURL(f, 1400); openSheet(name, kind, { pending: data, kind: (o && o.kind) || 'photo', caption: (o && o.caption) || '' }); }
        catch { say('That file is not an image this browser can read.'); }
      };
      if (editing) {
        let k = state.kind === 'art' ? 'art' : 'photo';
        for (const b of sheet.querySelectorAll('.ownEdit .seg button')) b.onclick = () => { k = b.dataset.kind; sheet.querySelectorAll('.ownEdit .seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
        $('ownCancel').onclick = () => openSheet(name, kind);
        $('ownSave').onclick = async () => {
          $('ownSave').disabled = true; say('Saving…');
          const r = await db.setBirdImage(name, { data: state.pending, kind: k, caption: $('ownCaption').value });
          if (!r.ok) { $('ownSave').disabled = false; say(r.message); return; }
          own[name] = r.image; refreshTile(name);
          openSheet(name, kind, { msg: 'Saved.' });
        };
      }
      const rm = $('ownRemove');
      if (rm) rm.onclick = async () => {
        rm.disabled = true; say('Removing…');
        try { await db.removeBirdImage(name); } catch {}
        delete own[name]; refreshTile(name);
        openSheet(name, kind, { msg: 'Removed. The Wikimedia photo is back when there is one.' });
      };
      if (typeof sheet.showModal === 'function') { if (!sheet.open) sheet.showModal(); } else sheet.setAttribute('open', '');
    }
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet) sheet.close(); });   // tap the backdrop to close
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('.tile'); if (!t) return;
      openSheet(t.dataset.name, t.classList.contains('unseen') ? 'unseen' : 'seen');
    });
    return { list, missing, photos, own, openSheet, renderWall, refreshTile, get sortBy() { return sortBy; } };
  }

  return {
    W, H, MAX_INFLIGHT, CACHE_KEY, TTL_DAYS,
    photos: { lookup, cached, request, cancel, fileName, thumbAt, sentence, stripHtml, clearCache, ownArt },
    entries, order, sections, rank, unseen, hintOf, fmtMonth, fmtLong, drawSlide, slideBlob, share, mount,
  };
})();
globalThis.DAYBIRD_LIFELIST = DAYBIRD_LIFELIST;   // also reachable from Node for the unit checks in tests/
