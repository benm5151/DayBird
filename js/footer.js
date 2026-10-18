/* Daybird footer helper. Loaded after app.js on every page.
   Adds "Privacy · Terms · Not safety advice" to every <footer>, and the safety sentence when the page's own
   footer text does not already say it. Pages without a footer get one. Idempotent: safe to run many times,
   and it re-runs when a page rewrites its footer (feed.html does that after sign-in). */
(() => {
  const SAFETY = 'Daybird is a guide, not safety advice. Check conditions yourself.';
  const links = () => {
    const s = document.createElement('span');
    s.className = 'legal-links';
    s.style.cssText = 'display:block;margin-top:6px';
    s.innerHTML = '<a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a> · <a href="terms.html#safety">Not safety advice</a>';
    return s;
  };
  const safety = () => {
    const s = document.createElement('span');
    s.className = 'legal-safety';
    s.style.cssText = 'display:block;margin-top:6px';
    s.textContent = SAFETY;
    return s;
  };
  // The page's own words, without anything this script added.
  const ownText = (f) => [...f.childNodes].filter(n => !(n.nodeType === 1 && /legal-(links|safety)/.test(n.className))).map(n => n.textContent).join(' ');

  function ensure() {
    let foots = [...document.querySelectorAll('footer')];
    if (!foots.length) {
      const f = document.createElement('footer');
      (document.querySelector('.wrap') || document.body).appendChild(f);
      foots = [f];
    }
    for (const f of foots) {
      if (!f.querySelector('.legal-safety') && !/not safety advice/i.test(ownText(f))) f.appendChild(safety());
      if (!f.querySelector('.legal-links')) f.appendChild(links());
      if (!f.dataset.legalWatch) {
        f.dataset.legalWatch = '1';
        // feed.html and others may replace the footer text later; put the lines back when that happens.
        new MutationObserver(() => { if (!f.querySelector('.legal-links') || !f.querySelector('.legal-safety') && !/not safety advice/i.test(ownText(f))) ensure(); }).observe(f, { childList: true });
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
  globalThis.DAYBIRD_FOOTER = { ensure, SAFETY };
})();
