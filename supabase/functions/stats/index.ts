// Daybird — stats edge function. The numbers behind stats.html: subscribers, sends, opens, clicks.
// Deploy in Supabase → Edge Functions (name: stats). Leave "Verify JWT" ON. Only the owner may call it: the function
// checks the caller's token with Supabase Auth and compares the user id to the OWNER_USER_ID secret (your id from
// Authentication → Users). Everyone else gets 403. It never returns an email address; it reads only the columns it counts.
//
// Secrets: OWNER_USER_ID. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected. Needs migration-5.sql.
//   POST {} → { active, pending, unsubscribed, confirmedThisWeek, unsubscribedThisMonth, goOnly, goOnlyShare,
//               weeklyReaders (distinct subscribers who opened or clicked in the last 7 days: the "500 weekly readers" number),
//               days: [{date, sent, skipped, opens, openers, clicks}] (30 days, oldest first), hosts: [{host, n}], runs: [...] }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York";
const DAYS = 30;

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const owner = (Deno.env.get("OWNER_USER_ID") || "").trim();
    if (!owner) return json({ error: "Server setup incomplete: OWNER_USER_ID secret not set." }, 500);
    const user = await verifiedUser(req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to see reader stats." }, 401);
    if (!same(user.id, owner)) return json({ error: "This page is for the site owner." }, 403);

    const today = todayISO();
    const since = addDays(today, -(DAYS - 1)), weekStart = addDays(today, -6);   // calendar days, Eastern: today and the six before it
    // Compare instants, not strings: Postgres writes "+00:00" timestamps and JS writes "Z", so text order is not time order.
    const weekAgo = Date.now() - 7 * 864e5, monthAgo = Date.now() - 30 * 864e5;
    const after = (iso: unknown, t: number) => typeof iso === "string" && Date.parse(iso) >= t;
    const [subs, runs, events] = await Promise.all([
      rows(`subscribers?select=status,go_only,confirmed_at,unsubscribed_at&order=created_at.asc`),
      rows(`daily_runs?select=date,sent,skipped,errors,created_at,finished_at&date=gte.${since}&order=date.asc`),
      rows(`email_events?select=subscriber_id,date,kind,host&date=gte.${since}&order=id.asc`),
    ]);

    const active = subs.filter((s) => s.status === "active");
    const byDay: Record<string, { date: string; sent: number; skipped: number; opens: number; openers: Set<string>; clicks: number }> = {};
    for (let i = 0; i < DAYS; i++) { const d = addDays(since, i); byDay[d] = { date: d, sent: 0, skipped: 0, opens: 0, openers: new Set(), clicks: 0 }; }
    for (const r of runs) if (byDay[r.date]) { byDay[r.date].sent = r.sent || 0; byDay[r.date].skipped = r.skipped || 0; }
    const hosts: Record<string, number> = {};
    const weekly = new Set<string>();
    for (const e of events) {
      const d = byDay[e.date]; if (!d) continue;
      if (e.kind === "open") { d.opens++; d.openers.add(e.subscriber_id); }
      else if (e.kind === "click") { d.clicks++; if (e.host) hosts[e.host] = (hosts[e.host] || 0) + 1; }
      else continue;
      if (e.date >= weekStart) weekly.add(e.subscriber_id);
    }
    return json({
      ok: true, today,
      active: active.length,
      pending: subs.filter((s) => s.status === "pending").length,
      unsubscribed: subs.filter((s) => s.status === "unsubscribed").length,
      confirmedThisWeek: subs.filter((s) => s.status !== "pending" && after(s.confirmed_at, weekAgo)).length,
      unsubscribedThisMonth: subs.filter((s) => s.status === "unsubscribed" && after(s.unsubscribed_at, monthAgo)).length,
      goOnly: active.filter((s) => s.go_only).length,
      goOnlyShare: active.length ? Math.round(100 * active.filter((s) => s.go_only).length / active.length) : 0,
      weeklyReaders: weekly.size,
      days: Object.values(byDay).map((d) => ({ date: d.date, sent: d.sent, skipped: d.skipped, opens: d.opens, openers: d.openers.size, clicks: d.clicks })),
      hosts: Object.entries(hosts).map(([host, n]) => ({ host, n })).sort((a, b) => b.n - a.n).slice(0, 10),
      runs: runs.slice(-7).reverse().map((r) => ({ date: r.date, sent: r.sent, skipped: r.skipped, errors: r.errors || "", finished: !!r.finished_at })),
    });
  } catch (e) {
    console.error("stats failed:", e);
    return json({ error: "Couldn't load stats right now." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// Checks the token with Supabase Auth itself, so it stays safe even if "Verify JWT" were switched off.
async function verifiedUser(auth: string | null): Promise<{ id: string } | null> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  if (!token || !url) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: String(u.id) } : null;
  } catch { return null; }
}
// Supabase caps a PostgREST response at 1000 rows whatever `limit` says, so every read pages with offset until
// a short page comes back. `path` must carry an `order=` so pages do not overlap. Stops at PAGES pages (100k rows).
const PAGE = 1000, PAGES = 100;
async function rows(path: string): Promise<any[]> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const out: any[] = [];
  for (let p = 0; p < PAGES; p++) {
    const r = await fetch(`${url}/rest/v1/${path}&offset=${p * PAGE}&limit=${PAGE}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}`);
    const page: any[] = await r.json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}
function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
