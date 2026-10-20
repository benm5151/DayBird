/* Daybird stories: phone-story pictures (1080×1920 PNG) of an outing or a new lifer, drawn in the browser with the
   canvas API (js/canvas-kit.js) and handed to the system share sheet or downloaded. Nothing is sent anywhere.

   Data shaping (pure, no DOM, testable in Node):
     myLists(rows, name, {days, now})        rows of eBird product/lists/{region} that are mine, last N days, newest first
     outingFromChecklist(view, row, names)   an outing from product/checklist/view/{subId} (+ speciesCode → name map)
     outingFromForm({place, date, minutes, species, best})
     pickBest(species, {best, have})         the highlight: the pick, else a lifer, else the first bird that is not everyday
     plan(outing, {have})                    the slides: cover, highlight, list pages of PER_SLIDE names
     liferNumber(name, L) / liferTotal       "Lifer #N" and "N species and counting" from DB.lifeList()
   Drawing (browser): render(outing, opts) → { best, slides: [canvas] }; renderLifer(lifer, opts) → canvas; shareAll(canvases, opts).
   eBird (browser): fetchMyLists(settings), fetchOuting(row, settings); species codes are resolved through
     ref/taxonomy/ebird and cached in localStorage 'daybird:taxon'.

   The art is the tufted titmouse only (mark.svg and the three mascot poses); species are carried by type, on purpose:
   the species silhouettes in art/birds/ are drafts and do not appear in stories. */
