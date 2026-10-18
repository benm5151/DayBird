// Daybird — digest edge function. Builds "This week in birds" for a place: notable eBird sightings nearby,
// a few birding news items from allowlisted RSS/Atom feeds, and recent open-access papers from OpenAlex,
// then one Claude call writes a short lead and a plain one-liner per item. The result is cached per region
// per week in the `digests` table, so every reader after the first costs nothing.
// Deploy in Supabase → Edge Functions (name: digest). Leave "Verify JWT" ON: the page calls it with the anon key.
//
// Secrets (Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   same key as bird-id
//   EBIRD_KEY           your eBird API key (kept here so the browser never sees it)
// Optional: DAILY_CAP_USD (default 1.00, shared with bird-id and ask via the `usage` table), DIGEST_RADIUS_KM (default 50)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically. Needs migration-3.sql (usage) and migration-7.sql (digests).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MODEL = "claude-sonnet-5-5";
const PRICE_IN = 2 / 1_000_000, PRICE_OUT = 10 / 1_000_000; // USD per token, Sonnet 5.5 list price
const TZ = "America/New_York";
const CBC = { from: [12, 1], to: [1, 5] }; // Christmas Bird Count season: Dec 1 to Jan 5

// The only outside sources this function reads. Add or remove feeds here; each must be RSS 2.0 or Atom.
// If a feed stops parsing it is skipped for that week and listed under "not reachable" in the Sources footer.
export const DIGEST_FEEDS: { name: string; url: string; home: string }[] = [
  { name: "All About Birds (Cornell Lab)", url: "https://www.allaboutbirds.org/news/feed/", home: "https://www.allaboutbirds.org/news/" },
  { name: "Audubon", url: "https://www.audubon.org/rss.xml", home: "https://www.audubon.org/news" },
  { name: "NH Audubon", url: "https://www.nhaudubon.org/feed/", home: "https://www.nhaudubon.org/" },
  { name: "BirdCast", url: "https://birdcast.info/feed/", home: "https://birdcast.info/" },
];
export const OPENALEX_QUERIES = ["bird migration", "ornithology citizen science"];
const PER_FEED = 4, FEED_MAX_AGE_DAYS = 10, PAPERS_MAX = 6;

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  return {
    anthropicKey: (Deno.env.get("ANTHROPIC_API_KEY") || "").trim(),
    ebirdKey: (Deno.env.get("EBIRD_KEY") || "").trim(),
    dailyCap: num("DAILY_CAP_USD", 1.0),
    radiusKm: Math.min(100, num("DIGEST_RADIUS_KM", 50)),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST" }, 405);
  try {
    const c = config();
    let p: Record<string, unknown> = {};
    if (req.method === "GET") p = Object.fromEntries(new URL(req.url).searchParams);
    else { try { p = await req.json(); } catch { return json({ error: "Bad request." }, 400); } }
    const v = parseRequest(p);
    if ("error" in v) return json({ error: v.error }, 400);

    const week = weekKey();
    const cached = await readCache(c, v.region, week);
    // A digest that Claude could not write (no lead) is kept only a few hours, so a later reader gets a retry.
    if (cached && (cached.json.lead || Date.now() - Date.parse(cached.created_at) < 6 * 3600e3)) return json({ ...cached.json, cached: true });

    const d = await buildDigest(c, v, week);
    await writeCache(c, v.region, week, v.place, d);
    return json({ ...d, cached: false });
  } catch (e) {
    console.error("digest failed:", e);
    return json({ error: "Something went wrong building the digest. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

export function parseRequest(b: Record<string, unknown>): { lat: number; lng: number; place: string; region: string } | { error: string } {
  const coord = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;
  const lat = coord(b.lat), lng = coord(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Pick a place first." };
  const place = cleanText(b.place, 80) || "your area";
  // one digest per 0.1° cell (about 10 km): neighbours share a cache entry, and nobody's exact point is stored
  const region = `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lng * 10) / 10).toFixed(1)}`;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, place, region };
}

// Monday of the current week in Eastern time, as YYYY-MM-DD. The cache key.
export function weekKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  const d = new Date(Date.UTC(+g("year"), +g("month") - 1, +g("day")));
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function localDate(now = new Date()): { month: number; day: number; iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)!.value;
  return { month: +g("month"), day: +g("day"), iso: `${g("year")}-${g("month")}-${g("day")}` };
}
export function isCbcSeason(month: number, day: number): boolean {
  return (month === CBC.from[0] && day >= CBC.from[1]) || (month === CBC.to[0] && day <= CBC.to[1]);
}

// ---------------------------------------------------------------- the digest
export type Notable = { name: string; reports: number; count: number; places: string[]; subIds: string[]; latest: string };
export type NewsItem = { source: string; title: string; link: string; date: string; summary: string; line?: string };
export type Paper = { title: string; link: string; journal: string; date: string; abstract: string; line?: string };
export type Digest = {
  place: string; region: string; week: string; generated: string; lead: string; seasonal: string;
  notable: Notable[]; news: NewsItem[]; papers: Paper[];
  video: { species: string; url: string } | null;
  sources: { name: string; url: string; ok: boolean; note?: string }[];
  partial: boolean; errors: string[];
};

export async function buildDigest(c: Cfg, v: { lat: number; lng: number; place: string; region: string }, week: string): Promise<Digest> {
  const errors: string[] = [];
  const sources: Digest["sources"] = [];
  // everything in parallel; each source fails on its own without taking the digest down
  const [nr, feedResults, pr] = await Promise.all([
    settle(fetchNotable(c, v.lat, v.lng)),
    Promise.all(DIGEST_FEEDS.map((f) => settle(fetchFeed(f)))),
    settle(fetchPapers()),
  ]);
  const notable = nr.ok ? nr.value : [];
  if (!nr.ok) errors.push(`ebird: ${nr.error}`);
  sources.push({ name: "eBird (Cornell Lab of Ornithology)", url: "https://ebird.org/", ok: nr.ok });

  const news: NewsItem[] = [];
  DIGEST_FEEDS.forEach((f, i) => {
    const r = feedResults[i];
    if (r.ok) { news.push(...r.value); sources.push({ name: f.name, url: f.home, ok: true }); }
    else { errors.push(`feed ${f.name}: ${r.error}`); sources.push({ name: f.name, url: f.home, ok: false, note: "not reachable this week" }); }
  });
  news.sort((a, b) => b.date.localeCompare(a.date));

  const papers = pr.ok ? pr.value : [];
  if (!pr.ok) errors.push(`openalex: ${pr.error}`);
  sources.push({ name: "OpenAlex (open-access research index)", url: "https://openalex.org/", ok: pr.ok });

  const today = localDate();
  const d: Digest = {
    place: v.place, region: v.region, week, generated: new Date().toISOString(), lead: "", seasonal: "",
    notable, news, papers,
    video: notable[0] ? { species: notable[0].name, url: `https://www.youtube.com/@CornellLabofOrnithology/search?query=${encodeURIComponent(notable[0].name)}` } : null,
    sources, partial: false, errors,
  };
  if (notable.length || news.length || papers.length) {
    const w = await writeWithClaude(c, d, isCbcSeason(today.month, today.day), today.iso);
    if (w) { d.lead = w.lead; d.seasonal = w.seasonal; w.news.forEach((l, i) => { if (l && d.news[i]) d.news[i].line = l; }); w.papers.forEach((l, i) => { if (l && d.papers[i]) d.papers[i].line = l; }); }
    else errors.push("claude: no summary this time");
  }
  d.partial = errors.length > 0;
  return d;
}

// ---- eBird: notable reports within the radius over the last 7 days, grouped by species
async function fetchNotable(c: Cfg, lat: number, lng: number): Promise<Notable[]> {
  if (!c.ebirdKey) throw new Error("no EBIRD_KEY");
  const url = `https://api.ebird.org/v2/data/obs/geo/recent/notable?lat=${lat}&lng=${lng}&dist=${c.radiusKm}&back=7&detail=simple`;
  const rows: any[] = await getJSON(url, { "X-eBirdApiToken": c.ebirdKey });
  type Group = Notable & { placeCount: Map<string, number> };
  const by = new Map<string, Group>();
  for (const o of rows || []) {
    const name = cleanText(o.comName, 60); if (!name) continue;
    const g: Group = by.get(name) || { name, reports: 0, count: 0, places: [], subIds: [], latest: "", placeCount: new Map<string, number>() };
    g.reports++; g.count += Number(o.howMany) > 0 ? Number(o.howMany) : 1;
    const loc = cleanText(o.locName, 60); if (loc) g.placeCount.set(loc, (g.placeCount.get(loc) || 0) + 1);
    const sub = safeId(o.subId); if (sub && g.subIds.length < 3 && !g.subIds.includes(sub)) g.subIds.push(sub);
    const dt = cleanText(o.obsDt, 20); if (dt > g.latest) g.latest = dt;
    by.set(name, g);
  }
  return [...by.values()].sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name)).slice(0, 12)
    .map(({ placeCount, ...g }) => ({ ...g, places: [...placeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0]) }));
}

