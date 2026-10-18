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
  const site = (Deno.env.get("SITE_URL") || "https://daybird.org/").trim();
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
// Action use), loaded from the live site so the dashboard-pasted function needs no local files.
// Tests remap this URL to the local file with an import map.
import "https://daybird.org/js/brief.js";
import "https://daybird.org/data/traits.js";
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
