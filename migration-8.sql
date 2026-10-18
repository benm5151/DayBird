-- Daybird migration 8: the Premium waitlist (plan.html and route.html → waitlist edge function).
-- Paste into Supabase → SQL Editor (empty editor) → Run. Does not change profiles or any other table.

-- One row per person who asked to hear about Daybird Premium: their address, what they said they would pay, and where they signed up.
-- email_hash is an HMAC of the address keyed by the UNSUB_SECRET secret (same derivation as send-brief) and is the
-- rate-limit key: a second request from the same address updates the row instead of adding one.
create table if not exists waitlist (
  email_hash text primary key,
  email text not null,                                          -- plain address, kept so Ben can send the one launch email
  price text not null default '' check (price in ('3mo', '5mo', '30yr', '')),  -- $3/mo, $5/mo, $30/yr, or "not sure"
  source text,                                                  -- which page the form was on: plan | route
  user_id uuid,                                                 -- set when the person was signed in; null otherwise
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists waitlist_created_at on waitlist (created_at);

-- Locked down: no client policies at all. Only the waitlist edge function (service role) reads and writes it.
alter table waitlist enable row level security;
