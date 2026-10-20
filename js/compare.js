/* Daybird "Which sparrow is that?" (compare.html), plus two helpers that bird.html and marks.html reuse.
   Loaded after data/tells.js, data/status.js, js/app.js and js/footer.js.

   DAYBIRD_COMPARE = {
     photos:   { request(name) → Promise<record|null>, cached(name), lookup(name), creditHtml(rec), sentence, titleOf, CACHE_KEY }
               A small private copy of the Wikimedia fetcher in js/lifelist.js with the same contract, so the two pages
               share one cache: localStorage 'daybird:photos', records { thumb, image, artist, license, page, wiki, title, at }
               (misses are { none: true, at }), 30-day TTL, at most 4 lookups in flight. Wikipedia's REST summary gives the
               thumbnail (name as typed, then sentence case after the first word); the Commons API gives artist and license.
               Every failure is silent and cached as a miss.
     expected: () → Promise<{ code, name, from, to, checklists, freq(name), n(name), window } | null>
               Feature-detects data/regions.json (bounding boxes) and data/expected/<code>.json for the set location in
               DB.settings(). Neither file is in this branch; see README for the shapes it accepts. null when absent.
     order:    (group, ex, date) → the group's species ordered for this week, each with { ...species, chip, freq }
     mount:    () builds compare.html when #compare exists
   } */
