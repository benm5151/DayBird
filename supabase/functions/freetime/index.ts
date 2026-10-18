// Daybird — freetime edge function. Reads a private calendar feed (.ics) and returns the busy blocks for the next
// week, so plan.html can say "You're free Saturday 6:30–8:30 and it looks like a GO." Nothing is stored: the URL is
// fetched, parsed and forgotten; the reply holds start and end times only, never titles or attendees.
// Deploy in Supabase → Edge Functions (name: freetime). Leave "Verify JWT" ON. Needs the `usage` table (migration-3.sql).
//
// Secrets: none required. Optional: FREETIME_PER_DAY (default 60 reads per user per day).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
//   POST { url, tz? }  → { busy: [{start, end, allDay}], count, notes: [string], truncated }
//     url: https only (webcal:// is read as https). tz: IANA zone for floating times, default America/New_York.
//
// What it understands (and what it doesn't):
//   - VEVENT with DTSTART and DTEND or DURATION; DATE (all-day), UTC (…Z), TZID=<IANA zone>, and floating times.
//   - RRULE FREQ=WEEKLY with INTERVAL, BYDAY, COUNT and UNTIL; EXDATE. Weeks start Monday.
//   - Any other RRULE (DAILY, MONTHLY, YEARLY) is counted once, on its first date, and the reply says so in `notes`.
//   - STATUS:CANCELLED and TRANSP:TRANSPARENT ("free") events are skipped. VTIMEZONE blocks are ignored, so a TZID that
//     is not an IANA name (Outlook's "Eastern Standard Time") falls back to `tz`, with a note.
//   - 1 MB max, 3 redirects max, 15 s timeout; only public https hosts (no localhost, IP literals or *.supabase.co).
// Guards: sign-in required (checked with Supabase Auth); per-user daily cap recorded in `usage` (kind 'freetime', cost 0).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TZ = "America/New_York";
const MAX_BYTES = 1_000_000, MAX_REDIRECTS = 3, DAYS_AHEAD = 8, MAX_BUSY = 500, KIND = "freetime";

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  return { perDay: num("FREETIME_PER_DAY", 60), sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""), anon: Deno.env.get("SUPABASE_ANON_KEY") || "", service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "" };
}
type Cfg = ReturnType<typeof config>;

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    const user = await verifiedUser(c, req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to check your calendar." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const urlCheck = checkUrl(body?.url);
    if ("error" in urlCheck) return json({ error: urlCheck.error }, 400);
    const tz = validZone(body?.tz) ? String(body.tz) : TZ;

    const used = await usedToday(c, user.id);
    if (used >= c.perDay) return json({ error: `You've checked your calendar ${c.perDay} times today, which is the limit. It resets at midnight Eastern.` }, 429);

    const fetched = await fetchIcs(urlCheck.url);
    if ("error" in fetched) return json({ error: fetched.error }, fetched.status);
    await record(c, user.id);

    const now = Date.now();
    const out = parseIcs(fetched.text, { tz, from: now - 864e5, to: now + DAYS_AHEAD * 864e5 });
    return json({ busy: out.busy.slice(0, MAX_BUSY), count: out.busy.length, truncated: out.busy.length > MAX_BUSY, notes: out.notes, events: out.events });
  } catch (e) {
    console.error("freetime failed:", e);
    return json({ error: "Something went wrong reading the calendar. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

// ---------------------------------------------------------------- the URL and the fetch
export function checkUrl(raw: unknown): { url: string } | { error: string } {
  let s = String(raw ?? "").trim();
  if (!s) return { error: "Paste your calendar's address first." };
  if (s.length > 2048) return { error: "That address is too long." };
  if (/^webcal:\/\//i.test(s)) s = "https://" + s.slice(9);
  let u: URL;
  try { u = new URL(s); } catch { return { error: "That is not a valid web address." }; }
  if (u.protocol !== "https:") return { error: "The calendar address must start with https://." };
  if (u.username || u.password) return { error: "Addresses with a username or password in them are not allowed." };
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".supabase.co") || /^[\d.]+$/.test(h) || h.startsWith("[") || h.includes(":")) return { error: "That host is not allowed." };
  return { url: u.toString() };
}
async function fetchIcs(url: string): Promise<{ text: string } | { error: string; status: number }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let r: Response;
    try { r = await fetch(current, { redirect: "manual", headers: { accept: "text/calendar, text/plain, */*", "user-agent": "Daybird freetime (https://day-bird.com/)" }, signal: AbortSignal.timeout(15000) }); }
    catch { return { error: "Couldn't reach that calendar address.", status: 502 }; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      await r.body?.cancel();
      if (!loc) return { error: "The calendar address redirected nowhere.", status: 502 };
      const next = checkUrl(new URL(loc, current).toString());
      if ("error" in next) return { error: "The calendar address redirected to a host that is not allowed.", status: 400 };
      current = next.url; continue;
    }
    if (!r.ok) { await r.body?.cancel(); return { error: r.status === 404 ? "That calendar address was not found (404). Google's secret address can be reset in Calendar settings." : `The calendar server answered ${r.status}.`, status: 502 }; }
    const len = Number(r.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BYTES) { await r.body?.cancel(); return { error: "That calendar is over 1 MB. Daybird only reads smaller feeds.", status: 413 }; }
    const text = await readLimited(r, MAX_BYTES);
    if (text === null) return { error: "That calendar is over 1 MB. Daybird only reads smaller feeds.", status: 413 };
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return { error: "That address did not return a calendar (.ics) file.", status: 400 };
    return { text };
  }
  return { error: "Too many redirects.", status: 502 };
}
async function readLimited(r: Response, max: number): Promise<string | null> {
  if (!r.body) return "";
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let o = 0; for (const ch of chunks) { all.set(ch, o); o += ch.byteLength; }
  return new TextDecoder("utf-8").decode(all);
}

