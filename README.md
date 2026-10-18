# Daybird — prototype

A static, client-side prototype of a birding morning brief + private-land passes + a small feed. No build step, no backend. Open `index.html` in a browser or publish on GitHub Pages.

## Run it locally

Double-click `index.html`. No server, no install. (Sample data ships as `data/*.js` so it loads from disk.)

## Publish on GitHub Pages

```bash
git init && git add . && git commit -m "Daybird prototype"
gh repo create daybird --public --source=. --push
gh api -X POST repos/{owner}/daybird/pages -f build_type=legacy -f source[branch]=main -f source[path]=/
```

Your site will be at `https://<your-username>.github.io/daybird/`.

## Live data

1. Get an eBird API key at https://ebird.org/api/keygen (free, personal/non-commercial).
2. Open **Settings** in the app and paste it. It is stored in your browser's localStorage only. **Never commit it.**
3. Check BirdCast's dashboard for Grafton County each morning and set the migration rating (1–5). BirdCast has no public API, so this is manual for now.

Weather comes from Open-Meteo (no key). If eBird returns a CORS error in the browser, the fallback is a tiny proxy (a Cloudflare Worker or a GitHub Action that writes `data/live.json` each morning) — that's the first thing to add if you want the brief to update itself.

## What works

- **Brief**: GO / MAYBE / STAY call from wind, rain, wind direction vs. season, your migration rating, and the count of nearby notable reports. Top spots by species reported, notable birds, open passes, one-tap share to feed.
- **Passes**: sample listings + any you create on **Host land**. Booking is saved locally and posts to the feed.
- **Feed**: seed posts + your posts and likes, local only.
- **Profile**: import MyEBirdData.csv (parsed in-browser) → life list, year list, recent lifers, lifers-by-month, most-logged species, top spots; favorite bird + photos; one-tap share of stats to the feed.
- **Settings**: name, key, eBird display name + regions (for live sync), location, radius, migration rating.
- **Live sync**: eBird has no per-user endpoint, so Profile → "Sync new checklists" scans `product/lists/{region}` for checklists under your display name, reads each with `product/checklist/view`, and merges new species into the life list (baseline from the CSV). Synced checklist IDs are remembered so nothing double-counts.

## Accounts and the shared feed (Supabase)

1. Create a free project at supabase.com.
2. SQL Editor → paste `schema.sql` → Run. Creates profiles, posts, likes, listings, bookings, a public `photos` bucket, and row-level security.
3. Authentication → URL Configuration → Site URL = your Pages URL (e.g. `https://benm5151.github.io/DayBird/`). Add it to Redirect URLs too.
4. Put the Project URL and anon key in `js/config.js`. The anon key is public by design; RLS decides who can write what.
5. Run `migration-2.sql` the same way (comments, private listing locations, host bookings).

Sign-in is a magic link by email (no passwords). When signed in: profile, life-list summary, posts, likes, listings and bookings go to the database; photos go to storage. Signed out: everything stays in localStorage like before.

## Also in

- Public profiles (`profile.html?u=<id>`), comments, delete own posts.
- Hosts store an exact location + directions in `listing_private`; RLS reveals it only to the host and to people with a booking. Host dashboard lists who booked. Birders can cancel.
- PWA manifest + icon (add to home screen), bottom tab bar on phones, "use my location" in Settings, `about.html` to share.

- **ID helper** (`id.html`): describe a bird (size, colors, habitat, behavior, free text); candidates start from every species reported within ~30 km in the last 14 days via eBird, scored against a hand-written trait table of ~120 Northeast species (`data/traits.js`). A shortlist, not a classifier. Next step: an LLM re-rank once there's a backend to hold the key.

## Photo ID (Claude vision)

`supabase/functions/bird-id/index.ts` is a Supabase Edge Function. Deploy it from the dashboard: Edge Functions → Deploy a new function → via Editor → name `bird-id` → paste the file → Deploy. Then Edge Functions → Secrets → add `ANTHROPIC_API_KEY` (from console.anthropic.com). The browser never sees the key. Each ID is one Claude call with one resized photo (cents). Spend cap: run `migration-3.sql` (creates a locked `usage` table). The function logs tokens and cost per call and refuses once today's total (midnight Eastern) reaches `DAILY_CAP_USD` (default $1.00); signed-in users get `PER_USER_DAILY` calls (default 25), anonymous callers 5. Both are optional secrets. Check spend in Supabase → Table Editor → usage.

