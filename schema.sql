-- Daybird schema. Paste into Supabase → SQL Editor → Run. Safe to re-run.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text, bio text, favorite text, favorite_why text,
  photo_url text, fav_photo_url text,
  life jsonb,                      -- parsed life-list summary from MyEBirdData.csv
  updated_at timestamptz default now()
);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  text text not null default '',
  tags text[] default '{}',
  photo_url text,
  created_at timestamptz default now()
);

create table if not exists likes (
  post_id uuid references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists listings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  title text not null, area text, habitat text[] default '{}', targets text[] default '{}',
  price int default 0, seats int default 6, "window" text, trigger text, host_notes text,
  dates text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  date text not null, seats int default 1,
  created_at timestamptz default now()
);

-- Create a profile row automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, split_part(new.email, '@', 1)) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Row-level security
alter table profiles enable row level security;
alter table posts    enable row level security;
alter table likes    enable row level security;
alter table listings enable row level security;
alter table bookings enable row level security;

drop policy if exists "profiles read"  on profiles; create policy "profiles read"  on profiles for select using (true);
drop policy if exists "profiles write" on profiles; create policy "profiles write" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "posts read"   on posts; create policy "posts read"   on posts for select using (true);
drop policy if exists "posts insert" on posts; create policy "posts insert" on posts for insert with check (auth.uid() = user_id);
drop policy if exists "posts delete" on posts; create policy "posts delete" on posts for delete using (auth.uid() = user_id);

drop policy if exists "likes read"  on likes; create policy "likes read"  on likes for select using (true);
drop policy if exists "likes write" on likes; create policy "likes write" on likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "listings read"  on listings; create policy "listings read"  on listings for select using (true);
drop policy if exists "listings write" on listings; create policy "listings write" on listings for all using (auth.uid() = host_id) with check (auth.uid() = host_id);

drop policy if exists "bookings own" on bookings; create policy "bookings own" on bookings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- hosts can see bookings on their own listings
drop policy if exists "bookings host read" on bookings;
create policy "bookings host read" on bookings for select using (exists (select 1 from listings l where l.id = listing_id and l.host_id = auth.uid()));

-- Public photo bucket
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists "photos read"   on storage.objects; create policy "photos read"   on storage.objects for select using (bucket_id = 'photos');
drop policy if exists "photos upload" on storage.objects; create policy "photos upload" on storage.objects for insert with check (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "photos update" on storage.objects; create policy "photos update" on storage.objects for update using (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
