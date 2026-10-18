// Daybird — ask edge function ("Ask Daybird"). Answers one question about the user's current brief and
// life-list summary with a single short Claude call. Sign-in required; 20 questions per user per day;
// the daily dollar cap is shared with bird-id and digest through the `usage` table.
// Deploy in Supabase → Edge Functions (name: ask). Leave "Verify JWT" ON.
//
// Secrets (Edge Functions → Secrets): ANTHROPIC_API_KEY (same key as bird-id).
// Optional: DAILY_CAP_USD (default 1.00, shared), ASK_PER_USER_DAILY (default 20).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically. Needs migration-3.sql (usage).
//
// Privacy: the question, a trimmed copy of the brief (about 2 KB) and a life-list summary (totals and the last ten
// lifers, never the full list) go to Anthropic for the answer. Only token counts and cost are stored, not the text.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-5-5";
const PRICE_IN = 2 / 1_000_000, PRICE_OUT = 10 / 1_000_000; // USD per token, Sonnet 5.5 list price
const TZ = "America/New_York";
const BRIEF_MAX = 2500, QUESTION_MAX = 500, HISTORY_TURNS = 6;

const num = (name: string, d: number) => { const v = Number(Deno.env.get(name)); return Number.isFinite(v) && v > 0 ? v : d; };
function config() {
  return {
    anthropicKey: (Deno.env.get("ANTHROPIC_API_KEY") || "").trim(),
    dailyCap: num("DAILY_CAP_USD", 1.0),
    perUser: num("ASK_PER_USER_DAILY", 20),
    sbUrl: (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, ""),
    anon: Deno.env.get("SUPABASE_ANON_KEY") || "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
}
type Cfg = ReturnType<typeof config>;

export const SYSTEM = `You are Ask Daybird, the helper inside Daybird, a morning brief that tells newer birders whether today is worth going out, what they might see, and why. Daybird layers plain-language summaries on top of eBird and Open-Meteo data; it does not replace eBird or Merlin.
Answer in 2 to 4 plain sentences. Be warm and specific, like a friend who birds. No jargon without a quick gloss, no exclamation marks, no emoji, no lists.
Use only the brief and life-list summary given to you. If they do not cover the question, say "I don't know" plainly and, when it fits, suggest what would answer it. For anything live (what is flying tonight, what was just reported), recommend checking BirdCast or eBird.
Never give safety or medical advice: no judgments about ice, water, roads, weather danger, wildlife encounters or health; if asked, say Daybird is not safety advice and point to a local authority or a doctor.
Dates in the brief are local to the user. "Lifer" means a species seen for the first time.`;

// ---------------------------------------------------------------- request handling
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const c = config();
    if (!c.anthropicKey) return json({ error: "Server setup incomplete: ANTHROPIC_API_KEY secret not set." }, 500);

    const user = await verifiedUser(c, req.headers.get("authorization"));
    if (!user) return json({ error: "Sign in to ask Daybird." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
    const v = parseRequest(body);
    if ("error" in v) return json({ error: v.error }, 400);

    const { spent, mine } = await todayUsage(c, user.id);
    if (c.dailyCap - spent < 0.02) return json({ error: `Daybird's daily budget for Claude ($${c.dailyCap.toFixed(2)}) is used up. It resets at midnight Eastern.`, remaining: 0 }, 429);
    if (mine >= c.perUser) return json({ error: `You've asked ${c.perUser} questions today, which is the daily limit. It resets at midnight Eastern.`, remaining: 0 }, 429);

    const messages = buildMessages(v);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": c.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages }),
      signal: AbortSignal.timeout(45000),
    });
    const out = await r.json();
    const inTok = out?.usage?.input_tokens || 0, outTok = out?.usage?.output_tokens || 0;
    const cost = inTok * PRICE_IN + outTok * PRICE_OUT;
    await record(c, { user_id: user.id, kind: "ask", model: MODEL, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, ok: r.ok });
    if (!r.ok) { console.error("ask: Anthropic", r.status, out?.error?.message); return json({ error: "Daybird couldn't answer just now. Try again in a minute." }, 502); }
    const answer = cleanText((out.content || []).map((b: any) => b.text || "").join(" "), 1200);
    if (!answer) return json({ error: "Daybird couldn't answer just now. Try again in a minute." }, 502);
    return json({ answer, remaining: Math.max(0, c.perUser - mine - 1), cost: Number(cost.toFixed(4)) });
  } catch (e) {
    console.error("ask failed:", e);
    return json({ error: "Something went wrong. Try again in a minute." }, 500);
  }
}
// The guard lets a test import this file without starting a server.
if (!(globalThis as any).__DAYBIRD_TEST__) Deno.serve(handler);

