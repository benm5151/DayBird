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
import "https://day-bird.com/js/brief.js";
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
