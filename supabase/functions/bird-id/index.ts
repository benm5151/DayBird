// Daybird — photo ID edge function. Deploy in Supabase → Edge Functions (name: bird-id).
// Secret required: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
// Receives a photo + description + the local eBird candidate list, asks Claude, returns ranked JSON.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);

    const { image, media_type, description, candidates, place, date } = await req.json();
    if (!image) return json({ error: "no image" }, 400);

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
        model: "claude-sonnet-5-5",
        max_tokens: 700,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    const body = await r.json();
    if (!r.ok) return json({ error: body?.error?.message || `Anthropic ${r.status}` }, 502);
    const text = (body.content || []).map((b: any) => b.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    let parsed;
    try { parsed = JSON.parse(m ? m[0] : text); } catch { return json({ error: "model returned non-JSON", raw: text }, 502); }
    return json(parsed);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}
