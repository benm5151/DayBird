/* Daybird canvas kit: the drawing helpers the share pictures have in common (js/stories.js uses it; js/share.js and
   js/birdcard.js predate it and keep their own copies so index.html and art.html load nothing extra).
   Everything here draws in the browser; nothing is sent anywhere. Loads as a plain <script> or a Node require (sets DAYBIRD_KIT).
     colors      PAPER, INK, AMBER, SKY (gradient stops by grade), SKY_INK (ink that reads on each sky), MASCOT (paths)
     fonts()     the page's --serif / --sans stacks, with the same fallbacks css/style.css names
     wrap        greedy word wrap; fit shrinks a font until the text fits a width and a line count, then ellipsizes
     loadSvg     SVG → Image through a Blob URL (works from file:// too); loadImage for anything else
     background  paper, navy, or a sky gradient by grade; markBadge, mascot, wordmark, rule, roundRect
     toBlob, toFile, download, shareFiles (system share sheet with the files, or 'unsupported') */
((root) => {
  const PAPER = '#F6F3EC', INK = '#1F2A37', AMBER = '#E8833A';
  // Same stops as .sky-go / .sky-maybe / .sky-stay in css/style.css and SKY in js/share.js. Keep the three in step.
  const SKY = { go: ['#FBD38D', '#F2A65A', '#E8833A'], maybe: ['#DCE3EA', '#B9C5D2'], stay: ['#1F2A37', '#2C3B50'] };
  const SKY_INK = { go: INK, maybe: INK, stay: PAPER, paper: INK, navy: PAPER };
  // The accent that still shows on each background: amber everywhere except on the amber GO sky, where navy carries it.
  const SKY_ACCENT = { go: INK, maybe: AMBER, stay: AMBER, paper: AMBER, navy: AMBER };
  const MASCOT = { go: 'art/mascot-go.svg', maybe: 'art/mascot-maybe.svg', stay: 'art/mascot-stay.svg' };
  const MARK = 'mark.svg';

  function fonts() {
    let serif = '', sans = '';
    try { const cs = getComputedStyle(document.documentElement); serif = cs.getPropertyValue('--serif').trim(); sans = cs.getPropertyValue('--sans').trim(); } catch {}
    return { serif: serif || '"Iowan Old Style","Palatino Linotype",Georgia,serif', sans: sans || 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif' };
  }
  const font = (weight, size, family) => `${weight} ${size}px ${family}`;

  // Greedy word wrap with the current ctx.font. A single word longer than maxW gets its own line (fit() shrinks for that).
  function wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW || !line) line = test; else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
  }
  // Cut a line to maxW with an ellipsis, with the current ctx.font.
  function ellipsize(ctx, text, maxW) {
    let s = String(text || '');
    if (ctx.measureText(s).width <= maxW) return s;
    s = s.replace(/…$/, '');
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1).replace(/\s+$/, '');
    return s + '…';
  }
  // Shrink from `start` by `step` until the text wraps into at most maxLines lines that each fit maxW, stopping at `min`.
  // Anything still too long at `min` is cut with an ellipsis, so nothing ever overflows. Leaves ctx.font set to the result.
  // Returns { size, lines, widths }.
  function fit(ctx, text, o) {
    const { weight = 700, family, maxW, start, min = 24, maxLines = 1, step = 4 } = o;
    let size = start, lines = [];
    for (;;) {
      ctx.font = font(weight, size, family);
      lines = wrap(ctx, text, maxW);
      const ok = lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW);
      if (ok || size - step < min) break;
      size -= step;
    }
    if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '); lines = keep; }
    lines = lines.map(l => ellipsize(ctx, l, maxW));
    return { size, lines, widths: lines.map(l => ctx.measureText(l).width) };
  }

  // ---------- images ----------
  const svgCache = {};
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('could not load ' + src)); i.src = src; });
  }
  // SVG as text → Blob URL → Image. Width/height are added when missing so every browser gives the image a size.
  async function loadSvg(path) {
    if (svgCache[path]) return svgCache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error('could not load ' + path);
    let text = await res.text();
    if (!/<svg[^>]*\swidth=/.test(text)) text = text.replace(/<svg\s/, '<svg width="240" height="240" ');
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try { return (svgCache[path] = await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  }
  // Mark and the three mascots, loaded once; a missing file gives null and the type carries the picture.
  async function art(base = '') {
    const get = (p) => loadSvg(base + p).catch(() => null);
    const [mark, go, maybe, stay] = await Promise.all([get(MARK), get(MASCOT.go), get(MASCOT.maybe), get(MASCOT.stay)]);
    return { mark, mascot: { go, maybe, stay } };
  }

  // ---------- shapes ----------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // kind: 'paper' | 'navy' | 'go' | 'maybe' | 'stay'. Returns the ink and accent that read on it.
  function background(ctx, W, H, kind) {
    if (kind === 'paper' || kind === 'navy') { ctx.fillStyle = kind === 'paper' ? PAPER : INK; ctx.fillRect(0, 0, W, H); }
    else {
      const stops = SKY[kind] || SKY.maybe, g = ctx.createLinearGradient(0, 0, 0, H);
      stops.forEach((col, i) => g.addColorStop(stops.length === 3 ? [0, .62, 1][i] : i, col));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    return { ink: SKY_INK[kind] || INK, accent: SKY_ACCENT[kind] || AMBER, dark: kind === 'stay' || kind === 'navy' };
  }
  // The header lockup from the site: the titmouse mark on a cream rounded square with an amber edge. Reads on every background.
  function markBadge(ctx, img, x, y, size) {
    const r = Math.round(size * 0.27);
    ctx.fillStyle = PAPER; roundRect(ctx, x, y, size, size, r); ctx.fill();
    ctx.strokeStyle = AMBER; ctx.lineWidth = Math.max(3, Math.round(size / 28)); roundRect(ctx, x, y, size, size, r); ctx.stroke();
    if (img) { const pad = Math.round(size * 0.14); ctx.drawImage(img, x + pad, y + pad, size - 2 * pad, size - 2 * pad); }
  }
  // A mascot pose; on dark backgrounds it sits on a cream disc, like the front door's STAY IN sky.
  function mascot(ctx, img, x, y, size, dark) {
    if (dark) { ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill(); }
    if (img) ctx.drawImage(img, x, y, size, size);
  }
  // A short accent rule, the branch under the wordmark made straight.
  function rule(ctx, x, y, w, h, color) { ctx.fillStyle = color; roundRect(ctx, x, y, w, h, h / 2); ctx.fill(); }
  // "daybird" with the amber branch under it, and the site name small, centered on x.
  function wordmark(ctx, x, y, o) {
    const F = o.fonts || fonts();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = o.ink || INK; ctx.font = font(700, o.size || 48, F.serif); ctx.fillText('daybird', x, y);
    const half = (o.size || 48) * 1.45;
    ctx.strokeStyle = o.accent || AMBER; ctx.lineWidth = Math.max(4, (o.size || 48) / 8); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - half, y + 16); ctx.quadraticCurveTo(x, y + 10, x + half, y + 16); ctx.stroke();
    if (o.site) { ctx.globalAlpha = 0.72; ctx.font = font(400, Math.round((o.size || 48) * 0.6), F.sans); ctx.fillText(o.site, x, y + (o.size || 48) * 1.2); ctx.globalAlpha = 1; }
  }
  // Letter-spaced small caps line (eyebrow). Uses ctx.letterSpacing where the browser has it, else spaces the letters by hand.
  function eyebrow(ctx, text, x, y, o) {
    const F = o.fonts || fonts(), size = o.size || 36, spacing = o.spacing || Math.round(size * 0.14);
    ctx.font = font(600, size, F.sans); ctx.fillStyle = o.color || AMBER; ctx.textBaseline = 'alphabetic';
    const t = String(text || '').toUpperCase();
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = spacing + 'px'; ctx.textAlign = o.align || 'left';
      ctx.fillText(t, x, y); const w = ctx.measureText(t).width; ctx.letterSpacing = '0px'; return w;
    }
    const widths = [...t].map(ch => ctx.measureText(ch).width), total = widths.reduce((a, b) => a + b, 0) + spacing * (t.length - 1);
    let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    [...t].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + spacing; });
    return total;
  }

  // ---------- out ----------
  const toBlob = (canvas, type = 'image/png') => new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('could not make the picture'))), type));
  async function toFile(canvas, name) { const b = await toBlob(canvas); try { return new File([b], name, { type: 'image/png' }); } catch { return b; } }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  // One system share sheet with every file. Returns 'shared' | 'cancelled' | 'unsupported' (then the caller downloads).
  async function shareFiles(files, o = {}) {
    const nav = o.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav || typeof nav.share !== 'function' || !files.length || !files.every(f => typeof File !== 'undefined' && f instanceof File)) return 'unsupported';
    if (typeof nav.canShare === 'function') { try { if (!nav.canShare({ files })) return 'unsupported'; } catch { return 'unsupported'; } }
    try { await nav.share({ files, title: o.title || 'Daybird', text: o.text || '' }); return 'shared'; }
    catch (e) { return e && e.name === 'AbortError' ? 'cancelled' : 'unsupported'; }
  }

  root.DAYBIRD_KIT = { PAPER, INK, AMBER, SKY, SKY_INK, SKY_ACCENT, MASCOT, MARK, fonts, font, wrap, ellipsize, fit, loadImage, loadSvg, art, roundRect, background, markBadge, mascot, rule, wordmark, eyebrow, toBlob, toFile, download, shareFiles };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
