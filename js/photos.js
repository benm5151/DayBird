/* Daybird photos: one free-licensed Wikimedia photo per species, for the front door's "This week's birds".
   Loaded after js/app.js. No DOM of its own; the page asks for a picture and draws it.

   DAYBIRD_PHOTOS = { get(name) → Promise<{thumb, image, artist, license, page, wiki, title} | null>,
                      observe(el, name, cb), cached(name), sentence, stripHtml, fileName, thumbAt, clearCache }

   Wikipedia's page summary (en.wikipedia.org/api/rest_v1/page/summary/<Title>; the eBird name as typed, then in
   Wikipedia's sentence case) gives the thumbnail and file name; the Commons API gives the photographer and license
   (HTML, stripped with an inert DOMParser). At most MAX_INFLIGHT lookups run at once. Results and misses are cached
   in localStorage 'daybird:photos' for 30 days with the record shape js/lifelist.js uses ({ thumb, image, artist,
   license, page, wiki, title, at } or { none: true, at }), so the two pages share one cache. Every failure is silent:
   a species with no picture resolves to null and the page keeps the name on paper. */
globalThis.DAYBIRD_PHOTOS = (() => {
  const CACHE_KEY = 'daybird:photos', TTL_DAYS = 30, MAX_INFLIGHT = 4;
  const SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&origin=*&titles=';

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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all())); } catch { /* full or blocked: the memory copy serves this visit */ }
  }
  function clearCache() { mem = {}; try { localStorage.removeItem(CACHE_KEY); } catch {} }

  // ---------------------------------------------------------------- Wikimedia lookups
  const titleOf = (name) => String(name || '').trim().replace(/\s+/g, '_');
  const sentence = (name) => { const [a, ...r] = String(name || '').trim().split(' '); return [a, ...r.map((w) => w.toLowerCase())].join(' '); };
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
  // Artist fields on Commons are HTML. A DOMParser document is inert: nothing in it loads or runs.
  function stripHtml(h) {
    const s = String(h || '');
    try { return new DOMParser().parseFromString(s, 'text/html').body.textContent.replace(/\s+/g, ' ').trim(); }
    catch { return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
  }
  async function summary(name) {
    for (const t of [...new Set([String(name).trim(), sentence(name)])]) {
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
  async function lookup(name) {
    const hit = cached(name); if (hit) return hit.none ? null : hit;
    const s = await summary(name);
    if (!s) { remember(name, { none: true }); return null; }
    const thumb = s.thumbnail.source, orig = s.originalimage || {};
    const w = +orig.width || 0;
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
  function get(name) {
    name = String(name || '').trim();
    if (!name) return Promise.resolve(null);
    const hit = cached(name); if (hit) return Promise.resolve(hit.none ? null : hit);
    return new Promise((res) => {
      (waiters[name] = waiters[name] || []).push(res);
      if (!pending.has(name)) { pending.add(name); queue.push(name); pump(); }
    });
  }
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const name = queue.shift(); inflight++;
      lookup(name).catch(() => null).then((e) => {
        inflight--; pending.delete(name);
        (waiters[name] || []).forEach((f) => f(e)); delete waiters[name];
        pump();
      });
    }
  }

  // ---------------------------------------------------------------- lazy loading: look a species up when its row scrolls near
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const job = jobs.get(en.target); if (!job) continue;
      io.unobserve(en.target); jobs.delete(en.target);
      get(job.name).then(job.cb);
    }
  }, { rootMargin: '240px 0px' }) : null;
  const jobs = new Map();
  function observe(el, name, cb) {
    if (!el) return get(name).then(cb);
    const hit = cached(name);
    if (hit) return Promise.resolve(cb(hit.none ? null : hit));
    if (!io) return get(name).then(cb);
    jobs.set(el, { name, cb }); io.observe(el);
  }

  return { get, observe, cached, sentence, stripHtml, fileName, thumbAt, clearCache, MAX_INFLIGHT };
})();
