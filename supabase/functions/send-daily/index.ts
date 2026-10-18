// Daybird — send-daily edge function. Emails the morning brief to every confirmed subscriber, once a day.
// Deploy in Supabase → Edge Functions (name: send-daily) with "Verify JWT" OFF: the caller is the GitHub Action in
// .github/workflows/brief.yml, which has no user token. It proves itself with the x-daily-secret header instead.
//
// Secrets: DAILY_SECRET (the shared header value; also a GitHub Actions secret), EBIRD_KEY, RESEND_API_KEY, UNSUB_SECRET.
// Optional: FROM_EMAIL, SITE_URL, MAILING_ADDRESS, DAILY_MAX_EMAILS (default 500), DAILY_TIME_BUDGET_MS (default 100000),
// BATCH_PAUSE_MS (pause between Resend batches, default 600). Needs migration-5.sql.
//
// How a run goes: insert today's daily_runs row (the primary key is the lock, so a second call today stops here) →
// load active subscribers → group them into 0.25° cells → fetch Open-Meteo and eBird ONCE per cell → compose a brief
// per subscriber with their own place label, mode and level (cheap, no network) → skip GO-only people on non-GO
// mornings → send through Resend's batch endpoint, 100 per call → write sent/skipped/errors back to daily_runs.

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-daily-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const TZ = "America/New_York";
const RADIUS_KM = 25, BACK_DAYS = 3; // same as scripts/build_brief.mjs and send-brief
const CELL = 0.25;                    // degrees; about 28 km north-south, so one eBird circle covers the cell
export const BATCH_SIZE = 100;        // Resend's batch limit

