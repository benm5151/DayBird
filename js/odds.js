/* Daybird premium preview engine — odds, best mornings, migration windows, head-to-head, route sampling.
   Everything here is an ESTIMATE from data the brief already has (no new API calls): the daily brief.json or a live
   DB.loadBrief() (spot species counts over 3 days, the species reported nearby, the morning weather, the call score)
   plus a 7-day daily forecast from Open-Meteo for the planner. Pure functions, no DOM, no network.
   Loads as a plain <script>, a Node require, or a Deno import (it only sets a global). Needs js/brief.js first.

   THE FORMULAS (also in README → "Premium preview"):

   P(15+ species in a morning at a spot)
     perDay = min(species3d / 3, 40)                 species reported at the spot over 3 days, per day, capped
     base   = clamp(0.5 + (perDay - 15) / 20, 0, 1)  15 a day is even odds; every 4 species moves it 20 points
     scale  = clamp(score / 70, 0.3, 1.3)            70 is the GO threshold, so a GO morning scales up, STAY IN down
     wxPen  = rainPen × windPen                       rain ≥60%: ×0.6, ≥40%: ×0.8 · wind ≥18 mph: ×0.7, ≥12: ×0.85
     p      = clamp(base × scale × wxPen, 0.03, 0.95)

   P(seeing one species)
     base   = reported nearby in the last 3 days ? 0.55 : 0.08
     season = SEASON[group][month]                   hand-written factor per bird group per month (0.05–1.2), default 1
     p      = clamp(base × scale × wxPen × season, 0.03, 0.95)

   Nothing shown is ever above 95% or below 3%. These are heuristics, not a model fitted to data. */
