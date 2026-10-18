/* Daybird subscriber pages (signup.html, confirm.html, manage.html) share this: a caller for the `subscribe`
   edge function and the place picker from the Brief page's email card. Loaded after js/app.js. */
const SUB = (() => {
  const cfg = window.DAYBIRD_CONFIG || {};
  // Plain fetch rather than the Supabase SDK: nobody on these pages is signed in, and the pages should work even
  // if the SDK failed to load. The anon key is public by design; the function checks the tokens in the body.
  async function call(action, body = {}) {
    if (!cfg.supabaseUrl) throw new Error('Signing up by email needs the online connection, which is off here.');
    let r;
    try {
      r = await fetch(`${cfg.supabaseUrl}/functions/v1/subscribe`, {
        method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey || '', authorization: 'Bearer ' + (cfg.supabaseAnonKey || '') },
        body: JSON.stringify({ action, ...body }),
      });
    } catch { throw new Error("Couldn't reach Daybird just now. Try again in a minute."); }
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'The subscribe function is not deployed yet.' : `Something went wrong (${r.status}).`));
    return j;
  }

  // Place picker: ids { q, find, geo, picks, now, msg }. Calls onPick(place) with { label, lat, lng } (lat/lng rounded).
  function picker(ids, initial, onPick) {
    const $ = (id) => document.getElementById(id);
    let place = initial;
    const say = (t, bad) => { $(ids.msg).textContent = t; $(ids.msg).style.color = bad ? 'var(--red)' : ''; };
    const show = () => { $(ids.now).textContent = place ? place.label : 'nothing yet'; };
    const set = (p) => { place = { label: p.label, lat: +(+p.lat).toFixed(2), lng: +(+p.lng).toFixed(2) }; show(); $(ids.picks).innerHTML = ''; say(''); onPick && onPick(place); };
    show();
    $(ids.find).onclick = async () => {
      const q = $(ids.q).value.trim(); if (!q) return;
      $(ids.picks).innerHTML = ''; say('Looking…');
      try {
        const r = await DB.findPlaces(q);
        if (!r.length) return say('No match. Try the town name with its state, like "Hanover, NH".', true);
        say('Pick one:');
        $(ids.picks).innerHTML = r.map((p, i) => `<button type="button" data-i="${i}">${DB.esc(p.label)}</button>`).join('');
        $(ids.picks).onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) set(r[+b.dataset.i]); };
      } catch (e) { say('Place search failed: ' + e.message, true); }
    };
    $(ids.q).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $(ids.find).click(); } });
    $(ids.geo).onclick = () => {
      if (!navigator.geolocation) return say('This device has no location access.', true);
      say('Asking your device for its location…');
      // rounded to 2 decimals (about 1 km): plenty for a brief, and nothing more precise leaves the browser
      navigator.geolocation.getCurrentPosition((p) => set({ label: 'My current location', lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => say(e.message || 'Could not get your location.', true), { timeout: 15000 });
    };
    return { get: () => place, set };
  }

  // <option>s for the mode and level selects, from the engine's vocabulary
  const modeOptions = (sel) => Object.entries(DAYBIRD_BRIEF.MODES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${DB.esc(v.label)}</option>`).join('');
  const levelOptions = (sel) => Object.entries(DAYBIRD_BRIEF.LEVELS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${DB.esc(v)}</option>`).join('');

  return { call, picker, modeOptions, levelOptions };
})();
