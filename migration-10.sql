-- Daybird migration 10: a person's own photo or drawing for each bird on their list (lifelist.html, "Your birds").
-- Paste into Supabase → SQL Editor (empty editor) → Run. Safe to re-run.
-- Not executed anywhere yet (no local Postgres); re-read for syntax before running. Report problems to Ben.

-- One row per user per species: the public URL of the file in the 'photos' bucket (under the user's own folder),
-- whether it is a photo or a drawing, and an optional one-line caption. Replaces the Wikimedia photo on that
-- person's tiles, detail sheet and share slide; nobody else's pages read it.
create table if not exists public.bird_images (
  user_id uuid not null references auth.users(id) on delete cascade,
  species text not null,
  url text not null,
  kind text not null default 'photo' check (kind in ('photo', 'art')),
  caption text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, species)
);

-- Row-level security: a person reads and writes only their own rows.
alter table public.bird_images enable row level security;

drop policy if exists "bird_images select own" on public.bird_images;
create policy "bird_images select own" on public.bird_images for select using (auth.uid() = user_id);
drop policy if exists "bird_images insert own" on public.bird_images;
create policy "bird_images insert own" on public.bird_images for insert with check (auth.uid() = user_id);
drop policy if exists "bird_images update own" on public.bird_images;
create policy "bird_images update own" on public.bird_images for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "bird_images delete own" on public.bird_images;
create policy "bird_images delete own" on public.bird_images for delete using (auth.uid() = user_id);

-- Removing a bird image also removes the old file. The bucket had read, upload and update policies (schema.sql) but
-- no delete; this one mirrors the upload rule: only inside the owner's folder.
drop policy if exists "photos delete" on storage.objects;
create policy "photos delete" on storage.objects for delete using (bucket_id = 'photos' and auth.uid()::text = (storage.foldername(name))[1]);
