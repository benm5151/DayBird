-- Daybird migration 3: spend meter for the photo-ID function. Paste into Supabase → SQL Editor (empty editor) → Run.
create table if not exists usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  user_id uuid,                 -- null for anonymous callers
  kind text not null default 'bird-id',
  model text,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_usd numeric(10,6) default 0,
  ok boolean default true
);
create index if not exists usage_created_at on usage (created_at);
-- Locked down: no client policies at all. Only the edge function (service role) reads/writes it.
alter table usage enable row level security;
