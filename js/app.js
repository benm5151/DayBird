/* Daybird prototype — shared data layer.
   Everything is client-side. Settings and bookings live in localStorage.
   Live data: eBird API v2 (needs your key, stored only in this browser) + Open-Meteo (no key).
   Fallback: data/mock.json so the app works with no key and no network. */

const DB = (() => {
  const KEY = 'daybird:';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
  };

  const DEFAULTS = {
    name: 'Ben',
    lat: 43.6423, lng: -72.2518, dist: 25, back: 3,   // Lebanon, NH; km; days
    ebirdKey: '',
    ebirdName: '',           // your eBird display name, exactly as it appears on your checklists
    ebirdRegions: 'US-NH,US-VT',
    migration: 0,            // 0 = unknown, 1..5 from BirdCast local dashboard
    mode: 'any',             // where you'll be: any | porch | woods | water | commute | campus (see js/brief.js)
    level: 'new',            // new | some | keen — how much jargon and how many ID tips the brief uses
    placeLabel: 'Lebanon, New Hampshire',
    birdcastUrl: 'https://dashboard.birdcast.info/region/US-NH-009', // Grafton County
  };
  const settings = () => Object.assign({}, DEFAULTS, store.get('settings', {}));
  const saveSettings = (s) => store.set('settings', s);

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return m + 'm'; const h = Math.round(m / 60); if (h < 24) return h + 'h';
    return Math.round(h / 24) + 'd';
  };
  async function getJSON(url, headers = {}) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }

  // ---------- live sources ----------
  async function ebird(path, s) {
    return getJSON('https://api.ebird.org/v2' + path, { 'X-eBirdApiToken': s.ebirdKey });
  }
  async function liveSightings(s) {
    const q = `lat=${s.lat}&lng=${s.lng}&dist=${s.dist}&back=${s.back}`;
    const [notable, recent, hotspots] = await Promise.all([
      ebird(`/data/obs/geo/recent/notable?${q}&detail=simple`, s),
      ebird(`/data/obs/geo/recent?${q}`, s),
      ebird(`/ref/hotspot/geo?lat=${s.lat}&lng=${s.lng}&dist=${s.dist}&back=${s.back}&fmt=json`, s),
    ]);
    return { notable, recent, hotspots };
  }
  const B = globalThis.DAYBIRD_BRIEF;
  async function weather(s) {
    // The engine owns the URL and the parsing; the site only fetches. forceToday: the page is always "this morning".
    return B.parseWeather(await getJSON(B.weatherUrl(s.lat, s.lng)), { forceToday: true });
  }

  // ---------- the call (scoring lives in js/brief.js) ----------
  const dirName = B.dirName;
  function makeCall(wx, mig, notableCount) {
    const c = B.score({ wx, month: new Date().getMonth() + 1, notableCount, migration: mig });
    return { score: c.score, grade: c.grade, word: c.word, why: B.whyTags(c, notableCount) };
  }

  // ---------- public API ----------
  async function loadBrief() {
    const s = settings();
    let source = 'mock', sightings, wx, tomorrow = null, errors = [];
    try { const w = await weather(s); wx = w.wx; tomorrow = w.tomorrow; } catch (e) { errors.push('weather: ' + e.message); }
    if (s.ebirdKey) {
      try { sightings = await liveSightings(s); source = 'live'; }
      catch (e) { errors.push('eBird: ' + e.message + ' (CORS or key problem — see README)'); }
    }
    if (!sightings || !wx) {
      // prefer the brief the GitHub Action committed this morning over the static sample
      let live = null; try { const r = await fetch('data/brief.json', { cache: 'no-store' }); if (r.ok) live = await r.json(); } catch {}
      if (live && live.wx && !wx) { wx = live.wx; tomorrow = live.tomorrow || null; errors = errors.filter(e => !e.startsWith('weather')); }
      if (live && !sightings && (live.spots || []).length) {
        sightings = { notable: live.notable || [], recent: [] };
        sightings._spots = live.spots;
        sightings._recent = live.recent || (live.lookFor || []).flatMap(g => g.species || []);
        if (!s.ebirdKey) { errors.push(`Showing this morning's brief built at ${new Date(live.generated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Add your eBird key in Settings for live data.`); source = 'daily'; }
      }
      const mock = window.DAYBIRD_MOCK;
      sightings = sightings || mock.sightings;
      wx = wx || mock.weather;
      if (!s.ebirdKey && source !== 'daily') errors.push('No eBird key saved — showing sample sightings. Add your key in Settings.');
    }
    // group hotspots by activity (eBird gives numSpeciesAllTime; recent list gives locations)
    const byLoc = {};
    (sightings.recent || []).forEach(o => { const k = o.locId || o.locName; byLoc[k] = byLoc[k] || { name: o.locName, locId: o.locId, species: 0 }; byLoc[k].species++; });
    const spots = sightings._spots || Object.values(byLoc).sort((a, b) => b.species - a.species).slice(0, 5);
    const notable = (sightings.notable || []).slice(0, 8);
    const call = makeCall(wx, s.migration, notable.length);
    const recentNames = sightings._recent || [...new Set((sightings.recent || []).map(o => o.comName))];
    const brief = B.compose({ place: s.placeLabel || 'your area', date: new Date().toISOString().slice(0, 10), whenLabel: 'this morning', wx, tomorrow, notable, spots, recent: recentNames,
      migration: s.migration, mode: s.mode, level: s.level, traits: globalThis.DAYBIRD_TRAITS });
    // call history: one entry per day, kept 60 days, with optional "was it right?" verdict
    const today = new Date().toISOString().slice(0, 10);
    const hist = store.get('calls', []).filter(h => h.date >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10));
    const idx = hist.findIndex(h => h.date === today);
    if (idx < 0) hist.unshift({ date: today, word: call.word, score: call.score, verdict: null });
    store.set('calls', hist);
    return { s, source, wx, spots, notable, call, brief, errors, history: hist, speciesCount: new Set((sightings.recent || []).map(o => o.comName)).size };
  }
  function gradeCall(date, verdict) {
    const h = store.get('calls', []); const e = h.find(x => x.date === date); if (e) e.verdict = verdict; store.set('calls', h); return h;
  }
  function briefText(b) {
    return B.text(b.brief, { site: location.href.split('?')[0] });
  }

  // ---------- place picker (for "email me this brief") ----------
  const US_STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
  // The geocoder matches on the place name only, and "Lebanon" alone returns ten countries and states with
  // New Hampshire last. So split "Lebanon, NH" / "Lebanon NH" / "Lebanon New Hampshire" into a name and a state hint.
  function splitPlaceQuery(q) {
    const clean = q.replace(/\s+/g, ' ').trim();
    const stateOf = (s) => US_STATES[s.toUpperCase()] || Object.values(US_STATES).find(v => v.toLowerCase() === s.toLowerCase()) || '';
    if (clean.includes(',')) {
      const [name, ...rest] = clean.split(',');
      const hint = rest.join(' ').trim();
      return { name: name.trim(), hint: (stateOf(hint) || hint).toLowerCase() };
    }
    const words = clean.split(' ');
    for (const n of [2, 1]) {
      if (words.length > n) { const st = stateOf(words.slice(-n).join(' ')); if (st) return { name: words.slice(0, -n).join(' '), hint: st.toLowerCase() }; }
    }
    return { name: clean, hint: '' };
  }
  async function findPlaces(q) {
    const { name, hint } = splitPlaceQuery(q);
    if (name.length < 2) return [];
    const search = async (n) => ((await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(n)}&count=20&language=en&format=json`)).results || [])
      .map(x => ({ name: x.name, admin1: x.admin1 || '', country: x.country || '', lat: +(+x.latitude).toFixed(4), lng: +(+x.longitude).toFixed(4) }));
    let res = await search(name);
    if (hint) res = res.filter(p => (p.admin1 + ' ' + p.country).toLowerCase().includes(hint));
    if (!res.length && hint) res = await search(q.trim());   // the "state" was really part of the name
    return res.slice(0, 6).map(p => ({ ...p, label: [p.name, p.admin1, p.country === 'United States' ? '' : p.country].filter(Boolean).join(', ') }));
  }
  const DEFAULT_PLACE = { label: 'Lebanon, New Hampshire', lat: DEFAULTS.lat, lng: DEFAULTS.lng };
  function briefPlace() {
    const saved = store.get('briefPlace', null);
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) return saved;
    const s = settings();
    return (s.lat === DEFAULTS.lat && s.lng === DEFAULTS.lng) ? DEFAULT_PLACE : { label: 'Your saved location', lat: s.lat, lng: s.lng };
  }
  const saveBriefPlace = (p) => store.set('briefPlace', { label: p.label, lat: p.lat, lng: p.lng });

  const online = () => CLOUD.ready && !!CLOUD.user();

  async function loadPasses() {
    const base = window.DAYBIRD_PASSES;
    const cloud = online() ? await CLOUD.listListings().catch(() => []) : [];
    const mine = store.get('hostListings', []);
    return [...cloud, ...mine, ...base];
  }
  async function bookings() {
    const local = store.get('bookings', []);
    return online() ? [...await CLOUD.myBookings().catch(() => []), ...local] : local;
  }
  async function book(pass, date, seats) {
    if (online() && pass.cloud) return CLOUD.book(pass.id, date, seats);
    const b = store.get('bookings', []);
    b.unshift({ id: 'b' + Date.now(), passId: pass.id, title: pass.title, date, seats, price: pass.price, at: new Date().toISOString() });
    store.set('bookings', b);
  }
  async function addListing(l) {
    if (online()) return CLOUD.createListing(l);
    const ls = store.get('hostListings', []); ls.unshift(l); store.set('hostListings', ls);
  }

  async function loadFeed(userId = null) {
    if (online()) return CLOUD.listPosts(userId);
    if (userId) return [];
    const seed = window.DAYBIRD_FEED;
    const mine = store.get('posts', []);
    const likes = store.get('likes', {});
    return [...mine, ...seed].map(p => ({ ...p, liked: !!likes[p.id], likes: (p.likes || 0) + (likes[p.id] ? 1 : 0) }));
  }
  async function post(text, tags = [], photo = null) {
    if (online()) return CLOUD.createPost(text, tags, photo);
    const s = settings();
    const p = { id: 'p' + Date.now(), who: s.name || 'You', text, tags, photo, at: new Date().toISOString(), likes: 0, mine: true };
    const ps = store.get('posts', []); ps.unshift(p); store.set('posts', ps); return p;
  }
  async function deletePost(id) {
    if (online()) return CLOUD.deletePost(id);
    store.set('posts', store.get('posts', []).filter(p => p.id !== id));
  }
  async function cancelBooking(b) {
    if (b.cloud) return CLOUD.cancelBooking(b.id);
    store.set('bookings', store.get('bookings', []).filter(x => x.id !== b.id));
  }
  async function toggleLike(id, liked) {
    if (online()) return CLOUD.toggleLike(id, liked);
    const l = store.get('likes', {}); l[id] = !l[id]; store.set('likes', l); return l[id];
  }

  // ---------- photos (resized to keep localStorage small) ----------
  function fileToDataURL(file, max = 1000) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = rej; img.src = url;
    });
  }

  // ---------- life list from eBird export (MyEBirdData.csv) ----------
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift().map(h => h.trim());
    return rows.filter(r => r.length > 3).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  function importLifeList(csvText) {
    const obs = parseCSV(csvText).filter(o => o['Common Name'] && !/\b(sp\.|hybrid|\/)/.test(o['Common Name']) && !/\(Domestic/.test(o['Common Name']));
    const first = {}, counts = {}, places = {};
    obs.forEach(o => {
      const n = o['Common Name'], d = o['Date'];
      counts[n] = (counts[n] || 0) + 1;
      const loc = o['Location']; places[loc] = (places[loc] || 0) + 1;
      if (!first[n] || d < first[n].date) first[n] = { date: d, loc, sci: o['Scientific Name'] };
    });
    const species = Object.keys(first).map(n => ({ name: n, sci: first[n].sci, first: first[n].date, loc: first[n].loc, sightings: counts[n] }));
    const dates = obs.map(o => o['Date']).filter(Boolean).sort();
    const checklists = new Set(obs.map(o => o['Submission ID'])).size;
    const yr = new Date().getFullYear();
    const life = {
      importedAt: new Date().toISOString(), checklists, observations: obs.length,
      total: species.length, thisYear: species.filter(s => s.first.startsWith(String(yr))).length,
      yearList: new Set(obs.filter(o => (o['Date'] || '').startsWith(String(yr))).map(o => o['Common Name'])).size,
      firstDate: dates[0], lastDate: dates[dates.length - 1],
      recentLifers: species.sort((a, b) => b.first.localeCompare(a.first)).slice(0, 10),
      mostSeen: [...species].sort((a, b) => b.sightings - a.sightings).slice(0, 5),
      topPlaces: Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })),
      byMonth: Array.from({ length: 12 }, (_, m) => species.filter(s => +s.first.slice(5, 7) === m + 1).length),
      allSpecies: species.map(s => s.name).sort(),
    };
    store.set('life', life);
    if (online()) CLOUD.saveProfile({ life }).catch(() => {});
    return life;
  }
  // ---- live sync: pull your recent checklists by region, merge new species into the life list ----
  async function syncFromEbird(onProgress = () => {}) {
    const s = settings();
    if (!s.ebirdKey) throw new Error('Add your eBird API key in Settings first.');
    if (!s.ebirdName) throw new Error('Add your eBird display name in Settings first.');
    const H = { 'X-eBirdApiToken': s.ebirdKey };
    const regions = s.ebirdRegions.split(',').map(r => r.trim()).filter(Boolean);
    const me = s.ebirdName.trim().toLowerCase();
    const seen = store.get('syncedSubIds', []);
    let mine = [];
    for (const r of regions) {
      onProgress(`Scanning recent checklists in ${r}…`);
      const res = await fetch(`https://api.ebird.org/v2/product/lists/${r}?maxResults=200`, { headers: H });
      if (!res.ok) throw new Error(`eBird ${res.status} for region ${r}`);
      const lists = await res.json();
      mine.push(...lists.filter(l => (l.userDisplayName || '').trim().toLowerCase() === me && !seen.includes(l.subId)));
    }
    if (!mine.length) return { newChecklists: 0, newSpecies: [], checked: regions };
    const L = store.get('life', null) || { total: 0, recentLifers: [], allSpecies: [], mostSeen: [], topPlaces: [], byMonth: Array(12).fill(0), checklists: 0, observations: 0, yearList: 0, thisYear: 0 };
    const have = new Set(L.allSpecies);
    const newSpecies = [];
    for (const l of mine) {
      onProgress(`Reading checklist ${l.subId} (${l.loc?.name || ''})…`);
      const res = await fetch(`https://api.ebird.org/v2/product/checklist/view/${l.subId}`, { headers: H });
      if (!res.ok) continue;
      const cl = await res.json();
      const date = (cl.obsDt || l.obsDt || '').slice(0, 10);
      for (const o of cl.obs || []) {
        const name = o.comName || (await speciesName(o.speciesCode, H));
        if (!name || /\b(sp\.|hybrid|\/)/.test(name) || /\(Domestic/.test(name)) continue;
        L.observations++;
        if (!have.has(name)) {
          have.add(name);
          newSpecies.push({ name, first: date, loc: l.loc?.name || cl.locId || '', sightings: 1 });
          if (date) L.byMonth[+date.slice(5, 7) - 1]++;
          if (date.startsWith(String(new Date().getFullYear()))) L.thisYear++;
        }
      }
      L.checklists++;
      seen.push(l.subId);
    }
    L.allSpecies = [...have].sort();
    L.total = L.allSpecies.length;
    L.recentLifers = [...newSpecies.sort((a, b) => b.first.localeCompare(a.first)), ...L.recentLifers].slice(0, 10);
    L.lastSync = new Date().toISOString();
    store.set('life', L); store.set('syncedSubIds', seen.slice(-2000));
    if (online()) CLOUD.saveProfile({ life: L }).catch(() => {});
    return { newChecklists: mine.length, newSpecies, checked: regions };
  }
  const _nameCache = {};
  async function speciesName(code, H) {
    if (_nameCache[code]) return _nameCache[code];
    try { const r = await fetch(`https://api.ebird.org/v2/ref/taxonomy/ebird?species=${code}&fmt=json`, { headers: H }); const j = await r.json(); _nameCache[code] = j[0]?.comName; } catch {}
    return _nameCache[code];
  }

  async function lifeList() {
    if (online()) { const p = await CLOUD.getProfile().catch(() => null); if (p?.life) return p.life; }
    return store.get('life', null);
  }
  async function profile() {
    const local = store.get('profile', { favorite: '', favoriteWhy: '', photo: null, bio: '', name: settings().name });
    if (!online()) return local;
    const p = await CLOUD.getProfile().catch(() => null);
    return p ? { name: p.name, bio: p.bio || '', favorite: p.favorite || '', favoriteWhy: p.favorite_why || '', photo: p.photo_url, favPhoto: p.fav_photo_url, online: true } : local;
  }
  async function saveProfile(p) {
    store.set('profile', p);
    if (!online()) return;
    const up = { ...p };
    if (p.photo && p.photo.startsWith('data:')) up.photo = await CLOUD.uploadPhoto(p.photo, 'avatar');
    if (p.favPhoto && p.favPhoto.startsWith('data:')) up.favPhoto = await CLOUD.uploadPhoto(p.favPhoto, 'fav');
    await CLOUD.saveProfile(up);
    store.set('profile', up);
  }

  const ready = CLOUD.ready ? CLOUD.init() : Promise.resolve(null);

  return { ready, online, settings, saveSettings, loadBrief, gradeCall, briefText, findPlaces, briefPlace, saveBriefPlace, loadPasses, bookings, book, cancelBooking, addListing, loadFeed, post, deletePost, toggleLike,
           fileToDataURL, importLifeList, syncFromEbird, lifeList, profile, saveProfile, esc, fmtDate, ago, dirName };
})();