// An unset or malformed secret falls back to the default; a value of 0 is kept (BATCH_PAUSE_MS=0 means no pause,
// DAILY_TIME_BUDGET_MS=0 means "stop before the first cell", which tests use to prove the budget is honoured).
const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v >= 0 ? v : d; };
function config() {
  const site = (Deno.env.get("SITE_URL") || "https://day-bird.com/").trim();
  return {
    dailySecret: (Deno.env.get("DAILY_SECRET") || "").trim(),
    ebirdKey: (Deno.env.get("EBIRD_KEY") || "").trim(),
    resendKey: (Deno.env.get("RESEND_API_KEY") || "").trim(),
    secret: (Deno.env.get("UNSUB_SECRET") || "").trim(),
    from: (Deno.env.get("FROM_EMAIL") || "Daybird <onboarding@resend.dev>").trim(),
    site: site.endsWith("/") ? site : site + "/",
    address: (Deno.env.get("MAILING_ADDRESS") || "").trim(),
    maxEmails: num("DAILY_MAX_EMAILS", 500) || 500,
    budgetMs: num("DAILY_TIME_BUDGET_MS", 100000),
    pauseMs: num("BATCH_PAUSE_MS", 600),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;
type Sub = { id: string; email: string; lat: number; lng: number; place: string; mode: string; level: string; go_only: boolean };

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const started = Date.now();
  try {
    const c = config();
    const missing = [!c.dailySecret && "DAILY_SECRET", !c.resendKey && "RESEND_API_KEY", !c.secret && "UNSUB_SECRET"].filter(Boolean);
    if (missing.length) return json({ error: `Server setup incomplete: ${missing.join(", ")} secret not set.` }, 500);
    if (!same(c.dailySecret, req.headers.get("x-daily-secret") || "")) return json({ error: "Not allowed." }, 401);

    const date = todayISO();
    const lock = await sbFetch(c, "daily_runs", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ date }) });
    if (lock.status === 409) return json({ ok: true, date, alreadyRan: true, sent: 0 });
    if (!lock.ok) return json({ error: `Couldn't start today's run (${lock.status}).` }, 500);

    const subs = await activeSubscribers(c);
    const result = await sendAll(c, subs, date, started);
    await sbFetch(c, `daily_runs?date=eq.${date}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ sent: result.sent, skipped: result.skipped, errors: result.errors.join("\n") || null, finished_at: new Date().toISOString() }) });
    if (result.errors.length) console.error("send-daily partial:", result.errors.join("; "));
    return json({ ok: true, date, subscribers: subs.length, ...result, ms: Date.now() - started });
  } catch (e) {
    console.error("send-daily failed:", e);
    return json({ error: "The daily send failed. Check the function logs." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// ---------------------------------------------------------------- the run
export function cellOf(lat: number, lng: number) {
  const r = (v: number) => Math.round(Math.round(v / CELL) * CELL * 100) / 100;
  return { lat: r(lat), lng: r(lng), key: `${r(lat)},${r(lng)}` };
}
export function groupByCell(subs: Sub[]) {
  const cells = new Map<string, { lat: number; lng: number; subs: Sub[] }>();
  for (const s of subs) {
    const c = cellOf(s.lat, s.lng);
    if (!cells.has(c.key)) cells.set(c.key, { lat: c.lat, lng: c.lng, subs: [] });
    cells.get(c.key)!.subs.push(s);
  }
  return cells;
}

async function sendAll(c: Cfg, subs: Sub[], date: string, started: number) {
  const errors: string[] = [];
  let sent = 0, skipped = 0, attempted = 0, capped = 0, queued: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }[] = [];
  // Checked before each cell's fetches (the slow part); the Supabase runtime kills a function at its wall-clock
  // limit, so a run that stops itself early writes its counts down instead of vanishing mid-batch.
  const overBudget = () => Date.now() - started >= c.budgetMs;
  const flush = async () => {
    while (queued.length) {
      const batch = queued.splice(0, BATCH_SIZE);
      const r = await sendBatch(c, batch);
      if (r.ok) sent += batch.length;
      else { errors.push(`resend: ${r.error} (${batch.length} emails not sent)`); }
      if (queued.length && c.pauseMs) await new Promise((res) => setTimeout(res, c.pauseMs));
    }
  };

  const cells = groupByCell(subs);
  let cellsDone = 0, budgetSkipped = 0;
  for (const cell of cells.values()) {
    if (overBudget()) { budgetSkipped += cell.subs.length; skipped += cell.subs.length; continue; }
    const data = await fetchCell(c, cell.lat, cell.lng);
    errors.push(...data.errors.map((e) => `cell ${cell.lat},${cell.lng}: ${e}`));
    if (!data.w && !data.eb.spots.length && !data.eb.notable.length) { skipped += cell.subs.length; errors.push(`cell ${cell.lat},${cell.lng}: no data, ${cell.subs.length} skipped`); cellsDone++; continue; }
    for (const s of cell.subs) {
      if (attempted >= c.maxEmails) { skipped++; capped++; continue; }
      const brief = B.compose({ place: s.place, date: data.w?.date || date, whenLabel: "this morning", wx: data.w?.wx || null, tomorrow: data.w?.tomorrow || null, ...data.eb, mode: s.mode, level: s.level, traits: TRAITS });
      if (s.go_only && brief.call.grade !== "go") { skipped++; continue; }
      queued.push(await renderDaily(c, brief, s, date, data.errors.length > 0));
      attempted++;
      if (queued.length >= BATCH_SIZE) await flush();
    }
    cellsDone++;
  }
  if (budgetSkipped) errors.push(`time budget hit after ${cellsDone} of ${cells.size} cells, ${budgetSkipped} not sent`);
  if (capped) errors.push(`cap: DAILY_MAX_EMAILS=${c.maxEmails} reached, ${capped} not sent`);
  await flush();
  return { sent, skipped, errors, cells: cells.size };
}

// ---------------------------------------------------------------- data (once per cell)
// Scoring, wording and the email body come from js/brief.js, the same engine the site, the daily Action and
// send-brief use, loaded from the live site so the dashboard-pasted function needs no local files.
// Tests remap these URLs to the local files with an import map.
import "https://day-bird.com/js/brief.js";
import "https://day-bird.com/data/traits.js";
const B: any = (globalThis as any).DAYBIRD_BRIEF;
const TRAITS: any[] = (globalThis as any).DAYBIRD_TRAITS || [];

async function getJSON(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.json();
}
async function fetchCell(c: Cfg, lat: number, lng: number) {
  const errors: string[] = [];
  const H = { "X-eBirdApiToken": c.ebirdKey };
  const q = `lat=${lat}&lng=${lng}&dist=${RADIUS_KM}&back=${BACK_DAYS}`;
  const [wr, nr, rr] = await Promise.allSettled([
    getJSON(B.weatherUrl(lat, lng)).then((w: unknown) => B.parseWeather(w, { forceToday: true })),   // the daily email is always "this morning"
    c.ebirdKey ? getJSON(`https://api.ebird.org/v2/data/obs/geo/recent/notable?${q}&detail=simple`, H) : Promise.reject(new Error("no EBIRD_KEY")),
    c.ebirdKey ? getJSON(`https://api.ebird.org/v2/data/obs/geo/recent?${q}`, H) : Promise.reject(new Error("no EBIRD_KEY")),
  ]);
  if (wr.status === "rejected") errors.push(`weather: ${wr.reason?.message || wr.reason}`);
  if (nr.status === "rejected") errors.push(`ebird notable: ${nr.reason?.message || nr.reason}`);
  if (rr.status === "rejected") errors.push(`ebird recent: ${rr.reason?.message || rr.reason}`);
  const eb = B.parseEbird(nr.status === "fulfilled" ? nr.value : [], rr.status === "fulfilled" ? rr.value : []);
  return { w: wr.status === "fulfilled" ? wr.value : null, eb, errors };
}

