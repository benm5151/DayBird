// Daybird — hotspots edge function. eBird lookups for the route finder, with the eBird key kept server-side.
// Deploy in Supabase → Edge Functions (name: hotspots). Leave "Verify JWT" ON. Needs the `usage` table (migration-3.sql).
//
// Secrets: EBIRD_KEY (required). Optional: HOTSPOTS_PER_DAY (default 30 requests per user per day, both routes together).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//   POST { points: [{lat, lng}, ...] }            → { hotspots: [{locId, locName, lat, lng, numSpeciesAllTime, latestObsDt, sample}], samples, cached, remaining }
//        eBird ref/hotspot/geo within 5 km of each point (20 points max per request), deduped by locId.
//   POST ?recent=1  { lat, lng }  (or { recent: true, lat, lng })
//        → { recent: [...], notable: [...], remaining }  eBird data/obs/geo/recent (+ /notable) within 25 km, 3 days back,
//        trimmed to the fields the brief engine reads. Used by "Brief for the far end".
//
// Guards: sign-in required (checked with Supabase Auth, not just the gateway); 30 requests per user per day recorded in
// `usage` (kind 'hotspots', cost 0, so the photo-ID dollar cap is untouched); coordinates rounded to 2 decimals;
// replies cached in memory for the life of the function instance, keyed by the rounded point (hotspot lists for good,
// recent sightings for an hour), so a popular route costs eBird nothing the second time.
// eBird data is for non-commercial use without the Cornell Lab's permission; attribute eBird wherever it is shown.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York"; // daily caps reset at midnight Eastern, like the other functions
const MAX_POINTS = 20, HOTSPOT_KM = 5, RECENT_KM = 25, BACK_DAYS = 3, RECENT_TTL_MS = 60 * 60 * 1000;
const KIND = "hotspots";

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  return {
    ebirdKey: (Deno.env.get("EBIRD_KEY") || "").trim(),
    perDay: num("HOTSPOTS_PER_DAY", 30),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;

// ---------------------------------------------------------------- in-memory cache (per function instance)
const CACHE = new Map<string, { at: number; data: unknown }>();
export function _resetCache() { CACHE.clear(); }
const cacheKey = (kind: string, lat: number, lng: number) => `${kind}:${lat.toFixed(2)}:${lng.toFixed(2)}`;
function cached<T>(key: string, ttl: number): T | undefined {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (ttl > 0 && Date.now() - hit.at > ttl) { CACHE.delete(key); return undefined; }
  return hit.data as T;
}

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    if (!c.ebirdKey) return json({ error: "Server setup incomplete: EBIRD_KEY secret not set." }, 500);

    const user = await verifiedUser(c, req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to search hotspots." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Bad request." }, 400);
    const wantRecent = new URL(req.url).searchParams.get("recent") === "1" || body.recent === true;

    const used = await usedToday(c, user.id);
    if (used >= c.perDay) return json({ error: `You've used today's ${c.perDay} hotspot searches. The limit resets at midnight Eastern.` }, 429);
    const remaining = c.perDay - used - 1;

    if (wantRecent) {
      const p = point(body);
      if (!p) return json({ error: "Pick a place first." }, 400);
      const data = await recentFor(c, p.lat, p.lng);
      await record(c, user.id, true);
      return json({ ...data, remaining, attribution: "Sightings via eBird (Cornell Lab of Ornithology)." });
    }

    if (!Array.isArray(body.points) || body.points.length === 0) return json({ error: "Send the points along the route." }, 400);
    if (body.points.length > MAX_POINTS) return json({ error: `At most ${MAX_POINTS} points per request.` }, 400);
    const pts = body.points.map(point);
    if (pts.some((p: unknown) => !p)) return json({ error: "Every point needs a latitude and longitude." }, 400);

    let hits = 0;
    const lists = await Promise.all(pts.map(async (p: { lat: number; lng: number }, i: number) => {
      const key = cacheKey("h", p.lat, p.lng);
      const hit = cached<any[]>(key, 0);
      if (hit) { hits++; return hit.map((h) => ({ ...h, sample: i })); }
      const raw = await ebird(c, `/ref/hotspot/geo?lat=${p.lat}&lng=${p.lng}&dist=${HOTSPOT_KM}&fmt=json`);
      const slim = (Array.isArray(raw) ? raw : []).map(slimHotspot).filter(Boolean) as any[];
      CACHE.set(key, { at: Date.now(), data: slim });
      return slim.map((h) => ({ ...h, sample: i }));
    }));
    const seen = new Set<string>(), hotspots: any[] = [];
    for (const list of lists) for (const h of list) { if (seen.has(h.locId)) continue; seen.add(h.locId); hotspots.push(h); }
    await record(c, user.id, true);
    return json({ hotspots, samples: pts.length, cached: hits, remaining, attribution: "Hotspots via eBird (Cornell Lab of Ornithology)." });
  } catch (e) {
    console.error("hotspots failed:", e);
    const msg = e instanceof EbirdError ? `eBird answered ${e.status}; try again in a minute.` : "Something went wrong looking up hotspots. Try again in a minute.";
    return json({ error: msg }, 502);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// Number(null) and Number("") are 0, which would point at the equator: require real numbers. Rounded to 2 decimals (~1 km).
function point(b: any): { lat: number; lng: number } | null {
  const coord = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
  const lat = coord(b?.lat), lng = coord(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const safeId = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9]{1,20}$/.test(s) ? s : "");
function slimHotspot(h: any) {
  const locId = safeId(h?.locId); if (!locId) return null;
  const lat = Number(h.lat), lng = Number(h.lng);
  return { locId, locName: cleanText(h.locName, 120) || locId, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    numSpeciesAllTime: Number.isFinite(Number(h.numSpeciesAllTime)) ? Number(h.numSpeciesAllTime) : null, latestObsDt: cleanText(h.latestObsDt, 20) || null };
}
const slimObs = (o: any) => ({ comName: cleanText(o?.comName, 80), locName: cleanText(o?.locName, 120), locId: safeId(o?.locId), subId: safeId(o?.subId), obsDt: cleanText(o?.obsDt, 20),
  howMany: Number.isFinite(Number(o?.howMany)) ? Number(o.howMany) : undefined, lat: Number.isFinite(Number(o?.lat)) ? Math.round(Number(o.lat) * 100) / 100 : undefined, lng: Number.isFinite(Number(o?.lng)) ? Math.round(Number(o.lng) * 100) / 100 : undefined });

async function recentFor(c: Cfg, lat: number, lng: number) {
  const key = cacheKey("r", lat, lng);
  const hit = cached<any>(key, RECENT_TTL_MS);
  if (hit) return { ...hit, cached: true };
  const q = `lat=${lat}&lng=${lng}&dist=${RECENT_KM}&back=${BACK_DAYS}`;
  const [rr, nr] = await Promise.allSettled([ebird(c, `/data/obs/geo/recent?${q}`), ebird(c, `/data/obs/geo/recent/notable?${q}&detail=simple`)]);
  if (rr.status === "rejected" && nr.status === "rejected") throw rr.reason;
  const data = { recent: (rr.status === "fulfilled" && Array.isArray(rr.value) ? rr.value : []).map(slimObs).filter((o: any) => o.comName),
    notable: (nr.status === "fulfilled" && Array.isArray(nr.value) ? nr.value : []).map(slimObs).filter((o: any) => o.comName), cached: false };
  CACHE.set(key, { at: Date.now(), data });
  return data;
}

class EbirdError extends Error { status: number; constructor(status: number) { super(`eBird ${status}`); this.status = status; } }
async function ebird(c: Cfg, path: string) {
  const r = await fetch(`https://api.ebird.org/v2${path}`, { headers: { "X-eBirdApiToken": c.ebirdKey, "User-Agent": "Daybird/1.0 (+https://day-bird.com; birding brief for newer birders)", "Accept": "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new EbirdError(r.status);
  return r.json();
}

// Checks the token with Supabase Auth itself, so it stays safe even if "Verify JWT" were switched off.
async function verifiedUser(c: Cfg, auth: string | null): Promise<{ id: string } | null> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !c.sbUrl) return null;
  try {
    const r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.anon || c.service, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id || !(u.email_confirmed_at || u.confirmed_at)) return null;
    return { id: String(u.id) };
  } catch { return null; }
}

// ---------------------------------------------------------------- the daily count, in the shared `usage` table
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
async function usedToday(c: Cfg, userId: string): Promise<number> {
  try {
    const r = await sbFetch(c, `usage?select=id&kind=eq.${KIND}&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(startOfTodayISO())}&limit=1000`);
    return r.ok ? ((await r.json()) as unknown[]).length : 0;
  } catch { return 0; }
}
async function record(c: Cfg, userId: string, ok: boolean) {
  try {
    const r = await sbFetch(c, "usage", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, kind: KIND, cost_usd: 0, ok }) });
    if (!r.ok) console.error("hotspots: could not record use:", r.status);
  } catch (e) { console.error("hotspots: could not record use:", e); }
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