// nav highlight + sign-in widget
document.addEventListener('DOMContentLoaded', async () => {
  const here = location.pathname.split('/').pop() || 'index.html';
  const tabs = [...document.querySelectorAll('nav.tabs a')];
  tabs.forEach(a => { if (a.getAttribute('href') === here) a.classList.add('active'); });
  // pages that live under the More hub (passes, host, settings, about, builders' pages) light up the More tab
  if (!tabs.some(a => a.classList.contains('active'))) { const m = tabs.find(a => a.getAttribute('href') === 'more.html'); if (m) m.classList.add('active'); }

  const head = document.querySelector('header.top'); if (!head) return;
  const box = document.createElement('div'); box.id = 'authbox'; box.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  head.appendChild(box);
  if (!CLOUD.ready) { box.innerHTML = '<span class="meta">offline mode</span>'; return; }
  await CLOUD.init();
  const render = () => {
    const u = CLOUD.user();
    box.innerHTML = u
      ? `<a class="meta" href="profile.html">${DB.esc(u.email)}</a><button class="ghost small" id="signout">Sign out</button>`
      : `<input id="loginEmail" type="email" placeholder="you@email.com" style="width:190px;padding:7px 10px"><button class="small" id="signin">Sign in</button>`;
    const si = document.getElementById('signin'), so = document.getElementById('signout');
    if (si) si.onclick = async () => {
      const e = document.getElementById('loginEmail').value.trim(); if (!e) return;
      si.disabled = true; try { await CLOUD.signIn(e); box.innerHTML = '<span class="meta">Check your email for a sign-in link.</span>'; }
      catch (err) { box.innerHTML = `<span class="meta">${DB.esc(err.message)}</span>`; }
    };
    if (so) so.onclick = async () => { await CLOUD.signOut(); location.reload(); };
  };
  render();
  document.addEventListener('daybird:auth', () => { render(); document.dispatchEvent(new Event('daybird:refresh')); });
});
