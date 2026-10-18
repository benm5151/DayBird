/* Daybird bird card: draws a 1080×1350 share card on a canvas.
   DAYBIRD_CARD.render(canvas, { name, hint, art: 'art/birds/x.svg', where, song, date, photo })
     art   path to a silhouette SVG (loaded as an Image from a Blob URL, so it works from file:// too)
     photo optional Image, data URL or Blob URL; when given, the photo fills a rounded frame and the
           silhouette (if any) shrinks to a corner stamp
   DAYBIRD_CARD.toBlob()  → Promise<Blob> (PNG of the last rendered canvas)
   DAYBIRD_CARD.download(filename) → saves the last card */
const DAYBIRD_CARD = (() => {
  const W = 1080, H = 1350;
  const PAPER = '#F6F3EC', INK = '#1F2A37', AMBER = '#E8833A', MUTED = '#5f6b63';
  const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"DejaVu Serif",serif';
  const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,"DejaVu Sans",sans-serif';
  let last = null;
  const svgCache = {};

  // SVG → Image via a Blob URL. Width/height are added so every browser gives the image a size.
  async function loadSvg(path) {
    if (svgCache[path]) return svgCache[path];
    const res = await fetch(path);
    if (!res.ok) throw new Error('Could not load ' + path);
    let text = await res.text();
    if (!/<svg[^>]*\swidth=/.test(text)) text = text.replace(/<svg\s/, '<svg width="240" height="240" ');
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try { return (svgCache[path] = await loadImage(url)); } finally { URL.revokeObjectURL(url); }
  }
  function loadImage(src) {
    if (src instanceof HTMLImageElement && src.complete && src.naturalWidth) return Promise.resolve(src);
    return new Promise((res, rej) => {
      const img = src instanceof HTMLImageElement ? src : new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('Image failed to load'));
      if (!(src instanceof HTMLImageElement)) img.src = src;
    });
  }

  // Greedy word wrap; returns the lines actually drawn.
  function wrap(ctx, text, x, y, maxW, lineH, maxLines = 3) {
    const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
    return lines;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // draw an image into a box, cover-style
  function cover(ctx, img, x, y, w, h) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  async function render(canvas, o = {}) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    const art = o.art ? await loadSvg(o.art).catch(() => null) : null;
    const photo = o.photo ? await loadImage(o.photo).catch(() => null) : null;

    // wordmark, top left; date, top right
    ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 40px ${SERIF}`; ctx.textAlign = 'left'; ctx.fillText('daybird', 72, 104);
    ctx.fillStyle = AMBER; ctx.fillRect(72, 118, 56, 5);
    if (o.date) { ctx.fillStyle = MUTED; ctx.font = `26px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(String(o.date), W - 72, 104); }

    let textTop;
    if (photo) {
      // photo in a rounded frame, silhouette as a small stamp in the lower right corner of the frame
      const fx = 72, fy = 160, fw = W - 144, fh = 820;
      ctx.save(); roundRect(ctx, fx, fy, fw, fh, 44); ctx.clip(); cover(ctx, photo, fx, fy, fw, fh); ctx.restore();
      ctx.strokeStyle = AMBER; ctx.lineWidth = 6; roundRect(ctx, fx, fy, fw, fh, 44); ctx.stroke();
      if (art) {
        const s = 200, sx = fx + fw - s - 24, sy = fy + fh - s - 24;
        ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(sx + s / 2, sy + s / 2, s / 2 + 12, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(art, sx, sy, s, s);
      }
      textTop = 1090;
    } else {
      if (art) ctx.drawImage(art, 150, 140, 780, 780);
      textTop = 1000;
    }

    ctx.textAlign = 'left'; ctx.fillStyle = INK;
    ctx.font = `700 76px ${SERIF}`;
    const name = String(o.name || 'A bird');
    let nameLines = 1;
    if (ctx.measureText(name).width > W - 144) { ctx.font = `700 60px ${SERIF}`; nameLines = wrap(ctx, name, 72, textTop, W - 144, 66, 2).length; }
    else ctx.fillText(name, 72, textTop);
    let y = textTop + (nameLines > 1 ? 66 * nameLines + 10 : 62);
    if (o.hint) { ctx.fillStyle = INK; ctx.font = `34px ${SANS}`; y += 44 * wrap(ctx, o.hint, 72, y, W - 144, 44, photo ? 2 : 3).length; }
    const meta = [o.where, o.song].filter(Boolean).join('  ·  ');
    if (meta) {
      const my = Math.max(y + 40, H - 72);
      ctx.fillStyle = AMBER; ctx.fillRect(72, my - 44, 56, 4);
      ctx.fillStyle = MUTED; ctx.font = `28px ${SANS}`; wrap(ctx, meta, 72, my, W - 144, 36, 1);
    }
    last = canvas;
    return canvas;
  }
  function toBlob(type = 'image/png') {
    if (!last) return Promise.reject(new Error('Render a card first'));
    return new Promise((res, rej) => last.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), type));
  }
  async function download(filename = 'daybird-card.png') {
    const b = await toBlob(); const url = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return b;
  }
  return { render, toBlob, download, loadSvg, W, H };
})();
