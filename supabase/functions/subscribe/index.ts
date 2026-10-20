// @ts-nocheck -- this file carries a generated plain-JavaScript block (see scripts/inline_engine.mjs)
// Daybird — subscribe edge function. The subscriber list behind signup.html, confirm.html and manage.html.
// Deploy in Supabase → Edge Functions (name: subscribe) and turn "Verify JWT" OFF: nobody on these pages is signed in.
// Every change to a row needs either the one-time confirm token we emailed, or the signed manage token that only
// appears in emails we sent to that address, so the public can reach the function but cannot touch anyone else's row.
//
// Secrets: RESEND_API_KEY and UNSUB_SECRET (both shared with send-brief). Optional: FROM_EMAIL, SITE_URL,
// MAILING_ADDRESS, SUBSCRIBE_PER_DAY (confirm emails per day, default 100). Needs migration-5.sql.
//
// Actions (POST JSON {action, ...}; the one-click unsubscribe from mail apps arrives as POST ?action=unsubscribe&e=&t=):
//   subscribe    {email, lat, lng, place, mode, level, go_only, consent:true} → stores a pending row, emails a confirm link
//   confirm      {token}                      → activates the row that token belongs to (double opt-in)
//   get          {e, t}                       → the preferences for manage.html
//   update       {e, t, lat, lng, place, mode, level, go_only} → changes them
//   unsubscribe  {e, t}                       → status 'unsubscribed'; the daily send skips the row from then on
// Responses never say whether an address is already on the list: "subscribe" always answers "check your email".

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York";
const CONFIRM_TTL_MS = 7 * 864e5;      // confirm links work for a week
const RESEND_GAP_MS = 10 * 60e3;       // one confirm email per address per ten minutes

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  const site = (Deno.env.get("SITE_URL") || "https://day-bird.com/").trim();
  return {
    resendKey: (Deno.env.get("RESEND_API_KEY") || "").trim(),
    secret: (Deno.env.get("UNSUB_SECRET") || "").trim(),
    from: (Deno.env.get("FROM_EMAIL") || "Daybird <onboarding@resend.dev>").trim(),
    site: site.endsWith("/") ? site : site + "/",
    address: (Deno.env.get("MAILING_ADDRESS") || "").trim(),
    perDay: num("SUBSCRIBE_PER_DAY", 100),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;

// Only MODES, LEVELS and esc are used here; the engine is loaded from the live site so the dashboard-pasted
// function needs no local files. Tests remap this URL to the local file with an import map.
// >>> engine: generated from js/brief.js by scripts/inline_engine.mjs; edit the source, not this block
// --- js/brief.js
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
// <<< engine
const B: any = (globalThis as any).DAYBIRD_BRIEF;

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    const missing = [!c.resendKey && "RESEND_API_KEY", !c.secret && "UNSUB_SECRET"].filter(Boolean);
    if (missing.length) return json({ error: `Server setup incomplete: ${missing.join(" and ")} secret not set.` }, 500);

    // Mail apps' one-click unsubscribe posts a form body to the List-Unsubscribe URL; everything else is JSON.
    const q = new URL(req.url).searchParams;
    let body: any = {};
    if ((req.headers.get("content-type") || "").includes("json")) {
      try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    }
    if (!body || typeof body !== "object") body = {};
    const action = String(body.action || q.get("action") || "");
    const e = String(body.e ?? q.get("e") ?? "").trim().toLowerCase();
    const t = String(body.t ?? q.get("t") ?? "").trim();

    switch (action) {
      case "subscribe": return await subscribe(c, body);
      case "confirm": return await confirm(c, String(body.token || ""));
      case "get": case "update": case "unsubscribe": {
        if (!(await validManage(c, e, t))) return json({ error: "This link isn't valid. Open the link from your latest Daybird email." }, 400);
        const row = await findByHash(c, await hmacHex(c.secret, "hash:" + e));
        if (!row) return json({ error: "This address isn't on the list." }, 404);
        if (action === "get") return json({ ok: true, ...publicPrefs(row) });
        if (action === "unsubscribe") {
          await patch(c, row.id, { status: "unsubscribed", unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
          return json({ ok: true, status: "unsubscribed" });
        }
        if (row.status !== "active") return json({ error: "This address isn't subscribed right now. Sign up again to restart the brief." }, 409);
        const p = parsePrefs(body);
        if ("error" in p) return json({ error: p.error }, 400);
        await patch(c, row.id, { ...p, updated_at: new Date().toISOString() });
        return json({ ok: true, ...publicPrefs({ ...row, ...p }) });
      }
      default: return json({ error: "Unknown action." }, 400);
    }
  } catch (err) {
    console.error("subscribe failed:", err);
    return json({ error: "Something went wrong. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// ---------------------------------------------------------------- the actions
async function subscribe(c: Cfg, b: any): Promise<Response> {
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!validEmail(email)) return json({ error: "That doesn't look like a valid email address." }, 400);
  if (b.consent !== true) return json({ error: "Tick the box to agree to the emails and what we store." }, 400);
  const p = parsePrefs(b);
  if ("error" in p) return json({ error: p.error }, 400);

  const hash = await hmacHex(c.secret, "hash:" + email);
  const existing = await findByHash(c, hash);
  const now = new Date(), nowISO = now.toISOString();
  const ok = () => json({ ok: true, message: "Check your email for a link to confirm." });

  if (existing?.status === "active") {
    // Someone (maybe not the owner of the address) typed an address that is already subscribed. Preferences are
    // not touched; the owner gets a note with their manage link instead, and the caller learns nothing.
    const recent = existing.confirm_sent_at && now.getTime() - Date.parse(existing.confirm_sent_at) < RESEND_GAP_MS;
    if (!recent && await underDailyCap(c)) {
      await sendMail(c, email, alreadyEmail(c, email, await manageUrl(c, email)));
      await patch(c, existing.id, { confirm_sent_at: nowISO });
    }
    return ok();
  }
  if (existing?.status === "pending" && existing.confirm_sent_at && now.getTime() - Date.parse(existing.confirm_sent_at) < RESEND_GAP_MS) return ok();
  if (!(await underDailyCap(c))) return json({ error: "Daybird has hit its signup limit for today. Please try again tomorrow." }, 429);

  const token = randomToken();
  const row = { email, email_hash: hash, ...p, status: "pending", confirm_token_hash: await hmacHex(c.secret, "confirm:" + token), confirm_sent_at: nowISO, updated_at: nowISO, confirmed_at: null, unsubscribed_at: null };
  if (existing) await patch(c, existing.id, row);        // pending again, or back from 'unsubscribed'
  else {
    const r = await sbFetch(c, "subscribers", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (!r.ok) { console.error("subscribe: insert failed", r.status); return json({ error: "Couldn't save that right now. Please try again." }, 500); }
  }
  const sent = await sendMail(c, email, confirmEmail(c, p.place, `${c.site}confirm.html?t=${token}`));
  if (!sent.ok) return json({ error: sent.error }, 502);
  return ok();
}

async function confirm(c: Cfg, token: string): Promise<Response> {
  if (!/^[0-9a-f]{48}$/.test(token)) return json({ error: "This confirm link isn't valid." }, 400);
  const r = await sbFetch(c, `subscribers?confirm_token_hash=eq.${await hmacHex(c.secret, "confirm:" + token)}&status=eq.pending&select=${COLS}`);
  const rows: any[] = r.ok ? await r.json() : [];
  const row = rows[0];
  if (!row) return json({ error: "This confirm link isn't valid or was already used. Sign up again to get a fresh one." }, 400);
  if (row.confirm_sent_at && Date.now() - Date.parse(row.confirm_sent_at) > CONFIRM_TTL_MS) return json({ error: "This confirm link has expired. Sign up again to get a fresh one." }, 400);
  const nowISO = new Date().toISOString();
  await patch(c, row.id, { status: "active", confirmed_at: nowISO, updated_at: nowISO, confirm_token_hash: null, confirm_sent_at: null });
  return json({ ok: true, ...publicPrefs({ ...row, status: "active" }), manage: await manageUrl(c, row.email) });
}

// ---------------------------------------------------------------- validation
const COLS = "id,email,lat,lng,place,mode,level,go_only,status,confirm_sent_at";
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const validEmail = (e: string) => e.length <= 254 && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(e) && !e.includes("..");

function parsePrefs(b: any): { lat: number; lng: number; place: string; mode: string; level: string; go_only: boolean } | { error: string } {
  // Number(null) and Number("") are 0, which would quietly point the brief at the equator: require real numbers.
  const coord = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
  const lat = coord(b.lat), lng = coord(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Pick a place first." };
  const place = cleanText(b.place, 80) || "your area";
  const mode = B.MODES[b.mode] ? String(b.mode) : "any", level = B.LEVELS[b.level] ? String(b.level) : "new";
  // two decimals (about 1 km): enough for weather and a 25 km eBird circle, and nothing more precise is kept
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, place, mode, level, go_only: b.go_only === true || b.go_only === "true" };
}
const publicPrefs = (r: any) => ({ lat: r.lat, lng: r.lng, place: r.place, mode: r.mode, level: r.level, go_only: !!r.go_only, status: r.status });

// ---------------------------------------------------------------- database (service role; the tables have no client policies)
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });

async function findByHash(c: Cfg, hash: string): Promise<any | null> {
  const r = await sbFetch(c, `subscribers?email_hash=eq.${encodeURIComponent(hash)}&select=${COLS}`);
  if (!r.ok) throw new Error(`subscribers lookup ${r.status}`);
  return ((await r.json()) as any[])[0] || null;
}
async function patch(c: Cfg, id: string, fields: Record<string, unknown>) {
  const r = await sbFetch(c, `subscribers?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(fields) });
  if (!r.ok) throw new Error(`subscribers update ${r.status}`);
}
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
// Confirm emails cost money and can be aimed at strangers, so there is a site-wide daily cap on them.
async function underDailyCap(c: Cfg): Promise<boolean> {
  const r = await sbFetch(c, `subscribers?confirm_sent_at=gte.${encodeURIComponent(startOfTodayISO())}&select=id`, { headers: { prefer: "count=exact" } });
  if (!r.ok) return true;
  const rows: any[] = await r.json();
  const total = Number((r.headers.get("content-range") || "").split("/")[1]);
  return (Number.isFinite(total) ? total : rows.length) < c.perDay;
}

// ---------------------------------------------------------------- the emails
const esc = (s: unknown) => B.esc(s);
function shell(c: Cfg, title: string, bodyHtml: string, bodyText: string[]) {
  const F = "font-family:Arial,Helvetica,sans-serif";
  const legal = "Daybird is a guide, not safety advice.";
  const foot = [legal, c.address].filter(Boolean);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ec"><div style="max-width:560px;margin:0 auto;padding:16px;font-family:Georgia,'Times New Roman',serif;color:#1F2A37">
<div style="background:#fffdf8;border:1px solid #e3ddd0;border-radius:14px;padding:20px">
<div style="${F};font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E8833A">Daybird</div>
<div style="font-size:26px;font-weight:700;margin:10px 0 8px">${esc(title)}</div>${bodyHtml}</div>
<p style="${F};font-size:12px;color:#5f6b63;margin:14px 4px 0">${foot.map(esc).join("<br>")}</p></div></body></html>`;
  return { subject: title, html, text: [title, "", ...bodyText, "", ...foot].join("\n") + "\n" };
}
function confirmEmail(c: Cfg, place: string, link: string) {
  const F = "font-family:Arial,Helvetica,sans-serif";
  return shell(c, "Confirm your Daybird brief",
    `<p style="${F};font-size:15px">You asked for the morning brief for <b>${esc(place)}</b>. Tap the button to confirm and the first one arrives tomorrow around sunrise.</p>
<p style="margin:18px 0"><a href="${esc(link)}" style="${F};background:#1F2A37;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600">Yes, send me the brief</a></p>
<p style="${F};font-size:13px;color:#5f6b63">Or paste this into your browser: ${esc(link)}<br>If you didn't ask for this, ignore it and nothing more will come.</p>`,
    [`You asked for the morning brief for ${place}. Open this link to confirm:`, link, "If you didn't ask for this, ignore it and nothing more will come."]);
}
function alreadyEmail(c: Cfg, _email: string, manage: string) {
  const F = "font-family:Arial,Helvetica,sans-serif";
  return shell(c, "You're already on the list",
    `<p style="${F};font-size:15px">Someone entered this address on the Daybird signup page, and it's already getting the morning brief. Nothing has changed.</p>
<p style="${F};font-size:15px">To change your place, your mode, or to stop the emails: <a href="${esc(manage)}" style="color:#1F2A37">manage your brief</a>.</p>`,
    ["Someone entered this address on the Daybird signup page, and it's already getting the morning brief. Nothing has changed.", `Manage your brief: ${manage}`]);
}
async function sendMail(c: Cfg, to: string, m: { subject: string; html: string; text: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: c.from, to: [to], subject: m.subject, html: m.html, text: m.text }), signal: AbortSignal.timeout(20000),
  });
  if (r.ok) return { ok: true };
  let detail = "";
  try { detail = String((await r.json())?.message || ""); } catch { /* not JSON */ }
  console.error("subscribe: Resend refused:", r.status, detail);
  if (r.status === 403 && /domain|verify|testing/i.test(detail)) return { ok: false, error: "Email isn't fully set up yet: the email service only delivers to the site owner until a sending domain is verified." };
  return { ok: false, error: `The email service refused the message (${r.status}).` };
}

// ---------------------------------------------------------------- tokens
// "hash:" (storage key), "manage:" (links in every daily email), "confirm:" (one-time signup token). send-daily
// derives the manage token the same way, so the two functions must share UNSUB_SECRET.
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const manageToken = (c: Cfg, email: string) => hmacHex(c.secret, "manage:" + email);
async function manageUrl(c: Cfg, email: string) { return `${c.site}manage.html?e=${encodeURIComponent(email)}&t=${await manageToken(c, email)}`; }
async function validManage(c: Cfg, email: string, token: string) { return validEmail(email) && same(await manageToken(c, email), token); }
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
// Compares without stopping at the first mismatch, so response time doesn't leak how much of a guess was right.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
