/* Daybird stickers: a bird from your list as a die-cut sticker PNG (1024×1024, transparent background) for iMessage, and
   a printable sheet of twelve (stickers.html). Loaded on lifelist.html before js/lifelist.js, and on stickers.html after it.

   A web page cannot install a sticker into iMessage. What works on iOS 17 and later: save the PNG to Photos, then in
   Messages tap +, Stickers, + and pick it (or long-press the bird in Photos and choose Add Sticker). So the product is a
   sticker-shaped PNG and a three-step note. On Android the PNG is sent as an image.

   The drawing (drawSticker): the species picture (the person's own photo or drawing first, else the credited Wikimedia
   photo) cropped to a circle of 860 px, a 26 px white die-cut border, a soft shadow outside it, and a white rounded tab
   across the bottom with the titmouse mark small at the left and the bird's name in the serif (one or two lines, fit to
   width). A Wikimedia photo adds "Photo: <artist> · <license>" to the tab, which its license asks for; own pictures carry
   no credit. Without a picture, or when a cross-origin image taints the canvas so toBlob throws, the circle is paper with
   the name big and a thin amber ring, and the tab says daybird. No species silhouettes anywhere: the identity is the
   tufted titmouse (mark.svg, art/mascot-go.svg) plus the type.

   DAYBIRD_STICKERS = { SIZE, drawSticker, makeSticker, exportSticker, shareFiles, download, fileName, slug, pick, fillers,
                        mount, lastSpec (the spec of the last sticker drawn, for tests and the page) } */
