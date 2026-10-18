// Tests for the premium-preview edge functions (hotspots, freetime, waitlist) with every outside service stubbed.
// Run from the repo root:  deno test --allow-env --allow-read --allow-net=none --no-check tests/premium-functions.test.ts
import assert from "node:assert/strict";

(globalThis as any).__DAYBIRD_TEST__ = true;
const ENV: Record<string, string> = {
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
  EBIRD_KEY: "ebird-key", UNSUB_SECRET: "test-secret",
};
for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);

const hotspots = await import("../supabase/functions/hotspots/index.ts");
const freetime = await import("../supabase/functions/freetime/index.ts");
const waitlist = await import("../supabase/functions/waitlist/index.ts");

// ---------------------------------------------------------------- stub world
const S: any = {};
function reset() {
  S.usage = [] as any[]; S.waitlist = [] as any[]; S.calls = [] as string[]; S.ebird = "ok"; S.ics = {} as Record<string, () => Response>;
  S.waitlistWriteFails = false;
  hotspots._resetCache();
}
const TOKENS: Record<string, any> = {
  tokA: { id: "u1", email: "ben@example.com", email_confirmed_at: "2026-01-01" },
  tokB: { id: "u2", email: "amy@example.com", email_confirmed_at: "2026-01-01" },
  tokUnconfirmed: { id: "u3", email: "new@example.com" },
};
const HOTSPOTS: Record<string, any[]> = {
  "43.64,-72.25": [{ locId: "L1", locName: "Boston Lot", lat: 43.66, lng: -72.27, numSpeciesAllTime: 180, latestObsDt: "2026-10-17 08:00" }, { locId: "L2", locName: "Wilder Dam", lat: 43.67, lng: -72.3, numSpeciesAllTime: 220, latestObsDt: "2026-10-18 07:10" }],
  "43.8,-72.4": [{ locId: "L2", locName: "Wilder Dam", lat: 43.67, lng: -72.3, numSpeciesAllTime: 220 }, { locId: "L3", locName: "<img src=x onerror=alert(1)> Marsh", lat: 43.81, lng: -72.41, numSpeciesAllTime: "95" }, { locId: 'L4"><script>', locName: "bad id", lat: 1, lng: 1 }],
  "44,-72.6": [],
};
const RECENT = [{ comName: "Song Sparrow", locName: "Mink Brook", locId: "L444", subId: "S1", obsDt: "2026-10-17 07:00", lat: 43.6912345, lng: -72.2887654, howMany: 2, sciName: "x", obsValid: true }, { comName: "Blue Jay", locName: "Mink Brook", locId: "L444" }];
const NOTABLE = [{ comName: "Snow Goose", locName: "Wilder Dam", locId: "L333", subId: "S1003", obsDt: "2026-10-16 10:00", howMany: 40 }];

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  S.calls.push(`${init.method || "GET"} ${url.host}${url.pathname}`);
  const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/auth/v1/user") {
    const t = (init.headers?.authorization || "").replace("Bearer ", "");
    return TOKENS[t] ? ok(TOKENS[t]) : ok({ msg: "invalid" }, 401);
  }
  if (url.host === "api.ebird.org") {
    if (S.ebird === "fail") return ok({ errors: ["x"] }, 500);
    if (url.pathname.endsWith("/ref/hotspot/geo")) return ok(HOTSPOTS[`${url.searchParams.get("lat")},${url.searchParams.get("lng")}`] || []);
    if (url.pathname.endsWith("/notable")) return ok(NOTABLE);
    return ok(RECENT);
  }
  if (url.host === "proj.supabase.co" && url.pathname === "/rest/v1/usage") {
    if (init.method === "POST") { S.usage.push({ ...JSON.parse(init.body), created_at: new Date().toISOString() }); return new Response(null, { status: 201 }); }
    const kind = url.searchParams.get("kind")?.replace("eq.", ""), uid = url.searchParams.get("user_id")?.replace("eq.", "");
    const gte = Date.parse(url.searchParams.get("created_at")!.replace("gte.", ""));
    return ok(S.usage.filter((r: any) => r.kind === kind && r.user_id === uid && Date.parse(r.created_at) >= gte).map(() => ({ id: "x" })));
  }
  if (url.host === "proj.supabase.co" && url.pathname === "/rest/v1/waitlist") {
    if (init.method === "POST") {
      if (S.waitlistWriteFails) return ok({ message: "boom" }, 500);
      assert.match(init.headers.prefer, /resolution=merge-duplicates/);
      const row = JSON.parse(init.body); const i = S.waitlist.findIndex((r: any) => r.email_hash === row.email_hash);
      if (i >= 0) S.waitlist[i] = { ...S.waitlist[i], ...row }; else S.waitlist.push({ ...row, created_at: new Date().toISOString() });
      return new Response(null, { status: 201 });
    }
    const h = url.searchParams.get("email_hash")?.replace("eq.", "");
    if (h) return ok(S.waitlist.filter((r: any) => r.email_hash === h).map((r: any) => ({ updated_at: r.updated_at })));
    const gte = Date.parse(url.searchParams.get("created_at")!.replace("gte.", ""));
    return ok(S.waitlist.filter((r: any) => Date.parse(r.created_at) >= gte).map((r: any) => ({ email_hash: r.email_hash })));
  }
  if (S.ics[url.host]) return S.ics[url.host]();
  throw new Error("unstubbed fetch: " + url.toString());
}) as any;