## The brief engine (js/brief.js)

Scoring and wording live in one file, `js/brief.js`, used by the site, the daily GitHub Action (`scripts/build_brief.mjs`, Node) and the `send-brief` edge function (which imports it from the live site URL, so a dashboard-pasted function needs no local files). It is pure: callers fetch Open-Meteo and eBird and hand the JSON over. What it produces per brief: the GO / MAYBE / STAY IN call and a plain "why this morning" sentence; a "what to wear" line; first-song and leave-by times from sunrise; the likeliest bird groups from the species reported nearby, with one tip each, filtered by **mode** (porch, woods, water, commute, campus) and **level** (new, knows the common birds, keeps a list), both set in Settings; a soaring-day rating for hawks from midday sun, warm-up and wind; a tomorrow line when tomorrow's call differs; and a quiz plus feeder nudge on STAY IN days. The group tips, mode tips and wear thresholds are hand-written at the top of the file and are the place to tune voice.

## Email a brief on demand (send-brief)

The Brief page has an **Email me this brief** card: type a town, pick it, tap **Send me the brief**. The server builds a fresh brief for that place (weather for 6–9 AM, plus eBird sightings within 25 km over the last 3 days) and emails it. After 9 AM local it covers tomorrow morning. **Send it to someone else** emails one brief to a friend. You must be signed in; "Send me" always goes to your verified sign-in address, never to an address typed into the form.

Guards, because the form can email strangers: per-user daily caps (10 to yourself, 5 to friends), one brief per recipient per day and three per week, a site-wide daily cap (50), and an unsubscribe link in every friend email that stops friends from sending to that address again. Recipient addresses are stored only as keyed hashes. Change the caps with the optional secrets below.

Setup (about 20 minutes, once):

1. **Database.** Run `migration-4.sql` in the Supabase SQL Editor. It creates `brief_sends` (the counters) and `email_suppressions` (the opt-outs), both locked to the edge functions.
2. **Email service.** Create a free account at resend.com and make an API key. Until you verify a sending domain there, Resend only delivers to the address you signed up with, so "Send me" works for you straight away but "send to someone else" will not. Verifying a domain you own (a few DNS records) removes that limit.
3. **Secrets** (Edge Functions → Secrets): `EBIRD_KEY` (your eBird key, same one as the GitHub secret), `RESEND_API_KEY`, and `UNSUB_SECRET` (any long random string, e.g. `openssl rand -hex 32`; keep it, because changing it later breaks old unsubscribe links). Optional: `FROM_EMAIL` (e.g. `Daybird <brief@yourdomain.com>` once the domain is verified), `MAILING_ADDRESS` (printed in the footer), `SITE_URL`, `SELF_PER_DAY`, `OTHER_PER_DAY`, `DAILY_SEND_CAP`.
4. **Deploy two functions** the same way as `bird-id`: `send-brief` with "Verify JWT" left **on**, and `unsubscribe` with "Verify JWT" **off** (people clicking the link in an email are not signed in; the link's signed token is the check instead).
5. **Try it.** Sign in, tap "Send me the brief", and check your inbox and spam folder. Check the `brief_sends` table in the Table Editor to see the row it logged.

`unsubscribe.html` is the page those unsubscribe links open. eBird terms still apply: this is free, non-commercial use, and a server key making calls for more people makes the Cornell Lab permission question more pressing.

## Still faked

- Payments, host payouts, insurance, messaging, moderation.

## Data terms

eBird API data is for non-commercial use without written permission from the Cornell Lab (https://www.birds.cornell.edu/home/ebird-api-terms-of-use/). Get permission before charging anyone for anything that uses it. Attribute eBird wherever its data is shown.

## Files

```
index.html     brief
passes.html    marketplace
feed.html      social
host.html      landowner listing form
profile.html   life list stats + favorite bird
settings.html  key + location + migration
unsubscribe.html  opt-out page linked from emailed briefs
supabase/functions/  bird-id, send-brief, unsubscribe (edge functions)
js/brief.js    the brief engine (scoring + wording, shared everywhere)
js/app.js      data layer
scripts/build_brief.mjs  daily brief builder (GitHub Action)
css/style.css
data/mock.js     sample sightings/weather (fallback)
data/passes.js   sample listings
data/feed.js     seed posts
```
