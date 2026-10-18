// Daybird — unsubscribe edge function. Lets someone opt out of briefs that friends send them.
// Deploy in Supabase → Edge Functions (name: unsubscribe) and turn "Verify JWT" OFF for this one function:
// people clicking the link in an email are not signed in. The link carries a signed token instead, so only
// links that send-brief generated work. Uses the same UNSUB_SECRET secret as send-brief. Needs migration-4.sql.
//
//   GET  ?e=<email>&t=<token>  → {valid: true|false}   (no side effects; unsubscribe.html uses it to show the button)
//   POST ?e=<email>&t=<token>  → opts the address out   (unsubscribe.html's button; also mail apps' one-click unsubscribe)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST only" }, 405);
  try {
    const secret = (Deno.env.get("UNSUB_SECRET") || "").trim();
    if (!secret) return json({ error: "UNSUB_SECRET secret not set" }, 500);
    const q = new URL(req.url).searchParams;
    const email = (q.get("e") || "").trim().toLowerCase();
    const token = (q.get("t") || "").trim();
    const valid = email.length > 3 && email.length <= 254 && same(await hmacHex(secret, "unsub:" + email), token);

    if (req.method === "GET") return json({ valid });
    if (!valid) return json({ error: "This unsubscribe link isn't valid." }, 400);

    const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const hash = await hmacHex(secret, "hash:" + email); // must match send-brief
    const r = await fetch(`${url}/rest/v1/email_suppressions?on_conflict=email_hash`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ email_hash: hash }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.error("unsubscribe: insert failed", r.status); return json({ error: "Couldn't save that right now. Please try again." }, 500); }
    return json({ ok: true });
  } catch (e) {
    console.error("unsubscribe failed:", e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
