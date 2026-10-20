// "This week's birds" in the emails: send-brief and send-daily fetch data/expected/{code}.json from the site at run
// time for the recipient's county and pass it to the engine. Every outside service is stubbed (Supabase REST + Auth,
// Open-Meteo, eBird, Resend, the site). Run from the repo root:
//   deno test --allow-env --allow-read --allow-net=none --no-check tests/expected-functions.test.ts
import assert from "node:assert/strict";

(globalThis as any).__DAYBIRD_TEST__ = true;
const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
  EBIRD_KEY: "ebird-key", RESEND_API_KEY: "resend-key", UNSUB_SECRET: "test-secret", DAILY_SECRET: "daily-secret",
  FROM_EMAIL: "Daybird <brief@example.com>", MAILING_ADDRESS: "1 Main St, Lebanon, NH 03766", SITE_URL: "https://day-bird.com", BATCH_PAUSE_MS: "0",
};
for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);

const send = await import(new URL("../supabase/functions/send-brief/index.ts", import.meta.url).href);
const daily = await import(new URL("../supabase/functions/send-daily/index.ts", import.meta.url).href);
const B: any = (globalThis as any).DAYBIRD_BRIEF;

// ---------------------------------------------------------------- stub world
const S: any = {};
function reset() {
  S.rows = [] as any[]; S.sent = [] as any[]; S.batches = [] as any[]; S.calls = [] as string[];
  S.db = { subscribers: [] as any[], daily_runs: [] as any[] };
  S.expected = "ok";   // ok | 500 | malformed | slow-fail
}
const TOKENS: Record<string, any> = { tokA: { id: "u1", email: "ben@example.com", email_confirmed_at: "2026-01-01" } };
const hours = (d: string) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, "0")}:00`);
function weatherJSON() {
  const d0 = "2026-10-18", d1 = "2026-10-19";
  const col = (a: number, b: number) => [...Array(24).fill(a), ...Array(24).fill(b)];
  return {
    current: { time: `${d0}T07:30`, temperature_2m: 50 },
    hourly: { time: [...hours(d0), ...hours(d1)], temperature_2m: col(41, 33), precipitation_probability: col(10, 10), wind_speed_10m: col(5, 20), wind_direction_10m: col(315, 180), cloud_cover: col(20, 90) },
    daily: { time: [d0, d1], sunrise: [`${d0}T07:05`, `${d1}T07:06`], sunset: [`${d0}T17:58`, `${d1}T17:56`], temperature_2m_max: [58, 40], temperature_2m_min: [35, 30] },
  };
}
const NOTABLE = [{ comName: "Snow Goose", locName: "Wilder Dam", locId: "L333", subId: "S1003", obsDt: "2026-10-16 10:00" }];
const RECENT = [{ comName: "Song Sparrow", locName: "Mink Brook", locId: "L444" }, { comName: "Blue Jay", locName: "Mink Brook", locId: "L444" }];
const EXPECTED: Record<string, any> = {
  "US-NH-009": { generated: "2026-10-20T09:40:00Z", region: { code: "US-NH-009", name: "Grafton County" }, window: { from: "2026-10-11", to: "2026-10-20", lists: 41, locations: 17, basis: "complete", tz: "UTC" }, prev: { from: "2026-10-01", to: "2026-10-10", lists: 30 },
    species: [
      { code: "blujay", name: "Blue Jay", share: 0.683, prevShare: 0.4, trend: "arriving", lists: 28 },
      { code: "bkcchi", name: "Black-capped Chickadee", share: 0.927, prevShare: 0.9, trend: "steady", lists: 38 },
      ...Array.from({ length: 12 }, (_, i) => ({ code: "x" + i, name: `Bird <b>${i}</b>`, share: 0.5 - i * 0.03, prevShare: 0.5, trend: "steady", lists: 20 - i })),
    ] },
  "US-VT-027": { generated: "2026-10-20T09:40:00Z", region: { code: "US-VT-027", name: "Windsor County" }, window: { from: "2026-10-11", to: "2026-10-20", lists: 12, locations: 6, basis: "all", tz: "UTC" }, prev: null,
    species: [{ code: "amecro", name: "American Crow", share: 0.25, prevShare: null, trend: null, lists: 3 }] },
};
const UNIQUE: Record<string, string[]> = { daily_runs: ["date"] };
function rest(url: URL, init: any): Response {
  const table = url.pathname.replace("/rest/v1/", "").split("?")[0];
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (table === "brief_sends") {
    if (init.method === "POST") { S.rows.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    return ok(S.rows);
  }
  if (table === "email_suppressions") return ok([]);
  if (table === "profiles") return ok([{ name: "Ben" }]);
  const rows: any[] = S.db[table]; if (!rows) throw new Error("no table " + table);
  if ((init.method || "GET") === "GET") {
    const st = url.searchParams.get("status");
    return ok(rows.filter((r) => !st || r.status === st.replace("eq.", "")));
  }
  if (init.method === "POST") {
    const row = JSON.parse(init.body);
    for (const u of UNIQUE[table] || []) if (rows.some((r) => r[u] === row[u])) return ok({ code: "23505" }, 409);
    rows.push({ id: crypto.randomUUID(), ...row }); return new Response(null, { status: 201 });
  }
  if (init.method === "PATCH") { const body = JSON.parse(init.body); for (const r of rows) Object.assign(r, body); return new Response(null, { status: 204 }); }
  throw new Error("unsupported " + init.method);
}
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  S.calls.push(`${init.method || "GET"} ${url.host}${url.pathname}`);
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/user") { const t = (init.headers?.authorization || "").replace("Bearer ", ""); return TOKENS[t] ? ok(TOKENS[t]) : ok({ msg: "invalid" }, 401); }
  if (url.host === "api.open-meteo.com") return ok(weatherJSON());
  if (url.host === "api.ebird.org") return ok(url.pathname.endsWith("/notable") ? NOTABLE : RECENT);
  if (url.host === "api.resend.com") {
    if (url.pathname === "/emails/batch") { S.batches.push(JSON.parse(init.body)); return ok({ data: [] }); }
    S.sent.push(JSON.parse(init.body)); return ok({ id: "msg_1" });
  }
  if (url.host === "day-bird.com") {
    const m = /^\/data\/expected\/([A-Z0-9-]+)\.json$/.exec(url.pathname);
    assert.ok(m, "only the expected files are fetched from the site: " + url.pathname);
    if (S.expected === "500") return ok({}, 500);
    if (S.expected === "malformed") return new Response("<html>not json", { status: 200, headers: { "content-type": "text/html" } });
    if (S.expected === "throw") throw new TypeError("network down");
    return EXPECTED[m![1]] ? ok(EXPECTED[m![1]]) : ok({ error: "not found" }, 404);
  }
  if (url.host === "proj.supabase.co" && url.pathname.startsWith("/rest/v1/")) return rest(url, init);
  throw new Error("unstubbed fetch: " + url);
}) as any;

const place = { lat: 43.6423, lng: -72.2518, place: "Lebanon, New Hampshire" };
const post = (body: unknown) => send.handler(new Request("https://proj.supabase.co/functions/v1/send-brief", { method: "POST", headers: { authorization: "Bearer tokA", "content-type": "application/json" }, body: JSON.stringify(body) }));
const siteCalls = () => S.calls.filter((c: string) => c.includes("day-bird.com"));

// ---------------------------------------------------------------- send-brief
Deno.test("send-brief: the block appears with the top ten, shares in tenths, trend words, the window line; names are escaped", async () => {
  reset();
  const r = await post({ to: "self", ...place });
  assert.equal(r.status, 200);
  assert.deepEqual(siteCalls(), ["GET day-bird.com/data/expected/US-NH-009.json"], "Lebanon is in Grafton County");
  const m = S.sent[0];
  assert.match(m.text, /This week's birds \(Grafton County, 41 checklists, Oct 11–20\):\n- Blue Jay — 7 in 10, arriving\n- Black-capped Chickadee — almost every\n- Bird <b>0<\/b> — 5 in 10\n/);
  assert.equal((m.text.match(/^- .* — \d+ in 10|^- .* — almost every/gm) || []).length, 10, "ten names, not fourteen");
  const i = m.text.indexOf("This week's birds");
  assert.ok(i > m.text.indexOf("First song") && i < m.text.indexOf("Where to go"), "after the morning's header lines, before the spots");
  assert.match(m.html, /This week&#39;s birds<\/h3>/);
  assert.match(m.html, /Grafton County, 41 checklists, Oct 11–20\. The share of eBird checklists each bird was on\./);
  assert.match(m.html, /<b>Blue Jay<\/b> <span style="color:#5f6b63">— 7 in 10<\/span> <span style="color:#E8833A;font-size:13px">arriving<\/span>/);
  assert.match(m.html, /<b>Black-capped Chickadee<\/b> <span style="color:#5f6b63">— almost every<\/span><\/li>/, "steady gets no word");
  assert.ok(!m.html.includes("<b>0</b>"), "species names from the data file are escaped");
  assert.match(m.html, /Bird &lt;b&gt;0&lt;\/b&gt;/);
});

Deno.test("send-brief: a county with no previous window gets names and shares, no trend words", async () => {
  reset();
  await post({ to: "self", lat: 43.62, lng: -72.52, place: "Woodstock, VT" });
  assert.deepEqual(siteCalls(), ["GET day-bird.com/data/expected/US-VT-027.json"]);
  assert.match(S.sent[0].text, /This week's birds \(Windsor County, 12 checklists, Oct 11–20\):\n- American Crow — 3 in 10\n\n/);
});

Deno.test("send-brief: outside the counties nothing is fetched and the email has no block", async () => {
  reset();
  const r = await post({ to: "self", lat: 42.36, lng: -71.06, place: "Boston, MA" });
  assert.equal(r.status, 200);
  assert.deepEqual(siteCalls(), []);
  assert.ok(!S.sent[0].text.includes("This week's birds")); assert.ok(!S.sent[0].html.includes("This week&#39;s birds"));
});

Deno.test("send-brief: a failing, missing, malformed or throwing site fetch still sends, complete and not marked partial", async () => {
  for (const mode of ["500", "malformed", "throw"]) {
    reset(); S.expected = mode;
    const r = await post({ to: "self", ...place });
    assert.equal(r.status, 200, mode);
    const body = await r.json();
    assert.equal(body.partial, false, `${mode}: the brief itself is complete`);
    assert.equal(S.sent.length, 1, mode);
    assert.ok(!S.sent[0].text.includes("This week's birds"), mode);
    assert.match(S.sent[0].text, /Where to go/);
    assert.ok(!S.sent[0].text.includes("Some data was unavailable"), mode);
  }
  reset();   // a county the Action has not built yet (404)
  await post({ to: "self", lat: 43.3767, lng: -72.3467, place: "Claremont, NH" });
  assert.deepEqual(siteCalls(), ["GET day-bird.com/data/expected/US-NH-019.json"]);
  assert.equal(S.sent.length, 1); assert.ok(!S.sent[0].text.includes("This week's birds"));
});

Deno.test("send-brief: expectedFor resolves to null for junk shapes", async () => {
  reset();
  assert.equal(await send.expectedFor("https://day-bird.com/", 42, -71), null);
  EXPECTED["US-NH-019"] = { region: {}, species: "nope" };
  assert.equal(await send.expectedFor("https://day-bird.com/", 43.3767, -72.3467), null);
  delete EXPECTED["US-NH-019"];
  assert.equal((await send.expectedFor("https://day-bird.com/", 43.6423, -72.2518)).region.name, "Grafton County");
});

// ---------------------------------------------------------------- send-daily
const run = () => daily.handler(new Request("https://proj.supabase.co/functions/v1/send-daily", { method: "POST", headers: { "x-daily-secret": "daily-secret" } }));
const seed = (rows: Partial<Record<string, unknown>>[]) => rows.forEach((r, i) => S.db.subscribers.push({ id: crypto.randomUUID(), email: `r${i}@example.com`, lat: 43.64, lng: -72.25, place: "Lebanon, NH", mode: "any", level: "new", go_only: false, status: "active", ...r }));
const mails = () => S.batches.flat();

Deno.test("send-daily: one site fetch per county per run; each cell's block matches its county; outside gets none", async () => {
  reset();
  seed([
    { lat: 43.64, lng: -72.25, place: "Lebanon, NH" }, { lat: 43.70, lng: -72.29, place: "Hanover, NH" },   // same cell, Grafton
    { lat: 44.306, lng: -71.77, place: "Littleton, NH" },                                                     // another cell, still Grafton
    { lat: 43.62, lng: -72.52, place: "Woodstock, VT" },                                                      // Windsor
    { lat: 42.36, lng: -71.06, place: "Boston, MA" },                                                         // outside
  ]);
  const r = await run();
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.sent, 5); assert.equal(body.cells, 4);
  assert.deepEqual(siteCalls().sort(), ["GET day-bird.com/data/expected/US-NH-009.json", "GET day-bird.com/data/expected/US-VT-027.json"], "two Grafton cells share one fetch");
  const byPlace = Object.fromEntries(mails().map((m: any) => [m.subject.split(" · ")[1], m]));
  assert.match(byPlace["Lebanon, NH"].text, /This week's birds \(Grafton County, 41 checklists, Oct 11–20\):\n- Blue Jay — 7 in 10, arriving/);
  assert.match(byPlace["Hanover, NH"].text, /Grafton County, 41 checklists/);
  assert.match(byPlace["Littleton, NH"].text, /Grafton County, 41 checklists/);
  assert.match(byPlace["Woodstock, VT"].text, /Windsor County, 12 checklists, Oct 11–20\):\n- American Crow — 3 in 10/);
  assert.ok(!byPlace["Boston, MA"].text.includes("This week's birds"));
  assert.match(byPlace["Lebanon, NH"].html, /<b>Blue Jay<\/b> <span style="color:#5f6b63">— 7 in 10<\/span>/);
  assert.ok(byPlace["Lebanon, NH"].html.indexOf("This week&#39;s birds") < byPlace["Lebanon, NH"].html.indexOf("Where to go"));
});

Deno.test("send-daily: the site being down changes nothing but the block; no error is recorded for it", async () => {
  reset(); S.expected = "500";
  seed([{ lat: 43.64, lng: -72.25, place: "Lebanon, NH" }]);
  const body = await (await run()).json();
  assert.equal(body.sent, 1); assert.deepEqual(body.errors, []);
  assert.ok(!mails()[0].text.includes("This week's birds")); assert.match(mails()[0].text, /Where to go/);
  reset(); S.expected = "throw";
  seed([{ lat: 43.64, lng: -72.25, place: "Lebanon, NH" }]);
  const b2 = await (await run()).json();
  assert.equal(b2.sent, 1); assert.deepEqual(b2.errors, []);
});

Deno.test("send-daily: the memo is per run, so tomorrow's run fetches today's file again", async () => {
  reset(); seed([{ lat: 43.64, lng: -72.25, place: "Lebanon, NH" }]);
  await run();
  assert.equal(siteCalls().length, 1);
  S.db.daily_runs = []; S.calls = []; S.batches = [];
  await run();
  assert.equal(siteCalls().length, 1, "fetched again on a new run");
});

Deno.test("engine: regionFor picks the county, the inlined copies are current", async () => {
  assert.equal(B.regionFor(43.6423, -72.2518).code, "US-NH-009");
  assert.equal(B.regionFor(43.62, -72.52).code, "US-VT-027");
  assert.equal(B.regionFor(42.36, -71.06), null);
  // the generated engine blocks in the functions must match js/brief.js (node scripts/inline_engine.mjs --check)
  const src = await Deno.readTextFile(new URL("../js/brief.js", import.meta.url));
  for (const fn of ["send-brief", "send-daily"]) {
    const f = await Deno.readTextFile(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url));
    assert.ok(f.includes(src.trimEnd()), `${fn} carries the current engine`);
  }
});