type Parsed = { question: string; brief: string; life: string; history: { role: "user" | "assistant"; text: string }[] };
export function parseRequest(b: any): Parsed | { error: string } {
  if (!b || typeof b !== "object") return { error: "Bad request." };
  const question = cleanText(b.question, QUESTION_MAX);
  if (question.length < 2) return { error: "Type a question first." };
  // The brief and the life summary arrive as objects; they are stringified here and hard-capped so a client cannot send a novel.
  const brief = typeof b.brief === "object" && b.brief ? JSON.stringify(b.brief).slice(0, BRIEF_MAX) : "";
  const life = typeof b.life === "object" && b.life ? JSON.stringify(summarizeLife(b.life)).slice(0, 1500) : "";
  const history = (Array.isArray(b.history) ? b.history : []).slice(-HISTORY_TURNS)
    .map((h: any) => ({ role: h?.role === "assistant" ? "assistant" as const : "user" as const, text: cleanText(h?.text, 600) }))
    .filter((h: any) => h.text);
  return { question, brief, life, history };
}
// Totals plus the last ten lifers (name, date, place). Nothing else from the life list leaves the browser.
function summarizeLife(l: any) {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return {
    total: n(l.total), thisYear: n(l.thisYear), yearList: n(l.yearList), checklists: n(l.checklists),
    recentLifers: (Array.isArray(l.recentLifers) ? l.recentLifers : []).slice(0, 10).map((x: any) => ({ name: cleanText(x?.name, 60), first: cleanText(x?.first, 10), loc: cleanText(x?.loc, 60) })),
    favorite: cleanText(l.favorite, 60),
  };
}
export function buildMessages(v: Parsed) {
  const ctx = `CURRENT BRIEF (JSON, trimmed): ${v.brief || "(no brief loaded)"}\nLIFE LIST SUMMARY (JSON): ${v.life || "(no life list imported)"}`;
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  // keep alternation valid: drop a leading assistant turn and merge same-role neighbours
  for (const h of v.history) {
    if (!msgs.length && h.role === "assistant") continue;
    if (msgs.length && msgs[msgs.length - 1].role === h.role) msgs[msgs.length - 1].content += "\n" + h.text;
    else msgs.push({ role: h.role, content: h.text });
  }
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();
  msgs.push({ role: "user", content: `${ctx}\n\nQUESTION: ${v.question}` });
  return msgs;
}

// Checks the token with Supabase Auth itself, so it stays safe even if "Verify JWT" were switched off.
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

// ---------------------------------------------------------------- spend meter (usage table, shared with bird-id and digest)
const sbFetch = (c: Cfg, path: string, init: RequestInit = {}) =>
  fetch(`${c.sbUrl}/rest/v1/${path}`, { ...init, headers: { apikey: c.service, authorization: `Bearer ${c.service}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
function startOfTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const sinceMidnight = (((+p.hour % 24) * 60 + +p.minute) * 60 + +p.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnight).toISOString();
}
async function todayUsage(c: Cfg, userId: string): Promise<{ spent: number; mine: number }> {
  try {
    const r = await sbFetch(c, `usage?select=cost_usd,user_id,kind&created_at=gte.${encodeURIComponent(startOfTodayISO())}`);
    const rows: any[] = r.ok ? await r.json() : [];
    return { spent: rows.reduce((a, x) => a + Number(x.cost_usd || 0), 0), mine: rows.filter((x) => x.kind === "ask" && x.user_id === userId).length };
  } catch { return { spent: 0, mine: 0 }; }
}
async function record(c: Cfg, row: Record<string, unknown>) {
  try { await sbFetch(c, "usage", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) }); } catch { /* bookkeeping only */ }
}

// ---------------------------------------------------------------- small helpers
const cleanText = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