// ---------------------------------------------------------------- the email
const esc = (s: unknown) => B.esc(s);
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const TRACKED_HOSTS = ["ebird.org", "birdcast.info", "open-meteo.com"];
const hostOk = (host: string, allowed: string) => host === allowed || host.endsWith("." + allowed);

export async function renderDaily(c: Cfg, b: any, s: Sub, date: string, partial: boolean) {
  const subject = `${b.call.word} · ${cleanText(b.place, 60)} · ${b.shortDate}`;
  const manage = `${c.site}manage.html?e=${encodeURIComponent(s.email)}&t=${await hmacHex(c.secret, "manage:" + s.email)}`;
  const oneClick = `${c.sbUrl}/functions/v1/subscribe?action=unsubscribe&e=${encodeURIComponent(s.email)}&t=${await hmacHex(c.secret, "manage:" + s.email)}`;
  const note = partial ? "Some data was unavailable for this brief, so it may be incomplete." : "";
  const legal = "Sightings via eBird (Cornell Lab of Ornithology). Weather via Open-Meteo. Daybird is a guide, not safety advice.";
  const footer = [legal, c.address, `Change your place or mode, or unsubscribe: ${manage}`].filter(Boolean);
  const text = B.text(b, { site: c.site, note, footer });
  const footerHtml = [esc(legal), c.address ? esc(c.address) : "", `You get this because you signed up at Daybird. <a href="${esc(manage)}" style="color:#1F2A37">Change your place or mode, or unsubscribe</a>.`].filter(Boolean).join("<br>");
  let html = B.emailHtml(b, { site: c.site, note, footerHtml });
  // Links to eBird, BirdCast and the site go through the track function so the stats page can count clicks.
  // The manage link stays direct. The signed token binds subscriber, day and URL, so nobody can mint a redirect.
  const seen: Record<string, string> = {};
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const raw = m[1].replace(/&amp;/g, "&");
    if (seen[m[1]] || raw.includes("manage.html")) continue;
    if (!trackable(c, raw)) continue;
    seen[m[1]] = await clickUrl(c, s.id, date, raw);
  }
  for (const [orig, tracked] of Object.entries(seen)) html = html.split(`href="${orig}"`).join(`href="${esc(tracked)}"`);
  const pixel = `<img src="${esc(await openUrl(c, s.id, date))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
  html = html.replace(/<\/body>/i, `${pixel}</body>`);
  return { to: s.email, subject, html, text, headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}
function trackable(c: Cfg, raw: string): boolean {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  return TRACKED_HOSTS.some((h) => hostOk(u.hostname, h)) || raw.startsWith(c.site);
}
// Tokens are the first 32 hex chars (128 bits) of the HMAC, to keep email links short. track checks the same prefix.
async function clickUrl(c: Cfg, id: string, date: string, url: string) {
  const t = (await hmacHex(c.secret, `click:${id}:${date}:${url}`)).slice(0, 32);
  return `${c.sbUrl}/functions/v1/track?k=click&s=${id}&d=${date}&t=${t}&u=${encodeURIComponent(url)}`;
}
async function openUrl(c: Cfg, id: string, date: string) {
  const t = (await hmacHex(c.secret, `open:${id}:${date}`)).slice(0, 32);
  return `${c.sbUrl}/functions/v1/track?k=open&s=${id}&d=${date}&t=${t}`;
}

// ---------------------------------------------------------------- sending (Resend batch: up to 100 emails per call)
async function sendBatch(c: Cfg, batch: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = batch.map((m) => ({ from: c.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }));
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
    });
    if (r.ok) return { ok: true };
    let detail = "";
    try { detail = String((await r.json())?.message || ""); } catch { /* not JSON */ }
    return { ok: false, error: `${r.status} ${detail}`.trim() };
  } catch (e) { return { ok: false, error: (e as Error).message || String(e) }; }
}

// ---------------------------------------------------------------- database and helpers
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) });
async function activeSubscribers(c: Cfg): Promise<Sub[]> {
  const out: Sub[] = [];
  for (let from = 0; from < 10000; from += 1000) {       // PostgREST pages at 1000 rows by default
    const r = await sbFetch(c, `subscribers?status=eq.active&select=id,email,lat,lng,place,mode,level,go_only&order=created_at.asc&offset=${from}&limit=1000`);
    if (!r.ok) throw new Error(`subscribers ${r.status}`);
    const rows: Sub[] = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
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
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