const j = async (r: Response) => ({ status: r.status, body: await r.json() });
const req = (fn: (r: Request) => Promise<Response>, body: unknown, token: string | null = "tokA", query = "") =>
  fn(new Request(`https://proj.supabase.co/functions/v1/x${query}`, { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ebirdCalls = () => S.calls.filter((c: string) => c.includes("api.ebird.org")).length;

// ================================================================ hotspots
const P3 = { points: [{ lat: 43.6423, lng: -72.2518 }, { lat: 43.8, lng: -72.4 }, { lat: 44.0, lng: -72.6 }] };

Deno.test("hotspots: sign-in required; anon key and unconfirmed users are refused", async () => {
  reset();
  assert.equal((await req(hotspots.handler, P3, null)).status, 401);
  assert.equal((await req(hotspots.handler, P3, "anon-key")).status, 401);
  assert.equal((await req(hotspots.handler, P3, "tokUnconfirmed")).status, 401);
  assert.equal(ebirdCalls(), 0); assert.equal(S.usage.length, 0);
});

Deno.test("hotspots: looks up each point within 5 km, dedupes by locId, cleans names, drops bad ids, records usage at cost 0", async () => {
  reset();
  const r = await j(await req(hotspots.handler, P3));
  assert.equal(r.status, 200);
  assert.equal(ebirdCalls(), 3);
  assert.ok(S.calls.some((c: string) => c.includes("/v2/ref/hotspot/geo")));
  assert.deepEqual(r.body.hotspots.map((h: any) => h.locId), ["L1", "L2", "L3"], "L2 appears once, the unsafe id is dropped");
  assert.ok(!/[<>]/.test(r.body.hotspots[2].locName) && r.body.hotspots[2].locName.endsWith("Marsh"), "angle brackets never leave the server: " + r.body.hotspots[2].locName);
  assert.equal(r.body.hotspots[2].numSpeciesAllTime, 95, "string counts become numbers");
  assert.equal(r.body.hotspots[0].sample, 0); assert.equal(r.body.hotspots[2].sample, 1);
  assert.equal(r.body.samples, 3); assert.equal(r.body.cached, 0); assert.equal(r.body.remaining, 29);
  assert.match(r.body.attribution, /eBird/);
  assert.equal(S.usage.length, 1); assert.equal(S.usage[0].kind, "hotspots"); assert.equal(S.usage[0].cost_usd, 0); assert.equal(S.usage[0].user_id, "u1");
});

Deno.test("hotspots: the in-memory cache answers repeat points without calling eBird", async () => {
  reset();
  await req(hotspots.handler, P3);
  const before = ebirdCalls();
  const r = await j(await req(hotspots.handler, { points: [{ lat: 43.6449, lng: -72.2501 }, { lat: 43.80, lng: -72.40 }] }, "tokB")); // rounds to the same cells
  assert.equal(ebirdCalls(), before, "no new eBird calls");
  assert.equal(r.body.cached, 2); assert.deepEqual(r.body.hotspots.map((h: any) => h.locId), ["L1", "L2", "L3"]);
  assert.equal(S.usage.length, 2, "a cached answer still counts toward the caller's day");
});

Deno.test("hotspots: sample cap and point validation", async () => {
  reset();
  const many = { points: Array.from({ length: 21 }, (_, i) => ({ lat: 43 + i * 0.01, lng: -72 })) };
  const r = await j(await req(hotspots.handler, many));
  assert.equal(r.status, 400); assert.match(r.body.error, /At most 20 points/);
  assert.equal((await req(hotspots.handler, { points: [] })).status, 400);
  assert.equal((await req(hotspots.handler, { points: [{ lat: 91, lng: 0 }] })).status, 400);
  assert.equal((await req(hotspots.handler, { points: [{ lat: "", lng: "" }] })).status, 400);
  assert.equal((await req(hotspots.handler, { points: [{ lat: null, lng: null }] })).status, 400);
  assert.equal((await req(hotspots.handler, {})).status, 400);
  assert.equal((await req(hotspots.handler, "{oops")).status, 400);
  assert.equal(ebirdCalls(), 0); assert.equal(S.usage.length, 0);
});

Deno.test("hotspots: 30 requests per user per day, counted across both routes; another user is unaffected", async () => {
  reset();
  for (let i = 0; i < 30; i++) S.usage.push({ user_id: "u1", kind: "hotspots", created_at: new Date().toISOString() });
  const r = await j(await req(hotspots.handler, P3));
  assert.equal(r.status, 429); assert.match(r.body.error, /30 hotspot searches/);
  assert.equal((await req(hotspots.handler, { recent: true, lat: 43.64, lng: -72.25 })).status, 429);
  assert.equal(ebirdCalls(), 0);
  assert.equal((await req(hotspots.handler, P3, "tokB")).status, 200);
  // yesterday's rows do not count
  reset();
  for (let i = 0; i < 30; i++) S.usage.push({ user_id: "u1", kind: "hotspots", created_at: new Date(Date.now() - 30 * 3600e3).toISOString() });
  assert.equal((await req(hotspots.handler, P3)).status, 200);
});

Deno.test("hotspots: ?recent=1 proxies recent + notable sightings, trimmed and rounded, cached for an hour", async () => {
  reset();
  const r = await j(await req(hotspots.handler, { lat: 43.6423, lng: -72.2518 }, "tokA", "?recent=1"));
  assert.equal(r.status, 200);
  assert.equal(ebirdCalls(), 2);
  assert.ok(S.calls.some((c: string) => c.endsWith("/v2/data/obs/geo/recent")) && S.calls.some((c: string) => c.endsWith("/v2/data/obs/geo/recent/notable")));
  assert.equal(r.body.recent.length, 2); assert.equal(r.body.notable.length, 1);
  assert.deepEqual(r.body.recent[0], { comName: "Song Sparrow", locName: "Mink Brook", locId: "L444", subId: "S1", obsDt: "2026-10-17 07:00", howMany: 2, lat: 43.69, lng: -72.29 }, "only the fields the engine reads, coordinates rounded");
  assert.equal(r.body.remaining, 29);
  // the body flag works too, and the second call is served from cache
  const r2 = await j(await req(hotspots.handler, { recent: true, lat: 43.64, lng: -72.25 }));
  assert.equal(r2.body.cached, true); assert.equal(ebirdCalls(), 2);
  assert.equal((await req(hotspots.handler, { recent: true }, "tokA")).status, 400);
});

Deno.test("hotspots: eBird failure and setup problems are explicit", async () => {
  reset(); S.ebird = "fail";
  const r = await j(await req(hotspots.handler, P3));
  assert.equal(r.status, 502); assert.match(r.body.error, /eBird answered 500/);
  assert.equal(S.usage.length, 0, "a failed lookup is not charged");
  Deno.env.delete("EBIRD_KEY");
  assert.equal((await req(hotspots.handler, P3)).status, 500);
  Deno.env.set("EBIRD_KEY", "ebird-key");
  assert.equal((await hotspots.handler(new Request("https://x/", { method: "GET" }))).status, 405);
  assert.equal((await hotspots.handler(new Request("https://x/", { method: "OPTIONS" }))).status, 200);
});

// ================================================================ freetime
const ICS = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${events}END:VCALENDAR\r\n`;
const EV = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT\r\n`;
const icsHost = (text: string | Response, host = "calendar.example.com") => { S.ics[host] = () => text instanceof Response ? text.clone() : new Response(text, { status: 200, headers: { "content-type": "text/calendar" } }); return `https://${host}/private/basic.ics`; };
// Parsing window used by the pure-parser tests: Mon Oct 19 2026 00:00 ET to Tue Oct 27 2026 00:00 ET
const FROM = Date.parse("2026-10-19T04:00:00Z"), TO = Date.parse("2026-10-27T04:00:00Z"), NY = "America/New_York";
const parse = (events: string) => freetime.parseIcs(ICS(events), { tz: NY, from: FROM, to: TO });

Deno.test("freetime: URL rules", () => {
  const bad = ["", "http://cal.example.com/a.ics", "ftp://x.example.com/a", "https://localhost/a.ics", "https://127.0.0.1/a.ics", "https://[::1]/a.ics", "https://proj.supabase.co/rest/v1/usage",
    "https://user:pw@cal.example.com/a.ics", "https://intranet/a.ics", "https://box.local/a.ics", "not a url", "https://" + "a".repeat(2100) + ".com/"];
  for (const u of bad) assert.ok("error" in freetime.checkUrl(u), u);
  assert.deepEqual(freetime.checkUrl("webcal://calendar.google.com/calendar/ical/x/basic.ics"), { url: "https://calendar.google.com/calendar/ical/x/basic.ics" });
  assert.deepEqual(freetime.checkUrl("  https://Calendar.Example.com/a.ics?x=1 "), { url: "https://calendar.example.com/a.ics?x=1" });
});

Deno.test("freetime: parses timed (TZID, UTC, floating), all-day and DURATION events; skips cancelled and free", () => {
  const out = parse(
    EV(["UID:1", "DTSTART;TZID=America/New_York:20261020T070000", "DTEND;TZID=America/New_York:20261020T080000", "SUMMARY:Dentist"]) +
    EV(["UID:2", "DTSTART:20261021T110000Z", "DTEND:20261021T113000Z"]) +
    EV(["UID:3", "DTSTART:20261022T063000", "DURATION:PT1H30M"]) +
    EV(["UID:4", "DTSTART;VALUE=DATE:20261023", "DTEND;VALUE=DATE:20261024", "SUMMARY:Holiday"]) +
    EV(["UID:5", "DTSTART;VALUE=DATE:20261024"]) +
    EV(["UID:6", "DTSTART:20261025T070000", "DTEND:20261025T080000", "STATUS:CANCELLED"]) +
    EV(["UID:7", "DTSTART:20261025T070000", "DTEND:20261025T080000", "TRANSP:TRANSPARENT"]) +
    EV(["UID:8", "DTSTART:20261101T070000", "DTEND:20261101T080000"]) +    // out of range
    EV(["UID:9", "DTSTART;TZID=Eastern Standard Time:20261026T070000", "DTEND;TZID=Eastern Standard Time:20261026T073000"]));
  assert.equal(out.events, 9);
  assert.deepEqual(out.busy.map((b) => [b.start, b.end, b.allDay]), [
    ["2026-10-20T11:00:00.000Z", "2026-10-20T12:00:00.000Z", false],
    ["2026-10-21T11:00:00.000Z", "2026-10-21T11:30:00.000Z", false],
    ["2026-10-22T10:30:00.000Z", "2026-10-22T12:00:00.000Z", false],
    ["2026-10-23T04:00:00.000Z", "2026-10-24T04:00:00.000Z", true],
    ["2026-10-24T04:00:00.000Z", "2026-10-25T04:00:00.000Z", true],
    ["2026-10-26T11:00:00.000Z", "2026-10-26T11:30:00.000Z", false],
  ]);
  assert.deepEqual(out.notes, ['Times in "Eastern Standard Time" were read as America/New_York.']);
  assert.ok(!JSON.stringify(out).includes("Dentist") && !JSON.stringify(out).includes("Holiday"), "titles never leave the server");
});

Deno.test("freetime: weekly RRULE with BYDAY, INTERVAL, COUNT, UNTIL and EXDATE; other frequencies count once", () => {
  // Mon/Wed/Fri 7:00 since September, every week
  let out = parse(EV(["DTSTART;TZID=America/New_York:20260907T070000", "DTEND;TZID=America/New_York:20260907T073000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26"]);
  // every other Tuesday from Oct 6: Oct 6, Oct 20, Nov 3 → only Oct 20 in range
  out = parse(EV(["DTSTART:20261006T063000", "DTEND:20261006T070000", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU"]));
  assert.deepEqual(out.busy.map((b) => b.start), ["2026-10-20T10:30:00.000Z"]);
  // COUNT=3 from Oct 5 Mondays: Oct 5, 12, 19 → only Oct 19
  out = parse(EV(["DTSTART:20261005T070000", "DTEND:20261005T080000", "RRULE:FREQ=WEEKLY;COUNT=3"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), ["2026-10-19"]);
  // UNTIL Oct 21: Wednesdays Oct 7, 14, 21 → Oct 21 only (Oct 28 excluded)
  out = parse(EV(["DTSTART:20261007T070000", "DTEND:20261007T080000", "RRULE:FREQ=WEEKLY;UNTIL=20261021T235959Z"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), ["2026-10-21"]);
  // EXDATE removes Oct 22 from a Thursday series
  out = parse(EV(["DTSTART:20261001T070000", "DTEND:20261001T080000", "RRULE:FREQ=WEEKLY", "EXDATE:20261022T070000"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), []);
  out = parse(EV(["DTSTART:20261001T070000", "DTEND:20261001T080000", "RRULE:FREQ=WEEKLY", "EXDATE:20261015T070000"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), ["2026-10-22"]);
  // all-day weekly (a Saturday chore) lands on the Saturday in range
  out = parse(EV(["DTSTART;VALUE=DATE:20260905", "RRULE:FREQ=WEEKLY;BYDAY=SA"]));
  assert.deepEqual(out.busy.map((b) => [b.start, b.allDay]), [["2026-10-24T04:00:00.000Z", true]]);
  // daily and monthly are counted once, on their first date, with a note
  out = parse(EV(["DTSTART:20261020T070000", "DTEND:20261020T073000", "RRULE:FREQ=DAILY"]) + EV(["DTSTART:20260920T070000", "DTEND:20260920T073000", "RRULE:FREQ=MONTHLY"]));
  assert.deepEqual(out.busy.map((b) => b.start.slice(0, 10)), ["2026-10-20"]);
  assert.deepEqual(out.notes, ["Repeating events that are not weekly were counted once, on their first date."]);
});

Deno.test("freetime: folded lines and exact duplicates", () => {
  const folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/New_Y\r\n ork:20261020T070000\r\nDTEND;TZID=America/New_York:2026102\r\n\t0T080000\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\nDTSTART;TZID=America/New_York:20261020T070000\nDTEND;TZID=America/New_York:20261020T080000\nEND:VEVENT\nEND:VCALENDAR";
  const out = freetime.parseIcs(folded, { tz: NY, from: FROM, to: TO });
  assert.equal(out.events, 2); assert.equal(out.busy.length, 1); assert.equal(out.busy[0].start, "2026-10-20T11:00:00.000Z");
});

Deno.test("freetime: handler fetches, parses, returns only busy blocks, counts usage", async () => {
  reset();
  const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const url = icsHost(ICS(EV([`DTSTART:${d}T070000`, `DTEND:${d}T080000`, "SUMMARY:Team standup", "DESCRIPTION:secret"])));
  const r = await j(await req(freetime.handler, { url, tz: "America/New_York" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1); assert.equal(r.body.busy.length, 1); assert.equal(r.body.busy[0].allDay, false);
  assert.ok(!JSON.stringify(r.body).includes("standup") && !JSON.stringify(r.body).includes("secret"));
  assert.equal(S.usage.length, 1); assert.equal(S.usage[0].kind, "freetime"); assert.equal(S.usage[0].cost_usd, 0);
  assert.ok(S.calls.some((c: string) => c === "GET calendar.example.com/private/basic.ics"));
  // bad tz falls back silently; webcal is accepted
  assert.equal((await req(freetime.handler, { url: url.replace("https://", "webcal://"), tz: "Mars/Olympus" })).status, 200);
});

Deno.test("freetime: sign-in, URL and size limits, not-a-calendar, upstream errors, redirects", async () => {
  reset();
  const url = icsHost(ICS(""));
  assert.equal((await req(freetime.handler, { url }, null)).status, 401);
  assert.equal((await req(freetime.handler, { url }, "anon-key")).status, 401);
  assert.equal((await req(freetime.handler, { url: "http://calendar.example.com/a.ics" })).status, 400);
  assert.equal((await req(freetime.handler, { url: "https://localhost/a.ics" })).status, 400);
  assert.equal((await req(freetime.handler, {})).status, 400);
  assert.equal((await req(freetime.handler, "{oops")).status, 400);
  // content-length over 1 MB
  S.ics["big.example.com"] = () => new Response("x", { status: 200, headers: { "content-length": String(2_000_000) } });
  let r = await j(await req(freetime.handler, { url: "https://big.example.com/a.ics" }));
  assert.equal(r.status, 413); assert.match(r.body.error, /1 MB/);
  // streamed body over 1 MB with no content-length
  S.ics["stream.example.com"] = () => { const chunk = new TextEncoder().encode("BEGIN:VCALENDAR\r\n" + "X".repeat(65536)); let n = 0; return new Response(new ReadableStream({ pull(ctl) { if (n++ < 20) ctl.enqueue(chunk); else ctl.close(); } }), { status: 200 }); };
  r = await j(await req(freetime.handler, { url: "https://stream.example.com/a.ics" }));
  assert.equal(r.status, 413);
  // not a calendar
  S.ics["html.example.com"] = () => new Response("<html>Sign in</html>", { status: 200 });
  r = await j(await req(freetime.handler, { url: "https://html.example.com/a.ics" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /did not return a calendar/);
  // upstream 404 and 500
  S.ics["gone.example.com"] = () => new Response("", { status: 404 });
  r = await j(await req(freetime.handler, { url: "https://gone.example.com/a.ics" }));
  assert.equal(r.status, 502); assert.match(r.body.error, /not found \(404\)/);
  S.ics["down.example.com"] = () => new Response("", { status: 500 });
  assert.equal((await req(freetime.handler, { url: "https://down.example.com/a.ics" })).status, 502);
  // one redirect to a good host is followed; a redirect to a forbidden host is refused
  S.ics["r.example.com"] = () => new Response(null, { status: 302, headers: { location: "https://calendar.example.com/private/basic.ics" } });
  assert.equal((await req(freetime.handler, { url: "https://r.example.com/a.ics" })).status, 200);
  S.ics["evil.example.com"] = () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  r = await j(await req(freetime.handler, { url: "https://evil.example.com/a.ics" }));
  assert.equal(r.status, 400); assert.match(r.body.error, /redirected to a host that is not allowed/);
  S.ics["loop.example.com"] = () => new Response(null, { status: 302, headers: { location: "https://loop.example.com/a.ics" } });
  r = await j(await req(freetime.handler, { url: "https://loop.example.com/a.ics" }));
  assert.equal(r.status, 502); assert.match(r.body.error, /Too many redirects/);
  assert.equal(S.usage.filter((u: any) => u.kind === "freetime").length, 1, "only the successful read counted");
});

Deno.test("freetime: per-user daily cap", async () => {
  reset();
  const url = icsHost(ICS(""));
  for (let i = 0; i < 60; i++) S.usage.push({ user_id: "u1", kind: "freetime", created_at: new Date().toISOString() });
  const r = await j(await req(freetime.handler, { url }));
  assert.equal(r.status, 429); assert.match(r.body.error, /60 times today/);
  assert.equal((await req(freetime.handler, { url }, "tokB")).status, 200);
});

// ================================================================ waitlist
Deno.test("waitlist: validation", async () => {
  reset();
  for (const bad of ["", "not-an-email", "a@b", "a b@c.com", "a@b..com", "<x>@y.com", "x".repeat(250) + "@e.com"]) {
    const r = await j(await req(waitlist.handler, { email: bad, price: "3mo", source: "plan" }, "anon-key"));
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await req(waitlist.handler, { email: "a@example.com", price: "$3", source: "plan" }, "anon-key")).status, 400);
  assert.equal((await req(waitlist.handler, { email: "a@example.com", price: 3, source: "plan" }, "anon-key")).status, 400);
  assert.equal((await req(waitlist.handler, "{oops", "anon-key")).status, 400);
  assert.equal((await req(waitlist.handler, [], "anon-key")).status, 400);
  assert.equal(S.waitlist.length, 0);
  assert.deepEqual(waitlist.parseRequest({ email: " Ben@Example.COM ", price: null, source: "<script>" }), { email: "ben@example.com", price: "", source: null });
});

Deno.test("waitlist: a signed-out visitor is stored by hash + plain address, no user id; duplicates update instead of adding", async () => {
  reset();
  let r = await j(await req(waitlist.handler, { email: "Ben@Example.com", price: "5mo", source: "plan" }, "anon-key"));
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, already: false });
  assert.equal(S.waitlist.length, 1);
  const row = S.waitlist[0];
  assert.equal(row.email_hash, await hmacHex("test-secret", "hash:ben@example.com"), "same derivation as send-brief");
  assert.equal(row.email, "ben@example.com"); assert.equal(row.price, "5mo"); assert.equal(row.source, "plan"); assert.equal(row.user_id, null);
  assert.ok(!S.calls.some((c: string) => c.includes("/auth/v1/user")), "the anon key is not sent to Auth as if it were a user");
  // a second answer a minute later updates the same row
  S.waitlist[0].updated_at = new Date(Date.now() - 2 * MIN).toISOString();
  r = await j(await req(waitlist.handler, { email: "ben@example.com", price: "30yr", source: "route" }, "anon-key"));
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, already: true });
  assert.equal(S.waitlist.length, 1); assert.equal(S.waitlist[0].price, "30yr"); assert.equal(S.waitlist[0].source, "route");
  // but not twice within a minute
  r = await j(await req(waitlist.handler, { email: "ben@example.com", price: "3mo", source: "route" }, "anon-key"));
  assert.equal(r.status, 429); assert.match(r.body.error, /Give it a minute/);
  assert.equal(S.waitlist[0].price, "30yr");
});
const MIN = 60_000;

Deno.test("waitlist: a signed-in user gets their id recorded; 'not sure' is an empty price", async () => {
  reset();
  const r = await j(await req(waitlist.handler, { email: "amy@example.com", price: "", source: "route" }, "tokB"));
  assert.equal(r.status, 200);
  assert.equal(S.waitlist[0].user_id, "u2"); assert.equal(S.waitlist[0].price, "");
  // an expired or forged token is simply anonymous, not an error
  assert.equal((await req(waitlist.handler, { email: "c@example.com", price: "3mo", source: "plan" }, "forged")).status, 200);
  assert.equal(S.waitlist[1].user_id, null);
});

Deno.test("waitlist: site-wide daily cap stops new rows but lets an existing address change its answer", async () => {
  reset();
  for (let i = 0; i < 200; i++) S.waitlist.push({ email_hash: "h" + i, email: `p${i}@example.com`, created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 5 * MIN).toISOString() });
  const r = await j(await req(waitlist.handler, { email: "new@example.com", price: "3mo", source: "plan" }, "anon-key"));
  assert.equal(r.status, 429); assert.match(r.body.error, /busy day/);
  assert.equal(S.waitlist.length, 200);
  const h = await hmacHex("test-secret", "hash:p5@example.com");
  S.waitlist[5].email_hash = h;
  assert.equal((await req(waitlist.handler, { email: "p5@example.com", price: "30yr", source: "plan" }, "anon-key")).status, 200);
  assert.equal(S.waitlist[5].price, "30yr");
  // yesterday's signups don't count
  reset();
  for (let i = 0; i < 200; i++) S.waitlist.push({ email_hash: "h" + i, email: `p${i}@example.com`, created_at: new Date(Date.now() - 30 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 30 * 3600e3).toISOString() });
  assert.equal((await req(waitlist.handler, { email: "new@example.com", price: "3mo", source: "plan" }, "anon-key")).status, 200);
});

Deno.test("waitlist: setup and storage problems are explicit", async () => {
  reset();
  Deno.env.delete("UNSUB_SECRET");
  const r = await j(await req(waitlist.handler, { email: "a@example.com", price: "3mo", source: "plan" }, "anon-key"));
  assert.equal(r.status, 500); assert.match(r.body.error, /UNSUB_SECRET/);
  Deno.env.set("UNSUB_SECRET", "test-secret");
  S.waitlistWriteFails = true;
  assert.equal((await req(waitlist.handler, { email: "a@example.com", price: "3mo", source: "plan" }, "anon-key")).status, 502);
  assert.equal((await waitlist.handler(new Request("https://x/", { method: "GET" }))).status, 405);
  assert.equal((await waitlist.handler(new Request("https://x/", { method: "OPTIONS" }))).status, 200);
});
