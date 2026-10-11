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
    migration: 0,            // 0 = unknown, 1..5 from BirdCast local dashboard
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
  async function weather(s) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lng}` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,cloud_cover` +
      `&daily=sunrise,sunset&timezone=auto&forecast_days=2&wind_speed_unit=mph&temperature_unit=fahrenheit`;
    const w = await getJSON(u);
    // morning window: 6–9am local today
    const idx = w.hourly.time.map((t, i) => ({ t, i })).filter(x => /T0[6-9]:/.test(x.t)).slice(0, 4).map(x => x.i);
    const avg = (arr) => idx.reduce((a, i) => a + arr[i], 0) / idx.length;
    return {
      temp: Math.round(avg(w.hourly.temperature_2m)),
      wind: Math.round(avg(w.hourly.wind_speed_10m)),
      windDir: Math.round(avg(w.hourly.wind_direction_10m)),
      rain: Math.round(avg(w.hourly.precipitation_probability)),
      cloud: Math.round(avg(w.hourly.cloud_cover)),
      sunrise: w.daily.sunrise[0].slice(11, 16),
    };
  }

  // ---------- the call ----------
  function dirName(deg) { return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8]; }
  function makeCall(wx, mig, notableCount) {
    let score = 50; const why = [];
    if (wx.wind <= 8) { score += 15; why.push('calm winds'); } else if (wx.wind >= 18) { score -= 20; why.push('windy'); }
    if (wx.rain <= 20) { score += 10; } else if (wx.rain >= 60) { score -= 25; why.push('rain likely'); }
    if (mig >= 4) { score += 25; why.push('big overnight migration'); } else if (mig === 3) { score += 10; why.push('moderate migration'); } else if (mig === 1) { score -= 10; }
    const d = dirName(wx.windDir);
    const month = new Date().getMonth() + 1;
    if (month >= 8 && month <= 11 && (d === 'N' || d === 'NW')) { score += 10; why.push('NW tailwind for fall migrants'); }
    if (month >= 3 && month <= 6 && (d === 'S' || d === 'SW')) { score += 10; why.push('SW tailwind for spring migrants'); }
    if (notableCount >= 3) { score += 10; why.push(`${notableCount} notable reports nearby`); }
    const grade = score >= 70 ? 'go' : score >= 45 ? 'maybe' : 'stay';
    const word = { go: 'GO', maybe: 'MAYBE', stay: 'STAY IN' }[grade];
    return { score, grade, word, why };
  }

  // ---------- public API ----------
  async function loadBrief() {
    const s = settings();
    let source = 'mock', sightings, wx, errors = [];
    try { wx = await weather(s); } catch (e) { errors.push('weather: ' + e.message); }
    if (s.ebirdKey) {
      try { sightings = await liveSightings(s); source = 'live'; }
      catch (e) { errors.push('eBird: ' + e.message + ' (CORS or key problem — see README)'); }
    }
    if (!sightings || !wx) {
      const mock = window.DAYBIRD_MOCK;
      sightings = sightings || mock.sightings;
      wx = wx || mock.weather;
      if (!s.ebirdKey) errors.push('No eBird key saved — showing sample sightings. Add your key in Settings.');
    }
    // group hotspots by activity (eBird gives numSpeciesAllTime; recent list gives locations)
    const byLoc = {};
    (sightings.recent || []).forEach(o => { byLoc[o.locName] = (byLoc[o.locName] || 0) + 1; });
    const spots = Object.entries(byLoc).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, n]) => ({ name, species: n }));
    const notable = (sightings.notable || []).slice(0, 8);
    const call = makeCall(wx, s.migration, notable.length);
    return { s, source, wx, spots, notable, call, errors, speciesCount: Object.keys(byLoc).length ? new Set((sightings.recent||[]).map(o=>o.comName)).size : 0 };
  }

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

  return { ready, online, settings, saveSettings, loadBrief, loadPasses, bookings, book, cancelBooking, addListing, loadFeed, post, deletePost, toggleLike,
           fileToDataURL, importLifeList, lifeList, profile, saveProfile, esc, fmtDate, ago, dirName };
})();

// nav highlight + sign-in widget
document.addEventListener('DOMContentLoaded', async () => {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav.tabs a').forEach(a => { if (a.getAttribute('href') === here) a.classList.add('active'); });

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
