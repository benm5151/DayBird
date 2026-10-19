// @ts-nocheck -- this file carries a generated plain-JavaScript block (see scripts/inline_engine.mjs)
// Daybird — send-brief edge function. Builds a fresh morning brief for any place and emails it,
// either to the signed-in user's own address ("self") or once to a friend ("other").
// Deploy in Supabase → Edge Functions (name: send-brief). Leave "Verify JWT" ON.
//
// Secrets (Edge Functions → Secrets):
//   EBIRD_KEY        your eBird API key (kept here so the browser never sees it)
//   RESEND_API_KEY   from resend.com. Until you verify a sending domain there, Resend only delivers to YOUR OWN address.
//   UNSUB_SECRET     any long random string (e.g. `openssl rand -hex 32`); signs unsubscribe links and hashes addresses
// Optional secrets:
//   FROM_EMAIL (default "Daybird <onboarding@resend.dev>"), SITE_URL (default the GitHub Pages site),
//   MAILING_ADDRESS (printed in the footer), SELF_PER_DAY (10), OTHER_PER_DAY (5), DAILY_SEND_CAP (50)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically. Needs migration-4.sql.
//
// Abuse guards, because this form can email strangers: sign-in required (the address for "self" comes from the
// verified account, never from the request); per-user daily caps; one brief per recipient per day and three per week;
// a site-wide daily cap; recipients can opt out for good; recipient addresses are stored only as keyed hashes.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York"; // daily caps reset at midnight Eastern, like the photo-ID cap
const RADIUS_KM = 25, BACK_DAYS = 3; // same as scripts/build_brief.mjs

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  const site = (Deno.env.get("SITE_URL") || "https://day-bird.com/").trim();
  return {
    ebirdKey: (Deno.env.get("EBIRD_KEY") || "").trim(),
    resendKey: (Deno.env.get("RESEND_API_KEY") || "").trim(),
    secret: (Deno.env.get("UNSUB_SECRET") || "").trim(),
    from: (Deno.env.get("FROM_EMAIL") || "Daybird <onboarding@resend.dev>").trim(),
    site: site.endsWith("/") ? site : site + "/",
    address: (Deno.env.get("MAILING_ADDRESS") || "").trim(),
    selfPerDay: num("SELF_PER_DAY", 10),
    otherPerDay: num("OTHER_PER_DAY", 5),
    dailyCap: num("DAILY_SEND_CAP", 50),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;


// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    const missing = [!c.resendKey && "RESEND_API_KEY", !c.secret && "UNSUB_SECRET"].filter(Boolean);
    if (missing.length) return json({ error: `Server setup incomplete: ${missing.join(" and ")} secret not set.` }, 500);

    const user = await verifiedUser(c, req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to send briefs by email." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const v = parseRequest(body);
    if ("error" in v) return json({ error: v.error }, 400);

    // sending "to a friend" at your own address is just a send to yourself
    const kind: "self" | "other" = v.kind === "other" && v.email !== user.email ? "other" : "self";
    const recipient = kind === "self" ? user.email : v.email;
    const rHash = await hmacHex(c.secret, "hash:" + recipient);

    // someone who opted out of friends' briefs is skipped silently (and the sender is not told which case it was)
    if (kind === "other" && await isSuppressed(c, rHash)) return json({ ok: true, kind, to: maskEmail(recipient) });

    const limitMsg = await checkLimits(c, user.id, kind, rHash);
    if (limitMsg) return json({ error: limitMsg }, 429);

    const brief = await buildBrief(v.lat, v.lng, v.place, c.ebirdKey, v.mode, v.level);
    if (!brief) return json({ error: "Couldn't build a brief right now: weather and sightings were both unavailable. Try again in a few minutes." }, 502);

    const sender = kind === "other" ? await senderLabel(c, user.id) : "";
    const unsub = kind === "other" ? await unsubLinks(c, recipient) : null;
    const mail = renderEmail(brief, { site: c.site, address: c.address, sender, unsubPage: unsub?.page || "" });

    const sent = await sendEmail(c, { to: recipient, ...mail, oneClick: unsub?.oneClick });
    if (!sent.ok) return json({ error: sent.error }, 502);

    await record(c, { sender_id: user.id, kind, recipient_hash: rHash, place: brief.place, ok: true });
    if (brief.errors.length) console.log("send-brief partial:", brief.errors.join("; "));
    return json({ ok: true, kind, to: kind === "self" ? recipient : maskEmail(recipient), word: brief.call.word, place: brief.place, when: brief.whenLabel, partial: brief.partial });
  } catch (e) {
    console.error("send-brief failed:", e);
    return json({ error: "Something went wrong sending the brief. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

function parseRequest(b: any): { kind: "self" | "other"; email: string; lat: number; lng: number; place: string; mode: string; level: string } | { error: string } {
  if (!b || typeof b !== "object") return { error: "Bad request." };
  if (b.to !== "self" && b.to !== "other") return { error: "Choose who to send the brief to." };
  // Number(null) and Number("") are 0, which would quietly point the brief at the equator: require real numbers.
  const coord = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
  const lat = coord(b.lat), lng = coord(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Pick a place first." };
  const place = cleanText(b.place, 80) || "your area";
  let email = "";
  if (b.to === "other") {
    email = String(b.email ?? "").trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(email) || email.includes("..")) return { error: "That doesn't look like a valid email address." };
  }
  const mode = B.MODES[b.mode] ? String(b.mode) : "any", level = B.LEVELS[b.level] ? String(b.level) : "new";
  return { kind: b.to, email, lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, place, mode, level };
}

// Checks the token with Supabase Auth itself, so it stays safe even if "Verify JWT" were switched off.
async function verifiedUser(c: Cfg, auth: string | null): Promise<{ id: string; email: string } | null> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !c.sbUrl) return null;
  try {
    const r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.anon || c.service, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id || !u?.email || !(u.email_confirmed_at || u.confirmed_at)) return null;
    return { id: String(u.id), email: String(u.email).trim().toLowerCase() };
  } catch { return null; }
}

// ---------------------------------------------------------------- limits and bookkeeping
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });

