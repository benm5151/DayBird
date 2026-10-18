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

Your site will be at `https://<your-username>.github.io/daybird/`. Daybird's own is **https://day-bird.com** (the `CNAME` file tells GitHub Pages the custom domain; the DNS records live at the registrar).

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
3. Authentication → URL Configuration → Site URL = your Pages URL (e.g. `https://day-bird.com/`). Add it to Redirect URLs too.
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

## Front door and sharing

The Brief page opens on one screen: the mascot, the call (GO / MAYBE / STAY IN), the one-sentence "why this morning", "Leave by … · first song …", and the wear line, on a sky that follows the grade (amber sunrise for GO, gray-blue for MAYBE, deep navy for STAY IN; `.sky-go` / `.sky-maybe` / `.sky-stay` in `css/style.css`). Everything else on the page sits under one **More for this morning** toggle (`<details id="moreWrap">`); whether you left it open is remembered per browser in `localStorage` as `daybird:moreOpen`. Every element id from before is still there, so the existing scripts keep working. At 390px wide the mascot, call, why line and leave-by fit on the first screen without scrolling.

**Navigation.** The tab bar on every page is Brief · ID · Feed · Profile · More. `more.html` is the hub: it lists Passes, Host land, Settings and About, plus every entry in `data/pages.js` (`DAYBIRD_PAGES`, entries of `{ href, title, blurb, group }`, group one of `learn | plan | you | about`), grouped. Builders add a page by appending to `data/pages.js`, never by editing the nav. The More tab lights up on any page that is not one of the four main tabs (`js/app.js`).

**Share this morning** (`js/share.js`) draws a 1080×1350 PNG with the canvas API, in the browser, with nothing sent anywhere: sky by grade, the mascot pose, the word, the why line wrapped by hand, leave-by, place and date, and a small "daybird" wordmark. On phones it opens the native share sheet (`navigator.share` with the file); elsewhere it downloads `daybird-<date>-<grade>.png`. **You in?** is an `sms:?&body=…` link: "Sat 6:50 AM, it's a GO at Campbell Flats Road. You in? <site url>" (top spot from the brief; on STAY IN days it says "it's a STAY IN morning. Coffee instead?"). Both work offline, no Supabase.

**Mascot poses** are three hand-drawn SVGs in `art/` (each under 1 KB, `viewBox 0 0 200 200`, no raster), the same tufted titmouse as `mark.svg`: `mascot-go.svg` alert and upright, crest up, facing right; `mascot-maybe.svg` fluffed with its head cocked, crest half; `mascot-stay.svg` tucked, eyes closed, crest down, sitting low. On the navy STAY IN sky the bird sits on a cream disc so it still shows. The card's text uses the page's own font stacks (`--serif`, `--sans`), so the picture looks slightly different per device; that is by design.

No setup: no migration, no secrets, no deploy beyond publishing the files. The card draws from the same `art/` files the page shows, so it needs the site served over http(s) (GitHub Pages is fine); opened from disk as `file://`, some browsers refuse to export a canvas that drew a local SVG.
## Learn and play (learn.html)

A page for newer birders, built from whatever is being reported nearby: it reads `data/brief.json`'s `recent` species list (what the daily GitHub Action wrote) and falls back to the sample list in `data/mock.js`, then picks from the hand-written trait table (`data/traits.js`). Nothing on it needs a key or a server; signed in, progress also rides along in `profiles.life.learned` so it follows you between devices. No migration, no new secrets.

What is on it:

