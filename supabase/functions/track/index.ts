// Daybird — track edge function. Counts opens and clicks on the daily email, so the stats page can show readers.
// Deploy in Supabase → Edge Functions (name: track) with "Verify JWT" OFF: mail clients load the pixel and follow
// links with no token at all. Each URL carries a signed token that send-daily minted, bound to the subscriber, the
// day and (for clicks) the exact destination, so a guessed or edited URL records nothing and redirects nowhere.
//
//   GET ?k=open&s=<subscriber id>&d=<YYYY-MM-DD>&t=<token>            → 1x1 GIF, records an open
//   GET ?k=click&s=&d=&t=&u=<encoded url>                               → records a click, 302 to the URL
// Clicks redirect only to http(s) URLs on ebird.org, birdcast.info, open-meteo.com or the site itself; anything else is 400.
// What gets stored (email_events): subscriber id, date, kind, and for clicks the host of the link. No IP, no user agent.
//
// Secrets: UNSUB_SECRET (shared with send-daily). Optional: SITE_URL. Needs migration-5.sql.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const ALLOWED_HOSTS = ["ebird.org", "birdcast.info", "open-meteo.com"];
// A transparent 1x1 GIF (43 bytes). Exported so tests can compare bytes.
export const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x21, 0xf9, 4, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b]);

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return text("GET only", 405);
  try {
    const secret = (Deno.env.get("UNSUB_SECRET") || "").trim();
    if (!secret) return text("UNSUB_SECRET secret not set", 500);
    const site0 = (Deno.env.get("SITE_URL") || "https://day-bird.com/").trim();
    const site = site0.endsWith("/") ? site0 : site0 + "/";

    const q = new URL(req.url).searchParams;
    const kind = q.get("k") || "", id = (q.get("s") || "").toLowerCase(), date = q.get("d") || "", token = q.get("t") || "", url = q.get("u") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || !/^\d{4}-\d\d-\d\d$/.test(date)) return text("Bad link.", 400);

    if (kind === "open") {
      if (!(await valid(secret, `open:${id}:${date}`, token))) return text("Bad link.", 400);
      await record(id, date, "open", null);
      return gif();
    }
    if (kind === "click") {
      if (!(await valid(secret, `click:${id}:${date}:${url}`, token))) return text("Bad link.", 400);
      const host = allowedHost(url, site);
      if (!host) return text("That link isn't one Daybird sends.", 400);
      await record(id, date, "click", host);
      return new Response(null, { status: 302, headers: { ...CORS, location: url, "cache-control": "no-store, private", "referrer-policy": "no-referrer" } });
    }
    return text("Bad link.", 400);
  } catch (e) {
    console.error("track failed:", e);
    return text("Something went wrong.", 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

export function allowedHost(raw: string, site: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a))) return h;
  if (raw.startsWith(site)) return h;      // the site itself, by full prefix (a shared host like github.io would otherwise let any page through)
  return null;
}

// Best effort: a failed insert must not stop the redirect or the pixel.
async function record(subscriber_id: string, date: string, kind: string, host: string | null) {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return;
  try {
    const r = await fetch(`${url}/rest/v1/email_events`, {
      method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ subscriber_id, date, kind, host }), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error("track: insert failed", r.status);
  } catch (e) { console.error("track: insert failed", e); }
}

async function valid(secret: string, msg: string, token: string) {
  const full = await hmacHex(secret, msg);
  return /^[0-9a-f]{32}$/.test(token) && same(full.slice(0, 32), token);
}
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const gif = () => new Response(GIF, { status: 200, headers: { ...CORS, "content-type": "image/gif", "content-length": String(GIF.length), "cache-control": "no-store, no-cache, must-revalidate, private", pragma: "no-cache", expires: "0" } });
const text = (s: string, status: number) => new Response(s, { status, headers: { ...CORS, "content-type": "text/plain" } });