// ---- feeds
async function fetchFeed(f: { name: string; url: string }): Promise<NewsItem[]> {
  const r = await fetch(f.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status}`);
  const parsed = parseFeed(await r.text());
  if (!parsed.items.length) throw new Error("no items parsed");
  const cutoff = Date.now() - FEED_MAX_AGE_DAYS * 864e5;
  const fresh = parsed.items.filter((i) => !i.date || Date.parse(i.date) >= cutoff);
  return (fresh.length ? fresh : parsed.items).slice(0, PER_FEED).map((i) => ({ source: f.name, ...i }));
}

// A small RSS 2.0 / Atom parser. Regex over the XML text: good enough for well-formed feeds, and every
// field it returns is cleaned (tags stripped, entities decoded, control characters removed) before use.
export function parseFeed(xml: string): { kind: "rss" | "atom" | "unknown"; title: string; items: { title: string; link: string; date: string; summary: string }[] } {
  const src = String(xml || "").replace(/^﻿/, "");
  const blocks = (tag: string) => [...src.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);
  const entries = blocks("item");
  const kind = entries.length ? "rss" : blocks("entry").length ? "atom" : "unknown";
  const list = kind === "atom" ? blocks("entry") : entries;
  const head = src.slice(0, src.search(/<(item|entry)[\s>]/i) === -1 ? src.length : src.search(/<(item|entry)[\s>]/i));
  const items = list.map((e) => {
    const title = textOf(e, "title");
    let link = "";
    if (kind === "atom") {
      const links = [...e.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
      const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0] || "";
      link = (pick.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    } else link = textOf(e, "link") || (e.match(/<link\b[^>]*href=["']([^"']+)["']/i) || [])[1] || textOf(e, "guid");
    const date = toISO(textOf(e, "pubDate") || textOf(e, "published") || textOf(e, "updated") || textOf(e, "dc:date"));
    const summary = textOf(e, "description") || textOf(e, "summary") || textOf(e, "content:encoded") || textOf(e, "content");
    return { title: cleanText(title, 200), link: safeUrl(decodeEntities(link.trim())), date, summary: cleanText(summary, 300) };
  }).filter((i) => i.title && i.link);
  return { kind, title: cleanText(textOf(head, "title"), 100), items };
}
function textOf(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  let s = m[1].trim();
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s);                       // feeds often double-encode HTML inside description
  s = s.replace(/<[^>]+>/g, " ");               // strip tags
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
function toISO(s: string): string { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : ""; }

// ---- OpenAlex: recent open-access papers, two searches, de-duplicated
async function fetchPapers(): Promise<Paper[]> {
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const out: Paper[] = []; const seen = new Set<string>();
  const results = await Promise.allSettled(OPENALEX_QUERIES.map((q) =>
    getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=from_publication_date:${since},is_oa:true&sort=publication_date:desc&per-page=5`)));
  if (results.every((r) => r.status === "rejected")) throw new Error(String((results[0] as PromiseRejectedResult).reason?.message || "unavailable"));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const w of (r.value as any)?.results || []) {
      const title = cleanText(w.display_name || w.title, 200);
      const link = safeUrl(w.doi || w.primary_location?.landing_page_url || w.id || "");
      const key = (w.doi || w.id || title).toLowerCase();
      if (!title || !link || seen.has(key)) continue; seen.add(key);
      out.push({ title, link, journal: cleanText(w.primary_location?.source?.display_name, 100), date: cleanText(w.publication_date, 10), abstract: cleanText(invertAbstract(w.abstract_inverted_index), 600) });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, PAPERS_MAX);
}
// OpenAlex stores abstracts as { word: [positions] }. Put every word back at its position and join.
export function invertAbstract(idx: unknown): string {
  if (!idx || typeof idx !== "object") return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx as Record<string, unknown>)) {
    if (!Array.isArray(pos)) continue;
    for (const p of pos) if (Number.isInteger(p) && p >= 0 && p < 5000) words[p] = w;
  }
  return words.filter((w) => w !== undefined).join(" ");
}