// ---------------------------------------------------------------- iCalendar parsing
type Busy = { start: string; end: string; allDay: boolean };
type Parsed = { busy: Busy[]; notes: string[]; events: number };
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DAY = 864e5;

export function parseIcs(text: string, o: { tz: string; from: number; to: number }): Parsed {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const notes = new Set<string>(); const busy: Busy[] = []; let events = 0;
  let cur: Record<string, { params: Record<string, string>; value: string }[]> | null = null;
  const flush = () => { if (!cur) return; events++; for (const b of expand(cur, o, notes)) busy.push(b); cur = null; };
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { flush(); continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
    const N = name.toUpperCase();
    if (["DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "STATUS", "TRANSP"].includes(N)) (cur[N] = cur[N] || []).push({ params, value: line.slice(i + 1).trim() });
  }
  busy.sort((a, b) => a.start.localeCompare(b.start));
  // merge exact duplicates (the same event listed twice, which some feeds do)
  const out: Busy[] = []; for (const b of busy) { const l = out[out.length - 1]; if (!l || l.start !== b.start || l.end !== b.end) out.push(b); }
  return { busy: out, notes: [...notes], events };
}

type DT = { ms: number; allDay: boolean; y: number; m: number; d: number; hh: number; mm: number; tz: string };
function parseDT(value: string, params: Record<string, string>, tz: string, notes: Set<string>): DT | null {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (params.VALUE === "DATE" || m) {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(value); if (!m) return null;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return { ms: zonedToUTC(y, mo, d, 0, 0, tz), allDay: true, y, m: mo, d, hh: 0, mm: 0, tz };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value); if (!m) return null;
  const [y, mo, d, hh, mm] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  if (m[7] === "Z") { const ms = Date.UTC(y, mo - 1, d, hh, mm, +(m[6] || 0)); const L = localParts(ms, tz); return { ms, allDay: false, ...L, tz }; }
  let zone = tz;
  if (params.TZID) { if (validZone(params.TZID)) zone = params.TZID; else notes.add(`Times in "${params.TZID}" were read as ${tz}.`); }
  return { ms: zonedToUTC(y, mo, d, hh, mm, zone), allDay: false, y, m: mo, d, hh, mm, tz: zone };
}
function parseDuration(v: string): number | null {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || ""); if (!m) return null;
  const ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 36e5 + (+m[5] || 0) * 6e4 + (+m[6] || 0) * 1e3;
  return m[1] ? -ms : ms;
}
function expand(ev: Record<string, { params: Record<string, string>; value: string }[]>, o: { tz: string; from: number; to: number }, notes: Set<string>): Busy[] {
  if (ev.STATUS?.some((s) => /CANCELLED/i.test(s.value)) || ev.TRANSP?.some((s) => /TRANSPARENT/i.test(s.value))) return [];
  const ds = ev.DTSTART?.[0]; if (!ds) return [];
  const start = parseDT(ds.value, ds.params, o.tz, notes); if (!start) return [];
  let dur: number;
  const de = ev.DTEND?.[0] ? parseDT(ev.DTEND[0].value, ev.DTEND[0].params, start.tz, notes) : null;
  if (de) dur = Math.max(0, de.ms - start.ms);
  else if (ev.DURATION?.[0]) dur = Math.max(0, parseDuration(ev.DURATION[0].value) ?? 0);
  else dur = start.allDay ? DAY : 60e3;
  const ex = new Set<number>();
  for (const x of ev.EXDATE || []) for (const v of x.value.split(",")) { const p = parseDT(v.trim(), x.params, start.tz, notes); if (p) ex.add(p.ms); }
  const mk = (ms: number): Busy => ({ start: new Date(ms).toISOString(), end: new Date(ms + dur).toISOString(), allDay: start.allDay });
  const inRange = (ms: number) => ms + dur > o.from && ms < o.to;

  const rule = ev.RRULE?.[0]?.value;
  if (!rule) return inRange(start.ms) && !ex.has(start.ms) ? [mk(start.ms)] : [];
  const R: Record<string, string> = {}; for (const part of rule.split(";")) { const j = part.indexOf("="); if (j > 0) R[part.slice(0, j).toUpperCase()] = part.slice(j + 1).toUpperCase(); }
  if (R.FREQ !== "WEEKLY") { notes.add("Repeating events that are not weekly were counted once, on their first date."); return inRange(start.ms) && !ex.has(start.ms) ? [mk(start.ms)] : []; }

  const interval = Math.max(1, Number(R.INTERVAL) || 1);
  const count = Number(R.COUNT) > 0 ? Number(R.COUNT) : Infinity;
  const until = R.UNTIL ? parseDT(R.UNTIL, {}, start.tz, notes)?.ms ?? Infinity : Infinity;
  const days = (R.BYDAY ? R.BYDAY.split(",").map((d) => WD[d.slice(-2)]).filter((d) => d !== undefined) : []);
  const startDay = Math.floor(Date.UTC(start.y, start.m - 1, start.d) / DAY); // "floating" day number of the first occurrence
  const startWd = new Date(startDay * DAY).getUTCDay();
  const wdays = days.length ? [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : [startWd];
  const weekStart = startDay - ((startWd + 6) % 7); // Monday of the first week
  const out: Busy[] = []; let n = 0;
  // Skip straight to the week before the range when there is no COUNT to keep track of.
  let k = count === Infinity ? Math.max(0, Math.floor((Math.floor(o.from / DAY) - weekStart) / (7 * interval)) - 1) : 0;
  for (; k < 20000; k++) {
    const ws = weekStart + k * 7 * interval;
    let past = false;
    for (const wd of wdays) {
      const day = ws + ((wd + 6) % 7);
      if (day < startDay) continue;
      if (n >= count) { past = true; break; }
      n++;
      const dt = new Date(day * DAY);
      const ms = zonedToUTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), start.hh, start.mm, start.tz);
      if (ms > until) { past = true; break; }
      if (ms >= o.to) { past = true; break; }
      if (!ex.has(ms) && inRange(ms)) out.push(mk(ms));
    }
    if (past) break;
  }
  return out;
}

// ---------------------------------------------------------------- time zones
export function validZone(tz: unknown): boolean {
  if (typeof tz !== "string" || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
function localParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute };
}
// Wall-clock time in a zone → UTC instant (two passes so a DST edge resolves).
export function zonedToUTC(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms: number) => { const L = localParts(ms, tz); return Date.UTC(L.y, L.m - 1, L.d, L.hh, L.mm) - ms; };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return utc;
}

// ---------------------------------------------------------------- auth, caps, helpers (same shape as the other functions)
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
async function record(c: Cfg, userId: string) {
  try {
    const r = await sbFetch(c, "usage", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, kind: KIND, cost_usd: 0, ok: true }) });
    if (!r.ok) console.error("freetime: could not record use:", r.status);
  } catch (e) { console.error("freetime: could not record use:", e); }
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
