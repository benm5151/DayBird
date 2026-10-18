-- Daybird migration 4: bookkeeping for the send-brief function (emailing a brief on demand).
-- Paste into Supabase → SQL Editor (empty editor) → Run.

-- One row per brief emailed. Used for the daily caps and the "one brief per person per day" rule.
-- The recipient's address is never stored: recipient_hash is an HMAC of it, keyed by the UNSUB_SECRET secret.
create table if not exists brief_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  sender_id uuid not null references auth.users(id) on delete cascade,  -- deleting an account removes its rows
  kind text not null check (kind in ('self', 'other')),                  -- self = to your own address, other = to a friend
  recipient_hash text,
  place text,                                                            -- the place label the brief covered
  ok boolean default true
);
create index if not exists brief_sends_created_at on brief_sends (created_at);
create index if not exists brief_sends_sender on brief_sends (sender_id, created_at);
create index if not exists brief_sends_recipient on brief_sends (recipient_hash, created_at);

-- People who clicked "unsubscribe" in a brief a friend sent them. Stored as a hash, same as above.
create table if not exists email_suppressions (
  email_hash text primary key,
  created_at timestamptz default now()
);

-- Locked down: no client policies at all. Only the edge functions (service role) read and write these.
alter table brief_sends enable row level security;
alter table email_suppressions enable row level security;
