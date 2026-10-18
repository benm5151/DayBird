/* Daybird premium preview — small UI pieces shared by plan.html and route.html.
   Everything on these pages is free while Daybird waits on eBird's commercial terms; this file holds the
   preview banner, the waitlist card and a reusable place picker. Needs js/app.js (DB) and js/cloud.js (CLOUD). */
const PREMIUM = (() => {
  const esc = (s) => DB.esc(s);
  const PRICES = [['3mo', '$3 a month'], ['5mo', '$5 a month'], ['30yr', '$30 a year'], ['', 'Not sure yet']];

  // The honest label every premium-preview page carries.
  function banner(el) {
    el.innerHTML = `<div class="banner ok"><b>Premium preview.</b> Everything on this page is free for now, and every percentage is an estimate from recent reports and the forecast, not a measurement. Daybird can't charge for anything built on eBird data until the Cornell Lab says yes.</div>`;
  }

  // Waitlist: posts { email, price, source } to the waitlist edge function. Works signed in or out.
  // Stores: the email and the price picked, nothing else (see migration-8.sql).
  // Through the SDK when it loaded (so a signed-in user's token goes along), else a plain fetch with the anon key.
  async function postWaitlist(body) {
    const cfg = window.DAYBIRD_CONFIG || {};
    if (CLOUD.ready) return CLOUD.invoke('waitlist', body);
    const r = await fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/functions/v1/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey, authorization: `Bearer ${cfg.supabaseAnonKey}` }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'waitlist function is not deployed yet' : `The waitlist refused (${r.status}).`));
    return j;
  }
  function waitlist(el, source) {
    const cfg = window.DAYBIRD_CONFIG || {};
    el.innerHTML = `
      <h3>Daybird Premium is coming</h3>
      <p class="tagline">Personal odds, a target-bird planner and the route finder, kept up to date, for people who want more than the free brief. Join the waitlist and tell us what feels fair.</p>
      <label for="wlEmail">Email</label>
      <div class="inline"><input id="wlEmail" type="email" placeholder="you@email.com" autocomplete="email"></div>
      <div class="inline" id="wlPrices" style="margin-top:8px">${PRICES.map(([v, l]) => `<button type="button" class="ghost small" data-price="${v}">${l}</button>`).join('')}</div>
      <p class="meta" id="wlMsg" role="status" aria-live="polite"></p>
      <p class="tagline">What is stored: your email and the price you picked, so we can send one email when Premium is ready. Nothing else.</p>`;
    const msg = el.querySelector('#wlMsg');
    el.querySelector('#wlPrices').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-price]'); if (!btn) return;
      const email = el.querySelector('#wlEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Enter your email first.'; return; }
      if (!cfg.supabaseUrl) { msg.textContent = 'The waitlist needs the online connection, which is not set up on this copy.'; return; }
      el.querySelectorAll('#wlPrices button').forEach((b) => (b.disabled = true));
      msg.textContent = 'Adding you…';
      try {
        const j = await postWaitlist({ email, price: btn.dataset.price, source });
        msg.textContent = j.already ? 'You were already on the list; we saved your new answer.' : "You're on the list. One email when Premium is ready, and nothing before.";
        el.querySelector('#wlEmail').value = '';
      } catch (err) { msg.textContent = /not deployed|not found|404/i.test(err.message) ? 'The waitlist is not switched on yet.' : err.message; }
      el.querySelectorAll('#wlPrices button').forEach((b) => (b.disabled = false));
    });
  }

  // Place picker: input + Find button + picks list. onPick({label, lat, lng}). Rounds to 2 decimals like the brief does.
  function placePicker({ input, find, picks, msg, onPick }) {
    const run = async () => {
      const q = input.value.trim(); if (q.length < 2) return;
      picks.innerHTML = ''; if (msg) msg.textContent = 'Looking…';
      try {
        const res = await DB.findPlaces(q);
        if (!res.length) { if (msg) msg.textContent = `No match for "${q}". Try "Town, ST".`; return; }
        if (msg) msg.textContent = '';
        picks.innerHTML = res.map((p, i) => `<button type="button" data-i="${i}">${esc(p.label)}</button>`).join('');
        picks.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; const p = res[Number(b.dataset.i)]; picks.innerHTML = ''; input.value = p.label; onPick({ label: p.label, lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100 }); };
      } catch (e) { if (msg) msg.textContent = 'Place search is not reachable right now.'; }
    };
    find.onclick = run;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  }

  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`); return r.json(); }
  const download = (name, text, type = 'text/calendar') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  return { banner, waitlist, placePicker, getJSON, download, PRICES };
})();
