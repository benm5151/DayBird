-- Daybird migration 5: the subscriber list, the daily email run log and open/click events.
-- Paste into Supabase → SQL Editor (empty editor) → Run. Needs nothing from migration-4 but lives alongside it.

-- People who asked for the morning brief by email (signup.html), one row per address.
-- This table holds the REAL email address, because the daily send has to put it in the "to" field; there is no
-- way around that. Everything else about the person is the minimum the brief needs: a location rounded to two
-- decimals (about 1 km), a place label they chose, and three preferences. email_hash is HMAC(UNSUB_SECRET, address),
-- the same derivation send-brief uses, so other tables and logs can refer to a person without holding the address.
-- Rows start as 'pending' and become 'active' only when the person clicks the confirm link we emailed (double opt-in).
-- 'unsubscribed' rows are kept so a re-subscribe is a plain update and the stats page can count opt-outs.
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_hash text not null unique,
  lat double precision not null,
  lng double precision not null,
  place text not null default 'your area',
  mode text not null default 'any',
  level text not null default 'new',
  go_only boolean not null default false,                        -- true = only email on GO mornings
  status text not null default 'pending' check (status in ('pending', 'active', 'unsubscribed')),
  confirm_token_hash text,                                       -- HMAC of the one-time confirm token; cleared once used
  confirm_sent_at timestamptz,                                   -- throttles repeat confirm emails
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);
create index if not exists subscribers_status on subscribers (status);
create index if not exists subscribers_confirm on subscribers (confirm_token_hash);

-- One row per calendar day (Eastern) the daily send ran. The primary key is the lock: send-daily inserts the row
-- first and stops if the insert conflicts, so a second call the same morning sends nothing.
create table if not exists daily_runs (
  date date primary key,
  sent int not null default 0,
  skipped int not null default 0,                                -- GO-only subscribers on a non-GO morning, plus caps
  errors text,                                                   -- provider or data failures, newline separated
  created_at timestamptz default now(),
  finished_at timestamptz
);

-- Opens and clicks from the daily email, recorded by the track function. Deliberately thin: who (subscriber id),
-- which day's email, open or click, and for clicks only the host of the link (ebird.org, birdcast.info ...).
-- No IP address, no user agent, no full URL.
create table if not exists email_events (
  id bigserial primary key,
  subscriber_id uuid not null references subscribers(id) on delete cascade,  -- deleting a subscriber removes their events
  date date not null,
  kind text not null check (kind in ('open', 'click')),
  host text,
  created_at timestamptz default now()
);
create index if not exists email_events_date on email_events (date, kind);
create index if not exists email_events_subscriber on email_events (subscriber_id, date, kind);

-- Locked down: row level security on, and no policies at all, so the anon and authenticated roles can neither read
-- nor write these tables from the browser. Only the edge functions, which use the service role key, touch them.
-- That is what keeps the plain addresses in `subscribers` out of reach of anyone who finds the public anon key.
alter table subscribers enable row level security;
alter table daily_runs enable row level security;
alter table email_events enable row level security;
