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
- **Settings**: name, key, location, radius, migration rating.

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

`supabase/functions/bird-id/index.ts` is a Supabase Edge Function. Deploy it from the dashboard: Edge Functions → Deploy a new function → via Editor → name `bird-id` → paste the file → Deploy. Then Edge Functions → Secrets → add `ANTHROPIC_API_KEY` (from console.anthropic.com). The browser never sees the key. Each ID is one Claude call with one resized photo (cents). The function is callable by anyone with the site's anon key, so add rate limiting or require sign-in before sharing widely.

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
js/app.js      data layer + scoring
css/style.css
data/mock.js     sample sightings/weather (fallback)
data/passes.js   sample listings
data/feed.js     seed posts
```