- **Bird of the day** — one species a day from the reports (same bird all day). "Hear its song" links out to xeno-canto's search; "See photos" links to All About Birds. Nothing is embedded or hot-linked. The All About Birds slug is guessed from the name (`Black-capped_Chickadee`), so a few may 404.
- **Mornings outside** — "I went out this morning" with a current and best streak. A STAY IN morning (from the Brief's call history or `brief.json`) pauses the streak rather than ending it, and the wording never scolds. Other pages can call `DB.markOutside()`; `DB.streak()` returns `{ current, best, today, total }`.
- **Your first 10 birds** — the ten most learnable species from the reports (feeder, yard and edge birds first; tiny ones and two-plumage birds later; see `learnScore` in `js/learn.js`), each with its trait hint, size word, where to look, and Heard it / Saw it checks.
- **What to look for this week** — the top five groups from `DAYBIRD_BRIEF.groups()` with the engine's own tip at your Settings level, plus the named birds behind each group.
- **Seasonal bingo** — 25 squares, deterministic per month and rounded location (`YYYY-MM` + lat/lng to two decimals, hashed), so friends in the same town get the same card. Reported species fill first; the rest come from the **season rules** at the top of `js/learn.js` (`SEASON_RULES`, `SUMMER_ONLY`, `WINTER_ONLY`): each season names habitats and behaviors it prefers and species it skips. Blunt on purpose; edit the lists there. "Share card" draws the grid on a canvas and shares or downloads a PNG. Last month's card is retired into a one-line history on the first load of a new month.
- **Learn five** — the challenges in `data/challenges.js` (five sparrows, five songs by Halloween, five ducks, five woodpeckers, five raptors in flight). Each picks its species from the trait table by group, behavior or habitat; mark any five and you get a small done card. Add or edit challenges in that file.
- **Quick quiz** — five "which bird is …" questions built by the same `stayIn()` the Brief uses, scored; "Another five" gives a new set.
- **Your first six months, in order** and five **specialty tracks** (Gulls, Waterfowl, Warblers, Raptors, Sparrows) in `data/tracks.js`: a why paragraph and ordered steps, each with the species it uses and a done check. All hand-written; edit the file.

Hand-written and worth tuning: the season rules in `js/learn.js`, everything in `data/challenges.js` and `data/tracks.js`, and the "where to look" phrases (`WHERE` in `js/learn.js`). Approximate by design: the learnability score, the season skip lists, and the All About Birds slugs.

Progress lives in localStorage under `daybird:learned` (`first10`, `bingo`, `challenges`, `outside`, `paused`, `tracks`, `quiz`). Merging with the cloud copy is a union, so nothing checked on one device gets unchecked by another. A profile whose `life` holds only `learned` is treated as "no life list yet" on the Profile page.

Test: `node tests/learn.test.mjs` (Playwright, network stubbed; serves the repo, stubs `data/brief.json` with 40 species and with a 404, checks every section, the streak arithmetic and that every page still loads; screenshots go to `OUT` or `.test-out/`).
## Recap, digest and Ask Daybird

Three pages, listed in `data/pages.js` for the hub, plus two edge functions and one migration.

**Your month in birds (`recap.html`)** reads the life list imported on the profile page (nothing is fetched). Pick a month (default: the last full month) and it shows the lifers you added, your best day (most lifers in one day), species and checklist counts, the same month last year when the list has it, and "likely next lifers": species in the Northeast trait table that are not on your list, with the ones in this morning's `data/brief.json` nearby list first and feeder and yard birds as the fallback. The month counts come from a `months` field that the CSV import now writes (`js/app.js`); a list imported before this change still works from the ten most recent lifers until you re-import the CSV. The live eBird sync adds lifer names to a month but not species counts, and the page says nothing about counts for those months. **Make my card** draws a 1080×1920 PNG on a canvas (lifers this year, latest lifer, favorite bird, top spot, a lifers-by-month strip, the titmouse mark and wordmark) and shares it with the system share sheet or downloads it. The **spark bird** variant asks for the bird that got you started and one line about why; those two fields are saved as your favorite bird on the profile (in the browser, and online when signed in) and nothing else is stored.

**This week in birds (`digest.html`)** calls the `digest` edge function for the place set on the Brief page and renders: a three-sentence lead, "Rare and notable" (eBird notable reports within 50 km over the last 7 days, grouped by species, with checklist links), a "Video of the week" link to a Cornell Lab channel search for the top notable species (a link, never an embed), "News" (one plain sentence per item plus a link to the source, or a short attributed quote when the summary is missing), "From the journals" (recent open-access papers from OpenAlex with DOI links) and a Sources footer. Article text is never reproduced beyond a short quote. The function builds one digest per 0.1° cell (about 10 km) per week (Monday, Eastern), stores it in the `digests` table and serves that row to everyone else, so the cost is one Claude call per area per week (about a cent or two at Sonnet prices) and nothing per reader. A digest that Claude could not summarize is kept for six hours and then rebuilt on the next read.

Feeds are an allowlist in `DIGEST_FEEDS` at the top of `supabase/functions/digest/index.ts`: All About Birds news, Audubon, NH Audubon and BirdCast. The parser is a small hand-written RSS 2.0 / Atom reader (no library), tested on hand-made samples only, so **check each feed URL once the function is live**: open Edge Functions → digest → Logs after the first call and look for `feed <name>:` lines, and the page's Sources footer lists any feed that did not parse under "Not reachable this week". To add a feed, append `{ name, url, home }` and redeploy; to drop one, delete its line. Items older than 10 days are skipped, 4 per feed are kept, and only the title, link, date and the first 300 characters of the description are stored. The OpenAlex queries (`bird migration`, `ornithology citizen science`) are in `OPENALEX_QUERIES` next to the feeds. From December 1 to January 5 the lead gets a short Christmas Bird Count note.

**Ask Daybird (`ask.html`)** is a chat box that answers questions about this morning's brief and your list. Sign-in required; 20 questions per user per day (`ASK_PER_USER_DAILY`). What is sent to the `ask` function: the question, the brief trimmed to about 2 KB (call, why line, weather, groups, spots, notable birds) and a life-list summary (totals and your last ten lifers, never the full list). The system prompt tells the model what Daybird is, to answer in two to four plain sentences, to say "I don't know" when the data does not cover it, never to give safety or medical advice, and to point to BirdCast and eBird for live data. Only token counts and cost are stored (`usage` rows with kind `ask`), never the text; the transcript lives in the tab's sessionStorage and clears when the tab closes. Each question is one short Claude call, about half a cent.

Setup:

1. **Database.** Run `migration-7.sql` in the SQL Editor. It creates `digests` (locked to the service role; readers go through the function). Both functions reuse the `usage` table from `migration-3.sql`, so run that first if you have not.
2. **Secrets** (Edge Functions → Secrets): `ANTHROPIC_API_KEY` (the one bird-id already uses) and `EBIRD_KEY` (the one send-brief uses). Optional: `DAILY_CAP_USD` (default $1.00, one shared budget across bird-id, digest and ask; when it is spent, the digest is served without the summary and ask refuses until midnight Eastern), `DIGEST_RADIUS_KM` (default 50, max 100), `ASK_PER_USER_DAILY` (default 20).
3. **Deploy two functions** the same way as `bird-id`: `digest` and `ask`, both with "Verify JWT" left **on**. The digest page calls its function with the anon key, which passes that check; ask also verifies the user's token with Supabase Auth itself.
4. **Try it.** Open `digest.html` (the first load of the week takes 10 to 20 seconds while the sources are fetched; the next loads are instant) and check the `digests` and `usage` tables. Sign in and ask a starter question on `ask.html`.

Approximate or hand-written: the feed parser (regex over the XML, fine for well-formed feeds), the "likely next lifers" ranking (presence in this morning's nearby list, then feeder birds), the card layout (fixed positions tuned for 1080×1920), and the Claude prices in the functions (list prices, update if they change). eBird data in the digest is non-commercial use and is attributed on the page.
## Subscribers and the daily email

`signup.html` is a public page (no sign-in): email, a place, mode, level, an "only GO mornings" box and a consent box. It stores a *pending* row and emails a confirm link (double opt-in); `confirm.html?t=…` activates it. Every daily email links to `manage.html?e=…&t=…`, where the person can change their place, mode or GO-only setting, or unsubscribe for good; mail apps also get a one-click `List-Unsubscribe` header. Each morning, right after the GitHub Action builds the brief, it calls the `send-daily` function, which groups active subscribers into 0.25° cells, fetches weather and eBird once per cell, composes one brief per subscriber with their own place label, mode and level (the same `js/brief.js` engine as everywhere else, imported from `https://day-bird.com/js/brief.js`), and sends through Resend's batch endpoint (100 per call). GO-only subscribers are skipped on MAYBE and STAY IN mornings. A `daily_runs` row per day makes a second call the same morning a no-op. Links in the email go through the `track` function, which records clicks (host only) and redirects, and a 1×1 pixel records opens; `stats.html` (owner only) shows **readers this week** (distinct subscribers who opened or clicked at least one brief in the last seven days, which is the number to measure the 500-weekly-readers goal by), active subscribers, confirmations this week, sends/opens/clicks per day for 30 days, top clicked hosts, the GO-only share and unsubscribes. Both pages are listed in `data/pages.js`.

What is stored: the real address has to live in `subscribers` (the send needs it), so that table has row-level security on and no policies at all; only the edge functions, with the service-role key, can read it. Everything else (`email_events`, `daily_runs`) refers to people by id. Coordinates are rounded to two decimals. Open and click events keep no IP address or user agent, and clicks keep only the link's host. Click redirects are allowlisted (ebird.org, birdcast.info, open-meteo.com, the site) and every tracking URL is signed, so nothing can be minted or edited.

Setup (after the send-brief setup above; about 20 minutes):

1. **Database.** Run `migration-5.sql` in the SQL Editor: `subscribers`, `daily_runs`, `email_events`, all locked to the service role.
2. **Resend domain.** The daily send goes to strangers, so Resend's "only your own address" test mode is not enough: verify a sending domain at resend.com (a few DNS records) and set `FROM_EMAIL` to an address on it, e.g. `Daybird <brief@yourdomain.com>`. Until then only your own address receives anything, which is fine for the first test below.
3. **Secrets** (Edge Functions → Secrets), on top of `EBIRD_KEY`, `RESEND_API_KEY` and `UNSUB_SECRET` from send-brief:
   - `DAILY_SECRET`: any long random string (`openssl rand -hex 32`). The GitHub Action sends it in an `x-daily-secret` header; nothing else can trigger a send.
   - `OWNER_USER_ID`: your user id from Authentication → Users. Only this account can open `stats.html`.
   - `MAILING_ADDRESS`: a postal address for the email footer (anti-spam law wants one; a PO box is fine).
   - Optional: `DAILY_MAX_EMAILS` (default 500), `DAILY_TIME_BUDGET_MS` (default 100000; the run stops starting new cells after this and writes down how many it skipped), `BATCH_PAUSE_MS` (default 600), `SUBSCRIBE_PER_DAY` (confirm emails per day, default 100), `SITE_URL` (default `https://day-bird.com/`; the confirm, manage and tracked site links are built from it).
4. **GitHub repository secrets** (Settings → Secrets and variables → Actions): `SUPABASE_URL` (the project URL) and `DAILY_SECRET` (same value as above). Without them the new "Email subscribers" step in `.github/workflows/brief.yml` skips itself and the brief build is unchanged.
5. **Deploy four functions** the same way as `bird-id`, in this order: `subscribe` ("Verify JWT" **off**), `track` ("Verify JWT" **off**), `send-daily` ("Verify JWT" **off**: the Action has no user token, the secret header is the check), then `stats` ("Verify JWT" **on**). Deploying the UI pages is just pushing to main.
6. **Test with one subscriber.** Open `signup.html`, enter your own address (the one Resend's test mode delivers to), pick a place, tick consent, submit. Click the confirm link; `confirm.html` should say "You're in" and the row in Table Editor → subscribers should be `active`. Then trigger a send by hand: `curl -X POST "$SUPABASE_URL/functions/v1/send-daily" -H "x-daily-secret: $DAILY_SECRET"` (or run the workflow from the Actions tab). The response reports `sent`, `skipped` and `errors`; the email should land within a minute. Open it, click a hotspot link, then sign in on the site and open `stats.html`: one send, one open, one click. Call the curl a second time: `alreadyRan: true`, nothing sent. To test again the same day, delete today's row from `daily_runs`.

Approximate or hand-written: the 0.25° cell (about 28 km) means two subscribers a few km apart can see slightly different "within 25 km" spot lists only if they fall either side of a cell edge; the email's call is the same for everyone in a cell. Opens undercount (Apple Mail and Gmail often block or pre-fetch pixels) and can also overcount when a mail app pre-fetches the pixel, which is why "readers this week" counts people with an open *or* a click rather than opens alone; clicks are the better signal. Subscribers are sent "this morning" at 09:40 UTC (5:40 AM EDT, 4:40 AM EST) whatever their time zone, so a subscriber out west gets it in the small hours. The migration rating is not in the email (BirdCast has no API). The stats function reads the whole `subscribers` and 30 days of `email_events` in 1000-row pages, which is fine at hundreds of readers and should become a SQL view or RPC before tens of thousands.
## Legal, account deletion and friend circles

**Templates, not legal advice.** `privacy.html`, `terms.html` and `waiver.html` (guest waiver and host agreement) were drafted by the builder, not a lawyer, and each carries a visible "TEMPLATE" banner. They describe Daybird specifically: what is stored (sign-in email, display name, optional photos, life-list summary, location rounded to two decimals, mode and level, posts, listings, bookings, circle lines; brief sends and opt-outs as keyed hashes only), the outside services that see data (Supabase, Resend, eBird / Cornell Lab, Open-Meteo, Anthropic for photo ID), no sale of data, deletion from Settings or by email, localStorage only (no ad or analytics cookies), the "not safety advice" line, eBird's non-commercial terms, age 13+, and New Hampshire as governing law. Fill in the orange `[PLACEHOLDERS]` (`[DATE]`, `[CONTACT_EMAIL]`, `[MAILING_ADDRESS]`, waiver versions), have someone qualified read them, then remove the banners (the `#templateBanner` div on each page). Book an attorney hour before any paid pass: waivers for minors, landowner liability and NH's recreational-use statute are the questions.

**Footer on every page.** `js/footer.js` (loaded right after `js/app.js` on every page) appends "Privacy · Terms · Not safety advice" to every `<footer>`, and the sentence "Daybird is a guide, not safety advice. Check conditions yourself." when the page's own footer does not already say it. It is idempotent and re-runs if a page rewrites its footer. New pages: add the one script tag and nothing else.

**"What we store" line.** `js/notice.js` exposes `DAYBIRD_NOTICE.storage(kind)` (one sentence; kinds `profile`, `listing`, `booking`, `circle`, or none for the general line) and `DAYBIRD_NOTICE.attach(el, kind)`, which writes it into an element with a link to Privacy. Used under the profile form, the host form and the circle post box. Any new form that saves something should call it.

**Delete my account** (Settings, signed in). Typing `DELETE` into the inline box is the only confirmation; no dialogs. It calls the `delete-account` edge function, which removes the user's rows in `likes`, `comments`, `posts`, `circle_mornings`, `circle_members`, `circles` (owned; deleted for every member), `bookings` (including bookings on other people's listings, and hosts are not notified; the page says so), `listing_private`, `listings`, `brief_sends` (by `sender_id`) and `profiles`, then every object under `photos/<uid>/` in storage, then the auth user itself through `/auth/v1/admin/users/<id>`. Tables from migrations not yet run count as zero rows, not failures. A table that fails is reported back as `partial` and the page tells the person to email for a hand clean-up. The browser's `daybird:*` localStorage is cleared and the session signed out afterwards. Deploy it like the other functions (Edge Functions → Deploy a new function → via Editor → name `delete-account` → paste → Deploy, "Verify JWT" on). No new secrets: it uses `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects automatically. The service role is what lets it delete from locked tables and call the Auth admin API; nothing about the user (no email, no id) is logged.

**Affiliate links** (none on the site yet; they wait for Cornell's answer on commercial eBird use). `js/affiliate.js` gives `DAYBIRD_AFFILIATE.link(url, text)` (a DOM node) and `DAYBIRD_AFFILIATE.html(url, text)` (a string for templates). Both render the link with a visible "(affiliate link)" label and `rel="sponsored noopener"`, which is the FTC's disclosure expectation and what search engines ask for. Include the script on the page that needs it; put the label next to every affiliate link, never a page-level note alone.

**Waiver acceptance.** `migration-9.sql` adds `bookings.waiver_accepted_at` and `listings.host_waiver_accepted_at`. On `passes.html` the Book button stays disabled until "I accept the guest waiver (template)" is ticked; on `host.html` the Publish button until the host agreement box is. The tick time is stored with the booking or listing (`DB.book(pass, date, seats, waiverAt)` → `CLOUD.book`; `hostWaiverAcceptedAt` → `CLOUD.createListing`), and in localStorage for sample listings. There is no version number on the waiver text yet; add one (`[WAIVER_VERSION]` on `waiver.html`) before the first paid pass so a booking can be matched to the exact text.

**Friend circles** (`circles.html`, listed under "you" in `data/pages.js`). A private group: create one and get a six-character invite code (alphabet without 0/O/1/I/L, so a code read out loud survives), or join with a friend's code. The page shows members (display names from `profiles`), a "Post this morning" box pre-set to today's call from the brief (GO / MAYBE / STAY IN, optional spot and a note up to 140 characters; posting again the same day replaces the line), a 14-day grid of who went out when, the last 20 lines, and Leave circle (for the owner, that deletes the circle for everyone). No notifications, nothing to the feed. `CLOUD.circles.{list, create, join, members, mornings, post, leave}` in `js/cloud.js`.

How the privacy holds: `migration-9.sql` creates `circles`, `circle_members` and `circle_mornings` with row-level security. Every read policy asks `is_circle_member(circle_id)`, a `security definer` helper, so a signed-in user sees only the circles they are in, and the members and mornings of those. Circles are created and joined only through two `security definer` functions, `create_circle(name)` and `join_circle(code)`: the client never has select access to codes it does not know, a wrong code just fails, and nothing can list codes. Members can insert and edit only their own mornings, delete only their own membership; only the owner can delete the circle (cascading to members and mornings). `new_invite_code()` is revoked from clients; it is only reached through the column default inside `create_circle`.

Setup: run `migration-9.sql` in the Supabase SQL Editor (safe to re-run) and deploy `delete-account`. The migration was executed against a local PostgreSQL 16 with a stand-in `auth.uid()` and the earlier migrations, and its policies checked as three different users; it has not been run on the live project yet.

## Still faked

- Payments, host payouts, insurance, messaging, moderation.

## Data terms

eBird API data is for non-commercial use without written permission from the Cornell Lab (https://www.birds.cornell.edu/home/ebird-api-terms-of-use/). Get permission before charging anyone for anything that uses it. Attribute eBird wherever its data is shown.

## Files

```
index.html     brief (front door + share)
more.html      hub for pages off the tab bar (data/pages.js)
passes.html    marketplace
feed.html      social
host.html      landowner listing form
profile.html   life list stats + favorite bird
settings.html  key + location + migration
unsubscribe.html  opt-out page linked from emailed briefs
learn.html     learn and play: first 10, weekly groups, bingo, challenges, quiz, streak, tracks
supabase/functions/  bird-id, send-brief, unsubscribe (edge functions)
recap.html     your month in birds + the share card
digest.html    this week in birds (news digest)
ask.html       Ask Daybird (chat about the brief and your list)
data/pages.js  pages beyond the main tabs, for the hub
supabase/functions/  bird-id, send-brief, unsubscribe, digest, ask (edge functions)
migration-N.sql  database changes, run in order in the SQL Editor
signup.html    subscribe to the daily brief by email (confirm.html, manage.html go with it)
stats.html     reader stats, owner only
supabase/functions/  bird-id, send-brief, unsubscribe, subscribe, send-daily, track, stats (edge functions)
js/subscribe.js  shared bits for the subscriber pages
js/brief.js    the brief engine (scoring + wording, shared everywhere)
js/app.js      data layer (incl. learn progress + streak)
js/share.js    share card (canvas PNG) + "You in?" text
art/           mascot poses (go, maybe, stay)
js/learn.js    learn-and-play picking logic + season rules
circles.html   private friend circles (who went out this morning)
privacy.html, terms.html, waiver.html  legal templates (review before publishing)
supabase/functions/  bird-id, send-brief, unsubscribe, delete-account (edge functions)
js/app.js      data layer
js/footer.js   legal links + safety line on every footer
js/notice.js   the "what we store" sentence next to forms
js/affiliate.js  labelled affiliate links (unused until the eBird licence is sorted)
tests/         delete-account.test.ts (deno), legal-circles.ui.mjs (playwright)
scripts/build_brief.mjs  daily brief builder (GitHub Action)
css/style.css
data/mock.js     sample sightings/weather (fallback)
data/passes.js   sample listings
data/feed.js     seed posts
data/challenges.js  learn-five challenges (hand-written)
data/tracks.js   six-month path + specialty tracks (hand-written)
data/pages.js    pages beyond the main tabs (the hub lists these)
tests/learn.test.mjs  Playwright checks for learn.html
```
