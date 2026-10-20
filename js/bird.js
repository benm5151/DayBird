/* Daybird bird.html?name=<eBird common name>: what this bird is up to right now.
   Loaded after data/tells.js, data/status.js, js/app.js, js/footer.js and js/compare.js (for the photo fetcher and the
   expected-frequency detection). Photo + credit, the name, the status word, a 12-cell month strip, the current season's
   line big and the other three small, the one tell from data/tells.js (linking to compare.html?g=<group>), Wikipedia and
   All About Birds, and the local count line when data/expected/<code>.json exists for the set location.
   Without ?name it lists every bird we have written up. With a name we have no entry for: photo, name, links, and
   "We haven't written this one up yet." */
(() => {
  const C = globalThis.DAYBIRD_COMPARE, ST = globalThis.DAYBIRD_STATUS, TL = globalThis.DAYBIRD_TELLS;
  const esc = C.esc;
  const root = document.getElementById('bird'); if (!root) return;
  const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const CAVEAT = '<p class="caveat">Written by Daybird from field guides; not yet checked by an expert birder. Spot an error? <a href="about.html">Tell us</a>.</p>';
  const aab = (name) => `https://www.allaboutbirds.org/guide/${encodeURIComponent(String(name).replace(/['’.]/g, '').replace(/\s+/g, '_'))}`;
  const wiki = (name, p) => (p && p.wiki) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(C.photos.titleOf(name)));

  function monthStrip(months, nowM) {
    return `<div class="months" role="img" aria-label="Present ${months.length === 12 ? 'all year' : 'in ' + months.map(m => ST.MONTHS[m - 1]).join(', ')}">` +
      LETTERS.map((l, i) => `<div class="${months.includes(i + 1) ? 'on' : ''} ${i + 1 === nowM ? 'now' : ''}" title="${esc(ST.MONTHS[i])}">${l}</div>`).join('') + '</div>';
  }

  function index() {
    const names = ST ? ST.names().sort() : [];
    document.title = 'Daybird — Birds right now';
    root.innerHTML = `<h1>What is each bird up to?</h1><p class="lead">Tap one for whether it is here, arriving, peaking or leaving, and what it is doing this month.</p>
      <ul class="index">${names.map(n => `<li><a href="${C.birdHref(n)}">${esc(n)}</a></li>`).join('')}</ul>` + CAVEAT;
  }

  function render(name, date) {
    const d = date ? new Date(date) : new Date();
    const nowM = d.getMonth() + 1;
    const st = ST ? ST.now(name, d) : null;
    const tell = TL && TL.get ? TL.get(name) : null;
    const group = tell && TL.find(g => g.key === tell.group);
    document.title = `Daybird — ${name}`;
    const others = st ? ['spring', 'summer', 'fall', 'winter'].filter(s => s !== st.season) : [];
    root.innerHTML = `<article class="bird" data-name="${esc(name)}">
      <div>
        <div class="pic" id="pic"><span class="paper">${esc(name)}</span></div>
        <p class="credit" id="credit"></p>
      </div>
      <div>
        ${st ? `<p class="word" id="word">${esc(st.word)}</p>` : ''}
        <h1 id="name">${esc(name)}</h1>
        ${st ? monthStrip(st.months, nowM) : ''}
        ${st ? `<p class="now" id="now"><b>${esc(ST.MONTHS[nowM - 1])}:</b> ${esc(st.line)}</p>
                <div class="others" id="others">${others.map(s => `<p><b>${s}</b> · ${esc(ST.species[name].seasons[s])}</p>`).join('')}</div>`
            : `<p class="notyet" id="notyet">We haven't written this one up yet.</p>`}
        ${tell ? `<div class="card tell" id="tell"><h3>The one thing to look for</h3><p>${esc(tell.look)}</p><a href="compare.html?g=${encodeURIComponent(tell.group)}">Compare with the other ${esc(group && group.title ? group.title.toLowerCase() : 'birds in its group')}</a></div>` : ''}
        <p class="count" id="count"></p>
        <div class="links" id="links">
          <a class="btn ghost small" id="wikiLink" href="${esc(wiki(name))}" target="_blank" rel="noopener">Wikipedia</a>
          <a class="btn ghost small" href="${esc(aab(name))}" target="_blank" rel="noopener">All About Birds</a>
          ${TL && TL.length ? `<a class="meta" href="compare.html">Which one is that?</a>` : ''}
        </div>
      </div>
    </article>` + CAVEAT;

    // photo (cached at once, else fetched), never a broken image
    const pic = document.getElementById('pic'), credit = document.getElementById('credit');
    const place = (p) => {
      if (!p || !p.thumb) return;
      const img = new Image(); img.alt = name; img.decoding = 'async';
      img.onload = () => pic.classList.add('has-photo');
      img.onerror = () => { img.remove(); pic.classList.remove('has-photo'); credit.textContent = ''; };
      img.src = p.image && p.image !== p.thumb && innerWidth > 700 ? p.image : p.thumb;
      pic.insertBefore(img, pic.firstChild);
      credit.innerHTML = C.photos.creditHtml(p);
      const w = document.getElementById('wikiLink'); if (w && p.wiki) w.href = p.wiki;
    };
    const hit = C.photos.cached(name);
    if (hit && !hit.none) place(hit); else if (!hit) C.photos.request(name).then(place);

    // local counts, when the data is there for the set location
    C.expected().then(ex => { const line = C.countLine(ex, name); if (line) document.getElementById('count').textContent = line + '.'; }).catch(() => {});
  }

  const name = new URL(location.href).searchParams.get('name');
  const at = new URL(location.href).searchParams.get('at');   // ?at=2026-10-20 for a fixed date (tests, screenshots)
  if (!name || !name.trim()) index(); else render(name.trim(), at || undefined);
  globalThis.DAYBIRD_BIRD = { render, index, monthStrip, aab };
})();
