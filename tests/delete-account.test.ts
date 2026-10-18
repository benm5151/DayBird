// Tests for the delete-account edge function with Supabase (Auth, REST, Storage) stubbed.
// Run from the repo root:
//   deno test --allow-env --allow-read --allow-net=none --no-check tests/delete-account.test.ts
import assert from "node:assert/strict";

(globalThis as any).__DAYBIRD_TEST__ = true;
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");

const fn = await import(new URL("../supabase/functions/delete-account/index.ts", import.meta.url).href);
const STEPS: ReadonlyArray<readonly [string, string]> = fn.STEPS;

// ---- stub world
const S: any = {};
function reset() {
  S.calls = [] as { method: string; path: string; query: string; headers: Record<string, string>; body: any }[];
  S.rows = { likes: 2, comments: 1, posts: 3, bookings: 1, listings: 1, listing_private: 1, brief_sends: 4, profiles: 1, circle_mornings: 5, circle_members: 2, circles: 1 } as Record<string, number>;
  S.failTables = new Set<string>();   // tables that answer 500
  S.missingTables = new Set<string>(); // tables that answer 404 (migration not run)
  S.photos = ["avatar-1.jpg", "fav-2.jpg"] as string[];
  S.storageList = "ok"; S.storageDelete = "ok"; S.authDelete = "ok";
}
const TOKENS: Record<string, any> = { tokA: { id: "11111111-1111-1111-1111-111111111111", email: "ben@example.com" } };
const UID = TOKENS.tokA.id;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const body = init.body ? JSON.parse(init.body) : null;
  S.calls.push({ method: init.method || "GET", path: url.pathname, query: url.search, headers, body });
  const ok = (b: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...h } });
  const service = headers.authorization === "Bearer service-key" && headers.apikey === "service-key";

  if (url.pathname === "/auth/v1/user") {
    const t = (headers.authorization || "").replace("Bearer ", "");
    return TOKENS[t] ? ok(TOKENS[t]) : ok({ msg: "invalid" }, 401);
  }
  if (url.pathname.startsWith("/auth/v1/admin/users/")) {
    if (!service) return ok({ msg: "forbidden" }, 403);
    if (S.authDelete === "fail") return ok({ msg: "boom" }, 500);
    return ok({});
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    if (!service) return ok({ msg: "forbidden" }, 401);
    const table = url.pathname.slice("/rest/v1/".length);
    if (S.missingTables.has(table)) return ok({ message: `relation "public.${table}" does not exist` }, 404);
    if (S.failTables.has(table)) return ok({ message: "boom" }, 500);
    const n = S.rows[table] ?? 0; S.rows[table] = 0;
    return new Response(null, { status: 204, headers: { "content-range": n ? `0-${n - 1}/${n}` : "*/0" } });
  }
  if (url.pathname === "/storage/v1/object/list/photos") {
    if (!service) return ok({ msg: "forbidden" }, 401);
    if (S.storageList === "fail") return ok({ message: "boom" }, 500);
    // Supabase returns folders with id null and files with an id
    return ok([{ name: "sub", id: null }, ...S.photos.map((p: string, i: number) => ({ name: p, id: `obj-${i}` }))]);
  }
  if (url.pathname === "/storage/v1/object/photos" && init.method === "DELETE") {
    if (!service) return ok({ msg: "forbidden" }, 401);
    if (S.storageDelete === "fail") return ok({ message: "boom" }, 500);
    S.photos = []; return ok([]);
  }
  throw new Error("unstubbed fetch: " + url.toString());
}) as any;

const post = (body: unknown, token: string | null = "tokA", method = "POST") =>
  fn.handler(new Request("https://proj.supabase.co/functions/v1/delete-account", { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }));
const j = async (r: Response) => ({ status: r.status, body: await r.json() });
const deletes = () => S.calls.filter((c: any) => c.method === "DELETE" && c.path.startsWith("/rest/v1/"));

// ---- tests
Deno.test("method and auth: OPTIONS ok, GET 405, missing / anon / service / bad tokens 401, nothing deleted", async () => {
  reset();
  assert.equal((await fn.handler(new Request("https://x/", { method: "OPTIONS" }))).status, 200);
  assert.equal((await post({ confirm: "DELETE" }, "tokA", "GET")).status, 405);
  assert.equal((await post({ confirm: "DELETE" }, null)).status, 401);
  assert.equal((await post({ confirm: "DELETE" }, "anon-key")).status, 401);
  assert.equal((await post({ confirm: "DELETE" }, "service-key")).status, 401);
  assert.equal((await post({ confirm: "DELETE" }, "nope")).status, 401);
  assert.equal(deletes().length, 0);
  assert.equal(S.calls.filter((c: any) => c.path.startsWith("/auth/v1/admin")).length, 0);
});

