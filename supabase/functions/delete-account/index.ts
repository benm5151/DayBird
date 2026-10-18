// Daybird — delete-account edge function. Removes everything the signed-in user owns, then the user.
// Deploy in Supabase → Edge Functions (name: delete-account). Leave "Verify JWT" ON.
//
// Secrets: none of its own. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// automatically; the service role is what lets this function delete rows in locked tables (brief_sends) and
// call the Auth admin API. Nothing here is logged except table names and HTTP statuses: no emails, no ids.
//
// Order matters only a little, because most tables cascade from profiles and profiles cascades from auth.users.
// The explicit deletes exist so a partial failure is visible and reported, and because storage objects never cascade.
//
//   POST { confirm: "DELETE" }  (signed in)  →  { ok: true, removed: {table: n, ...}, partial: [table, ...] }
//
// Bookings the user made on other people's listings go too, and hosts are not notified; settings.html says so.
// Circles the user owns are deleted for every member (the table cascades); their memberships elsewhere just end.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const BUCKET = "photos";

// [table, column that holds the user's id]. Children before parents, so counts mean something even without cascades.
export const STEPS: ReadonlyArray<readonly [string, string]> = [
  ["likes", "user_id"],
  ["comments", "user_id"],
  ["posts", "user_id"],
  ["circle_mornings", "user_id"],
  ["circle_members", "user_id"],
  ["circles", "owner_id"],
  ["bookings", "user_id"],
  ["listing_private", "host_id"],
  ["listings", "host_id"],
  ["brief_sends", "sender_id"],
  ["profiles", "id"],
];

function config() {
  return {
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    if (!c.sbUrl || !c.service) return json({ error: "Server setup incomplete: Supabase service role not available." }, 500);

    const user = await verifiedUser(c, req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to delete your account." }, 401);

    let body: any = null;
    try { body = await req.json(); } catch { /* fall through */ }
    if (!body || body.confirm !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);

    const removed: Record<string, number> = {};
    const partial: string[] = [];

    for (const [table, col] of STEPS) {
      const r = await deleteRows(c, table, col, user.id);
      if (r.ok) removed[table] = r.count;
      else if (r.status === 404) removed[table] = 0;            // table from a migration that has not been run yet
      else { partial.push(table); console.error(`delete-account: ${table} delete failed:`, r.status); }
    }

    const photos = await deletePhotos(c, user.id);
    if (photos.ok) removed.photos = photos.count;
    else { partial.push("photos"); console.error("delete-account: photo cleanup failed:", photos.status); }

    const auth = await fetch(`${c.sbUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE", headers: { apikey: c.service, authorization: `Bearer ${c.service}` }, signal: AbortSignal.timeout(15000),
    });
    if (!auth.ok && auth.status !== 404) {
      console.error("delete-account: auth user delete failed:", auth.status);
      return json({ error: "Your data was removed but the sign-in itself could not be deleted. Try again in a minute; if it keeps failing, email the address on the Privacy page.", removed, partial }, 502);
    }
    return json({ ok: true, removed, partial });
  } catch (e) {
    console.error("delete-account failed:", e);
    return json({ error: "Something went wrong. Nothing more was deleted; try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// Checks the token with Supabase Auth itself, so it stays safe even if "Verify JWT" were switched off.
async function verifiedUser(c: Cfg, auth: string | null): Promise<{ id: string } | null> {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === c.anon || token === c.service) return null;
  try {
    const r = await fetch(`${c.sbUrl}/auth/v1/user`, { headers: { apikey: c.anon || c.service, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u?.id) return null;
    return { id: String(u.id) };
  } catch { return null; }
}

const H = (c: Cfg, extra: Record<string, string> = {}) => ({ apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...extra });

// DELETE /rest/v1/<table>?<col>=eq.<uid> with an exact count, so the report can say how many rows went.
async function deleteRows(c: Cfg, table: string, col: string, uid: string): Promise<{ ok: true; count: number } | { ok: false; status: number }> {
  try {
    const r = await fetch(`${c.sbUrl}/rest/v1/${table}?${col}=eq.${encodeURIComponent(uid)}`, {
      method: "DELETE", headers: H(c, { prefer: "count=exact, return=minimal" }), signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, status: r.status };
    const range = r.headers.get("content-range") || "";       // "0-4/5" or "*/0"
    const count = Number(range.split("/")[1]);
    return { ok: true, count: Number.isFinite(count) ? count : 0 };
  } catch { return { ok: false, status: 0 }; }
}

// Storage does not cascade: list every object under photos/<uid>/ and remove them in one call.
async function deletePhotos(c: Cfg, uid: string): Promise<{ ok: true; count: number } | { ok: false; status: number }> {
  try {
    const list = await fetch(`${c.sbUrl}/storage/v1/object/list/${BUCKET}`, {
      method: "POST", headers: H(c), body: JSON.stringify({ prefix: uid, limit: 1000, offset: 0 }), signal: AbortSignal.timeout(15000),
    });
    if (!list.ok) return list.status === 404 || list.status === 400 ? { ok: true, count: 0 } : { ok: false, status: list.status };
    const items: any[] = await list.json();
    const names = items.filter((o) => o && o.name && o.id).map((o) => `${uid}/${o.name}`);   // folders come back without an id
    if (!names.length) return { ok: true, count: 0 };
    const del = await fetch(`${c.sbUrl}/storage/v1/object/${BUCKET}`, {
      method: "DELETE", headers: H(c), body: JSON.stringify({ prefixes: names }), signal: AbortSignal.timeout(20000),
    });
    if (!del.ok) return { ok: false, status: del.status };
    return { ok: true, count: names.length };
  } catch { return { ok: false, status: 0 }; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