const DAYBIRD_STICKERS = (() => {
  const SIZE = 1024, PAPER = '#F6F3EC', INK = '#1F2A37', AMBER = '#E8833A', MUTED = '#5f6b63', WHITE = '#FFFFFF';
  const CX = 512, CY = 478, R_IMG = 430, BORDER = 26, R_OUT = R_IMG + BORDER;   // circle of 860 px, 26 px white border
  const TAB = { x: 84, w: 856, r: 36, bottom: 968, minH: 150, pad: 28 };          // the label tab across the bottom
  const MARK = 88;                                                                // the mark's size in the tab
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s || 'bird').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bird';
  const fileName = (name) => `daybird-sticker-${slug(name)}.png`;

  // ---------------------------------------------------------------- type helpers
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
  function ellipsize(ctx, text, maxW) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }
  const fits = (ctx, lines, maxW) => lines.every(l => ctx.measureText(l).width <= maxW);
  // The name in the tab: one line as big as fits (72 down to 52), else two lines (60 down to 40), else two lines cut.
  function fitName(ctx, text, maxW, F) {
    for (const s of [72, 68, 64, 60, 56, 52]) { ctx.font = `700 ${s}px ${F.serif}`; if (ctx.measureText(text).width <= maxW) return { size: s, lines: [text] }; }
    for (const s of [60, 56, 52, 48, 44, 40]) { ctx.font = `700 ${s}px ${F.serif}`; const l = wrap(ctx, text, maxW); if (l.length <= 2 && fits(ctx, l, maxW)) return { size: s, lines: l }; }
    ctx.font = `700 40px ${F.serif}`; const l = wrap(ctx, text, maxW).slice(0, 2); return { size: 40, lines: l.map(x => ellipsize(ctx, x, maxW)) };
  }
  // The credit: 26 px, down to 22 when long, then two lines at 22 (the second cut). Never dropped.
  function fitCredit(ctx, text, maxW, F) {
    for (const s of [26, 24, 22]) { ctx.font = `400 ${s}px ${F.sans}`; if (ctx.measureText(text).width <= maxW) return { size: s, lines: [text] }; }
    ctx.font = `400 22px ${F.sans}`; const l = wrap(ctx, text, maxW).slice(0, 2); return { size: 22, lines: l.map(x => ellipsize(ctx, x, maxW)) };
  }
  // The big name inside a paper circle: up to three lines, 120 px down to 64.
  function fitBig(ctx, text, maxW, F) {
    for (const s of [120, 108, 96, 84, 72, 64]) { ctx.font = `700 ${s}px ${F.serif}`; const l = wrap(ctx, text, maxW); if (l.length <= 3 && fits(ctx, l, maxW)) return { size: s, lines: l }; }
    ctx.font = `700 64px ${F.serif}`; return { size: 64, lines: wrap(ctx, text, maxW).slice(0, 3).map(x => ellipsize(ctx, x, maxW)) };
  }
  // Appends a rounded rectangle to the current path (no beginPath, so a circle and a tab can be one shape).
  function roundRectPath(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Cover-crop an image into a square.
  function cover(ctx, img, x, y, s) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.max(s / w, s / h), dw = w * k, dh = h * k;
    ctx.drawImage(img, x + (s - dw) / 2, y + (s - dh) / 2, dw, dh);
  }
  // Contain an image in a square.
  function contain(ctx, img, x, y, s) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(s / w, s / h), dw = w * k, dh = h * k;
    ctx.drawImage(img, x + (s - dw) / 2, y + (s - dh) / 2, dw, dh);
  }
  function wordmark(ctx, x, y, size, F, color) {
    // "daybird" in the serif with the amber branch under it, as on the slides and cards
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.font = `700 ${size}px ${F.serif}`;
    const w = ctx.measureText('daybird').width;
    ctx.fillText('daybird', x - w / 2, y);
    ctx.strokeStyle = AMBER; ctx.lineWidth = Math.max(4, size * 0.085); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - w / 2 + size * 0.08, y + size * 0.3); ctx.quadraticCurveTo(x, y + size * 0.17, x + w / 2 - size * 0.02, y + size * 0.3); ctx.stroke();
    return w;
  }

  // ---------------------------------------------------------------- the drawing
  // ctx: a 1024×1024 2d context (cleared here). d: { image (Image or null), name, credit, mark (Image or null), kind, tab }.
  //   kind: 'photo' (the default with an image: the picture fills the circle), 'text' (the default without one: the name
  //   big on paper), 'mascot' (the mascot SVG contained on paper), 'wordmark' (daybird big on paper).
  //   tab: the text in the tab; the name for photo and mascot stickers, "daybird" for text, "day-bird.com" for the wordmark.
  // Returns the spec: sizes and positions of what was drawn, so a page or a test can read them back instead of OCR.
  function drawSticker(ctx, d = {}) {
    const F = fonts();
    const image = d.image || null, mark = d.mark || null, name = String(d.name || '').trim();
    const kind = d.kind || (image ? 'photo' : 'text');
    const label = String(d.tab || (kind === 'photo' || kind === 'mascot' ? name : kind === 'wordmark' ? 'day-bird.com' : 'daybird')).trim();
    const credit = kind === 'photo' && d.credit ? String(d.credit).trim() : '';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    // measure the tab first: the mark at the left, then the name, then the credit line
    const textX = TAB.x + TAB.pad + (mark ? MARK + 22 : 0), maxW = TAB.x + TAB.w - TAB.pad - textX;
    const nm = fitName(ctx, label, maxW, F), cr = credit ? fitCredit(ctx, credit, maxW, F) : null;
    const lh = nm.size * 1.08, nameH = nm.lines.length * lh;
    const creditH = cr ? cr.lines.length * (cr.size * 1.2) + 12 : 0;
    const h = Math.round(Math.max(TAB.minH, 30 + nameH + creditH + 30));
    const tabY = TAB.bottom - h;
    // 1. the die-cut base: circle and tab as one white shape with a soft shadow outside it
    ctx.save();
    ctx.shadowColor = 'rgba(31,42,55,.32)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
    ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(CX, CY, R_OUT, 0, Math.PI * 2); roundRectPath(ctx, TAB.x, tabY, TAB.w, h, TAB.r); ctx.fill();
    ctx.restore();
    // 2. what is inside the circle
    ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, R_IMG, 0, Math.PI * 2); ctx.clip();
    if (kind === 'photo' && image) cover(ctx, image, CX - R_IMG, CY - R_IMG, 2 * R_IMG);
    else {
      ctx.fillStyle = PAPER; ctx.fillRect(CX - R_IMG, CY - R_IMG, 2 * R_IMG, 2 * R_IMG);
      ctx.strokeStyle = AMBER; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(CX, CY, R_IMG - 34, 0, Math.PI * 2); ctx.stroke();
      const mid = CY - 44;   // the tab covers the bottom of the circle, so the visual centre sits a little above CY
      if (kind === 'mascot' && image) { const s = 520; contain(ctx, image, CX - s / 2, mid - s / 2 - 10, s); }
      else if (kind === 'wordmark') wordmark(ctx, CX, mid + 50, 150, F, INK);
      else {
        const big = fitBig(ctx, name || 'daybird', 2 * R_IMG - 200, F);
        const blh = big.size * 1.04, top = mid - (big.lines.length * blh) / 2 + big.size * 0.78;
        ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.font = `700 ${big.size}px ${F.serif}`;
        big.lines.forEach((l, i) => ctx.fillText(l, CX, top + i * blh));
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
    // 3. the tab over the bottom of the picture, then the mark, the name and the credit
    ctx.fillStyle = WHITE; ctx.beginPath(); roundRectPath(ctx, TAB.x, tabY, TAB.w, h, TAB.r); ctx.fill();
    const blockH = nameH + creditH, blockTop = tabY + (h - blockH) / 2;
    if (mark) ctx.drawImage(mark, TAB.x + TAB.pad, tabY + (h - MARK) / 2, MARK, MARK);
    ctx.fillStyle = INK; ctx.font = `700 ${nm.size}px ${F.serif}`;
    nm.lines.forEach((l, i) => ctx.fillText(l, textX, blockTop + i * lh + nm.size * 0.8));
    if (cr) {
      ctx.fillStyle = MUTED; ctx.font = `400 ${cr.size}px ${F.sans}`;
      cr.lines.forEach((l, i) => ctx.fillText(l, textX, blockTop + nameH + 12 + i * (cr.size * 1.2) + cr.size * 0.8));
    }
    return {
      size: SIZE, kind, name, label, circle: { cx: CX, cy: CY, r: R_IMG }, border: BORDER,
      tab: { x: TAB.x, y: tabY, w: TAB.w, h, r: TAB.r }, textX, nameSize: nm.size, nameLines: nm.lines,
      credit: credit || null, creditSize: cr ? cr.size : null, creditLines: cr ? cr.lines : [], mark: !!mark, photo: kind === 'photo' && !!image,
    };
  }

  // ---------------------------------------------------------------- images
  const toBlob = (c) => new Promise((res, rej) => { try { c.toBlob(b => (b ? res(b) : rej(new Error('no picture'))), 'image/png'); } catch (e) { rej(e); } });
  function loadImage(src, cors) {
    return new Promise((res, rej) => {
      const i = new Image(); if (cors && !/^data:|^blob:/.test(src)) i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + src)); i.src = src;
    });
  }
  // An SVG as an Image with a fixed pixel size, so every browser rasterizes it sharp at the size it is drawn.
  const svgCache = {};
  function svgImage(path, px, base = '') {
    const key = base + path + '@' + px;
    if (!svgCache[key]) svgCache[key] = (async () => {
      const r = await fetch(base + path); if (!r.ok) throw new Error('no ' + path);
      let t = await r.text();
      t = t.replace(/<svg\b([^>]*)>/, (m, attrs) => '<svg' + attrs.replace(/\s(width|height)="[^"]*"/g, '') + ` width="${px}" height="${px}">`);
      const url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    })().catch(e => { delete svgCache[key]; throw e; });
    return svgCache[key];
  }
  const markImage = (base = '') => svgImage('mark.svg', 256, base);

  // d: { name, image (URL, data URL, or an Image; the mascot SVG path for kind 'mascot'), credit, kind, tab }. opts: { base }.
  // Returns { blob, canvas, spec, photo, leftOut }: photo is true when the picture made it in; leftOut is true when a
  // picture was asked for but could not be drawn (failed to load, or tainted the canvas), so the page can say so.
  async function makeSticker(d, opts = {}) {
    const base = opts.base || '';
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    let mark = null; try { mark = await markImage(base); } catch { /* no mark: the type still says who made it */ }
    const kind = d.kind || (d.image ? 'photo' : 'text');
    let image = null;
    if (kind === 'mascot') { try { image = await svgImage(d.image || 'art/mascot-go.svg', 640, base); } catch { image = null; } }
    else if (kind === 'photo' && d.image) {
      if (typeof d.image === 'object') image = d.image;
      else { try { image = await loadImage(d.image, true); } catch { image = null; } }
    }
    const canvas = () => { const c = document.createElement('canvas'); c.width = SIZE; c.height = SIZE; return c; };
    if (kind !== 'photo' || image) {
      const c = canvas();
      try {
        const spec = drawSticker(c.getContext('2d'), { ...d, kind, image, mark });
        const blob = await toBlob(c);
        API.lastSpec = spec;
        return { blob, canvas: c, spec, photo: spec.photo, leftOut: false };
      } catch { /* a tainted canvas: toBlob throws; fall through to the name on paper, on a fresh canvas */ }
    }
    const c = canvas();
    const spec = drawSticker(c.getContext('2d'), { name: d.name, kind: 'text', mark });
    const blob = await toBlob(c);
    API.lastSpec = spec;
    return { blob, canvas: c, spec, photo: false, leftOut: kind === 'photo' && !!d.image };
  }

  // ---------------------------------------------------------------- getting it out
  // Native share sheet when the browser offers one for these files (phones: iOS then offers Save Image). true when shared,
  // 'cancelled' when the person closed the sheet, false when there is no share sheet for files (then download).
  async function shareFiles(files, { title = 'Daybird sticker', text = '', navigator: nav = globalThis.navigator } = {}) {
    if (!files.length || !nav || !nav.share || !nav.canShare) return false;
    let ok = false; try { ok = nav.canShare({ files }); } catch { ok = false; }
    if (!ok) return false;
    try { await nav.share({ files, title, text }); return true; }
    catch (e) { return e && e.name === 'AbortError' ? 'cancelled' : false; }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const toFile = (blob, name) => { try { return new File([blob], name, { type: 'image/png' }); } catch { return null; } };
  // One sticker, out: { how: 'shared' | 'downloaded' | 'cancelled', photo, leftOut, spec, name }
  async function exportSticker(d, opts = {}) {
    const r = await makeSticker(d, opts);
    const name = fileName(d.name);
    const file = toFile(r.blob, name);
    const shared = file ? await shareFiles([file], { title: `${d.name} sticker · Daybird`, text: `${d.name}, from my Daybird list. day-bird.com`, navigator: opts.navigator }) : false;
    if (shared === true) return { how: 'shared', photo: r.photo, leftOut: r.leftOut, spec: r.spec, name };
    if (shared === 'cancelled') return { how: 'cancelled', photo: r.photo, leftOut: r.leftOut, spec: r.spec, name };
    download(r.blob, name);
    return { how: 'downloaded', photo: r.photo, leftOut: r.leftOut, spec: r.spec, name };
  }

  // ---------------------------------------------------------------- the sheet (stickers.html)
  // Up to `max` of your birds: the ones with your own picture first, then the rest in the Your birds order (newest first,
  // undated A–Z). entries: DAYBIRD_LIFELIST.entries(life); own: DB.birdImages().
  function pick(entries, own = {}, max = 12) {
    const L = globalThis.DAYBIRD_LIFELIST;
    const sorted = L && L.order ? L.order(entries || [], 'date') : [...(entries || [])];
    return [...sorted.filter(e => own[e.name]), ...sorted.filter(e => !own[e.name])].slice(0, max);
  }
  // Fillers for empty slots: the mascot and the wordmark, alternating.
  const fillers = (n) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ kind: i % 2 ? 'wordmark' : 'mascot', name: 'daybird' }));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Expects these ids: sheet, print, saveAll, status, sub, empty. life: DB.lifeList(); images: DB.birdImages().
  async function mount({ life, images = {}, base = '', navigator: nav = globalThis.navigator, max = 12 } = {}) {
    const $ = (id) => document.getElementById(id);
    const L = globalThis.DAYBIRD_LIFELIST;
    const own = images || {};
    const ownSrc = (o) => (o && (o.url || o.data)) || '';
    const entries = L && life && Array.isArray(life.allSpecies) && life.allSpecies.length ? L.entries(life) : [];
    const birds = pick(entries, own, max);
    const slots = [...birds.map(e => ({ kind: own[e.name] ? 'own' : 'bird', name: e.name })), ...fillers(max - birds.length)];
    const mine = slots.filter(s => s.kind === 'own').length;
    if ($('empty')) $('empty').classList.toggle('hidden', birds.length > 0);
    if ($('sub')) $('sub').textContent = birds.length
      ? `${birds.length} of your birds${mine ? `, ${mine} with your own picture` : ''}${birds.length < max ? `, and the titmouse in the other ${max - birds.length}` : ''}.`
      : '';
    $('sheet').innerHTML = slots.map((s, i) => `<figure class="slot" data-i="${i}" data-kind="${s.kind}" data-name="${esc(s.name)}"><span class="ph">${esc(s.name)}</span></figure>`).join('');
    const made = new Array(slots.length).fill(null);
    const say = (t) => { if ($('status')) $('status').textContent = t; };
    let done = 0;
    await Promise.all(slots.map(async (s, i) => {
      let d;
      if (s.kind === 'own') d = { name: s.name, image: ownSrc(own[s.name]), kind: 'photo' };
      else if (s.kind === 'bird') {
        const p = L && L.photos ? await L.photos.request(s.name).catch(() => null) : null;
        d = p && !p.none ? { name: s.name, kind: 'photo', image: p.image || p.thumb, credit: p.own ? '' : ['Photo: ' + (p.artist || 'Wikimedia Commons'), p.license].filter(Boolean).join(' · ') } : { name: s.name, kind: 'text' };
      } else d = s.kind === 'mascot' ? { name: 'daybird', kind: 'mascot', image: 'art/mascot-go.svg' } : { name: 'daybird', kind: 'wordmark' };
      let r;
      try { r = await makeSticker(d, { base }); } catch { return; }
      made[i] = { ...r, name: s.name, kind: s.kind };
      const fig = $('sheet').querySelector(`.slot[data-i="${i}"]`); if (!fig) return;
      const img = new Image(); img.alt = s.kind === 'own' || s.kind === 'bird' ? `${s.name} sticker` : (s.kind === 'mascot' ? 'Daybird titmouse sticker' : 'daybird wordmark sticker');
      img.onload = () => { fig.innerHTML = ''; fig.appendChild(img); fig.dataset.photo = r.photo ? '1' : '0'; fig.dataset.leftOut = r.leftOut ? '1' : '0'; fig.classList.add('done'); };
      img.src = URL.createObjectURL(r.blob);
      done++; say(done < slots.length ? `Drawing ${done} of ${slots.length}…` : '');
    }));
    const leftOut = made.filter(m => m && m.leftOut).length;
    say(leftOut ? `${leftOut} photo${leftOut === 1 ? '' : 's'} could not be copied into a sticker, so ${leftOut === 1 ? 'that one shows' : 'those show'} the name on paper.` : '');
    // files, one per sticker, no two with the same name
    const files = () => {
      const seen = {};
      return made.filter(Boolean).map(m => {
        const key = m.kind === 'mascot' ? 'titmouse' : m.kind === 'wordmark' ? 'daybird' : m.name;
        seen[key] = (seen[key] || 0) + 1;
        return toFile(m.blob, fileName(seen[key] > 1 ? `${key}-${seen[key]}` : key));
      }).filter(Boolean);
    };
    if ($('print')) $('print').onclick = () => print();
    if ($('saveAll')) $('saveAll').onclick = async () => {
      const fs = files(); if (!fs.length) { say('Nothing drawn yet.'); return; }
      $('saveAll').disabled = true; say('Saving…');
      const shared = await shareFiles(fs, { title: 'Daybird stickers', text: 'My birds as stickers. day-bird.com', navigator: nav });
      if (shared === true) say(`Shared ${fs.length} stickers. On an iPhone, Save Image puts them in Photos.`);
      else if (shared === 'cancelled') say('');
      else {
        for (let i = 0; i < fs.length; i++) { download(fs[i], fs[i].name); if (i < fs.length - 1) await sleep(350); }
        say(`Saved ${fs.length} PNGs.`);
      }
      $('saveAll').disabled = false;
    };
    return { slots, made, files };
  }

  const API = {
    SIZE, CX, CY, R_IMG, BORDER, TAB, lastSpec: null,
    drawSticker, makeSticker, exportSticker, shareFiles, download, fileName, slug, pick, fillers, mount, svgImage, loadImage,
  };
  return API;
})();
globalThis.DAYBIRD_STICKERS = DAYBIRD_STICKERS;   // also reachable from Node for the unit checks in tests/