Deno.test("requires the typed DELETE confirmation in the body", async () => {
  reset();
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ confirm: "delete" })).status, 400);
  assert.equal((await post("not json")).status, 400);
  assert.equal(deletes().length, 0);
});

Deno.test("happy path: deletes every table in order with the service role, lists and removes photos, then the auth user", async () => {
  reset();
  const r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.partial, []);
  // one DELETE per step, in STEPS order, each scoped to this user by the right column
  const d = deletes();
  assert.deepEqual(d.map((c: any) => c.path.slice("/rest/v1/".length)), STEPS.map(([t]) => t));
  for (const [i, [table, col]] of STEPS.entries()) {
    assert.equal(d[i].query, `?${col}=eq.${UID}`, table);
    assert.equal(d[i].headers.apikey, "service-key");
    assert.equal(d[i].headers.authorization, "Bearer service-key");
    assert.match(d[i].headers.prefer, /count=exact/);
  }
  // children before parents
  const order = STEPS.map(([t]) => t);
  assert.ok(order.indexOf("likes") < order.indexOf("posts") && order.indexOf("comments") < order.indexOf("posts"));
  assert.ok(order.indexOf("bookings") < order.indexOf("listings") && order.indexOf("listing_private") < order.indexOf("listings"));
  assert.ok(order.indexOf("circle_members") < order.indexOf("circles"));
  assert.equal(order[order.length - 1], "profiles");
  // counts came from Content-Range
  assert.equal(r.body.removed.posts, 3);
  assert.equal(r.body.removed.brief_sends, 4);
  assert.equal(r.body.removed.profiles, 1);
  // storage: list under photos/<uid>/ then one DELETE with the full paths, folders skipped
  const list = S.calls.find((c: any) => c.path === "/storage/v1/object/list/photos");
  assert.equal(list.body.prefix, UID);
  const sdel = S.calls.find((c: any) => c.path === "/storage/v1/object/photos" && c.method === "DELETE");
  assert.deepEqual(sdel.body.prefixes, [`${UID}/avatar-1.jpg`, `${UID}/fav-2.jpg`]);
  assert.equal(r.body.removed.photos, 2);
  // auth admin delete, last, with the service role
  const auth = S.calls.find((c: any) => c.path.startsWith("/auth/v1/admin/users/"));
  assert.equal(auth.method, "DELETE");
  assert.equal(auth.path, `/auth/v1/admin/users/${UID}`);
  assert.equal(auth.headers.authorization, "Bearer service-key");
  assert.equal(S.calls.indexOf(auth), S.calls.length - 1);
  // response never carries the email
  assert.ok(!JSON.stringify(r.body).includes("ben@example.com"));
});

Deno.test("a table from a migration that has not been run (404) counts as zero, not a failure", async () => {
  reset(); S.missingTables.add("circles"); S.missingTables.add("circle_members"); S.missingTables.add("circle_mornings");
  const r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.partial, []);
  assert.equal(r.body.removed.circles, 0);
  assert.ok(S.calls.some((c: any) => c.path.startsWith("/auth/v1/admin/users/")));
});

Deno.test("a failing table is reported as partial; the rest and the auth user are still deleted", async () => {
  reset(); S.failTables.add("brief_sends");
  const r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.partial, ["brief_sends"]);
  assert.equal(r.body.removed.brief_sends, undefined);
  assert.equal(r.body.removed.profiles, 1);
  assert.equal(deletes().length, STEPS.length, "every table was still attempted");
  assert.ok(S.calls.some((c: any) => c.path.startsWith("/auth/v1/admin/users/")));
});

Deno.test("photo listing or removal failing is reported as partial 'photos'", async () => {
  reset(); S.storageList = "fail";
  let r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.partial, ["photos"]);
  reset(); S.storageDelete = "fail";
  r = await j(await post({ confirm: "DELETE" }));
  assert.deepEqual(r.body.partial, ["photos"]);
  reset(); S.photos = [];
  r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.body.removed.photos, 0);
  assert.equal(S.calls.filter((c: any) => c.path === "/storage/v1/object/photos").length, 0, "no storage DELETE when there is nothing to delete");
});

Deno.test("auth user delete failing returns 502 with the report, so the UI can say what is left", async () => {
  reset(); S.authDelete = "fail";
  const r = await j(await post({ confirm: "DELETE" }));
  assert.equal(r.status, 502);
  assert.match(r.body.error, /sign-in itself could not be deleted/);
  assert.equal(r.body.removed.posts, 3);
  assert.deepEqual(r.body.partial, []);
});
