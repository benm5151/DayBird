-- Daybird migration 2: comments, private listing locations, host bookings view, cancellations.
-- Paste into Supabase → SQL Editor (empty editor) → Run. Safe to re-run.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz default now()
);
alter table comments enable row level security;
drop policy if exists "comments read"   on comments; create policy "comments read"   on comments for select using (true);
drop policy if exists "comments insert" on comments; create policy "comments insert" on comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments delete" on comments; create policy "comments delete" on comments for delete using (auth.uid() = user_id);

-- Exact location lives in its own table so the public listing never leaks it.
create table if not exists listing_private (
  listing_id uuid primary key references listings(id) on delete cascade,
  host_id uuid not null references profiles(id) on delete cascade,
  location text,        -- address or what3words / coordinates
  directions text       -- parking, gate code, where to meet
);
alter table listing_private enable row level security;
drop policy if exists "private host" on listing_private;
create policy "private host" on listing_private for all using (auth.uid() = host_id) with check (auth.uid() = host_id);
drop policy if exists "private booked" on listing_private;
create policy "private booked" on listing_private for select
  using (exists (select 1 from bookings b where b.listing_id = listing_private.listing_id and b.user_id = auth.uid()));

-- Hosts need to see who booked (name), so allow reading the booker's profile name (profiles are already public-read).
-- Bookings: owner can delete (cancel) — covered by "bookings own" for all. Hosts can read — already added.

-- Posts: allow owners to update (edit) too.
drop policy if exists "posts update" on posts; create policy "posts update" on posts for update using (auth.uid() = user_id);
