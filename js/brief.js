/* Daybird brief engine — the ONE place the morning call is scored and worded.
   Used by: the site (js/app.js), the daily GitHub Action (scripts/build_brief.mjs) and the
   send-brief edge function. Pure functions, no network, no DOM: callers fetch, this decides and writes.
   Loads as a plain <script>, as a Node CommonJS require/import, or as a Deno ESM import (it only sets a global). */
(function (root) {
  const VERSION = 2;
  const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dirName = (deg) => DIRS[Math.round((Number(deg) || 0) / 45) % 8];
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  // ---------------------------------------------------------------- settings vocab
  const MODES = {
    any:    { label: 'Anywhere',          short: 'anywhere' },
    porch:  { label: 'Porch or backyard', short: 'from the porch' },
    woods:  { label: 'Walk in the woods', short: 'on a woods walk' },
    water:  { label: 'Pond, river or lake', short: 'by the water' },
    commute:{ label: 'Commute or driving', short: 'on the drive' },
    campus: { label: 'Campus or town',     short: 'around campus' },
  };
  const LEVELS = { new: 'Brand new to birding', some: 'Knows the common birds', keen: 'Keeps a list' };

  // ---------------------------------------------------------------- bird groups (works on any eBird name)
  const GROUP_RULES = [
    ['raptors',     /Hawk|Eagle|Vulture|Osprey|Harrier|Falcon|Kestrel|^Merlin|Kite$/],
    ['owls',        /Owl$/],
    ['warblers',    /Warbler|Redstart|Ovenbird|Waterthrush|Yellowthroat|Parula|Chat$/],
    ['waterfowl',   /Duck|Merganser|Goose|Loon|Grebe|Teal|Mallard|Scaup|Bufflehead|Goldeneye|Wigeon|Pintail|Gadwall|Scoter|Swan|Coot|Shoveler|Redhead|Canvasback/],
    ['waders',      /Heron|Egret|Bittern|Crane|Ibis|Rail$|Sora|Gallinule/],
    ['shorebirds',  /Sandpiper|Plover|Killdeer|Snipe|Woodcock|Yellowlegs|Dunlin|Dowitcher|Turnstone|Sanderling|Whimbrel|Curlew|Godwit|Phalarope/],
    ['gulls',       /Gull|Tern|Jaeger|Kittiwake/],
    ['woodpeckers', /Woodpecker|Flicker|Sapsucker/],
    ['sparrows',    /Sparrow|Junco|Towhee|Longspur|Bunting/],
    ['finches',     /Finch|Siskin|Redpoll|Grosbeak|Crossbill|Goldfinch/],
    ['thrushes',    /Thrush|Veery|Robin|Bluebird/],
    ['swallows',    /Swallow|Swift|Martin$/],
    ['flycatchers', /Flycatcher|Phoebe|Pewee|Kingbird/],
    ['vireos',      /Vireo/],
    ['kinglets',    /Kinglet|Gnatcatcher/],
    ['blackbirds',  /Blackbird|Grackle|Cowbird|Oriole|Bobolink|Meadowlark|Starling/],
    ['feeder birds',/Chickadee|Titmouse|Nuthatch|Cardinal|Jay$|Creeper|Wren|Dove|Pigeon|Waxwing|Mockingbird|Catbird|Thrasher/],
    ['corvids',     /Crow|Raven/],
    ['game birds',  /Turkey|Grouse|Pheasant|Partridge/],
    ['hummingbirds',/Hummingbird/],
    ['kingfishers', /Kingfisher/],
  ];
  const GROUP_TIPS = {
    raptors:     { new: 'Look up over open fields and along ridgelines. Big, slow circles with wings held flat or in a shallow V.', some: 'Check kettles over ridges late morning; Red-tailed (belly band) vs. Broad-winged (banded tail) is the usual question.' },
    owls:        { new: 'Listen at dusk and before dawn. "Who cooks for you?" is a Barred Owl.', some: 'Dawn and dusk; listen for Barred and Great Horned, and watch for mobbing crows.' },
    warblers:    { new: 'Small, busy, often yellow. Watch the tops of trees along edges as the sun hits them.', some: 'Work sunlit edges at first light; in fall most are dull, so go by wing bars and undertail.' },
    waterfowl:   { new: 'Scan the water from one spot for a few minutes. Ducks come in groups; count the different kinds.', some: 'Scope the far shore; divers vs. dabblers first, then sort by head shape.' },
    waders:      { new: 'Tall, still, at the edge of the water. Watch for the slow stalk.', some: 'Check marsh edges and the river at first light before people and dogs arrive.' },
    shorebirds:  { new: 'Small birds running along mud or shoreline, bobbing as they go.', some: 'Low water and mudflats; the teeter means Spotted Sandpiper.' },
    gulls:       { new: 'Big, pale birds over the water or on the ball field. More kinds than you think.', some: 'Age them: brown is young. Ring-billed is the default; check for Herring.' },
    woodpeckers: { new: 'Listen for drumming and tapping, then look at the trunk.', some: 'Downy vs. Hairy is bill length; a white rump in flight is a Flicker.' },
    sparrows:    { new: 'Little brown birds in the weeds and at the feeder. Look for stripes on the head.', some: 'Weedy edges at first light; pish quietly and let them pop up.' },
    finches:     { new: 'Bouncy fliers that love feeders. Yellow in summer, duller now.', some: 'Watch for irruptive winter finches at feeders and in conifers.' },
    thrushes:    { new: 'Robin-shaped birds on the ground, hopping and pausing.', some: 'Damp forest floor at dawn; spots and tail color tell them apart.' },
    swallows:    { new: 'Swooping low over water and fields, never sitting still.', some: 'Over water on cool mornings when insects sit low.' },
    flycatchers: { new: 'A bird that sits on a bare perch, darts out, and comes back.', some: 'Phoebe pumps its tail; the rest need voice.' },
    vireos:      { new: 'Slow-moving leaf-green birds that sing all morning.', some: 'Canopy singers; Red-eyed keeps going through midday.' },
    kinglets:    { new: 'Tiny, restless, flicking their wings in the conifers.', some: 'Flocks in conifers; listen for the high "see-see-see".' },
    blackbirds:  { new: 'Noisy flocks in the marsh and on the fields.', some: 'Check flocks for Rusty Blackbird in wet woods.' },
    'feeder birds': { new: 'Chickadees, titmice and nuthatches lead the mixed flocks. Follow the chickadees.', some: 'Follow the chickadee flock; migrants ride along with it.' },
    corvids:     { new: 'Crows in groups; a raven is bigger with a wedge tail and a croak.', some: 'Ravens over the ridge, crows commuting at dawn.' },
    'game birds':{ new: 'Turkeys on the roadside at first light.', some: 'Turkey flocks along field edges; grouse drum in spring.' },
    hummingbirds:{ new: 'Tiny and hovering at flowers or the feeder.', some: 'Check jewelweed and feeders through September.' },
    kingfishers: { new: 'A big-headed blue bird that rattles as it flies along the river.', some: 'Perched over slow water; rattling call gives it away.' },
  };
  function groupOf(name) {
    for (const [g, re] of GROUP_RULES) if (re.test(name || '')) return g;
    return null;
  }
  // recent: [{comName, locName?}] or ['Name', ...]. Returns groups ranked by species count.
  function groups(recent) {
    const by = {};
    const seen = new Set();
    for (const r of recent || []) {
      const n = typeof r === 'string' ? r : r && r.comName;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      const g = groupOf(n);
      if (!g) continue;
      (by[g] = by[g] || { key: g, count: 0, species: [] });
      by[g].count++; by[g].species.push(n);
    }
    return Object.values(by).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  // ---------------------------------------------------------------- weather parsing (Open-Meteo)
  // One URL for everyone. Hourly covers 2 days so a request after 9 AM can roll to tomorrow.
  function weatherUrl(lat, lng) {
    return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,cloud_cover` +
      `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min&current=temperature_2m` +
      `&timezone=auto&forecast_days=2&wind_speed_unit=mph&temperature_unit=fahrenheit`;
  }
  // Picks the morning window (6–9 AM local) of today, or tomorrow if it's already past 9 AM where the place is.
  // Returns { wx, date, dayIdx, whenLabel, tomorrow }. Throws when the hourly block is missing.
  function parseWeather(w, opts = {}) {
    if (!w || !w.hourly || !w.hourly.time || !w.daily || !w.daily.time) throw new Error('no hourly weather');
    const localHour = w.current && w.current.time ? Number(String(w.current.time).slice(11, 13)) : (opts.hourNow != null ? opts.hourNow : 0);
    const dayIdx = opts.forceToday ? 0 : (localHour >= 9 && w.daily.time.length > 1 ? 1 : 0);
    const dayOf = (i) => {
      const date = w.daily.time[i];
      if (!date) return null;
      const pick = (hh) => w.hourly.time.findIndex((t) => t.startsWith(date) && t.slice(11, 13) === hh);
      const idx = ['06', '07', '08', '09'].map(pick).filter((i) => i >= 0);
      const avg = (k) => { const v = idx.map((i) => w.hourly[k] && w.hourly[k][i]).filter((x) => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
      const at = (k, hh) => { const i = pick(hh); const v = i >= 0 && w.hourly[k] ? w.hourly[k][i] : NaN; return typeof v === 'number' ? v : NaN; };
      const temp = avg('temperature_2m');
      if (!Number.isFinite(temp)) return null;
      const r = (x, d = 0) => (Number.isFinite(x) ? Math.round(x) : d);
      return {
        temp: r(temp), wind: r(avg('wind_speed_10m')), windDir: r(avg('wind_direction_10m')), rain: r(avg('precipitation_probability')),
        cloud: r(avg('cloud_cover'), 50), cloudMid: r(at('cloud_cover', '12'), 50), windMid: r(at('wind_speed_10m', '12')),
        high: r(w.daily.temperature_2m_max && w.daily.temperature_2m_max[i], NaN), low: r(w.daily.temperature_2m_min && w.daily.temperature_2m_min[i], NaN),
        sunrise: String((w.daily.sunrise || [])[i] || '').slice(11, 16), sunset: String((w.daily.sunset || [])[i] || '').slice(11, 16), date,
      };
    };
    const wx = dayOf(dayIdx);
    if (!wx) throw new Error('no hourly weather for the morning window');
    const tomorrow = dayIdx === 0 ? dayOf(1) : null;
    return { wx, date: wx.date, dayIdx, whenLabel: dayIdx === 1 ? 'tomorrow morning' : 'this morning', tomorrow };
  }
  // eBird raw → {notable (deduped species+place, max 8), spots (top 5 by species), recent (species list)}
  function parseEbird(notableRaw, recentRaw) {
    const notable = [], seen = new Set();
    for (const o of notableRaw || []) {
      const k = `${o.comName}|${o.locId || o.locName}`;
      if (seen.has(k)) continue; seen.add(k);
      notable.push({ comName: String(o.comName || ''), howMany: o.howMany, locName: String(o.locName || ''), obsDt: o.obsDt, subId: o.subId, locId: o.locId, lat: o.lat, lng: o.lng });
    }
    const by = new Map(), species = new Set();
    for (const o of recentRaw || []) {
      species.add(o.comName);
      const k = o.locId || o.locName;
      if (!by.has(k)) by.set(k, { name: String(o.locName || ''), locId: o.locId, lat: o.lat, lng: o.lng, species: new Set() });
      by.get(k).species.add(o.comName);
    }
    const spots = [...by.values()].map((v) => ({ name: v.name, locId: v.locId, lat: v.lat, lng: v.lng, species: v.species.size })).sort((a, b) => b.species - a.species).slice(0, 5);
    return { notable: notable.slice(0, 8), spots, recent: [...species] };
  }

  // ---------------------------------------------------------------- the call
  // Same numbers as before (50 base; calm +15 / windy -20; dry +10 / rain -25; tailwind +10; 3+ notable +10; migration ±).
  function score({ wx, month, notableCount = 0, migration = 0 }) {
    let s = 50; const why = [];
    if (wx) {
      const d = dirName(wx.windDir);
      if (wx.wind <= 8) { s += 15; why.push('calm'); } else if (wx.wind >= 18) { s -= 20; why.push('windy'); }
      if (wx.rain <= 20) { s += 10; why.push('dry'); } else if (wx.rain >= 60) { s -= 25; why.push('rain'); }
      if (month >= 8 && month <= 11 && (d === 'N' || d === 'NW')) { s += 10; why.push('fallwind'); }
      if (month >= 3 && month <= 6 && (d === 'S' || d === 'SW')) { s += 10; why.push('springwind'); }
    } else why.push('nowx');
    if (migration >= 4) { s += 25; why.push('bigmig'); } else if (migration === 3) { s += 10; why.push('modmig'); } else if (migration === 1) { s -= 10; }
    if (notableCount >= 3) { s += 10; why.push('notable'); }
    const grade = s >= 70 ? 'go' : s >= 45 ? 'maybe' : 'stay';
    return { score: s, grade, word: { go: 'GO', maybe: 'MAYBE', stay: 'STAY IN' }[grade], headline: { go: 'Get out there.', maybe: 'Worth a look.', stay: 'Coffee first.' }[grade], why };
  }
  // The old "calm winds · NW tailwind" tags, for anything that still wants them.
  const WHY_TAGS = { calm: 'calm winds', windy: 'windy', rain: 'rain likely', fallwind: 'NW tailwind for fall migrants', springwind: 'SW tailwind for spring migrants', bigmig: 'big overnight migration', modmig: 'moderate migration', nowx: 'no weather data' };
  function whyTags(call, notableCount) { return call.why.filter((k) => WHY_TAGS[k]).map((k) => WHY_TAGS[k]).concat(call.why.includes('notable') ? [`${notableCount} notable reports nearby`] : []); }

  // Plain and warm: one or two sentences a new birder can read in a second.
  function whyLine(call, wx, notableCount, month, whenLabel = 'this morning') {
    const W = call.why; const bits = [];
    if (wx) {
      const sky = W.includes('rain') ? 'rain is likely' : wx.rain >= 40 ? 'showers are possible' : W.includes('dry') ? 'dry' : 'mostly dry';
      const air = W.includes('windy') ? `Blowing ${wx.wind} mph and ${sky}` : W.includes('calm') ? `Calm and ${sky}` : `A ${wx.wind} mph breeze and ${sky}`;
      bits.push(`${air} at sunrise, ${wx.temp}°.`);
    } else bits.push("No weather data for the morning, so this is a guess from the bird reports alone.");
    const d = wx ? dirName(wx.windDir) : '';
    if (W.includes('fallwind')) bits.push(`Fall migrants are moving on the ${d === 'N' ? 'north' : 'northwest'} wind.`);
    else if (W.includes('springwind')) bits.push(`Spring migrants are riding the ${d === 'S' ? 'south' : 'southwest'} wind.`);
    else if (wx && (month >= 8 && month <= 11) && (d === 'S' || d === 'SW') && wx.wind >= 8) bits.push('The wind is from the south, which holds fall migrants in place.');
    if (W.includes('bigmig')) bits.push('A big flight came through overnight.');
    else if (W.includes('modmig')) bits.push('A moderate flight came through overnight.');
    if (W.includes('notable')) bits.push(`${notableCount} unusual birds were reported nearby this week.`);
    const close = { go: 'Worth getting out.', maybe: W.includes('windy') ? 'Find somewhere sheltered and give it an hour.' : 'Pick the closest spot and give it an hour.', stay: wx && wx.rain >= 60 ? 'Coffee first; watch the feeder and try tomorrow.' : 'Coffee first; the feeder will do today.' }[call.grade];
    return bits.join(' ') + ' ' + close;
  }

  // ---------------------------------------------------------------- the small extras
  function wearLine(wx, level = 'new', mode = 'any') {
    if (!wx) return '';
    const t = wx.temp, parts = [];
    if (t < 20) parts.push('heavy coat, hat and gloves'); else if (t < 35) parts.push('winter coat, gloves and a hat'); else if (t < 45) parts.push('warm jacket and a hat'); else if (t < 55) parts.push('a light jacket'); else if (t < 65) parts.push('long sleeves'); else parts.push('a t-shirt is fine');
    if (wx.rain >= 40) parts.push('rain shell'); else if (wx.wind >= 15) parts.push('something windproof');
    if (mode === 'water' || mode === 'woods') parts.push(wx.rain >= 30 || t < 35 ? 'boots' : 'shoes that can get wet');
    if (t < 45) parts.push('a thermos');
    parts.push(level === 'new' ? 'binoculars optional' : 'binoculars');
    const lead = `${t}° at sunrise` + (Number.isFinite(wx.high) && wx.high - t >= 15 ? `, ${wx.high}° later` : '');
    return `${lead}: ${parts.join(', ')}.`;
  }
  const addMin = (hhmm, m) => { if (!/^\d\d:\d\d$/.test(hhmm || '')) return ''; const [h, mi] = hhmm.split(':').map(Number); const t = ((h * 60 + mi + m) % 1440 + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const ampm = (hhmm) => { if (!/^\d\d:\d\d$/.test(hhmm || '')) return ''; const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  // Dawn chorus starts roughly 30-45 minutes before sunrise (civil twilight). We say 40.
  const firstSong = (sunrise) => ampm(addMin(sunrise, -40));
  const leaveBy = (sunrise) => ampm(addMin(sunrise, -15));
  const bestWindow = (sunrise) => sunrise ? `${ampm(addMin(sunrise, -20))} to ${ampm(addMin(sunrise, 150))}` : '';

  // Soaring day for raptors: sun to build thermals, a decent temperature rise, some but not too much wind.
  function soaring(wx, month) {
    if (!wx) return null;
    const season = (month >= 8 && month <= 11) || (month >= 3 && month <= 5);
    const rise = Number.isFinite(wx.high) ? wx.high - wx.temp : 10;
    let pts = 0; const why = [];
    if (wx.cloudMid < 40) { pts += 2; why.push('sunny by midday'); } else if (wx.cloudMid < 70) { pts += 1; why.push('some sun'); } else why.push('overcast');
    if (rise >= 15) { pts += 2; why.push(`a ${rise}° warm-up`); } else if (rise >= 8) { pts += 1; why.push(`a ${rise}° warm-up`); } else why.push('little warm-up');
    const wm = Number.isFinite(wx.windMid) ? wx.windMid : wx.wind;
    if (wm >= 5 && wm <= 20) { pts += 1; why.push('a light breeze'); } else if (wm > 20) { pts -= 1; why.push('too windy'); } else why.push('dead calm');
    if (wx.rain >= 50) { pts -= 2; }
    const d = dirName(wx.windDir);
    if (season && month >= 8 && (d === 'N' || d === 'NW' || d === 'W')) { pts += 1; why.push('a north-west push'); }
    const rating = pts >= 4 ? 'good' : pts >= 2 ? 'fair' : 'poor';
    const when = rating === 'poor' ? '' : ' Thermals build late morning, so 10 AM to 2 PM beats dawn for hawks.';
    return { rating, why, line: `${{ good: 'Good', fair: 'Fair', poor: 'Poor' }[rating]} soaring day for hawks: ${why.join(', ')}.${when}` };
  }

  // What to look for by mode. Picks the groups that fit the mode, in the order they were reported.
  const MODE_GROUPS = {
    any: null,
    porch: ['feeder birds', 'finches', 'sparrows', 'woodpeckers', 'raptors', 'corvids', 'blackbirds', 'thrushes', 'hummingbirds'],
    woods: ['warblers', 'thrushes', 'woodpeckers', 'kinglets', 'vireos', 'feeder birds', 'owls', 'game birds', 'flycatchers'],
    water: ['waterfowl', 'waders', 'gulls', 'shorebirds', 'swallows', 'kingfishers', 'blackbirds', 'raptors'],
    commute: ['raptors', 'corvids', 'game birds', 'blackbirds', 'gulls', 'waterfowl', 'thrushes'],
    campus: ['thrushes', 'sparrows', 'feeder birds', 'raptors', 'blackbirds', 'gulls', 'woodpeckers', 'corvids'],
  };
  const MODE_TIPS = {
    any:     { new: ['Start at the closest edge where trees meet open ground; that line is where the birds are.'], some: ['Edges first, then water, then deep woods: that order gets the most species before 9.'] },
    porch:   { new: ['You can do this with coffee in hand: sit still for ten minutes and count the different voices before you look.', 'Anything flying over in a straight line is going somewhere; anything circling is hunting.'], some: ['Ten minutes of still listening beats ten minutes of scanning; flyovers peak in the first hour after sunrise.'] },
    woods:   { new: ['Walk slowly and stop often. Most birds show themselves when you stand still.', 'Follow the chickadees: the little mixed flocks carry the interesting birds with them.'], some: ['Sunlit edges and openings first; mixed flocks move through about once every twenty minutes.'] },
    water:   { new: ['Pick one spot with a view and stay put. Ducks drift in and out; the count grows if you wait.'], some: ['Scan the far shore first, then the near edge; divers surface where you were not looking.'] },
    commute: { new: ['Big bird on a pole or wire by a field: probably a Red-tailed Hawk. Big dark bird wobbling in circles: Turkey Vulture.', 'For passengers, or for the walk to the car. Eyes on the road when you are driving.'], some: ['Kestrels on the wires, harriers low over fields, kettles over ridges after 10. Passengers only; eyes on the road.'] },
    campus:  { new: ['Lawns at first light: robins and sparrows. The big trees in the quad: woodpeckers and, some mornings, a hawk.'], some: ['Quads at first light for thrushes and sparrows; check the tallest trees and rooftops for an accipiter.'] },
  };
  function lookFor(recent, mode = 'any', level = 'new') {
    const gs = groups(recent);
    const order = MODE_GROUPS[mode] || null;
    const picked = order ? order.map((k) => gs.find((g) => g.key === k)).filter(Boolean) : gs;
    const tipLevel = level === 'new' ? 'new' : 'some';
    return picked.slice(0, 3).map((g) => ({ ...g, label: g.key, tip: (GROUP_TIPS[g.key] || {})[tipLevel] || '' }));
  }
  function groupsLine(picked, mode = 'any') {
    if (!picked.length) return '';
    const where = MODES[mode] && mode !== 'any' ? ` ${MODES[mode].short}` : '';
    return `Most likely${where}: ${picked.map((g) => `${g.label} (${g.count} ${g.count === 1 ? 'kind' : 'kinds'} reported)`).join(', ')}.`;
  }

  // Something for a STAY IN day: a quick ID question from the traits table, and a feeder nudge.
  function stayIn(traits, seed = 0) {
    const rows = (traits || []).filter((r) => r[5] && r[1] !== 'tiny');
    if (rows.length < 4) return null;
    const pick = (n) => rows[(seed * 7 + n * 13) % rows.length];
    const answer = pick(1), wrong1 = pick(2), wrong2 = pick(3);
    const options = [answer, wrong1, wrong2].map((r) => r[0]).filter((v, i, a) => a.indexOf(v) === i);
    if (options.length < 3) return null;
    const rot = seed % 3; const shuffled = options.slice(rot).concat(options.slice(0, rot));
    return { question: `Which bird is "${answer[5]}"?`, options: shuffled, answer: answer[0], feeder: 'Rainy mornings bring the feeder crowd in close; a quiet ten minutes at the window counts as birding.' };
  }

  // ---------------------------------------------------------------- regions: "This week's birds"
  // The Upper Valley counties Daybird counts checklists for. The same boxes live in data/regions.json ([south, west,
  // north, east]); tests/expected.test.mjs fails if the two drift. Boxes overlap along the Connecticut River, so a point
  // inside two goes to the county whose box center is nearer (longitude scaled by cos(lat)). A town right on the river
  // can land in the county across the water; the birds there are much the same.
  const REGIONS = [
    { code: 'US-NH-009', name: 'Grafton County', bbox: [43.48, -72.34, 44.40, -71.40] },
    { code: 'US-NH-019', name: 'Sullivan County', bbox: [43.09, -72.46, 43.59, -71.97] },
    { code: 'US-VT-027', name: 'Windsor County', bbox: [43.19, -72.95, 43.99, -72.30] },
    { code: 'US-VT-017', name: 'Orange County', bbox: [43.77, -72.82, 44.20, -72.03] },
  ];
  function regionFor(lat, lng, regions = REGIONS) {
    lat = Number(lat); lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const hits = (regions || []).filter((r) => { const [s, w, n, e] = r.bbox || []; return lat >= s && lat <= n && lng >= w && lng <= e; });
    if (!hits.length) return null;
    const k = Math.cos(lat * Math.PI / 180);
    const d = (r) => { const [s, w, n, e] = r.bbox; const dl = lat - (s + n) / 2, dg = (lng - (w + e) / 2) * k; return dl * dl + dg * dg; };
    return hits.slice().sort((a, b) => d(a) - d(b))[0];
  }
  // share → "7 in 10" (rounded to tenths, never below 1 in 10; "almost every" from 0.9 up)
  const tenths = (share) => Math.min(10, Math.max(1, Math.round((Number(share) || 0) * 10)));
  const shareShort = (share) => (Number(share) >= 0.9 ? 'almost every' : `${tenths(share)} in 10`);
  const shareWords = (share) => (Number(share) >= 0.9 ? 'on almost every checklist' : `on ${tenths(share)} in 10 checklists`);
  const pct = (share) => `${Math.round((Number(share) || 0) * 100)}%`;
  // "Oct 10–20", or "Sep 28–Oct 7" across a month boundary (dates are UTC calendar days)
  function windowLabel(from, to) {
    const f = (iso, o) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(d); };
    if (!from || !to) return '';
    const sameMonth = String(from).slice(0, 7) === String(to).slice(0, 7);
    return sameMonth ? `${f(from, { month: 'short' })} ${f(from, { day: 'numeric' })}–${f(to, { day: 'numeric' })}` : `${f(from, { month: 'short', day: 'numeric' })}–${f(to, { month: 'short', day: 'numeric' })}`;
  }
  // "Grafton County, 41 checklists, Oct 10–20."
  function expectedLine(exp) {
    if (!exp || !exp.window) return '';
    const n = exp.window.lists || 0;
    return `${(exp.region && exp.region.name) || 'Your county'}, ${n} checklist${n === 1 ? '' : 's'}, ${windowLabel(exp.window.from, exp.window.to)}.`;
  }
  // "On 68% of 41 checklists in Grafton County over Oct 10–20, up from 40% the ten days before: arriving."
  function statusSentence(sp, exp) {
    if (!sp || !exp || !exp.window) return '';
    const where = (exp.region && exp.region.name) || 'your county';
    let s = `On ${pct(sp.share)} of ${exp.window.lists} checklists in ${where} over ${windowLabel(exp.window.from, exp.window.to)}`;
    if (sp.prevShare == null || !sp.trend) return s + '.';
    const before = sp.trend === 'new' ? 'not reported the ten days before' : sp.trend === 'arriving' ? `up from ${pct(sp.prevShare)} the ten days before` : sp.trend === 'tapering' ? `down from ${pct(sp.prevShare)} the ten days before` : `about the same as the ten days before (${pct(sp.prevShare)})`;
    return `${s}, ${before}: ${sp.trend}.`;
  }
  // The shape compose keeps: the top `n` names with share and trend, plus the window line.
  function expectedFor(exp, n = 10) {
    if (!exp || !exp.window || !Array.isArray(exp.species) || !exp.species.length) return null;
    return { region: { code: exp.region && exp.region.code, name: (exp.region && exp.region.name) || 'Your county' }, window: { from: exp.window.from, to: exp.window.to, lists: exp.window.lists || 0 },
      species: exp.species.slice(0, n).map((s) => ({ name: String(s.name || ''), share: Number(s.share) || 0, trend: s.trend || null })), line: expectedLine(exp) };
  }

  // ---------------------------------------------------------------- compose: one object with everything
  // in: { place, date (YYYY-MM-DD), whenLabel, wx, tomorrow, notable, spots, recent, migration, mode, level, traits, seed,
  //       expected (optional: a data/expected/{code}.json object → the top ten as b.expected) }
  function compose(i) {
    const date = i.date || (i.wx && i.wx.date) || new Date().toISOString().slice(0, 10);
    const month = Number(date.slice(5, 7));
    const mode = MODES[i.mode] ? i.mode : 'any';
    const level = LEVELS[i.level] ? i.level : 'new';
    const notable = i.notable || [], spots = i.spots || [], recent = i.recent || [];
    const call = score({ wx: i.wx, month, notableCount: notable.length, migration: i.migration || 0 });
    const d = new Date(`${date}T12:00:00Z`);
    const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(d);
    const picked = lookFor(recent, mode, level);
    const soar = soaring(i.wx, month);
    const sunrise = i.wx ? i.wx.sunrise : '';
    const whenLabel = i.whenLabel || 'this morning';
    const tomorrow = i.tomorrow ? { ...score({ wx: i.tomorrow, month, notableCount: notable.length }), temp: i.tomorrow.temp, wind: i.tomorrow.wind, rain: i.tomorrow.rain } : null;
    return {
      version: VERSION, place: i.place || 'your area', date, dateLabel: fmt({ weekday: 'long', month: 'short', day: 'numeric' }), shortDate: fmt({ weekday: 'short', month: 'short', day: 'numeric' }),
      whenLabel, mode, level, call,
      why: whyTags(call, notable.length), whyLine: whyLine(call, i.wx, notable.length, month, whenLabel),
      wx: i.wx || null, wxLine: i.wx ? `${i.wx.temp}°F · wind ${i.wx.wind} mph ${dirName(i.wx.windDir)} · rain ${i.wx.rain}%${sunrise ? ` · sunrise ${ampm(sunrise)}` : ''}` : '',
      wear: wearLine(i.wx, level, mode),
      firstSong: firstSong(sunrise), leaveBy: leaveBy(sunrise), bestWindow: bestWindow(sunrise),
      lookFor: picked, groupsLine: groupsLine(picked, mode), modeTips: (MODE_TIPS[mode] || MODE_TIPS.any)[level === 'new' ? 'new' : 'some'],
      soaring: soar && (mode === 'commute' || mode === 'any' || picked.some((g) => g.key === 'raptors') || soar.rating === 'good') ? soar : null,
      stayIn: call.grade === 'stay' ? stayIn(i.traits, i.seed || Number(date.replace(/-/g, ''))) : null,
      tomorrow: tomorrow && tomorrow.grade !== call.grade ? tomorrow : null,
      spots, notable, recentCount: recent.length, migration: i.migration || 0,
      expected: expectedFor(i.expected, 10),
    };
  }

  // Plain text for email and copy-to-clipboard. `o`: { site, intro, note, footer: [] }
  function text(b, o = {}) {
    const L = [];
    if (o.intro) L.push(o.intro, '');
    L.push(`${b.call.word} — ${b.call.headline}  (score ${b.call.score})`, b.whyLine, '');
    L.push(`${b.place} · ${b.dateLabel}, 6–9 AM (${b.whenLabel})`);
    if (b.wxLine) L.push(b.wxLine);
    if (b.wear) L.push(`Wear: ${b.wear}`);
    if (b.firstSong) L.push(`First song around ${b.firstSong}; leave by ${b.leaveBy} to catch sunrise.`);
    L.push('');
    if (b.expected && b.expected.species.length) {
      L.push(`This week's birds (${b.expected.line.replace(/\.$/, '')}):`);
      b.expected.species.forEach((s) => L.push(`- ${s.name} — ${shareShort(s.share)}${s.trend && s.trend !== 'steady' ? `, ${s.trend}` : ''}`));
      L.push('');
    }
    if (b.groupsLine) { L.push(b.groupsLine); b.lookFor.forEach((g) => g.tip && L.push(`- ${g.label}: ${g.tip}`)); L.push(''); }
    if (b.modeTips && b.modeTips.length) { L.push(`${modeTitle(b.mode)}:`); b.modeTips.forEach((t) => L.push(`- ${t}`)); L.push(''); }
    if (b.soaring) L.push(b.soaring.line, '');
    if (b.tomorrow) L.push(`Tomorrow looks like ${b.tomorrow.word} (${b.tomorrow.temp}°, wind ${b.tomorrow.wind} mph, rain ${b.tomorrow.rain}%).`, '');
    if (b.stayIn) L.push(`Stay-in quiz: ${b.stayIn.question}  ${b.stayIn.options.join(' / ')}`, b.stayIn.feeder, '');
    L.push('Where to go (species reported in the last 3 days, within 25 km):');
    b.spots.forEach((s, i) => L.push(`${i + 1}. ${s.name} — ${s.species} species${safeId(s.locId) ? ` — https://ebird.org/hotspot/${s.locId}` : ''}`));
    if (!b.spots.length) L.push('(no eBird data)');
    L.push('', 'Notable nearby:');
    b.notable.forEach((n) => L.push(`- ${n.comName}${n.howMany ? ` ×${n.howMany}` : ''} — ${n.locName}${n.obsDt ? `, ${n.obsDt}` : ''}${safeId(n.subId) ? ` — https://ebird.org/checklist/${n.subId}` : ''}`));
    if (!b.notable.length) L.push('Nothing notable in range.');
    L.push('', 'Migration last night: https://dashboard.birdcast.info/');
    if (o.site) L.push(`Full brief: ${o.site}`);
    if (o.note) L.push(o.note);
    (o.footer || []).forEach((f) => L.push('', f));
    return L.join('\n') + '\n';
  }
  const safeId = (s) => (typeof s === 'string' && /^[A-Za-z0-9]{1,20}$/.test(s) ? s : '');
  const modeTitle = (mode) => (mode === 'any' ? 'Tip' : MODES[mode].label);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // HTML blocks with inline styles (email clients ignore stylesheets); the site uses its own markup.
  function emailHtml(b, o = {}) {
    const color = { go: '#2f6b4f', maybe: '#b8561a', stay: '#a33a2a' }[b.call.grade];
    const F = "font-family:Arial,Helvetica,sans-serif";
    const p = (s, extra = '') => `<p style="${F};font-size:15px;margin:0 0 8px;${extra}">${s}</p>`;
    const h = (s) => `<h3 style="${F};font-size:16px;margin:16px 0 6px">${esc(s)}</h3>`;
    const li = (s) => `<li style="margin:0 0 6px">${s}</li>`;
    const a = (href, t) => `<a href="${esc(href)}" style="color:#1F2A37">${esc(t)}</a>`;
    const spots = b.spots.map((s) => li(`${safeId(s.locId) ? a(`https://ebird.org/hotspot/${s.locId}`, s.name) : esc(s.name)} <span style="color:#5f6b63">— ${s.species} species</span>`)).join('') || li('No recent eBird reports.');
    const notable = b.notable.map((n) => { const nm = `${n.comName}${n.howMany ? ` ×${n.howMany}` : ''}`; return li(`${safeId(n.subId) ? a(`https://ebird.org/checklist/${n.subId}`, nm) : esc(nm)} <span style="color:#5f6b63">— ${esc(n.locName)}${n.obsDt ? `, ${esc(n.obsDt)}` : ''}</span>`); }).join('') || li('Nothing notable in range.');
    return `<!doctype html><html><body style="margin:0;background:#f6f3ec">
<div style="max-width:560px;margin:0 auto;padding:16px;font-family:Georgia,'Times New Roman',serif;color:#1F2A37">
<div style="background:#fffdf8;border:1px solid #e3ddd0;border-radius:14px;padding:20px">
<div style="${F};font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E8833A">Daybird · morning brief</div>
${o.intro ? p(esc(o.intro), 'margin-top:10px') : ''}
<div style="font-size:46px;font-weight:700;line-height:1.1;margin:10px 0 2px;color:${color}">${esc(b.call.word)}</div>
<div style="font-size:20px;margin-bottom:8px">${esc(b.call.headline)}</div>
${p(esc(b.whyLine), 'font-size:16px')}
<p style="${F};font-weight:600;font-size:14px;margin:14px 0 2px">${esc(`${b.place} · ${b.dateLabel}, 6–9 AM (${b.whenLabel})`)}</p>
${b.wxLine ? p(esc(b.wxLine), 'font-size:14px;margin:0 0 4px') : ''}
${b.wear ? p(`<b>Wear:</b> ${esc(b.wear)}`, 'font-size:14px;margin:0 0 4px') : ''}
${b.firstSong ? p(`First song around <b>${esc(b.firstSong)}</b>; leave by <b>${esc(b.leaveBy)}</b> to catch sunrise.`, 'font-size:14px') : ''}
${b.expected && b.expected.species.length ? h("This week's birds") + `<p style="${F};font-size:12px;color:#5f6b63;margin:0 0 6px">${esc(b.expected.line)} The share of eBird checklists each bird was on.</p>` +
  `<ul style="${F};font-size:15px;padding-left:20px;margin:0">${b.expected.species.map((s) => li(`<b>${esc(s.name)}</b> <span style="color:#5f6b63">— ${esc(shareShort(s.share))}</span>${s.trend && s.trend !== 'steady' ? ` <span style="color:#E8833A;font-size:13px">${esc(s.trend)}</span>` : ''}`)).join('')}</ul>` : ''}
${b.groupsLine ? h('What to look for') + p(esc(b.groupsLine)) + `<ul style="${F};font-size:14px;padding-left:20px;margin:0">${b.lookFor.map((g) => g.tip ? li(`<b>${esc(g.label)}:</b> ${esc(g.tip)}`) : '').join('')}</ul>` : ''}
${b.modeTips && b.modeTips.length ? h(modeTitle(b.mode)) + `<ul style="${F};font-size:14px;padding-left:20px;margin:0">${b.modeTips.map((t) => li(esc(t))).join('')}</ul>` : ''}
${b.soaring ? p(esc(b.soaring.line), 'font-size:14px;margin-top:12px') : ''}
${b.tomorrow ? p(esc(`Tomorrow looks like ${b.tomorrow.word} (${b.tomorrow.temp}°, wind ${b.tomorrow.wind} mph, rain ${b.tomorrow.rain}%).`), 'font-size:14px') : ''}
${b.stayIn ? h('Stay-in quiz') + p(esc(b.stayIn.question)) + p(esc(b.stayIn.options.join(' · ')), 'color:#5f6b63;font-size:14px') + p(esc(b.stayIn.feeder), 'font-size:14px') : ''}
${h('Where to go')}
<p style="${F};font-size:12px;color:#5f6b63;margin:0 0 6px">Most species reported in the last 3 days, within 25 km.</p>
<ol style="${F};font-size:15px;padding-left:20px;margin:0">${spots}</ol>
${h('Notable nearby')}
<ul style="${F};font-size:15px;padding-left:20px;margin:0">${notable}</ul>
${p(a('https://dashboard.birdcast.info/', "Check last night's migration on BirdCast"), 'font-size:14px;margin-top:14px')}
${o.site ? p(a(o.site, 'Open the full brief'), 'font-size:14px;margin-top:6px') : ''}
${o.note ? p(esc(o.note), 'font-size:13px;color:#a33a2a;margin-top:10px') : ''}
</div>
${o.footerHtml ? `<p style="${F};font-size:12px;color:#5f6b63;margin:14px 4px 0">${o.footerHtml}</p>` : ''}
</div></body></html>`;
  }

  root.DAYBIRD_BRIEF = { VERSION, MODES, LEVELS, DIRS, dirName, modeTitle, groupOf, groups, weatherUrl, parseWeather, parseEbird, score, whyTags, whyLine, wearLine, firstSong, leaveBy, bestWindow, soaring, lookFor, groupsLine, stayIn, compose, text, emailHtml, esc, safeId, ampm, addMin,
    REGIONS, regionFor, tenths, shareShort, shareWords, pct, windowLabel, expectedLine, statusSentence, expectedFor };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
