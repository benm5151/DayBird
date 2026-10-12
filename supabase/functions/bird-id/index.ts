// Daybird — photo ID edge function with a daily spend cap. Deploy in Supabase → Edge Functions (name: bird-id).
// Secrets: ANTHROPIC_API_KEY (required). Optional: DAILY_CAP_USD (default 1.00), PER_USER_DAILY (default 25 calls).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.
// Needs the `usage` table from migration-3.sql.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-5-5";
const PRICE_IN = 2 / 1_000_000, PRICE_OUT = 10 / 1_000_000; // USD per token, Sonnet 5.5 list price
const DAILY_CAP = Number(Deno.env.get("DAILY_CAP_USD") || "1.00");
const PER_USER_DAILY = Number(Deno.env.get("PER_USER_DAILY") || "25");
const TZ = "America/New_York";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);

    const userId = userFromAuth(req.headers.get("authorization"));
    const { spent, userCalls } = await todaySpend(userId);
    const remaining = Math.max(0, DAILY_CAP - spent);
    if (remaining < 0.02) return json({ error: `Daily photo-ID budget ($${DAILY_CAP.toFixed(2)}) is used up. Resets at midnight Eastern.`, spent, remaining: 0 }, 429);
    if (userId && userCalls >= PER_USER_DAILY) return json({ error: `You've hit today's limit of ${PER_USER_DAILY} photo IDs.`, remaining }, 429);
    if (!userId && userCalls >= 5) return json({ error: "Sign in to keep using photo ID (anonymous limit reached).", remaining }, 429);

    const { image, media_type, description, candidates, place, date } = await req.json();
    if (!image) return json({ error: "no image" }, 400);
    if (image.length > 2_000_000) return json({ error: "image too large; resize to under 1500px" }, 413);

    const pool = (candidates || []).slice(0, 150).map((c: any) => `${c.name} (${c.freq} spots)`).join("; ");
    const prompt = `You are an expert field ornithologist helping a beginner birder in ${place || "the northeastern United States"} on ${date || "today"}.
Identify the bird in the photo. Weigh heavily what has actually been reported nearby in the last 14 days (listed below), but do not exclude a species if the photo clearly shows it.
Observer notes: ${description || "(none)"}
Species reported nearby recently: ${pool || "(none available)"}

Return ONLY JSON, no prose, in this shape:
{"candidates":[{"name":"Common Name","confidence":0-100,"why":"one sentence citing visible field marks"}],"quality":"one sentence on photo quality / what would help","safety":"if the photo is not a bird or is unusable, say so here, else empty"}
Give 1 to 5 candidates, best first. Confidence values should sum to at most 100.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 600,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    const body = await r.json();
    const inTok = body?.usage?.input_tokens || 0, outTok = body?.usage?.output_tokens || 0;
    const cost = inTok * PRICE_IN + outTok * PRICE_OUT;
    await record(userId, inTok, outTok, cost, r.ok);
    if (!r.ok) return json({ error: body?.error?.message || `Anthropic ${r.status}` }, 502);

    const text = (body.content || []).map((b: any) => b.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    let parsed: any;
    try { parsed = JSON.parse(m ? m[0] : text); } catch { return json({ error: "model returned non-JSON", raw: text }, 502); }
    parsed.cost = Number(cost.toFixed(4));
    parsed.remaining = Number(Math.max(0, remaining - cost).toFixed(2));
    return json(parsed);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// ---- helpers ----
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
// The Supabase gateway already verified the JWT; we only need the subject. Anon key has no sub.
function userFromAuth(h: string | null): string | null {
  try {
    const t = (h || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "authenticated" && payload.sub ? payload.sub : null;
  } catch { return null; }
}
function startOfTodayISO(): string {
  // midnight in TZ, expressed as an ISO instant
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00`);
  const offsetMin = (new Date(now.toLocaleString("en-US", { timeZone: TZ })).getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000;
  return new Date(local.getTime() - offsetMin * 60000).toISOString();
}
const SB = () => ({ url: Deno.env.get("SUPABASE_URL")!, key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! });
async function todaySpend(userId: string | null) {
  const { url, key } = SB();
  const since = startOfTodayISO();
  const r = await fetch(`${url}/rest/v1/usage?select=cost_usd,user_id&created_at=gte.${encodeURIComponent(since)}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  const rows: any[] = r.ok ? await r.json() : [];
  const spent = rows.reduce((a, x) => a + Number(x.cost_usd || 0), 0);
  const userCalls = rows.filter(x => (userId ? x.user_id === userId : !x.user_id)).length;
  return { spent, userCalls };
}
async function record(userId: string | null, input_tokens: number, output_tokens: number, cost_usd: number, ok: boolean) {
  const { url, key } = SB();
  await fetch(`${url}/rest/v1/usage`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, kind: "bird-id", model: MODEL, input_tokens, output_tokens, cost_usd, ok }) }).catch(() => {});
}