// ---- the one Claude call
type Written = { lead: string; seasonal: string; news: string[]; papers: string[] };
async function writeWithClaude(c: Cfg, d: Digest, cbc: boolean, today: string): Promise<Written | null> {
  if (!c.anthropicKey) return null;
  const spent = await todaySpend(c);
  if (c.dailyCap - spent < 0.05) { console.log("digest: daily Claude budget used up"); return null; }
  const prompt = `You write "This week in birds" for Daybird, a morning brief for newer birders around ${d.place}. Today is ${today}.
Voice: plain, warm and specific. Short sentences. No jargon without a gloss, no exclamation marks, no emoji, no safety or medical advice. Do not invent facts that are not in the data below; if an item is thin, say what it is about in general terms.

NOTABLE BIRDS REPORTED NEARBY IN THE LAST 7 DAYS (species, reports): ${d.notable.map((n) => `${n.name} (${n.reports})`).join("; ") || "(none)"}

NEWS ITEMS (index. source — title — feed summary):
${d.news.map((n, i) => `${i}. ${n.source} — ${n.title} — ${n.summary}`).join("\n") || "(none)"}

PAPERS (index. journal — title — abstract):
${d.papers.map((p, i) => `${i}. ${p.journal || "journal"} — ${p.title} — ${p.abstract.slice(0, 500)}`).join("\n") || "(none)"}

Write, and return ONLY JSON in this shape:
{"lead":"exactly three sentences: what the notable birds and the week's news add up to for a newer birder around ${d.place}",
 "news":["one plain sentence per news item, same order and count as the list: what it says and why a birder might care"],
 "papers":["one plain sentence per paper, same order and count: what it found and why a birder might care"],
 "seasonal":${cbc ? '"two sentences about the Christmas Bird Count season (Dec 14 to Jan 5): what it is and how a newer birder can join a local count via Audubon"' : '""'}}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": c.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await r.json();
    const inTok = body?.usage?.input_tokens || 0, outTok = body?.usage?.output_tokens || 0;
    await record(c, { user_id: null, kind: "digest", model: MODEL, input_tokens: inTok, output_tokens: outTok, cost_usd: inTok * PRICE_IN + outTok * PRICE_OUT, ok: r.ok });
    if (!r.ok) { console.error("digest: Anthropic", r.status, body?.error?.message); return null; }
    const text = (body.content || []).map((b: any) => b.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    const arr = (x: unknown, n: number) => (Array.isArray(x) ? x : []).slice(0, n).map((s) => cleanText(s, 400));
    return { lead: cleanText(parsed.lead, 800), seasonal: cbc ? cleanText(parsed.seasonal, 500) : "", news: arr(parsed.news, d.news.length), papers: arr(parsed.papers, d.papers.length) };
  } catch (e) { console.error("digest: Claude call failed:", e); return null; }
}

// ---------------------------------------------------------------- Supabase: cache and spend meter
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });

async function readCache(c: Cfg, region: string, week: string): Promise<{ json: Digest; created_at: string } | null> {
  try {
    const r = await sbFetch(c, `digests?region=eq.${encodeURIComponent(region)}&week=eq.${encodeURIComponent(week)}&select=json,created_at`);
    const rows: any[] = r.ok ? await r.json() : [];
    return rows[0]?.json ? { json: rows[0].json, created_at: rows[0].created_at } : null;
  } catch { return null; }
}
async function writeCache(c: Cfg, region: string, week: string, place: string, d: Digest) {
  try {
    const r = await sbFetch(c, "digests?on_conflict=region,week", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ region, week, place, json: d, created_at: new Date().toISOString() }) });
    if (!r.ok) console.error("digest: could not cache:", r.status);
  } catch (e) { console.error("digest: could not cache:", e); }
}
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
// Spend across every kind (bird-id, digest, ask): one shared daily budget.
async function todaySpend(c: Cfg): Promise<number> {
  try {
    const r = await sbFetch(c, `usage?select=cost_usd&created_at=gte.${encodeURIComponent(startOfTodayISO())}`);
    const rows: any[] = r.ok ? await r.json() : [];
    return rows.reduce((a, x) => a + Number(x.cost_usd || 0), 0);
  } catch { return 0; }
}
async function record(c: Cfg, row: Record<string, unknown>) {
  try { await sbFetch(c, "usage", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) }); } catch { /* bookkeeping only */ }
}

// ---------------------------------------------------------------- small helpers
type Settled<T> = { ok: true; value: T } | { ok: false; error: string };
async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, error: String((e as any)?.message || e) }; }
}
async function getJSON(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.json();
}
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const safeId = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9]{1,20}$/.test(s) ? s : "");
function safeUrl(u: string): string {
  try { const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") ? x.href.slice(0, 500) : ""; } catch { return ""; }
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json", ...(status === 200 ? { "cache-control": "public, max-age=3600" } : {}) } });
}