((root) => {
  const K = () => root.DAYBIRD_KIT;
  const W = 1080, H = 1920, SITE = 'day-bird.com';
  const PER_SLIDE = 28;                       // two columns of 14 at a size that still reads on a phone
  const GRADES = ['go', 'maybe', 'stay'];
  // Birds nearly every list has; the default highlight skips them.
  const EVERYDAY = ['pigeon', 'starling', 'house sparrow', 'crow', 'mallard', 'goose', 'robin', 'chickadee', 'mourning dove', 'blue jay'];
  const isEveryday = (name) => { const n = String(name || '').toLowerCase(); return EVERYDAY.some(e => n.includes(e)); };
  // "Dark-eyed Junco (Slate-colored)" → "Dark-eyed Junco"; spuhs, slashes, hybrids and domestics are not species.
  const cleanName = (n) => String(n || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const isSpecies = (n) => !!n && !/\b(sp\.|hybrid|\/)/.test(n) && !/\(Domestic/.test(n);

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // eBird writes "2026-10-18 07:15" in checklist views and isoObsDate, and "18 Oct 2026" in list rows' obsDt.
  function isoDate(s) {
    if (!s) return '';
    const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1];
    const d = new Date(String(s).replace(/(\d{1,2}) (\w{3}) (\d{4})/, '$2 $1, $3')); return isNaN(d) ? '' : localISO(d);
  }
  const time24 = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : ''; };
  const ampm = (t) => { const m = time24(t); if (!m) return ''; const h = +m.slice(0, 2); return `${(h % 12) || 12}:${m.slice(3)} ${h < 12 ? 'AM' : 'PM'}`; };
  const dayLabel = (iso, o = {}) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? String(iso || '') : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...(o.year ? { year: 'numeric' } : {}) }); };
  const shortDate = (iso) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? String(iso || '') : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  // 'today' | 'yesterday' | 'other', in the browser's local calendar
  function relation(iso, now = new Date()) { const y = new Date(now.getTime() - 864e5); return iso === localISO(now) ? 'today' : iso === localISO(y) ? 'yesterday' : 'other'; }

  // ---------- eBird shapes ----------
  function myLists(rows, me, o = {}) {
    const name = String(me || '').trim().toLowerCase(), days = o.days ?? 14, now = o.now || new Date();
    const since = localISO(new Date(now.getTime() - days * 864e5));
    const seen = new Set();
    return (rows || [])
      .filter(l => l && (l.userDisplayName || '').trim().toLowerCase() === name)
      .map(l => {
        const when = l.isoObsDate || [l.obsDt, l.obsTime].filter(Boolean).join(' ');
        return { subId: l.subId || l.subID || '', place: (l.loc && (l.loc.name || l.loc.locName)) || l.locName || l.locId || 'Somewhere', locId: l.locId || (l.loc && l.loc.locId) || '',
          date: isoDate(when), time: time24(l.isoObsDate || l.obsTime || ''), numSpecies: Number.isFinite(+l.numSpecies) ? +l.numSpecies : null };
      })
      .filter(l => l.subId && l.date && l.date >= since && !seen.has(l.subId) && seen.add(l.subId))
      .sort((a, b) => (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time));
  }
  function outingFromChecklist(view, row, names = {}) {
    const species = [], seen = new Set();
    for (const o of (view && view.obs) || []) {
      const raw = o.comName || names[o.speciesCode] || '', n = cleanName(raw);
      if (!isSpecies(raw) || !n || seen.has(n)) continue;
      seen.add(n); species.push(n);
    }
    const date = isoDate(view && view.obsDt) || (row && row.date) || localISO();
    const hrs = view && +view.durationHrs;
    return { source: 'ebird', subId: (view && view.subId) || (row && row.subId) || '', place: (row && row.place) || (view && view.locId) || 'Somewhere', date,
      time: ampm((view && view.obsDt) || (row && row.time) || ''), minutes: Number.isFinite(hrs) && hrs > 0 ? Math.round(hrs * 60) : null,
      observers: view && Number.isFinite(+view.numObservers) && +view.numObservers > 0 ? +view.numObservers : null, species, best: null };
  }
  function outingFromForm(f = {}) {
    const species = [], seen = new Set();
    for (const line of String(f.species || '').split(/\r?\n|;/)) { const n = cleanName(line); if (!isSpecies(line.trim()) || !n || seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); species.push(n); }
    const minutes = Number.isFinite(+f.minutes) && +f.minutes > 0 ? Math.round(+f.minutes) : null;
    return { source: 'typed', place: String(f.place || '').trim() || 'Somewhere', date: isoDate(f.date) || localISO(), time: '', minutes, observers: null, species, best: species.includes(f.best) ? f.best : null };
  }

  // ---------- the plan ----------
  // have: Set of species on the life list (empty or missing = no list, so nothing is a lifer).
  const hasList = (have) => have instanceof Set && have.size > 0;
  const isLifer = (name, have) => hasList(have) && !have.has(name);
  function pickBest(species, o = {}) {
    if (!species || !species.length) return null;
    if (o.best && species.includes(o.best)) return o.best;
    if (hasList(o.have)) { const lifer = species.find(n => !o.have.has(n)); if (lifer) return lifer; }
    return species.find(n => !isEveryday(n)) || species[0];
  }
  function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]]; }
  function plan(outing, o = {}) {
    const species = (outing && outing.species) || [];
    const best = pickBest(species, { best: outing && outing.best, have: o.have });
    const slides = [{ kind: 'cover' }];
    if (best) slides.push({ kind: 'highlight', name: best, lifer: isLifer(best, o.have) });
    chunk(species, PER_SLIDE).forEach((names, i) => slides.push({ kind: 'list', names, more: i > 0 }));
    return { best, slides };
  }
  function hintFor(name, traits) {
    const n = String(name || '').toLowerCase();
    const row = (traits || root.DAYBIRD_TRAITS || []).find(t => String(t[0]).toLowerCase() === n);
    return row ? String(row[5] || '') : '';
  }
  // recentLifers is newest first, so the newest is #total. A bird not on the list yet would be #total+1.
  function liferNumber(name, L) {
    if (!L || !L.total) return null;
    const i = (L.recentLifers || []).findIndex(x => x && x.name === name);
    if (i >= 0) return L.total - i;
    return (L.allSpecies || []).includes(name) ? null : L.total + 1;
  }
  function liferTotal(name, L) { if (!L || !L.total) return null; return (L.allSpecies || []).includes(name) ? L.total : L.total + 1; }
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bird';
  const fileName = (outing, i) => `daybird-story-${outing.date || localISO()}-${i + 1}.png`;
  const liferFileName = (lifer) => `daybird-lifer-${slug(lifer.name)}.png`;

  // ---------- drawing ----------
  function setup(canvas) { canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d'); ctx.textBaseline = 'alphabetic'; return ctx; }
  // mark top left, wordmark and site bottom center: the same on every slide
  function chrome(ctx, bg, o) {
    K().markBadge(ctx, o.art.mark, 72, 72, 112);
    K().wordmark(ctx, W / 2, 1724, { ink: bg.ink, accent: bg.accent, site: SITE, fonts: o.fonts, size: 48 });
  }
  // "place · date" on one line when it fits the width with the current font, else the place (cut if it must) over the date
  function whereLines(ctx, outing, maxW) {
    const k = K(), date = dayLabel(outing.date), one = [outing.place, date].filter(Boolean).join(' · ');
    if (ctx.measureText(one).width <= maxW) return [one];
    return [k.ellipsize(ctx, outing.place || '', maxW), date].filter(Boolean);
  }
  const cap = (s) => String(s || '').replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  // A bird's name as the hero: up to three lines; three short words ("Northern Pygmy Owl") would stack at full size and
  // run into the footer, so a three-line name is capped at 150px.
  function fitName(ctx, name, family, start) {
    const k = K(), o = { weight: 700, family, maxW: 920, min: 96, maxLines: 3 };
    let nm = k.fit(ctx, name, { ...o, start });
    if (nm.lines.length === 3 && nm.size > 150) nm = k.fit(ctx, name, { ...o, start: 150 });
    return nm;
  }
  // "65 minutes" up to an hour and a half, then "2 hours" or "2h 20m"
  const minutesLabel = (m) => !m ? '' : m < 90 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)}h ${m % 60}m`;

  // Cover: the day's sky (or paper), the mascot, the species count as the hero, place, date.
  function drawCover(canvas, outing, o) {
    const k = K(), ctx = setup(canvas), F = o.fonts, bg = k.background(ctx, W, H, o.sky || 'paper');
    const pose = o.art.mascot[o.grade] || o.art.mascot.go, ms = 400;
    k.mascot(ctx, pose, (W - ms) / 2, 300, ms, bg.dark);
    const n = outing.species.length;
    ctx.fillStyle = bg.ink; ctx.textAlign = 'center';
    const num = k.fit(ctx, String(n), { weight: 700, family: F.serif, maxW: 900, start: 470, min: 240 });
    ctx.fillText(num.lines[0], W / 2, 1130);
    ctx.font = k.font(400, 56, F.sans); ctx.globalAlpha = .9;
    ctx.fillText(['species', minutesLabel(outing.minutes)].filter(Boolean).join(' · '), W / 2, 1218); ctx.globalAlpha = 1;
    const place = k.fit(ctx, outing.place, { weight: 700, family: F.serif, maxW: 900, start: 84, min: 48, maxLines: 2 });
    let y = 1386; place.lines.forEach(l => { ctx.fillText(l, W / 2, y); y += Math.round(place.size * 1.12); });
    ctx.globalAlpha = .78; ctx.font = k.font(400, 40, F.sans);
    ctx.fillText([dayLabel(outing.date), outing.time].filter(Boolean).join(' · '), W / 2, y + 14); ctx.globalAlpha = 1;
    chrome(ctx, bg, o);
    canvas._layout = { place: { ...place, maxW: 900, x: W / 2 }, number: num };
    return canvas;
  }
  // Highlight: the best bird's name as the hero in serif on paper, an amber rule, the trait hint, a lifer ribbon when new.
  function drawHighlight(canvas, outing, name, o) {
    const k = K(), ctx = setup(canvas), F = o.fonts, bg = k.background(ctx, W, H, 'paper');
    const nm = fitName(ctx, name, F.serif, 190);
    const lineH = Math.round(nm.size * 1.02);
    ctx.font = k.font(400, 46, F.sans);
    const hint = o.hint ? k.wrap(ctx, cap(o.hint), 900).slice(0, 3) : [];
    const blockH = 40 + nm.size * 0.9 + (nm.lines.length - 1) * lineH + 70 + (hint.length ? 90 + hint.length * 62 : 0);
    let y = 460 + Math.max(0, (820 - blockH) / 2);
    k.eyebrow(ctx, o.lifer ? 'A new lifer' : 'Best bird', 80, y, { fonts: F, size: 38, color: k.AMBER });
    y += 40 + nm.size * 0.9;
    ctx.fillStyle = k.INK; ctx.textAlign = 'left'; ctx.font = k.font(700, nm.size, F.serif);
    nm.lines.forEach(l => { ctx.fillText(l, 80, y); y += lineH; });
    y += 70 - lineH; k.rule(ctx, 80, y, 160, 10, k.AMBER);
    if (hint.length) { y += 90; ctx.fillStyle = k.INK; ctx.globalAlpha = .82; ctx.font = k.font(400, 46, F.sans); hint.forEach(l => { ctx.fillText(l, 80, y); y += 62; }); ctx.globalAlpha = 1; }
    if (o.lifer) ribbon(ctx, 'lifer!', F);
    k.mascot(ctx, o.art.mascot[o.grade] || o.art.mascot.go, W - 80 - 200, 1360, 200, false);
    ctx.fillStyle = k.INK; ctx.globalAlpha = .7; ctx.font = k.font(400, 36, F.sans); ctx.textAlign = 'left';
    let cy = 1606; whereLines(ctx, outing, 920).forEach(l => { ctx.fillText(l, 80, cy); cy += 46; }); ctx.globalAlpha = 1;
    chrome(ctx, bg, o);
    canvas._layout = { name: { ...nm, maxW: 920, x: 80 } };
    return canvas;
  }
  // The amber band across the top-right corner.
  function ribbon(ctx, text, F) {
    const k = K();
    ctx.save(); ctx.translate(W - 190, 190); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = k.AMBER; ctx.fillRect(-520, -48, 1040, 96);
    ctx.fillStyle = k.PAPER; ctx.font = k.font(700, 60, F.serif); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 4);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
  // The list: every species in two columns, the highlight marked with an amber dot; later pages say "…and N more".
  function drawList(canvas, outing, names, o) {
    const k = K(), ctx = setup(canvas), F = o.fonts, bg = k.background(ctx, W, H, 'paper');
    const total = outing.species.length;
    ctx.fillStyle = k.INK; ctx.textAlign = 'left';
    const t = k.fit(ctx, o.more ? `…and ${names.length} more` : `${total} species`, { weight: 700, family: F.serif, maxW: 920, start: 104, min: 60 });
    ctx.fillText(t.lines[0], 80, 400);
    ctx.globalAlpha = .7; ctx.font = k.font(400, 36, F.sans);
    let cy = 462; const wl = whereLines(ctx, outing, 920); wl.forEach(l => { ctx.fillText(l, 80, cy); cy += 46; }); ctx.globalAlpha = 1;
    k.rule(ctx, 80, cy - 8, 160, 8, k.AMBER);
    // up to 7 names: one column, bigger; more: two balanced columns. One type size for the whole page, the largest at which
    // every name fits its column (down to 30px); a name that still does not fit at 30px is cut, which should be rare.
    const two = names.length > 7, rows = two ? Math.ceil(names.length / 2) : names.length;
    const colX = two ? [80, 566] : [80], colW = two ? 440 : 920;
    let size = two ? (rows <= 8 ? 48 : rows <= 11 ? 44 : 40) : 56;
    const fitsAll = (sz) => { ctx.font = k.font(600, sz, F.sans); return names.every(n => ctx.measureText(n).width <= colW); };
    while (size > 30 && !fitsAll(size)) size -= 2;
    // the block sits centered between the rule and the footer line, so a short list is not top-heavy
    const lineH = Math.round(size * 1.6), bandTop = cy + 90, bandBottom = 1540, blockH = rows * lineH;
    const top = Math.round(bandTop + Math.max(0, (bandBottom - bandTop - blockH) / 2)) + size;
    const drawn = [];
    names.forEach((n, i) => {
      const x = colX[Math.floor(i / rows)], y = top + (i % rows) * lineH;
      ctx.font = k.font(n === o.best ? 600 : 400, size, F.sans);
      const label = k.ellipsize(ctx, n, colW);
      ctx.fillStyle = k.INK; ctx.textAlign = 'left'; ctx.fillText(label, x, y);
      if (n === o.best) { ctx.fillStyle = k.AMBER; ctx.beginPath(); ctx.arc(x - 26, y - size * 0.34, Math.round(size * 0.22), 0, Math.PI * 2); ctx.fill(); }
      drawn.push({ name: label, size, width: ctx.measureText(label).width, x, y });
    });
    ctx.fillStyle = k.INK; ctx.globalAlpha = .7; ctx.font = k.font(400, 32, F.sans); ctx.fillText('Sightings logged on eBird', 80, 1600); ctx.globalAlpha = 1;
    chrome(ctx, bg, o);
    canvas._layout = { title: t.lines[0], rows: drawn, colW, size };
    return canvas;
  }
  // The lifer story: navy, the titmouse on its moon, "Lifer #N", the name huge, place and date, the running total.
  function drawLifer(canvas, lifer, o) {
    const k = K(), ctx = setup(canvas), F = o.fonts, bg = k.background(ctx, W, H, 'navy');
    k.mascot(ctx, o.art.mascot.go, (W - 260) / 2, 300, 260, true);
    k.eyebrow(ctx, lifer.number ? `Lifer #${lifer.number}` : 'Lifer', W / 2, 700, { fonts: F, size: 44, color: k.AMBER, align: 'center' });
    const nm = fitName(ctx, lifer.name || 'A bird', F.serif, 200);
    const lineH = Math.round(nm.size * 1.02);
    let y = 760 + nm.size * 0.9;
    ctx.fillStyle = k.PAPER; ctx.textAlign = 'center'; ctx.font = k.font(700, nm.size, F.serif);
    nm.lines.forEach(l => { ctx.fillText(l, W / 2, y); y += lineH; });
    y += 64 - lineH; k.rule(ctx, W / 2 - 80, y, 160, 10, k.AMBER); y += 96;
    const wh = [lifer.place, lifer.date ? dayLabel(lifer.date, { year: true }) : ''].filter(Boolean);
    if (wh.length) {
      ctx.fillStyle = k.PAPER; ctx.globalAlpha = .82; ctx.font = k.font(400, 42, F.sans);
      wh.forEach(l => { ctx.fillText(k.ellipsize(ctx, l, 920), W / 2, y); y += 56; });
      ctx.globalAlpha = 1;
    }
    if (lifer.total) { ctx.fillStyle = k.PAPER; ctx.font = k.font(400, 54, F.serif); ctx.fillText(`${lifer.total} species and counting`, W / 2, Math.max(y + 56, 1500)); }
    chrome(ctx, bg, o);
    canvas._layout = { name: { ...nm, maxW: 920, x: W / 2 }, number: lifer.number || null, total: lifer.total || null };
    return canvas;
  }

  async function prep(o) {
    const k = K();
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    return { fonts: k.fonts(), art: o.art || await k.art(o.base || '') };
  }
  // outing + { have: Set, grade: 'go'|'maybe'|'stay'|null (today's or yesterday's call), traits } → { best, slides: [canvas] }
  async function render(outing, o = {}) {
    const common = await prep(o);
    const { best, slides } = plan(outing, { have: o.have });
    const grade = GRADES.includes(o.grade) ? o.grade : null;
    const mk = () => (o.canvas ? o.canvas() : document.createElement('canvas'));
    const out = slides.map(s => {
      const c = mk(), opts = { ...common, grade: grade || 'go' };
      if (s.kind === 'cover') drawCover(c, outing, { ...opts, sky: grade || 'paper' });
      else if (s.kind === 'highlight') drawHighlight(c, outing, s.name, { ...opts, hint: hintFor(s.name, o.traits), lifer: s.lifer });
      else drawList(c, outing, s.names, { ...opts, more: s.more, best });
      c.dataset.kind = s.kind;
      return c;
    });
    return { best, slides: out };
  }
  // lifer: { name, date, place } + L (DB.lifeList()) → canvas
  async function renderLifer(lifer, o = {}) {
    const common = await prep(o);
    const c = o.canvas ? o.canvas() : document.createElement('canvas');
    drawLifer(c, { ...lifer, number: lifer.number ?? liferNumber(lifer.name, o.lifeList), total: lifer.total ?? liferTotal(lifer.name, o.lifeList) }, common);
    c.dataset.kind = 'lifer';
    return c;
  }
  // One share sheet with every slide; when the browser has none, every slide downloads, a beat apart.
  // Returns 'shared' | 'cancelled' | 'downloaded'.
  async function shareAll(canvases, o = {}) {
    const k = K(), files = [];
    for (let i = 0; i < canvases.length; i++) files.push(await k.toFile(canvases[i], o.name ? o.name(i) : `daybird-story-${i + 1}.png`));
    const r = await k.shareFiles(files, { title: o.title || 'My Daybird story', text: o.text || '', navigator: o.navigator });
    if (r === 'shared' || r === 'cancelled') return r;
    for (let i = 0; i < files.length; i++) { k.download(files[i], files[i].name || (o.name ? o.name(i) : `daybird-story-${i + 1}.png`)); if (i < files.length - 1) await new Promise(res => setTimeout(res, o.gap ?? 350)); }
    return 'downloaded';
  }
  const shareText = (outing, best) => `${outing.species.length} species at ${outing.place}${best ? `, best bird ${best}` : ''}. ${SITE}`;

  // ---------- eBird (browser) ----------
  const EB = 'https://api.ebird.org/v2', TAXON_KEY = 'daybird:taxon';
  async function ebGet(path, key) {
    const r = await fetch(EB + path, { headers: { 'X-eBirdApiToken': key } });
    if (!r.ok) throw new Error(`eBird ${r.status} for ${path.split('?')[0]}`);
    return r.json();
  }
  async function fetchMyLists(s, o = {}) {
    if (!s.ebirdKey || !s.ebirdName) throw new Error('Add your eBird API key and display name in Settings first.');
    const regions = String(s.ebirdRegions || 'US-NH').split(',').map(r => r.trim()).filter(Boolean);
    const rows = [];
    for (const r of regions) { if (o.onProgress) o.onProgress(`Scanning recent checklists in ${r}…`); rows.push(...(await ebGet(`/product/lists/${encodeURIComponent(r)}?maxResults=200`, s.ebirdKey) || [])); }
    return myLists(rows, s.ebirdName, { days: o.days ?? 14, now: o.now });
  }
  const taxonCache = () => { try { return JSON.parse(localStorage.getItem(TAXON_KEY)) || {}; } catch { return {}; } };
  async function speciesNames(codes, key) {
    const cache = taxonCache(), missing = [...new Set(codes.filter(c => c && !cache[c]))];
    for (let i = 0; i < missing.length; i += 60) {
      try { for (const t of (await ebGet(`/ref/taxonomy/ebird?species=${missing.slice(i, i + 60).join(',')}&fmt=json`, key)) || []) if (t.speciesCode && t.comName) cache[t.speciesCode] = t.comName; } catch {}
    }
    try { localStorage.setItem(TAXON_KEY, JSON.stringify(cache)); } catch {}
    return cache;
  }
  async function fetchOuting(row, s) {
    const view = await ebGet(`/product/checklist/view/${encodeURIComponent(row.subId)}`, s.ebirdKey);
    const codes = (view.obs || []).filter(o => !o.comName && o.speciesCode).map(o => o.speciesCode);
    return outingFromChecklist(view, row, codes.length ? await speciesNames(codes, s.ebirdKey) : {});
  }

  root.DAYBIRD_STORIES = { W, H, SITE, PER_SLIDE, EVERYDAY, isEveryday, cleanName, isSpecies, localISO, isoDate, time24, ampm, dayLabel, shortDate, relation,
    minutesLabel, myLists, outingFromChecklist, outingFromForm, pickBest, isLifer, chunk, plan, hintFor, liferNumber, liferTotal, slug, fileName, liferFileName,
    drawCover, drawHighlight, drawList, drawLifer, render, renderLifer, shareAll, shareText, fetchMyLists, fetchOuting, speciesNames };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