(function (root) {
  const B = () => root.DAYBIRD_BRIEF;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const MIN_P = 0.03, MAX_P = 0.95;

  // ---------------------------------------------------------------- seasonal factors (Northeast US), Jan..Dec
  const SEASON = {
    warblers:      [0.1, 0.1, 0.2, 0.6, 1.2, 0.9, 0.8, 1.0, 1.2, 0.6, 0.2, 0.1],
    waterfowl:     [0.8, 0.8, 1.1, 1.2, 0.8, 0.6, 0.6, 0.6, 0.8, 1.2, 1.2, 0.9],
    raptors:       [0.7, 0.7, 0.9, 1.1, 0.9, 0.8, 0.8, 0.9, 1.2, 1.1, 0.8, 0.7],
    shorebirds:    [0.1, 0.1, 0.3, 0.7, 1.1, 0.6, 0.9, 1.2, 1.1, 0.7, 0.3, 0.1],
    finches:       [1.2, 1.2, 1.0, 0.8, 0.7, 0.7, 0.7, 0.7, 0.8, 1.0, 1.2, 1.2],
    sparrows:      [0.8, 0.8, 0.9, 1.1, 1.0, 0.9, 0.9, 0.9, 1.1, 1.2, 0.9, 0.8],
    swallows:      [0.05, 0.05, 0.3, 1.0, 1.2, 1.2, 1.2, 1.1, 0.8, 0.3, 0.05, 0.05],
    hummingbirds:  [0.05, 0.05, 0.05, 0.3, 1.1, 1.2, 1.2, 1.2, 0.9, 0.2, 0.05, 0.05],
    flycatchers:   [0.05, 0.05, 0.2, 0.7, 1.2, 1.1, 1.1, 1.1, 0.9, 0.3, 0.05, 0.05],
    vireos:        [0.05, 0.05, 0.1, 0.6, 1.2, 1.1, 1.1, 1.0, 1.0, 0.4, 0.05, 0.05],
    thrushes:      [0.5, 0.5, 0.8, 1.1, 1.2, 1.0, 1.0, 1.0, 1.1, 1.0, 0.6, 0.5],
    kinglets:      [0.6, 0.6, 0.8, 1.2, 0.9, 0.6, 0.6, 0.6, 1.0, 1.2, 0.8, 0.6],
    blackbirds:    [0.5, 0.5, 1.0, 1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.2, 0.8, 0.5],
    waders:        [0.2, 0.2, 0.4, 1.0, 1.1, 1.1, 1.1, 1.2, 1.0, 0.7, 0.3, 0.2],
    owls:          [1.1, 1.2, 1.1, 0.9, 0.8, 0.8, 0.8, 0.8, 0.9, 1.0, 1.0, 1.1],
    kingfishers:   [0.3, 0.3, 0.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7, 0.4],
    'feeder birds':[1.1, 1.1, 1.0, 1.0, 0.9, 0.9, 0.9, 0.9, 1.0, 1.0, 1.1, 1.1],
    'game birds':  [1.0, 1.0, 1.1, 1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0],
    // gulls, woodpeckers, corvids and anything unmatched: 1.0 all year
  };
  const seasonFactor = (group, month) => { const row = SEASON[group]; const m = clamp(Math.round(Number(month) || 1), 1, 12); return row ? row[m - 1] : 1; };

  // ---------------------------------------------------------------- the two odds
  const scaleFor = (score) => clamp((Number.isFinite(score) ? score : 50) / 70, 0.3, 1.3);
  function weatherPenalty(wx) {
    if (!wx) return 1;
    const rain = wx.rain >= 60 ? 0.6 : wx.rain >= 40 ? 0.8 : 1;
    const wind = wx.wind >= 18 ? 0.7 : wx.wind >= 12 ? 0.85 : 1;
    return rain * wind;
  }
  const bound = (p) => clamp(Number.isFinite(p) ? p : MIN_P, MIN_P, MAX_P);

  // species: distinct species reported at the spot over `days` days (brief.json spots[].species)
  function spotOdds({ species, days = 3, score, wx }) {
    const perDay = Math.min((Number(species) || 0) / (days || 3), 40);
    const base = clamp(0.5 + (perDay - 15) / 20, 0, 1);
    const scale = scaleFor(score), wxPen = weatherPenalty(wx);
    return { p: bound(base * scale * wxPen), perDay: Math.round(perDay * 10) / 10, base, scale, wxPen };
  }
  // name: species; recent: names reported nearby; group: override (else from the engine's group rules)
  function speciesOdds({ name, recent, score, wx, month, group }) {
    const list = (recent || []).map((r) => (typeof r === 'string' ? r : r && r.comName)).filter(Boolean);
    const inRecent = list.some((n) => n.toLowerCase() === String(name || '').toLowerCase());
    const g = group || (B() ? B().groupOf(name) : null);
    const season = seasonFactor(g, month);
    const base = inRecent ? 0.55 : 0.08;
    const scale = scaleFor(score), wxPen = weatherPenalty(wx);
    return { p: bound(base * scale * wxPen * season), inRecent, group: g, season, base, scale, wxPen };
  }
  const pct = (p) => `${Math.round(bound(p) * 100)}%`;

  // ---------------------------------------------------------------- 7-day forecast → one wx object per day
  // Same units and zone handling as DAYBIRD_BRIEF.weatherUrl, but daily fields only (one small request).
  function forecastUrl(lat, lng) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,sunrise` +
      `&timezone=auto&forecast_days=7&wind_speed_unit=mph&temperature_unit=fahrenheit`;
  }
  // Daily fields are a rougher picture than the hourly morning window the brief uses, so:
  // morning temp ≈ the daily low; morning wind ≈ 70% of the daily max; rain = the day's max probability.
  function wxFromDaily(daily, i) {
    if (!daily || !daily.time || !daily.time[i]) return null;
    const n = (k, d = NaN) => { const v = daily[k] && daily[k][i]; return typeof v === 'number' ? v : d; };
    const r = (x, d = 0) => (Number.isFinite(x) ? Math.round(x) : d);
    const windMax = n('wind_speed_10m_max'), low = n('temperature_2m_min'), high = n('temperature_2m_max');
    if (!Number.isFinite(low) && !Number.isFinite(high)) return null;
    return {
      temp: r(Number.isFinite(low) ? low : high), wind: r(windMax * 0.7), windDir: r(n('wind_direction_10m_dominant')), rain: r(n('precipitation_probability_max')),
      cloud: 50, cloudMid: 50, windMid: r(windMax), high: r(high, NaN), low: r(low, NaN),
      sunrise: String((daily.sunrise || [])[i] || '').slice(11, 16), date: daily.time[i], approx: true,
    };
  }
  function scoreDays(daily) {
    const out = [];
    for (let i = 0; i < ((daily && daily.time) || []).length; i++) {
      const wx = wxFromDaily(daily, i); if (!wx) continue;
      const month = Number(wx.date.slice(5, 7));
      out.push({ date: wx.date, wx, month, call: B().score({ wx, month }) });
    }
    return out;
  }

  // ---------------------------------------------------------------- target-bird planner
  // Best hour by group. Raptors ride thermals, so late morning (the engine's soaring line says 10 AM to 2 PM).
  // Owls: before first light. Waterfowl: once the light is on the water. Everyone else: half an hour after sunrise.
  function bestHour(group, sunrise) {
    const add = B().addMin, ampm = B().ampm;
    if (group === 'raptors') return { time: '10:00', label: '10:00 AM', note: 'late morning, once thermals build' };
    if (group === 'owls') return { time: add(sunrise, -60), label: ampm(add(sunrise, -60)), note: 'an hour before sunrise, while it is still dark' };
    if (group === 'waterfowl') return { time: add(sunrise, 60), label: ampm(add(sunrise, 60)), note: 'an hour after sunrise, with full light on the water' };
    return { time: add(sunrise, 30), label: ampm(add(sunrise, 30)), note: 'half an hour after sunrise' };
  }
  // Trait hint from DAYBIRD_TRAITS when the species is in the table, else the engine's group tip.
  function idTip(name, traits, level = 'new') {
    const row = (traits || []).find((r) => r[0].toLowerCase() === String(name || '').toLowerCase());
    if (row && row[5]) return row[5];
    const g = B().lookFor([name], 'any', level);
    return g.length && g[0].tip ? g[0].tip : '';
  }
  // in: { name, daily (Open-Meteo daily block), recent, traits, level, today (YYYY-MM-DD) }
  // out: { group, inRecent, days: [...all scored days], best: top 3 by odds, tip }
  function bestMornings({ name, daily, recent, traits, level, today }) {
    const group = B().groupOf(name);
    const days = scoreDays(daily).filter((d) => !today || d.date >= today).map((d) => {
      const odds = speciesOdds({ name, recent, score: d.call.score, wx: d.wx, month: d.month, group });
      const hour = bestHour(group, d.wx.sunrise);
      return { ...d, odds, p: odds.p, hour, label: dayLabel(d.date) };
    });
    const best = [...days].sort((a, b) => b.p - a.p || a.date.localeCompare(b.date)).slice(0, 3);
    return { name, group, inRecent: days.length ? days[0].odds.inRecent : false, days, best, tip: idTip(name, traits, level) };
  }
  const dayLabel = (date, o = { weekday: 'long', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(new Date(`${date}T12:00:00Z`));
  const weekday = (date) => dayLabel(date, { weekday: 'long' });

  // ---------------------------------------------------------------- .ics for "add to calendar"
  // Floating local time (no TZID): the event lands at that wall-clock time wherever the calendar is set, which is
  // what you want for "be at the pond at 7:30".
  const icsEsc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
  const fold = (line) => { const out = []; let s = line; while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); } out.push(s); return out.join('\r\n'); };
  // in: { date: YYYY-MM-DD, time: HH:MM, minutes (default 90), title, description, location, url, uid, stamp (Date) }
  function ics(e) {
    const add = B().addMin;
    const d = String(e.date || '').replace(/-/g, ''), t = String(e.time || '07:00').replace(':', '') + '00';
    const end = add(e.time || '07:00', e.minutes || 90).replace(':', '') + '00'; // same day: a morning slot never crosses midnight
    const endDate = d;
    const stamp = (e.stamp || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daybird//Target planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', `UID:${e.uid || `daybird-${d}-${(e.title || 'morning').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}@daybird`}`, `DTSTAMP:${stamp}`,
      `DTSTART:${d}T${t}`, `DTEND:${endDate}T${end}`, `SUMMARY:${icsEsc(e.title)}`];
    if (e.description) L.push(`DESCRIPTION:${icsEsc(e.description)}`);
    if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.url) L.push(`URL:${icsEsc(e.url)}`);
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- distance and routes
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toR = (x) => (x * Math.PI) / 180;
    const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // coords: GeoJSON [[lng, lat], ...]. Emits a point every `everyKm`, spacing widened so there are never more than `max`.
  function samplePolyline(coords, everyKm = 10, max = 20) {
    const pts = (coords || []).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (!pts.length) return { samples: [], lengthKm: 0, spacingKm: everyKm };
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    const spacing = Math.max(everyKm, total / Math.max(1, max - 1));
    const samples = [{ lat: pts[0][1], lng: pts[0][0], km: 0 }];
    let acc = 0, next = spacing;
    for (let i = 1; i < pts.length; i++) {
      acc += haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
      if (acc >= next && samples.length < max - 1) { samples.push({ lat: pts[i][1], lng: pts[i][0], km: Math.round(acc) }); next += spacing; }
    }
    const last = pts[pts.length - 1];
    if (samples.length < max && (samples[samples.length - 1].lat !== last[1] || samples[samples.length - 1].lng !== last[0])) samples.push({ lat: last[1], lng: last[0], km: Math.round(total) });
    return { samples: samples.map((s) => ({ lat: Math.round(s.lat * 100) / 100, lng: Math.round(s.lng * 100) / 100, km: s.km })), lengthKm: Math.round(total), spacingKm: Math.round(spacing) };
  }
  // Straight-line distance from a point to the nearest route vertex, as km and as minutes at 50 km/h, both ways.
  function detour(lat, lng, coords, step = 1) {
    let best = Infinity, at = -1;
    for (let i = 0; i < (coords || []).length; i += step) {
      const d = haversineKm(lat, lng, coords[i][1], coords[i][0]);
      if (d < best) { best = d; at = i; }
    }
    if (!Number.isFinite(best)) return { km: NaN, min: NaN, at: -1 };
    return { km: Math.round(best * 10) / 10, min: Math.round((best / 50) * 60 * 2), at }; // ×2: there and back
  }
  // Equirectangular fit: x by longitude scaled by cos(mid latitude), y by latitude, into a width×height box with padding.
  function projector(points, width = 600, height = 360, pad = 16) {
    const ps = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!ps.length) return null;
    const lats = ps.map((p) => p.lat), lngs = ps.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const w = Math.max((maxLng - minLng) * k, 0.01), h = Math.max(maxLat - minLat, 0.01);
    const s = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = (width - w * s) / 2, oy = (height - h * s) / 2;
    const project = (lat, lng) => ({ x: Math.round((ox + (lng - minLng) * k * s) * 10) / 10, y: Math.round((oy + (maxLat - lat) * s) * 10) / 10 });
    return { project, width, height, bounds: { minLat, maxLat, minLng, maxLng } };
  }

  // ---------------------------------------------------------------- hotspot head-to-head
  // spots: [{name, species, lat?, lng?, locId?}] (today's brief), from: {lat, lng} the saved place
  function headToHead(spots, from, score, wx) {
    const rows = (spots || []).map((s) => {
      const has = Number.isFinite(s.lat) && Number.isFinite(s.lng) && from && Number.isFinite(from.lat) && Number.isFinite(from.lng);
      const km = has ? Math.round(haversineKm(from.lat, from.lng, s.lat, s.lng) * 10) / 10 : NaN;
      return { ...s, km, odds: spotOdds({ species: s.species, score, wx }) };
    });
    if (!rows.length) return { rows, best: null, why: '' };
    const sorted = [...rows].sort((a, b) => b.odds.p - a.odds.p || (Number.isFinite(a.km) ? a.km : 1e9) - (Number.isFinite(b.km) ? b.km : 1e9));
    const best = sorted[0], second = sorted[1];
    const most = rows.every((r) => r === best || r.species < best.species); // strictly the most; a tie falls through to the odds wording
    const closest = rows.every((r) => !Number.isFinite(r.km) || !Number.isFinite(best.km) || best.km <= r.km);
    let why;
    if (rows.length === 1) why = `${best.name} is the only spot picked.`;
    else if (most && closest && Number.isFinite(best.km)) why = `${best.name} has the most species reported this week (${best.species}) and it's the closest, about ${best.km} km away.`;
    else if (most) why = `${best.name} has the most species reported this week (${best.species})${Number.isFinite(best.km) ? `, which beats the shorter drive to ${closestName(rows)}` : ''}.`;
    else if (second && Math.abs(best.odds.p - second.odds.p) < 0.03 && Number.isFinite(best.km)) why = `${best.name} and ${second.name} are about even on odds, and ${best.name} is closer.`;
    else why = `${best.name} gives the best odds of a 15-species morning (${pct(best.odds.p)}) once today's weather is counted.`;
    return { rows, best, why };
  }
  const closestName = (rows) => { const c = rows.filter((r) => Number.isFinite(r.km)).sort((a, b) => a.km - b.km)[0]; return c ? c.name : 'the others'; };

  // ---------------------------------------------------------------- migration windows
  // table: data/windows.js entries { key, name, windows: [{ from: 'MM-DD', to: 'MM-DD', note }] }
  const doy = (mmdd, year) => Math.round((Date.UTC(year, Number(mmdd.slice(0, 2)) - 1, Number(mmdd.slice(3, 5))) - Date.UTC(year, 0, 1)) / 864e5);
  function windowState(table, today, lookahead = 14) {
    const t = String(today || new Date().toISOString().slice(0, 10));
    const year = Number(t.slice(0, 4)), d = doy(t.slice(5), year), yearLen = doy('12-31', year) + 1;
    const open = [], soon = [];
    for (const e of table || []) {
      for (const w of e.windows || []) {
        const a = doy(w.from, year), b = doy(w.to, year);
        const inside = a <= b ? d >= a && d <= b : d >= a || d <= b;
        if (inside) {
          const daysLeft = a <= b ? b - d : d >= a ? yearLen - d + b : b - d;
          open.push({ ...e, window: w, daysLeft });
          break;
        }
        const until = ((a - d) % yearLen + yearLen) % yearLen;
        if (until > 0 && until <= lookahead) soon.push({ ...e, window: w, opensIn: until });
      }
    }
    open.sort((x, y) => x.daysLeft - y.daysLeft);
    soon.sort((x, y) => x.opensIn - y.opensIn);
    return { open, soon };
  }
  const mmddLabel = (mmdd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`2001-${mmdd}T12:00:00Z`));

  // ---------------------------------------------------------------- calendar-aware mornings
  // Wall-clock time in an IANA zone → UTC instant (two passes so a DST edge resolves). Falls back to the runtime's zone.
  function zonedToUTC(date, hh, mm, tz) {
    const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh, mm);
    const offsetAt = (ms) => {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
        const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
        return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms;
      } catch { return -new Date(ms).getTimezoneOffset() * 60000; }
    };
    let utc = guess - offsetAt(guess);
    utc = guess - offsetAt(utc);
    return new Date(utc);
  }
  // days: scoreDays output; busy: [{start, end}] ISO; window 6:30–8:30 at the place's zone
  function freeMornings(days, busy, tz, win = { from: [6, 30], to: [8, 30] }) {
    const blocks = (busy || []).map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) })).filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e));
    return (days || []).map((d) => {
      const s = zonedToUTC(d.date, win.from[0], win.from[1], tz).getTime(), e = zonedToUTC(d.date, win.to[0], win.to[1], tz).getTime();
      const hits = blocks.filter((b) => b.s < e && b.e > s);
      return { ...d, free: hits.length === 0, busyCount: hits.length };
    });
  }
  // today (YYYY-MM-DD, optional) turns the weekday into "this morning" or "tomorrow" when that is what it is.
  function nudgeLine(marked, today) {
    const free = (marked || []).filter((d) => d.free);
    if (!free.length) return 'Every morning this week has something on the calendar between 6:30 and 8:30.';
    const best = [...free].sort((a, b) => b.call.score - a.call.score || a.date.localeCompare(b.date))[0];
    const look = { go: 'it looks like a GO', maybe: 'it looks like a MAYBE', stay: 'it looks like a STAY IN, so maybe sleep in' }[best.call.grade];
    const tomorrow = today ? new Date(Date.parse(today + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10) : '';
    const when = best.date === today ? 'this morning' : best.date === tomorrow ? 'tomorrow' : weekday(best.date);
    return `You're free ${when} 6:30–8:30 and ${look}.`;
  }

  root.DAYBIRD_ODDS = { MIN_P, MAX_P, SEASON, seasonFactor, scaleFor, weatherPenalty, spotOdds, speciesOdds, pct, forecastUrl, wxFromDaily, scoreDays,
    bestHour, idTip, bestMornings, dayLabel, weekday, ics, haversineKm, samplePolyline, detour, projector, headToHead, windowState, mmddLabel, zonedToUTC, freeMornings, nudgeLine };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
