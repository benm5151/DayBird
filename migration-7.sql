-- Daybird migration 7: cache for the weekly news digest (digest edge function).
-- Paste into Supabase → SQL Editor (empty editor) → Run. Needs migration-3.sql (the `usage` table) already run.

-- One finished digest per region per week. region = lat,lng rounded to 0.1° (about 10 km), week = the Monday (YYYY-MM-DD, Eastern).
-- The function builds a digest once (eBird + feeds + OpenAlex + one Claude call) and serves this row to everyone for the rest of the week.
create table if not exists digests (
  region text not null,
  week text not null,
  place text,                        -- the place label shown on the page, e.g. "Lebanon, New Hampshire"
  json jsonb not null,               -- the rendered digest (see supabase/functions/digest/index.ts for the shape)
  created_at timestamptz default now(),
  primary key (region, week)
);
create index if not exists digests_created_at on digests (created_at);

-- Locked down: no client policies. Readers go through the edge function; only the service role touches this table.
alter table digests enable row level security;

-- The Claude spend meter is the `usage` table from migration-3.sql, shared by bird-id, digest (kind = 'digest') and
-- ask (kind = 'ask'). Nothing to create here; do not recreate it.
