// Daybird — waitlist edge function. The "Daybird Premium is coming" card on plan.html and route.html posts here.
// Deploy in Supabase → Edge Functions (name: waitlist). Leave "Verify JWT" ON: the browser sends the public anon key
// when nobody is signed in, which the gateway accepts, and a signed-in user's token when there is one. Needs migration-8.sql.
//
// Secrets: UNSUB_SECRET (required; the same HMAC key send-brief uses, so one secret hashes every address Daybird keeps).
// Optional: WAITLIST_PER_DAY (default 200 new addresses per day, site-wide). SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are injected.
//
//   POST { email, price: '3mo' | '5mo' | '30yr' | '', source: 'plan' | 'route' }  → { ok: true, already: boolean }
//
// What is stored (table `waitlist`, locked to the service role): the HMAC of the address as the key, the plain address so
// Ben can send the one launch email, the price picked, which page the form was on, and the user id when signed in.
// Guards: valid-looking address only; a second answer from the same address updates its row instead of adding one, and
// at most one write per address per minute; a site-wide cap on new rows per day so a script can't fill the table.
// Raw addresses are never logged.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York"; // the daily cap resets at midnight Eastern, like the other functions
const PRICES = ["3mo", "5mo", "30yr", ""], SOURCES = ["plan", "route"];
const MIN_GAP_MS = 60_000;

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  return {
    secret: (Deno.env.get("UNSUB_SECRET") || "").trim(),
    perDay: num("WAITLIST_PER_DAY", 200),
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
    if (!c.secret) return json({ error: "Server setup incomplete: UNSUB_SECRET secret not set." }, 500);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const v = parseRequest(body);
    if ("error" in v) return json({ error: v.error }, 400);

    // Sign-in is optional. A real user token fills user_id; the anon key (or nothing) leaves it null.
    const user = await verifiedUser(c, req.headers.get("authorization"));
    const hash = await hmacHex(c.secret, "hash:" + v.email);

    const existing = await findRow(c, hash);
    if (existing && Date.now() - Date.parse(existing.updated_at) < MIN_GAP_MS) return json({ error: "That address was just added. Give it a minute before changing the answer." }, 429);
    if (!existing && await newToday(c) >= c.perDay) return json({ error: "The waitlist has had a busy day and is closed until midnight Eastern. Try again tomorrow." }, 429);

    const row = { email_hash: hash, email: v.email, price: v.price, source: v.source, user_id: user?.id ?? null, updated_at: new Date().toISOString() };
    const r = await sbFetch(c, "waitlist", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
    if (!r.ok) { console.error("waitlist: could not save row:", r.status); return json({ error: "Couldn't save that right now. Try again in a minute." }, 502); }
    return json({ ok: true, already: !!existing });
  } catch (e) {
    console.error("waitlist failed:", e);
    return json({ error: "Something went wrong joining the waitlist. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

export function parseRequest(b: any): { email: string; price: string; source: string | null } | { error: string } {
  if (!b || typeof b !== "object") return { error: "Bad request." };
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email first." };
  if (email.length > 254 || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/.test(email) || email.includes("..")) return { error: "That doesn't look like a valid email address." };
  const price = b.price == null ? "" : String(b.price);
  if (!PRICES.includes(price)) return { error: "Pick one of the prices, or \"not sure yet\"." };
  const source = SOURCES.includes(String(b.source)) ? String(b.source) : null;
  return { email, price, source };
}

// Checks the token with Supabase Auth itself; the anon key is not a user and comes back null.
async function verifiedUser(c: Cfg, auth: string | null): Promise<{ id: string } | null> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !c.sbUrl || token === c.anon) return null;
  try {
    const r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.anon || c.service, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id || !(u.email_confirmed_at || u.confirmed_at)) return null;
    return { id: String(u.id) };
  } catch { return null; }
}

// ---------------------------------------------------------------- the table
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
async function findRow(c: Cfg, hash: string): Promise<{ updated_at: string } | null> {
  const r = await sbFetch(c, `waitlist?email_hash=eq.${encodeURIComponent(hash)}&select=updated_at`);
  if (!r.ok) throw new Error(`waitlist lookup ${r.status}`);
  const rows = (await r.json()) as { updated_at: string }[];
  return rows[0] || null;
}
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
async function newToday(c: Cfg): Promise<number> {
  const r = await sbFetch(c, `waitlist?select=email_hash&created_at=gte.${encodeURIComponent(startOfTodayISO())}&limit=1000`);
  return r.ok ? ((await r.json()) as unknown[]).length : 0;
}

// ---------------------------------------------------------------- small helpers
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