async function isSuppressed(c: Cfg, hash: string): Promise<boolean> {
  const r = await sbFetch(c, `email_suppressions?email_hash=eq.${encodeURIComponent(hash)}&select=email_hash`);
  if (!r.ok) return false;
  return ((await r.json()) as unknown[]).length > 0;
}
async function checkLimits(c: Cfg, userId: string, kind: "self" | "other", rHash: string): Promise<string | null> {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const r = await sbFetch(c, `brief_sends?select=sender_id,kind,recipient_hash,created_at&ok=eq.true&created_at=gte.${encodeURIComponent(weekAgo)}&limit=5000`);
  const rows: any[] = r.ok ? await r.json() : [];
  const at = (x: any) => Date.parse(x.created_at); // compare instants, not strings: Postgres and JS format timestamps differently
  const today = Date.parse(startOfTodayISO());
  const todayRows = rows.filter((x) => at(x) >= today);
  if (todayRows.length >= c.dailyCap) return "Daybird has hit its email limit for today. It resets at midnight Eastern.";
  const mine = todayRows.filter((x) => x.sender_id === userId && x.kind === kind).length;
  if (kind === "self" && mine >= c.selfPerDay) return `You've sent yourself ${c.selfPerDay} briefs today, which is the daily limit. It resets at midnight Eastern.`;
  if (kind === "other") {
    if (mine >= c.otherPerDay) return `You've shared ${c.otherPerDay} briefs today, which is the daily limit. It resets at midnight Eastern.`;
    const theirs = rows.filter((x) => x.recipient_hash === rHash);
    const dayAgo = Date.now() - 864e5;
    if (theirs.some((x) => at(x) >= dayAgo)) return "That address already got a Daybird brief in the last day.";
    if (theirs.length >= 3) return "That address has already received three Daybird briefs this week.";
  }
  return null;
}
async function record(c: Cfg, row: Record<string, unknown>) {
  try {
    const r = await sbFetch(c, "brief_sends", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (!r.ok) console.error("send-brief: could not record send:", r.status);
  } catch (e) { console.error("send-brief: could not record send:", e); }
}
async function senderLabel(c: Cfg, userId: string): Promise<string> {
  try {
    const r = await sbFetch(c, `profiles?id=eq.${encodeURIComponent(userId)}&select=name`);
    const rows: any[] = r.ok ? await r.json() : [];
    return cleanText(rows[0]?.name, 40) || "a Daybird user";
  } catch { return "a Daybird user"; }
}

// ---------------------------------------------------------------- building the brief
// Scoring, wording and the email body come from js/brief.js (the same engine the site and the daily
// Action use). A generated copy sits between the marker lines below, because Supabase's bundler will not
// import from outside sites; run `node scripts/inline_engine.mjs` after changing js/brief.js.
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

  // ---------------------------------------------------------------- compose: one object with everything
  // in: { place, date (YYYY-MM-DD), whenLabel, wx, tomorrow, notable, spots, recent, migration, mode, level, traits, seed }
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

  root.DAYBIRD_BRIEF = { VERSION, MODES, LEVELS, DIRS, dirName, modeTitle, groupOf, groups, weatherUrl, parseWeather, parseEbird, score, whyTags, whyLine, wearLine, firstSong, leaveBy, bestWindow, soaring, lookFor, groupsLine, stayIn, compose, text, emailHtml, esc, safeId, ampm, addMin };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
// --- data/traits.js
// Field-mark trait table for common Northeast US birds. Hand-authored for the ID helper; not exhaustive.
// size: tiny | sparrow | robin | jay | crow | hawk | goose   colors: dominant colors a beginner would name
// hab: feeder yard forest edge field marsh pond river lake shore sky   beh: perched ground feeder flying soaring swimming wading flocking hovering trunk hopping singing diving
globalThis.DAYBIRD_TRAITS = [
["Black-capped Chickadee","sparrow",["black","white","gray"],["feeder","yard","forest","edge"],["feeder","perched","flocking"],"black cap and bib, tiny, acrobatic"],
["Tufted Titmouse","sparrow",["gray","white","buff"],["feeder","yard","forest"],["feeder","perched"],"gray with a crest, peach flanks"],
["White-breasted Nuthatch","sparrow",["gray","white","black"],["feeder","forest","yard"],["trunk","feeder"],"walks head-first down trunks"],
["Red-breasted Nuthatch","sparrow",["gray","orange","black","white"],["forest","feeder"],["trunk","feeder"],"black eyeline, rusty belly, nasal 'yank'"],
["Downy Woodpecker","sparrow",["black","white","red"],["feeder","yard","forest","edge"],["trunk","feeder"],"small, short bill; male red nape"],
["Hairy Woodpecker","robin",["black","white","red"],["forest","feeder"],["trunk","feeder"],"like Downy but bigger with a long bill"],
["Pileated Woodpecker","crow",["black","white","red"],["forest"],["trunk","flying"],"crow-sized, flaming red crest, loud"],
["Northern Flicker","jay",["brown","black","white","yellow"],["yard","edge","field","forest"],["ground","flying","trunk"],"brown, spotted, white rump in flight, often on the ground"],
["Yellow-bellied Sapsucker","robin",["black","white","red","yellow"],["forest","edge"],["trunk"],"rows of holes in bark, red forehead"],
["Blue Jay","jay",["blue","white","black"],["feeder","yard","forest","edge"],["feeder","perched","flying","flocking"],"loud, crested, blue and white"],
["American Crow","crow",["black"],["yard","field","edge","sky"],["flying","ground","flocking"],"all black, 'caw'"],
["Common Raven","hawk",["black"],["forest","sky","field"],["soaring","flying"],"huge, wedge tail, croaks"],
["American Robin","robin",["gray","orange","brown"],["yard","field","edge","forest"],["ground","hopping","singing"],"orange breast, hops on lawns"],
["Eastern Bluebird","sparrow",["blue","orange","white"],["field","edge","yard"],["perched","flying"],"blue back, rusty chest, on wires and boxes"],
["Hermit Thrush","sparrow",["brown","white","orange"],["forest"],["ground","hopping"],"spotted breast, rusty tail it pumps"],
["Wood Thrush","robin",["brown","white"],["forest"],["ground","singing"],"bold round spots, flute song"],
["Veery","sparrow",["brown","buff"],["forest"],["ground","singing"],"warm brown, faint spots, spiraling song"],
["Gray Catbird","robin",["gray","black"],["edge","yard"],["perched","singing"],"slate gray, black cap, mews"],
["Northern Mockingbird","robin",["gray","white"],["yard","edge"],["perched","singing","flying"],"white wing flashes, mimics"],
["Brown Thrasher","jay",["brown","white"],["edge","yard"],["ground","singing"],"rusty, long tail, streaked breast"],
["European Starling","robin",["black","white","green"],["yard","field","feeder"],["flocking","ground","feeder"],"glossy, speckled in fall, yellow bill in spring"],
["Cedar Waxwing","sparrow",["brown","yellow","buff"],["edge","yard","pond"],["flocking","perched"],"sleek crest, yellow tail tip, in flocks"],
["Northern Cardinal","robin",["red","brown"],["feeder","yard","edge"],["feeder","perched","singing"],"male red; female brown with red bill"],
["Rose-breasted Grosbeak","robin",["black","white","red"],["feeder","forest","edge"],["feeder","perched","singing"],"male black/white with red triangle"],
["Evening Grosbeak","robin",["yellow","black","white"],["feeder","forest"],["feeder","flocking"],"chunky, huge pale bill, yellow"],
["Purple Finch","sparrow",["red","brown","white"],["feeder","forest","edge"],["feeder","perched"],"raspberry-dipped male"],
["House Finch","sparrow",["red","brown","streaked"],["feeder","yard"],["feeder","perched","flocking"],"streaky; male red on head and chest"],
["American Goldfinch","sparrow",["yellow","black","white"],["feeder","field","edge"],["feeder","flocking","flying"],"bright yellow (summer), bouncing flight"],
["Pine Siskin","sparrow",["brown","streaked","yellow"],["feeder","forest"],["feeder","flocking"],"streaky with yellow in wings"],
["Common Redpoll","sparrow",["brown","streaked","red"],["feeder","field"],["feeder","flocking"],"red cap, winter flocks"],
["House Sparrow","sparrow",["brown","gray","black"],["yard","feeder"],["ground","feeder","flocking"],"male gray crown, black bib"],
["Song Sparrow","sparrow",["brown","streaked","white"],["edge","field","marsh","yard"],["ground","perched","singing"],"streaky with central breast spot"],
["White-throated Sparrow","sparrow",["brown","white","gray","yellow"],["edge","feeder","forest"],["ground","feeder","singing"],"white throat, yellow lores, 'Oh sweet Canada'"],
["White-crowned Sparrow","sparrow",["gray","brown","black","white"],["edge","field"],["ground"],"bold black and white crown stripes"],
["Dark-eyed Junco","sparrow",["gray","white"],["feeder","yard","forest","edge"],["ground","feeder","flocking"],"slate gray, white belly, white outer tail"],
["Chipping Sparrow","sparrow",["brown","gray","orange"],["yard","edge"],["ground","perched"],"rusty cap, clean gray breast"],
["Savannah Sparrow","sparrow",["brown","streaked","yellow"],["field"],["ground","perched"],"streaky, yellow in front of eye"],
["Field Sparrow","sparrow",["brown","gray","orange"],["field","edge"],["perched","singing"],"pink bill, plain face"],
["Swamp Sparrow","sparrow",["brown","gray","orange"],["marsh"],["ground","perched"],"rusty wings, gray face, in cattails"],
["Eastern Towhee","robin",["black","orange","white"],["edge","forest"],["ground"],"black hood, rufous sides, scratches in leaves"],
["Red-winged Blackbird","robin",["black","red","yellow"],["marsh","field","pond"],["perched","flocking","singing"],"red shoulder, cattails"],
["Common Grackle","jay",["black","blue","green"],["yard","field","feeder"],["ground","flocking"],"iridescent, long keeled tail, pale eye"],
["Brown-headed Cowbird","robin",["black","brown"],["field","feeder","edge"],["ground","flocking"],"brown head, black body"],
["Rusty Blackbird","robin",["black","brown","yellow"],["marsh","pond","forest"],["ground","flocking"],"rusty edges in fall, pale eye, wet woods"],
["Baltimore Oriole","robin",["orange","black"],["edge","yard"],["perched","singing"],"flame orange and black"],
["Bobolink","sparrow",["black","white","buff"],["field"],["perched","flying","singing"],"male black below, white above in summer"],
["Eastern Meadowlark","robin",["yellow","brown","black"],["field"],["ground","perched","singing"],"yellow breast with black V"],
["Yellow-rumped Warbler","sparrow",["gray","yellow","white","black"],["edge","forest","yard"],["perched","flying","flocking"],"yellow rump patch, common migrant"],
["Yellow Warbler","sparrow",["yellow"],["edge","marsh"],["perched","singing"],"all yellow, red streaks on male"],
["Common Yellowthroat","sparrow",["yellow","black","brown"],["marsh","edge"],["perched","singing"],"black mask, 'witchety'"],
["Black-throated Green Warbler","sparrow",["yellow","black","green","white"],["forest"],["perched","singing"],"yellow face, black throat"],
["Black-and-white Warbler","sparrow",["black","white"],["forest"],["trunk"],"striped, creeps on branches"],
["American Redstart","sparrow",["black","orange","yellow"],["forest","edge"],["perched","flying"],"fans tail, orange or yellow patches"],
["Ovenbird","sparrow",["brown","white","orange"],["forest"],["ground","singing"],"walks on forest floor, 'teacher teacher'"],
["Northern Waterthrush","sparrow",["brown","white","streaked"],["marsh","pond","river"],["ground"],"bobs tail along water edges"],
["Pine Warbler","sparrow",["yellow","green","white"],["forest","feeder"],["perched","feeder"],"yellow, in pines, visits feeders"],
["Palm Warbler","sparrow",["brown","yellow"],["edge","field"],["ground","perched"],"pumps tail, rusty cap"],
["Magnolia Warbler","sparrow",["yellow","black","gray","white"],["forest","edge"],["perched"],"yellow with black necklace"],
["Ruby-crowned Kinglet","tiny",["green","gray","white"],["forest","edge"],["hovering","perched"],"tiny, flicks wings, white eye ring"],
["Golden-crowned Kinglet","tiny",["green","gray","yellow","black"],["forest"],["hovering","flocking"],"tiny, striped crown, high thin calls"],
["Blue-headed Vireo","sparrow",["blue","gray","white","green"],["forest"],["perched","singing"],"spectacles, slow deliberate"],
["Red-eyed Vireo","sparrow",["green","gray","white"],["forest"],["perched","singing"],"sings all day in canopy"],
["Winter Wren","tiny",["brown"],["forest","river"],["ground","singing"],"tiny, stub tail, long bubbling song"],
["House Wren","sparrow",["brown"],["yard","edge"],["perched","singing"],"plain brown, cocked tail, chattering"],
["Carolina Wren","sparrow",["brown","buff","white"],["yard","edge"],["perched","singing"],"loud, white eyebrow"],
["Eastern Phoebe","sparrow",["gray","brown","white"],["edge","river","yard"],["perched","flying"],"pumps tail, says its name"],
["Eastern Kingbird","robin",["black","white","gray"],["field","pond","edge"],["perched","flying"],"black above white below, white tail tip"],
["Eastern Wood-Pewee","sparrow",["gray","brown"],["forest"],["perched","singing"],"'pee-a-wee', sits still then sallies"],
["Tree Swallow","sparrow",["blue","white"],["pond","field","lake"],["flying","flocking"],"blue-green back, white below, over water"],
["Barn Swallow","sparrow",["blue","orange","buff"],["field","pond","yard"],["flying"],"forked tail, swooping low"],
["Chimney Swift","sparrow",["gray","black"],["sky","yard"],["flying","flocking"],"cigar with wings, twittering"],
["Ruby-throated Hummingbird","tiny",["green","red","white"],["yard","feeder","edge"],["hovering","feeder"],"tiny, hovering, red throat on male"],
["Belted Kingfisher","jay",["blue","white","gray","orange"],["river","pond","lake"],["perched","flying","diving"],"big head, rattling call, over water"],
["Mourning Dove","jay",["brown","gray","buff"],["yard","feeder","field"],["ground","perched","feeder"],"slender, pointed tail, whistling wings"],
["Rock Pigeon","jay",["gray","white","black","green"],["yard","field"],["flocking","ground","flying"],"city pigeon"],
["Wild Turkey","goose",["brown","black"],["field","forest","edge"],["ground","flocking"],"huge, in flocks on roadsides"],
["Ruffed Grouse","crow",["brown","gray"],["forest"],["ground"],"explodes from underfoot, drumming"],
["Canada Goose","goose",["brown","black","white"],["pond","field","lake","river","sky"],["swimming","ground","flying","flocking"],"black neck, white chin strap"],
["Mallard","hawk",["green","brown","gray","blue"],["pond","river","lake","marsh"],["swimming"],"male green head; female mottled brown"],
["Wood Duck","hawk",["green","white","brown","orange"],["pond","marsh","river"],["swimming"],"ornate male, crested; whistles"],
["Hooded Merganser","hawk",["black","white","brown"],["pond","river","lake"],["swimming","diving"],"male fan-shaped white crest"],
["Common Merganser","goose",["green","white","orange","gray"],["river","lake"],["swimming","diving"],"long, sleek, red bill"],
["Ring-necked Duck","hawk",["black","gray","white"],["pond","lake"],["swimming","diving"],"peaked head, white ring on bill"],
["American Black Duck","hawk",["brown","black"],["marsh","pond","river"],["swimming"],"dark brown, like a dark female mallard"],
["Common Loon","goose",["black","white"],["lake"],["swimming","diving"],"checkered back, wailing call"],
["Pied-billed Grebe","jay",["brown"],["pond","lake","marsh"],["swimming","diving"],"small, chunky, sinks like a submarine"],
["Double-crested Cormorant","goose",["black"],["lake","river"],["swimming","diving","flying","perched"],"holds wings out to dry"],
["Great Blue Heron","goose",["gray","blue","white"],["pond","marsh","river","lake","shore"],["wading","flying"],"huge, slow, stands still"],
["Green Heron","crow",["green","orange","black"],["pond","marsh"],["wading","perched"],"small, hunched, chestnut neck"],
["Killdeer","robin",["brown","white","black"],["field","shore","yard"],["ground","flying"],"two black breast bands, loud"],
["Spotted Sandpiper","sparrow",["brown","white"],["shore","river","pond"],["ground","wading"],"teeters, stiff-winged flight"],
["Solitary Sandpiper","robin",["brown","white"],["pond","marsh","river"],["wading","ground"],"white eye ring, bobs, alone"],
["Wilson's Snipe","robin",["brown","buff","streaked"],["marsh","field"],["ground","flying"],"long bill, zigzag flush"],
["American Woodcock","robin",["brown","buff"],["edge","forest","field"],["ground","flying"],"rotund, long bill, dusk display"],
["Ring-billed Gull","hawk",["white","gray","black"],["lake","field","river","shore"],["flying","ground","flocking"],"parking-lot gull, ring on bill"],
["Herring Gull","goose",["white","gray","black"],["lake","river","shore"],["flying","ground"],"large gull, pink legs"],
["Turkey Vulture","hawk",["black","red"],["sky","field"],["soaring"],"wobbly V, two-toned wings"],
["Bald Eagle","goose",["black","white","brown"],["river","lake","sky"],["soaring","perched"],"white head and tail (adult)"],
["Osprey","hawk",["brown","white"],["lake","river","sky"],["soaring","hovering","diving"],"white below, crooked wings, dives for fish"],
["Red-tailed Hawk","hawk",["brown","white","red"],["field","sky","edge"],["soaring","perched"],"belly band, red tail, on highway poles"],
["Broad-winged Hawk","hawk",["brown","white"],["forest","sky"],["soaring","flocking"],"banded tail, migrates in kettles"],
["Cooper's Hawk","crow",["gray","orange","brown"],["yard","forest","feeder"],["flying","perched"],"long tail, ambushes feeders"],
["Sharp-shinned Hawk","jay",["gray","orange","brown"],["forest","yard","feeder"],["flying","perched"],"small accipiter, square tail"],
["Northern Harrier","hawk",["gray","brown","white"],["field","marsh"],["flying"],"white rump, low tilting flight"],
["American Kestrel","jay",["orange","blue","brown"],["field","edge"],["hovering","perched"],"small falcon, hovers, on wires"],
["Merlin","jay",["gray","brown","streaked"],["field","edge","sky"],["flying","perched"],"small dark falcon, fast direct flight"],
["Peregrine Falcon","crow",["gray","black","white"],["sky","river","shore"],["flying","soaring"],"dark hood, powerful"],
["Barred Owl","crow",["brown","white","streaked"],["forest","marsh"],["perched"],"'who cooks for you', dark eyes"],
["Great Horned Owl","hawk",["brown","gray","buff"],["forest","edge"],["perched"],"ear tufts, deep hoots"],
["Scarlet Tanager","sparrow",["red","black","yellow","green"],["forest"],["perched","singing"],"male blazing red with black wings"],
["Indigo Bunting","sparrow",["blue","brown"],["edge","field"],["perched","singing"],"all blue male, sings from wires"],
["Red-bellied Woodpecker","robin",["red","black","white","gray"],["feeder","forest","yard"],["trunk","feeder"],"zebra back, red nape"],
["Snow Bunting","sparrow",["white","brown","black"],["field","shore"],["flocking","ground"],"winter flocks, white in flight"],
["Horned Lark","sparrow",["brown","yellow","black"],["field"],["ground","flocking"],"black mask, tiny horns, bare fields"],
["American Pipit","sparrow",["brown","buff","streaked"],["field","shore"],["ground","flocking"],"walks, bobs tail, 'pip-it'"],
["Bank Swallow","sparrow",["brown","white"],["river","pond"],["flying","flocking"],"brown breast band"],
["Sandhill Crane","goose",["gray","red"],["field","marsh"],["ground","flying"],"huge, red crown, bugling"],
];
// <<< engine
const B: any = (globalThis as any).DAYBIRD_BRIEF;
const TRAITS: any[] = (globalThis as any).DAYBIRD_TRAITS || [];

async function getJSON(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

export async function buildBrief(lat: number, lng: number, place: string, ebirdKey: string, mode = "any", level = "new") {
  const errors: string[] = [];
  const H = { "X-eBirdApiToken": ebirdKey };
  const q = `lat=${lat}&lng=${lng}&dist=${RADIUS_KM}&back=${BACK_DAYS}`;
  const [wr, nr, rr] = await Promise.allSettled([
    getJSON(B.weatherUrl(lat, lng)).then((w: unknown) => B.parseWeather(w)),
    ebirdKey ? getJSON(`https://api.ebird.org/v2/data/obs/geo/recent/notable?${q}&detail=simple`, H) : Promise.reject(new Error("no EBIRD_KEY")),
    ebirdKey ? getJSON(`https://api.ebird.org/v2/data/obs/geo/recent?${q}`, H) : Promise.reject(new Error("no EBIRD_KEY")),
  ]);
  const w = wr.status === "fulfilled" ? wr.value : null;
  if (wr.status === "rejected") errors.push(`weather: ${wr.reason?.message || wr.reason}`);
  if (nr.status === "rejected") errors.push(`ebird notable: ${nr.reason?.message || nr.reason}`);
  if (rr.status === "rejected") errors.push(`ebird recent: ${rr.reason?.message || rr.reason}`);
  const eb = B.parseEbird(nr.status === "fulfilled" ? nr.value : [], rr.status === "fulfilled" ? rr.value : []);
  if (!w && !eb.spots.length && !eb.notable.length) return null;
  const brief = B.compose({ place, date: w?.date, whenLabel: w?.whenLabel || "today", wx: w?.wx || null, tomorrow: w?.tomorrow || null, ...eb, mode, level, traits: TRAITS });
  return { ...brief, errors, partial: errors.length > 0 };
}

// ---------------------------------------------------------------- the email itself
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s: unknown) => B.esc(s);

export function renderEmail(b: any, o: { site: string; address: string; sender: string; unsubPage: string }) {
  const subject = `${b.call.word} · ${cleanText(b.place, 60)} · ${b.shortDate}`;
  const intro = o.sender ? `${o.sender} shared today's Daybird brief with you.` : "";
  const note = b.partial ? "Some data was unavailable for this brief, so it may be incomplete." : "";
  const legal = "Sightings via eBird (Cornell Lab of Ornithology). Weather via Open-Meteo. Daybird is a guide, not safety advice.";
  const footer = [legal, o.address, o.unsubPage ? `Don't want briefs from friends? Unsubscribe: ${o.unsubPage}` : ""].filter(Boolean);
  const text = B.text(b, { site: o.site, intro, note, footer });
  const footerHtml = [esc(legal), o.address ? esc(o.address) : "", o.unsubPage ? `Don't want briefs from friends? <a href="${esc(o.unsubPage)}" style="color:#1F2A37">Unsubscribe</a>` : ""].filter(Boolean).join("<br>");
  const html = B.emailHtml(b, { site: o.site, intro, note, footerHtml });
  return { subject, html, text };
}


// ---------------------------------------------------------------- sending
async function sendEmail(c: Cfg, m: { to: string; subject: string; html: string; text: string; oneClick?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload: Record<string, unknown> = { from: c.from, to: [m.to], subject: m.subject, html: m.html, text: m.text };
  if (m.oneClick) payload.headers = { "List-Unsubscribe": `<${m.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  });
  if (r.ok) return { ok: true };
  let detail = "";
  try { detail = String((await r.json())?.message || ""); } catch { /* not JSON */ }
  console.error("send-brief: Resend refused:", r.status, detail);
  if (r.status === 403 && /domain|verify|testing/i.test(detail)) return { ok: false, error: "Email isn't fully set up yet: the email service only delivers to the account owner until a sending domain is verified." };
  return { ok: false, error: `The email service refused the message (${r.status}).` };
}

// ---------------------------------------------------------------- small helpers
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// The same two derivations live in the unsubscribe function: "hash:" for storage, "unsub:" for the link token.
async function unsubLinks(c: Cfg, email: string) {
  const t = await hmacHex(c.secret, "unsub:" + email);
  const q = `e=${encodeURIComponent(email)}&t=${t}`;
  return { page: `${c.site}unsubscribe.html?${q}`, oneClick: `${c.sbUrl}/functions/v1/unsubscribe?${q}` };
}
const maskEmail = (e: string) => { const [l, d] = e.split("@"); return `${l.slice(0, 1)}***@${d}`; };
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
