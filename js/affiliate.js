/* Daybird affiliate link helper. Nothing on the site uses it yet: affiliate links wait for the Cornell Lab's answer
   on commercial eBird use (see README, "Legal, account deletion and friend circles").
   Every link it makes carries a visible "(affiliate link)" label and rel="sponsored noopener", which is what the
   FTC's endorsement guides and search engines ask for. Usage:
     el.appendChild(DAYBIRD_AFFILIATE.link('https://example.com/binoculars?tag=daybird', 'Nikon Prostaff 8x42'))
     el.innerHTML = DAYBIRD_AFFILIATE.html(url, text)      // string form for template literals */
(() => {
  const LABEL = '(affiliate link)';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
  function link(url, text) {
    const wrap = document.createElement('span');
    wrap.className = 'affiliate';
    const a = document.createElement('a');
    a.href = safeUrl(url); a.rel = 'sponsored noopener'; a.target = '_blank'; a.textContent = text || url;
    const tag = document.createElement('small');
    tag.className = 'affiliate-label'; tag.textContent = LABEL;
    tag.style.cssText = 'color:var(--muted);margin-left:4px';
    wrap.append(a, ' ', tag);
    return wrap;
  }
  const html = (url, text) => `<span class="affiliate"><a href="${esc(safeUrl(url))}" rel="sponsored noopener" target="_blank">${esc(text || url)}</a> <small class="affiliate-label" style="color:var(--muted);margin-left:4px">${LABEL}</small></span>`;
  globalThis.DAYBIRD_AFFILIATE = { link, html, LABEL };
})();
