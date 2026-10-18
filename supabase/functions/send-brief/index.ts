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
const RADIUS_KM = 25, BACK_DAYS = 3; // same as scripts/build_brief.py
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  const site = (Deno.env.get("SITE_URL") || "https://benm5151.github.io/DayBird/").trim();
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

type Wx = { temp: number; wind: number; windDir: number; rain: number; sunrise: string };
type Spot = { name: string; locId?: string; species: number };
type Notable = { comName: string; howMany?: number; locName: string; obsDt?: string; subId?: string };
export type Brief = {
  place: string; date: string; dateLabel: string; shortDate: string; whenLabel: string;
  word: string; grade: "go" | "maybe" | "stay"; headline: string; score: number; why: string[];
  wx: Wx | null; spots: Spot[]; notable: Notable[]; errors: string[]; partial: boolean;
};

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

    const brief = await buildBrief(v.lat, v.lng, v.place, c.ebirdKey);
    if (!brief) return json({ error: "Couldn't build a brief right now: weather and sightings were both unavailable. Try again in a few minutes." }, 502);

    const sender = kind === "other" ? await senderLabel(c, user.id) : "";
    const unsub = kind === "other" ? await unsubLinks(c, recipient) : null;
    const mail = renderEmail(brief, { site: c.site, address: c.address, sender, unsubPage: unsub?.page || "" });

    const sent = await sendEmail(c, { to: recipient, ...mail, oneClick: unsub?.oneClick });
    if (!sent.ok) return json({ error: sent.error }, 502);

    await record(c, { sender_id: user.id, kind, recipient_hash: rHash, place: brief.place, ok: true });
    if (brief.errors.length) console.log("send-brief partial:", brief.errors.join("; "));
    return json({ ok: true, kind, to: kind === "self" ? recipient : maskEmail(recipient), word: brief.word, place: brief.place, when: brief.whenLabel, partial: brief.partial });
  } catch (e) {
    console.error("send-brief failed:", e);
    return json({ error: "Something went wrong sending the brief. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

function parseRequest(b: any): { kind: "self" | "other"; email: string; lat: number; lng: number; place: string } | { error: string } {
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
  return { kind: b.to, email, lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, place };
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
async function getJSON(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.json();
}

// Weather for 6–9 AM local. After 9 AM local the morning is over, so it covers tomorrow instead.
async function getWeather(lat: number, lng: number): Promise<{ wx: Wx; date: string; whenLabel: string }> {
  const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m&daily=sunrise&current=temperature_2m` +
    `&timezone=auto&forecast_days=2&wind_speed_unit=mph&temperature_unit=fahrenheit`);
  const hourNow = w.current?.time ? Number(String(w.current.time).slice(11, 13)) : 0;
  const dayIdx = hourNow >= 9 && (w.daily?.time?.length || 0) > 1 ? 1 : 0;
  const date: string = w.daily.time[dayIdx];
  const idx: number[] = [];
  (w.hourly.time as string[]).forEach((t, i) => { if (t.startsWith(date) && ["06", "07", "08", "09"].includes(t.slice(11, 13))) idx.push(i); });
  const avg = (k: string) => {
    const vals = idx.map((i) => w.hourly[k]?.[i]).filter((x) => typeof x === "number" && Number.isFinite(x)) as number[];
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  };
  const wx = { temp: avg("temperature_2m"), wind: avg("wind_speed_10m"), windDir: avg("wind_direction_10m"), rain: avg("precipitation_probability") };
  if (!Number.isFinite(wx.temp) || !Number.isFinite(wx.wind)) throw new Error("no hourly weather for the morning window");
  return {
    wx: { temp: Math.round(wx.temp), wind: Math.round(wx.wind), windDir: Math.round(Number.isFinite(wx.windDir) ? wx.windDir : 0), rain: Math.round(Number.isFinite(wx.rain) ? wx.rain : 0), sunrise: String(w.daily.sunrise?.[dayIdx] || "").slice(11, 16) },
    date, whenLabel: dayIdx === 1 ? "tomorrow morning" : "this morning",
  };
}

async function getEbird(lat: number, lng: number, key: string): Promise<{ notable: Notable[]; spots: Spot[]; errors: string[] }> {
  const H = { "X-eBirdApiToken": key };
  const q = `lat=${lat}&lng=${lng}&dist=${RADIUS_KM}&back=${BACK_DAYS}`;
  const [n, r] = await Promise.allSettled([
    getJSON(`https://api.ebird.org/v2/data/obs/geo/recent/notable?${q}&detail=simple`, H),
    getJSON(`https://api.ebird.org/v2/data/obs/geo/recent?${q}`, H),
  ]);
  const errors: string[] = [];
  const notable: Notable[] = [];
  if (n.status === "fulfilled") {
    const seen = new Set<string>();
    for (const o of n.value as any[]) { // one line per species + place, newest first (eBird returns newest first)
      const k = `${o.comName}|${o.locId || o.locName}`;
      if (seen.has(k)) continue;
      seen.add(k);
      notable.push({ comName: String(o.comName || ""), howMany: o.howMany, locName: String(o.locName || ""), obsDt: o.obsDt, subId: o.subId });
    }
  } else errors.push(`ebird notable: ${n.reason?.message || n.reason}`);
  const by = new Map<string, { name: string; locId?: string; species: Set<string> }>();
  if (r.status === "fulfilled") {
    for (const o of r.value as any[]) {
      const k = o.locId || o.locName;
      if (!by.has(k)) by.set(k, { name: String(o.locName || ""), locId: o.locId, species: new Set() });
      by.get(k)!.species.add(o.comName);
    }
  } else errors.push(`ebird recent: ${r.reason?.message || r.reason}`);
  const spots = [...by.values()].map((v) => ({ name: v.name, locId: v.locId, species: v.species.size })).sort((a, b) => b.species - a.species).slice(0, 5);
  return { notable: notable.slice(0, 8), spots, errors };
}

// Same rules as scripts/build_brief.py (no migration rating: BirdCast has no public API).
function scoreCall(wx: Wx | null, notableCount: number, month: number) {
  let score = 50;
  const why: string[] = [];
  if (wx) {
    const d = DIRS[Math.round(wx.windDir / 45) % 8];
    if (wx.wind <= 8) { score += 15; why.push("calm winds"); } else if (wx.wind >= 18) { score -= 20; why.push("windy"); }
    if (wx.rain <= 20) score += 10; else if (wx.rain >= 60) { score -= 25; why.push("rain likely"); }
    if (month >= 8 && month <= 11 && (d === "N" || d === "NW")) { score += 10; why.push("NW tailwind for fall migrants"); }
    if (month >= 3 && month <= 6 && (d === "S" || d === "SW")) { score += 10; why.push("SW tailwind for spring migrants"); }
  } else why.push("no weather data");
  if (notableCount >= 3) { score += 10; why.push(`${notableCount} notable reports nearby`); }
  const grade = score >= 70 ? "go" : score >= 45 ? "maybe" : "stay";
  return { score, grade: grade as "go" | "maybe" | "stay", why };
}

export async function buildBrief(lat: number, lng: number, place: string, ebirdKey: string): Promise<Brief | null> {
  const errors: string[] = [];
  const [wr, er] = await Promise.allSettled([
    getWeather(lat, lng),
    ebirdKey ? getEbird(lat, lng, ebirdKey) : Promise.reject(new Error("no EBIRD_KEY")),
  ]);
  const w = wr.status === "fulfilled" ? wr.value : null;
  if (wr.status === "rejected") errors.push(`weather: ${wr.reason?.message || wr.reason}`);
  const eb = er.status === "fulfilled" ? er.value : { notable: [], spots: [], errors: [] as string[] };
  if (er.status === "rejected") errors.push(`ebird: ${er.reason?.message || er.reason}`);
  errors.push(...eb.errors);
  if (!w && !eb.spots.length && !eb.notable.length) return null;

  const date = w?.date || new Date().toISOString().slice(0, 10);
  const { score, grade, why } = scoreCall(w?.wx || null, eb.notable.length, Number(date.slice(5, 7)));
  const d = new Date(`${date}T12:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(d);
  return {
    place, date, dateLabel: fmt({ weekday: "long", month: "short", day: "numeric" }), shortDate: fmt({ weekday: "short", month: "short", day: "numeric" }),
    whenLabel: w?.whenLabel || "today",
    word: { go: "GO", maybe: "MAYBE", stay: "STAY IN" }[grade], grade,
    headline: { go: "Get out there.", maybe: "Worth a look.", stay: "Coffee first." }[grade],
    score, why, wx: w?.wx || null, spots: eb.spots, notable: eb.notable, errors, partial: errors.length > 0,
  };
}

// ---------------------------------------------------------------- the email itself
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ESC[ch]);
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const safeId = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9]{1,20}$/.test(s) ? s : "");
const wind = (wx: Wx) => `${wx.wind} mph ${DIRS[Math.round(wx.windDir / 45) % 8]}`;
const BIRDCAST = "https://dashboard.birdcast.info/";

export function renderEmail(b: Brief, o: { site: string; address: string; sender: string; unsubPage: string }) {
  const subject = `${b.word} · ${cleanText(b.place, 60)} · ${b.shortDate}`;
  const intro = o.sender ? `${o.sender} shared today's Daybird brief with you.` : "";
  const when = `${b.place} · ${b.dateLabel}, 6–9 AM (${b.whenLabel})`;
  const wxLine = b.wx ? `${b.wx.temp}°F · wind ${wind(b.wx)} · rain ${b.wx.rain}%${b.wx.sunrise ? ` · sunrise ${b.wx.sunrise}` : ""}` : "";
  const whyLine = b.why.join(" · ") || "Average conditions.";
  const note = b.partial ? "Some data was unavailable for this brief, so it may be incomplete." : "";
  const legal = "Sightings via eBird (Cornell Lab of Ornithology). Weather via Open-Meteo. Daybird is a guide, not safety advice.";

  // ---- plain text
  const T: string[] = [];
  if (intro) T.push(intro, "");
  T.push(`${b.word} — ${b.headline}  (score ${b.score})`, whyLine, "", when);
  if (wxLine) T.push(wxLine);
  T.push(`Migration last night: ${BIRDCAST}`, "", `Where to go (species reported in the last ${BACK_DAYS} days, within ${RADIUS_KM} km):`);
  b.spots.forEach((s, i) => { const id = safeId(s.locId); T.push(`${i + 1}. ${s.name} — ${s.species} species${id ? ` — https://ebird.org/hotspot/${id}` : ""}`); });
  if (!b.spots.length) T.push("(no eBird data)");
  T.push("", "Notable nearby:");
  b.notable.forEach((n) => { const id = safeId(n.subId); T.push(`- ${n.comName}${n.howMany ? ` ×${n.howMany}` : ""} — ${n.locName}${n.obsDt ? `, ${n.obsDt}` : ""}${id ? ` — https://ebird.org/checklist/${id}` : ""}`); });
  if (!b.notable.length) T.push("Nothing notable in range.");
  T.push("", `Full brief: ${o.site}`);
  if (note) T.push(note);
  T.push("", legal);
  if (o.address) T.push(o.address);
  if (o.unsubPage) T.push(`Don't want briefs from friends? Unsubscribe: ${o.unsubPage}`);

  // ---- HTML (inline styles only: email clients ignore stylesheets)
  const color = { go: "#2f6b4f", maybe: "#b8561a", stay: "#a33a2a" }[b.grade];
  const li = (inner: string) => `<li style="margin:0 0 6px">${inner}</li>`;
  const link = (href: string, text: string) => `<a href="${esc(href)}" style="color:#1F2A37">${esc(text)}</a>`;
  const spots = b.spots.map((s) => { const id = safeId(s.locId); return li(`${id ? link(`https://ebird.org/hotspot/${id}`, s.name) : esc(s.name)} <span style="color:#5f6b63">— ${s.species} species</span>`); }).join("") || li("No recent eBird reports.");
  const notable = b.notable.map((n) => { const id = safeId(n.subId); const nm = `${n.comName}${n.howMany ? ` ×${n.howMany}` : ""}`; return li(`${id ? link(`https://ebird.org/checklist/${id}`, nm) : esc(nm)} <span style="color:#5f6b63">— ${esc(n.locName)}${n.obsDt ? `, ${esc(n.obsDt)}` : ""}</span>`); }).join("") || li("Nothing notable in range.");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ec">
<div style="max-width:560px;margin:0 auto;padding:16px;font-family:Georgia,'Times New Roman',serif;color:#1F2A37">
<div style="background:#fffdf8;border:1px solid #e3ddd0;border-radius:14px;padding:20px">
<div style="font:700 12px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#E8833A">Daybird · morning brief</div>
${intro ? `<p style="font:15px Arial,sans-serif;margin:10px 0 0">${esc(intro)}</p>` : ""}
<div style="font-size:46px;font-weight:700;line-height:1.1;margin:10px 0 2px;color:${color}">${esc(b.word)}</div>
<div style="font-size:20px">${esc(b.headline)}</div>
<p style="font:15px Arial,sans-serif;color:#5f6b63;margin:8px 0">${esc(whyLine)}</p>
<p style="font:600 14px Arial,sans-serif;margin:14px 0 2px">${esc(when)}</p>
${wxLine ? `<p style="font:14px Arial,sans-serif;margin:0 0 4px">${esc(wxLine)}</p>` : ""}
<p style="font:14px Arial,sans-serif;margin:0 0 14px">${link(BIRDCAST, "Check last night's migration on BirdCast")}</p>
<h3 style="font:700 16px Arial,sans-serif;margin:16px 0 6px">Where to go</h3>
<p style="font:12px Arial,sans-serif;color:#5f6b63;margin:0 0 6px">Most species reported in the last ${BACK_DAYS} days, within ${RADIUS_KM} km.</p>
<ol style="font:15px Arial,sans-serif;padding-left:20px;margin:0">${spots}</ol>
<h3 style="font:700 16px Arial,sans-serif;margin:16px 0 6px">Notable nearby</h3>
<ul style="font:15px Arial,sans-serif;padding-left:20px;margin:0">${notable}</ul>
<p style="font:14px Arial,sans-serif;margin:18px 0 0">${link(o.site, "Open the full brief")}</p>
${note ? `<p style="font:13px Arial,sans-serif;color:#a33a2a;margin:10px 0 0">${esc(note)}</p>` : ""}
</div>
<p style="font:12px Arial,sans-serif;color:#5f6b63;margin:14px 4px 0">${esc(legal)}${o.address ? `<br>${esc(o.address)}` : ""}${o.unsubPage ? `<br>Don't want briefs from friends? ${link(o.unsubPage, "Unsubscribe")}` : ""}</p>
</div></body></html>`;
  return { subject, html, text: T.join("\n") + "\n" };
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
