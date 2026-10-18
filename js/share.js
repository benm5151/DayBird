/* Daybird share: the morning as a 1080×1350 picture (canvas, drawn in the browser, nothing sent anywhere)
   and a one-line "You in?" text. Works offline: it only needs the brief object the page already has
   and the mascot SVG in art/. */
const DAYBIRD_SHARE = (() => {
  const W = 1080, H = 1350;
  // Same colors as .sky-go / .sky-maybe / .sky-stay in css/style.css. Keep the two in step.
  const SKY = { go: ['#FBD38D', '#F2A65A', '#E8833A'], maybe: ['#DCE3EA', '#B9C5D2'], stay: ['#1F2A37', '#2C3B50'] };
  const INK = { go: '#1F2A37', maybe: '#1F2A37', stay: '#F6F3EC' };
  const CREAM = '#F6F3EC', AMBER = '#E8833A';
  const MASCOT = { go: 'art/mascot-go.svg', maybe: 'art/mascot-maybe.svg', stay: 'art/mascot-stay.svg' };

  // The page's own font stacks, so the card matches the site. Falls back to the same families style.css names.
  function fonts() {
    let serif = '', sans = '';
    try { const cs = getComputedStyle(document.documentElement); serif = cs.getPropertyValue('--serif').trim(); sans = cs.getPropertyValue('--sans').trim(); } catch {}
    return { serif: serif || '"Iowan Old Style","Palatino Linotype",Georgia,serif', sans: sans || 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif' };
  }
  // Greedy word wrap with the current ctx.font. A single word longer than maxW gets its own line.
  function wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW || !line) line = test; else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + src)); i.src = src; });
  }
  const grade = (b) => ({ go: 'go', maybe: 'maybe', stay: 'stay' })[b && b.call && b.call.grade] || 'maybe';

  // Draws the card onto a canvas and returns it. `b` is the object DB.loadBrief() returns (call, brief, spots).
  async function draw(b, opts = {}) {
    const g = grade(b), ink = INK[g], R = b.brief || {}, F = fonts();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    const stops = SKY[g]; stops.forEach((col, i) => sky.addColorStop(stops.length === 3 ? [0, .62, 1][i] : i, col));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // mascot (on a cream moon when the sky is navy, so the ink-navy bird still shows)
    const size = 400, mx = (W - size) / 2, my = 90;
    if (g === 'stay') { ctx.fillStyle = CREAM; ctx.beginPath(); ctx.arc(W / 2, my + size / 2, size / 2, 0, Math.PI * 2); ctx.fill(); }
    try { const img = opts.mascot || await loadImage(opts.base ? opts.base + MASCOT[g] : MASCOT[g]); ctx.drawImage(img, mx, my, size, size); }
    catch { /* no mascot: the word still carries the card */ }
    // the word
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 190px ${F.serif}`;
    const word = (b.call && b.call.word) || 'MAYBE';
    if (ctx.measureText(word).width > W - 120) ctx.font = `700 150px ${F.serif}`;
    ctx.fillText(word, W / 2, 660);
    // why this morning, wrapped
    ctx.font = `400 46px ${F.sans}`;
    const lines = wrap(ctx, R.whyLine || '', W - 160).slice(0, 6);
    let y = 745;
    for (const l of lines) { ctx.fillText(l, W / 2, y); y += 60; }
    // leave by
    if (R.leaveBy) {
      ctx.font = `600 40px ${F.sans}`; y += 24;
      ctx.fillText(`Leave by ${R.leaveBy} · first song ${R.firstSong}`, W / 2, Math.min(y, 1130)); y += 52;
    }
    // place and date
    ctx.globalAlpha = .82; ctx.font = `400 36px ${F.sans}`;
    const where = [R.place, R.dateLabel].filter(Boolean).join(' · ');
    for (const l of wrap(ctx, where, W - 160).slice(0, 2)) { ctx.fillText(l, W / 2, Math.max(y, 1185)); y = Math.max(y, 1185) + 46; }
    ctx.globalAlpha = 1;
    // wordmark, small, with the branch under it
    ctx.font = `700 44px ${F.serif}`; ctx.fillText('daybird', W / 2, 1290);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2 - 70, 1306); ctx.quadraticCurveTo(W / 2, 1300, W / 2 + 70, 1306); ctx.stroke();
    return c;
  }
  async function blob(b, opts) {
    const c = await draw(b, opts);
    return new Promise((res, rej) => c.toBlob((bl) => (bl ? res(bl) : rej(new Error('could not make the picture'))), 'image/png'));
  }
  const fileName = (b) => `daybird-${(b.brief && b.brief.date) || new Date().toISOString().slice(0, 10)}-${grade(b)}.png`;

  // Native share sheet when the browser has one and accepts files (phones), otherwise a download.
  // Returns 'shared' | 'downloaded' | 'cancelled'.
  async function share(b, opts = {}) {
    const bl = await blob(b, opts);
    const name = fileName(b);
    let file = null;
    try { file = new File([bl], name, { type: 'image/png' }); } catch {}
    const nav = opts.navigator || navigator;
    if (file && nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: `Daybird: ${b.call.word}`, text: smsText(b, opts.site) }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; /* else fall through to download */ }
    }
    const url = URL.createObjectURL(bl);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }

  // "Sat 6:50 AM, it's a GO at Mink Brook. You in? https://…"  (STAY IN days invite coffee instead)
  function smsText(b, site) {
    const R = b.brief || {}, call = b.call || {};
    const day = (R.shortDate || '').split(',')[0] || '';
    const when = [day, R.leaveBy].filter(Boolean).join(' ');
    const spot = b.spots && b.spots[0] && b.spots[0].name ? b.spots[0].name : (R.place || 'the usual spot');
    const link = site ? ' ' + site : '';
    if (call.grade === 'stay') return `${when ? when + ', ' : ''}it's a STAY IN morning. Coffee instead?${link}`;
    return `${when ? when + ', ' : ''}it's a ${call.word || 'MAYBE'} at ${spot}. You in?${link}`;
  }
  const smsHref = (b, site) => 'sms:?&body=' + encodeURIComponent(smsText(b, site));

  return { W, H, SKY, INK, MASCOT, wrap, draw, blob, share, smsText, smsHref, fileName };
})();