globalThis.DAYBIRD_COMPARE = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = () => globalThis.DAYBIRD_TELLS || [];
  const S = () => globalThis.DAYBIRD_STATUS || null;

  // ================================================================ photos (same contract as js/lifelist.js)
  const photos = (() => {
    const CACHE_KEY = 'daybird:photos', TTL_DAYS = 30, MAX_INFLIGHT = 4;
    const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
    const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&origin=*&titles=';
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
      // re-read first so we do not clobber what another page cached in the meantime
      try { const disk = JSON.parse(localStorage.getItem(CACHE_KEY)); if (disk && typeof disk === 'object' && !Array.isArray(disk)) mem = Object.assign(disk, mem); } catch {}
      all()[name] = { ...e, at: today() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(all())); } catch { /* full or blocked: the memory copy still serves this visit */ }
    }
    const titleOf = (name) => String(name || '').trim().replace(/\s+/g, '_');
    const sentence = (name) => { const [a, ...r] = String(name || '').trim().split(' '); return [a, ...r.map(w => w.toLowerCase())].join(' '); };
    async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json(); }
    function fileName(url) {
      let last = String(url || '').split('?')[0].split('#')[0].split('/').pop() || '';
      try { last = decodeURIComponent(last); } catch {}
      last = last.replace(/^(lossy|lossless)-page\d+-/, '').replace(/^\d+px-/, '');
      if (/\.(svg|tiff?|pdf|webm|ogv)\.(png|jpe?g)$/i.test(last)) last = last.replace(/\.(png|jpe?g)$/i, '');
      return last;
    }
    const thumbAt = (url, w) => String(url || '').replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
    const isThumb = (url) => /\/thumb\/.*\/\d+px-[^/]+$/.test(String(url || ''));
    function stripHtml(h) {
      const s = String(h || '');
      try { return new DOMParser().parseFromString(s, 'text/html').body.textContent.replace(/\s+/g, ' ').trim(); }
      catch { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
    }
    async function summary(name) {
      for (const t of [...new Set([String(name).trim(), sentence(name)])]) {
        try { const j = await getJSON(SUMMARY + encodeURIComponent(titleOf(t))); if (j && j.type !== 'disambiguation' && j.thumbnail && j.thumbnail.source) return j; }
        catch { /* try the next spelling */ }
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
    async function lookup(name) {
      const hit = cached(name); if (hit) return hit.none ? null : hit;
      const s = await summary(name);
      if (!s) { remember(name, { none: true }); return null; }
      const thumb = s.thumbnail.source, orig = s.originalimage || {}, w = +orig.width || 0;
      const tile = isThumb(thumb) && (!w || w >= 400) ? thumbAt(thumb, 400) : thumb;
      const image = orig.source && w && w <= 1400 ? orig.source : (isThumb(thumb) && (!w || w >= 1000) ? thumbAt(thumb, 1000) : (orig.source || thumb));
      const file = fileName(orig.source || thumb);
      const c = await credit(file);
      const e = { thumb: tile, image, artist: c.artist, license: c.license,
        page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file).replace(/%20/g, '_'),
        wiki: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent((s.titles && s.titles.canonical) || titleOf(name))),
        title: (s.titles && s.titles.normalized) || String(name) };
      remember(name, e);
      return e;
    }
    const queue = [], pending = new Set(), waiters = {}; let inflight = 0;
    function request(name) {
      return new Promise(res => { (waiters[name] = waiters[name] || []).push(res); if (!pending.has(name)) { pending.add(name); queue.push(name); pump(); } });
    }
    function pump() {
      while (inflight < MAX_INFLIGHT && queue.length) {
        const name = queue.shift(); inflight++;
        lookup(name).catch(() => null).then(e => { inflight--; pending.delete(name); (waiters[name] || []).forEach(f => f(e)); delete waiters[name]; pump(); });
      }
    }
    // "Photo: Rhododendrites · CC BY-SA 4.0 · Wikimedia Commons", the artist linking to the file page
    const creditHtml = (p) => p ? `Photo: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.artist || 'see Commons')}</a>${p.license ? ' · ' + esc(p.license) : ''} · Wikimedia Commons` : '';
    return { request, cached, lookup, creditHtml, sentence, titleOf, fileName, CACHE_KEY };
  })();

  // ================================================================ expected frequencies (feature-detected)
  // data/regions.json: [{ code, name, bbox }] where bbox is [west, south, east, north] (GeoJSON order) or an object with
  // south/west/north/east (or s/w/n/e, or minLat/minLng/maxLat/maxLng). data/expected/<code>.json: { name, from, to,
  // checklists, species: { "<eBird name>": 0.68 | { freq, n } } } (species may also be an array of { name, freq, n }).
  async function getJSONorNull(url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
  }
  function box(b) {
    if (!b) return null;
    if (Array.isArray(b) && b.length >= 4) return { w: +b[0], s: +b[1], e: +b[2], n: +b[3] };
    const k = (o, ...ks) => { for (const x of ks) if (o[x] != null) return +o[x]; return NaN; };
    const o = { s: k(b, 's', 'south', 'minLat', 'lat0'), w: k(b, 'w', 'west', 'minLng', 'minLon', 'lng0'), n: k(b, 'n', 'north', 'maxLat', 'lat1'), e: k(b, 'e', 'east', 'maxLng', 'maxLon', 'lng1') };
    if (Array.isArray(b.lat) && Array.isArray(b.lng)) { o.s = +b.lat[0]; o.n = +b.lat[1]; o.w = +b.lng[0]; o.e = +b.lng[1]; }
    return [o.s, o.w, o.n, o.e].every(Number.isFinite) ? o : null;
  }
  const inBox = (b, lat, lng) => !!b && lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e;
  function regionList(j) {
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.regions)) return j.regions;
    if (j && typeof j === 'object') return Object.entries(j).map(([code, r]) => ({ code, ...(r || {}) }));
    return [];
  }
  const fmtDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? { mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1], day: +m[3] } : null; };
  function windowLabel(from, to) {
    const a = fmtDay(from), b = fmtDay(to);
    if (a && b) return a.mon === b.mon ? `${a.mon} ${a.day}–${b.day}` : `${a.mon} ${a.day}–${b.mon} ${b.day}`;
    if (a) return `from ${a.mon} ${a.day}`;
    return '';
  }
  function normalize(ex, region, code) {
    const map = {};
    const put = (name, v) => {
      if (!name) return;
      const o = (v && typeof v === 'object') ? v : { freq: v };
      let f = +(o.freq ?? o.frequency ?? o.pct ?? o.rate ?? o.share ?? NaN);
      if (Number.isFinite(f) && f > 1) f = f / 100;
      map[String(name)] = { freq: Number.isFinite(f) ? f : null, n: +(o.n ?? o.count ?? o.checklists ?? NaN) || null };
    };
    const sp = ex.species || ex.expected || ex.birds || {};
    if (Array.isArray(sp)) sp.forEach(r => r && put(r.name || r.comName || r.species, r));
    else if (sp && typeof sp === 'object') Object.entries(sp).forEach(([k, v]) => put(k, v));
    const win = ex.window && typeof ex.window === 'object' ? ex.window : {};
    const from = ex.from || ex.start || win.from || win.start || '', to = ex.to || ex.end || win.to || win.end || '';
    return {
      code, name: ex.name || ex.region || (region && region.name) || code,
      from, to, window: windowLabel(from, to) || (typeof ex.period === 'string' ? ex.period : ''),
      checklists: +(ex.checklists ?? ex.n ?? ex.total ?? ex.lists ?? NaN) || null,
      freq: (name) => (map[name] && map[name].freq != null) ? map[name].freq : null,
      n: (name) => (map[name] && map[name].n) || null,
      has: (name) => !!map[name],
    };
  }
  let exPromise = null;
  function expected(settings) {
    if (exPromise) return exPromise;
    exPromise = (async () => {
      // DB is a top-level const in js/app.js (not on globalThis), so test for it by name
      const s = settings || (typeof DB !== 'undefined' && DB && typeof DB.settings === 'function' ? DB.settings() : {}) || {};
      const lat = +s.lat, lng = +s.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const regions = regionList(await getJSONorNull('data/regions.json'));
      const r = regions.find(x => x && inBox(box(x.bbox || x.box || x.bounds || x), lat, lng));
      const code = r && (r.code || r.id || r.region);
      if (!code) return null;
      const ex = await getJSONorNull(`data/expected/${encodeURIComponent(String(code))}.json`);
      return ex && typeof ex === 'object' ? normalize(ex, r, String(code)) : null;
    })().catch(() => null);
    return exPromise;
  }
  // "On 68% of 41 checklists in Grafton County, Oct 10–20" for one species, or '' when the data is not there
  function countLine(ex, name) {
    if (!ex || !ex.has(name)) return '';
    const f = ex.freq(name); if (f == null) return '';
    const pct = Math.round(f * 100);
    const lists = ex.checklists ? ` of ${ex.checklists} checklist${ex.checklists === 1 ? '' : 's'}` : ' of checklists';
    return `On ${pct}%${lists} in ${ex.name}${ex.window ? ', ' + ex.window : ''}`;
  }

  // ================================================================ ordering for this week
  const LIKELY = 0.15, POSSIBLE = 0.03;
  // With expected data: most-reported first, with "likely this week" / "possible this week" chips. Without it: the
  // species data/status.js says are here this month first (tells order inside), absent ones last with a soft chip.
  function order(group, ex, date) {
    const st = S(), d = date ? new Date(date) : new Date();
    const list = group.species.map((sp, i) => {
      const f = ex ? ex.freq(sp.name) : null;
      const now = st ? st.now(sp.name, d) : null;
      let chip = null, kind = null;
      if (ex) {
        if (f != null && f >= LIKELY) { chip = 'likely this week'; kind = 'likely'; }
        else if (f != null && f >= POSSIBLE) { chip = 'possible this week'; kind = 'possible'; }
      } else if (now && !now.present) { chip = now.word; kind = 'soft'; }
      return { ...sp, i, freq: f, chip, kind, status: now };
    });
    if (ex) return list.sort((a, b) => ((b.freq ?? -1) - (a.freq ?? -1)) || a.i - b.i);
    return list.sort((a, b) => ((b.status && b.status.present !== false ? 1 : 0) - (a.status && a.status.present !== false ? 1 : 0)) || a.i - b.i);
  }

  // ================================================================ the page
  const GROUP_KEY = 'daybird:compareGroup';
  const $ = (id) => document.getElementById(id);
  const birdHref = (name) => `bird.html?name=${encodeURIComponent(name)}`;

  // put a photo into a .pic box: paper name until it loads, never a broken image
  function placePhoto(pic, p, alt) {
    if (!p || !p.thumb) return;
    const img = new Image();
    img.alt = alt || ''; img.decoding = 'async';
    img.onload = () => { pic.classList.add('has-photo'); };
    img.onerror = () => { img.remove(); pic.classList.remove('has-photo'); };
    img.src = p.thumb;
    pic.insertBefore(img, pic.firstChild);
    const c = pic.querySelector('.credit'); if (c) c.innerHTML = photos.creditHtml(p);
  }

  function mount() {
    const root = $('compare'); if (!root) return;
    const groups = T(); if (!groups.length) { root.innerHTML = '<p class="meta">No groups yet.</p>'; return; }
    const url = new URL(location.href);
    let saved = null; try { saved = localStorage.getItem(GROUP_KEY); } catch {}
    const want = url.searchParams.get('g') || saved;
    const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();   // ?at=2026-10-20 fixes "this month" (tests)
    const today = Number.isNaN(at.getTime()) ? new Date() : at;
    let g = groups.find(x => x.key === want) || groups[0];
    let ex = null, ordered = [], quizOn = false;
    const photoOf = {};   // name → record (loaded this visit)

    // chips
    $('chips').innerHTML = groups.map(x => `<button type="button" role="tab" data-g="${esc(x.key)}" aria-pressed="${x.key === g.key}">${esc(x.title)}</button>`).join('');
    $('chips').addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (!b) return; const n = groups.find(x => x.key === b.dataset.g); if (n) choose(n); });

    function choose(next) {
      g = next;
      try { localStorage.setItem(GROUP_KEY, g.key); } catch {}
      const u = new URL(location.href); u.searchParams.set('g', g.key); history.replaceState(null, '', u);
      [...$('chips').querySelectorAll('button')].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.g === g.key)));
      const chip = $('chips').querySelector(`button[data-g="${g.key}"]`); if (chip && chip.scrollIntoView) { try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch {} }
      $('title').textContent = `Which ${g.one || g.title.toLowerCase()} is that?`;
      document.title = `Daybird — Which ${g.one || g.title.toLowerCase()} is that?`;
      $('intro').textContent = g.intro || '';
      if (quizOn) closeQuiz();
      renderCards();
    }

    function whereLine() {
      if (ex) return `Ordered by how often each was reported in ${ex.name}${ex.window ? ', ' + ex.window : ''}. Sightings via eBird.`;
      const s = S(); const m = today.toLocaleDateString(undefined, { month: 'long' });
      return s ? `No local counts for your spot yet, so this is the usual order for ${m}; birds that are normally away are last.` : '';
    }

    function renderCards() {
      ordered = order(g, ex, today);
      $('where').textContent = whereLine();
      const rail = $('rail');
      rail.innerHTML = ordered.map((sp, i) => {
        const prev = ordered[(i - 1 + ordered.length) % ordered.length], next = ordered[(i + 1) % ordered.length];
        // neighbours first (the cards you can see), then the rest in order
        const others = [...new Set([prev, next, ...ordered].filter(o => o.name !== sp.name))];
        const line = (o) => sp.vs && sp.vs[o.name] ? `<div><b>${esc(o.name)}</b>${esc(sp.vs[o.name])}</div>` : '';
        // the two neighbours stay in view; the rest fold away so the card stays a card
        const shown = others.slice(0, 2), folded = others.slice(2);
        const vs = shown.map(line).join('') + (folded.length ? `<details class="morevs"><summary>vs the other ${folded.length === 1 ? esc(folded[0].name) : folded.length + ' ' + esc(g.title.toLowerCase())}</summary><div class="fold">${folded.map(line).join('')}</div></details>` : '');
        return `<article class="ccard" data-name="${esc(sp.name)}" data-i="${i}" aria-label="${esc(sp.name)}">
          <div class="pic"><span class="paper">${esc(sp.name)}</span>${sp.chip ? `<span class="when ${sp.kind || ''}">${esc(sp.chip)}</span>` : ''}<span class="credit"></span></div>
          <div class="body">
            <h2><a href="${birdHref(sp.name)}">${esc(sp.name)}</a></h2>
            <p class="look">${esc(sp.look)}</p>
            <div class="vs">${vs}</div>
          </div></article>`;
      }).join('');
      $('dots').innerHTML = ordered.map((sp, i) => `<button type="button" data-i="${i}" aria-label="${esc(sp.name)}" aria-current="${i === 0}"></button>`).join('');
      rail.scrollLeft = 0;
      updateArrows();
      // photos: cached ones at once, the rest as they arrive (≤4 at a time)
      for (const sp of ordered) {
        const pic = rail.querySelector(`.ccard[data-name="${CSS.escape(sp.name)}"] .pic`);
        const hit = photos.cached(sp.name);
        if (hit && !hit.none) { photoOf[sp.name] = hit; placePhoto(pic, hit, sp.name); continue; }
        if (hit && hit.none) continue;
        photos.request(sp.name).then(p => { if (p) { photoOf[sp.name] = p; if (pic.isConnected) placePhoto(pic, p, sp.name); } });
      }
    }

    // carousel chrome: which card is in view, arrows, dots
    const rail = $('rail');
    const cards = () => [...rail.querySelectorAll('.ccard')];
    // where each card snaps to (phone: centered; wider: at the start), so "current" is the card the rail has settled on
    const snapLeft = (c) => innerWidth >= 700 ? c.offsetLeft - (parseFloat(getComputedStyle(rail).paddingLeft) || 0) : c.offsetLeft - (rail.clientWidth - c.offsetWidth) / 2;
    function current() {
      const cs = cards(); if (!cs.length) return 0;
      let best = 0, d = Infinity;
      cs.forEach((c, i) => { const dd = Math.abs(snapLeft(c) - rail.scrollLeft); if (dd < d) { d = dd; best = i; } });
      return best;
    }
    function updateArrows() {
      const i = current(), n = cards().length;
      [...$('dots').querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
      $('prev').disabled = rail.scrollLeft <= 2;
      $('next').disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2 || n <= 1;
    }
    // phone: the card snaps to the center (neighbours peek in at both edges); wider: it snaps to the start
    function goTo(i) {
      const cs = cards(); if (!cs.length) return;
      const c = cs[Math.max(0, Math.min(cs.length - 1, i))];
      rail.scrollTo({ left: Math.max(0, snapLeft(c)), behavior: 'smooth' });
    }
    let t = null; rail.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(updateArrows, 60); }, { passive: true });
    addEventListener('resize', updateArrows);
    $('prev').onclick = () => goTo(current() - 1);
    $('next').onclick = () => goTo(current() + 1);
    $('dots').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) goTo(+b.dataset.i); });
    rail.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current() + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - 1); } });
    rail.tabIndex = 0;

    // ---------------------------------------------------------------- quiz: one photo, three names
    let q = { right: 0, asked: 0, answer: null, seen: [] };
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    function withPhotos() { return ordered.filter(sp => photoOf[sp.name] && photoOf[sp.name].thumb); }
    function openQuiz() {
      quizOn = true; q = { right: 0, asked: 0, answer: null, seen: [] };
      $('deck').hidden = true; $('dots').hidden = true; $('quiz').hidden = false; $('quizBtn').textContent = 'Back to the cards';
      ask();
    }
    function closeQuiz() {
      quizOn = false; $('deck').hidden = false; $('dots').hidden = false; $('quiz').hidden = true; $('quizBtn').textContent = 'Quiz me';
      $('quiz').innerHTML = ''; $('quiz').removeAttribute('data-answer');
    }
    function ask() {
      const pool = withPhotos();
      if (pool.length < 2) {
        $('quiz').innerHTML = `<div class="qbody"><p class="qask">Photos are still loading.</p><p class="meta">The quiz needs at least two photos in this group. Give it a moment, or try another group.</p>
          <div class="qacts"><button type="button" class="ghost small" id="qRetry">Try again</button><button type="button" class="ghost small" id="qBack">Back to the cards</button></div></div>`;
        $('qRetry').onclick = ask; $('qBack').onclick = closeQuiz; return;
      }
      // avoid repeating until every photo has been shown once
      let fresh = pool.filter(sp => !q.seen.includes(sp.name)); if (!fresh.length) { q.seen = []; fresh = pool; }
      const sp = fresh[Math.floor(Math.random() * fresh.length)]; q.seen.push(sp.name); q.answer = sp.name;
      const others = shuffle(ordered.filter(o => o.name !== sp.name).map(o => o.name)).slice(0, 2);
      const opts = shuffle([sp.name, ...others]);
      const p = photoOf[sp.name];
      $('quiz').dataset.answer = sp.name;
      $('quiz').innerHTML = `
        <div class="qpic"><img src="${esc(p.thumb)}" alt="A mystery ${esc(g.one || 'bird')}"><span class="credit">${photos.creditHtml(p)}</span></div>
        <div class="qbody">
          <p class="qask">Which ${esc(g.one || 'bird')} is this?</p>
          <div class="qopts">${opts.map(n => `<button type="button" data-pick="${esc(n)}">${esc(n)}</button>`).join('')}</div>
          <p class="qmsg" role="status" aria-live="polite"></p>
          <div class="qacts"><button type="button" class="ghost small" id="qNext" hidden>Next one</button><button type="button" class="ghost small" id="qBack">Back to the cards</button><span class="meta qscore">${q.asked ? `${q.right} of ${q.asked} right` : ''}</span></div>
        </div>`;
      $('qBack').onclick = closeQuiz; $('qNext').onclick = ask;
      $('quiz').querySelector('.qopts').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-pick]'); if (!b || b.disabled) return;
        q.asked++;
        const pick = b.dataset.pick, ok = pick === sp.name; if (ok) q.right++;
        [...$('quiz').querySelectorAll('.qopts button')].forEach(x => { x.disabled = true; if (x.dataset.pick === sp.name) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); });
        // right: the bird's own tell; wrong: how to split the one you picked from the one it was
        const tell = ok ? sp.look : (sp.vs && sp.vs[pick]) || sp.look;
        $('quiz').querySelector('.qmsg').innerHTML = (ok ? `<b>Right.</b> ` : `<b>Not that one.</b> It's the ${esc(sp.name)}. `) + esc(tell);
        $('quiz').querySelector('.qscore').textContent = `${q.right} of ${q.asked} right`;
        $('qNext').hidden = false; $('qNext').focus();
      });
    }
    $('quizBtn').onclick = () => quizOn ? closeQuiz() : openQuiz();

    // first paint without waiting on the network; re-order once the local counts (if any) arrive
    choose(g);
    expected().then(e => { if (e) { ex = e; renderCards(); } }).catch(() => {});
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  }
  return { photos, expected, countLine, order, mount, esc, birdHref, LIKELY, POSSIBLE, _box: box, _normalize: normalize, _windowLabel: windowLabel };
})();
