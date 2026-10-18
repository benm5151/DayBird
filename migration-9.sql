-- Daybird migration 9: waiver acceptance timestamps and private friend circles.
-- Paste into Supabase → SQL Editor (empty editor) → Run. Safe to re-run.
-- Not executed anywhere yet (no local Postgres); re-read for syntax before running. Report problems to Ben.

-- ---------------------------------------------------------------- waivers
-- When a guest ticked "I accept the guest waiver" while booking, and when a host ticked the host agreement while listing.
alter table bookings add column if not exists waiver_accepted_at timestamptz;
alter table listings add column if not exists host_waiver_accepted_at timestamptz;

-- ---------------------------------------------------------------- friend circles
create extension if not exists pgcrypto;   -- gen_random_bytes for invite codes (already on in Supabase; harmless if so)

-- Six characters from an alphabet without 0/O, 1/I/L, so a code read out loud or typed from a text survives.
create or replace function public.new_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(6);
  code text := '';
  i int;
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return code;
end $$;

-- A private group of friends. Nobody outside it can see it; the invite code is the only way in.
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  owner_id uuid not null references profiles(id) on delete cascade,
  invite_code text not null unique default public.new_invite_code(),
  created_at timestamptz default now()
);

-- Who is in which circle. The owner is added on creation; everyone else joins by code through join_circle().
create table if not exists circle_members (
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (circle_id, user_id)
);

-- One line per member per morning: the call they went out on, where, and a short note. One row per person per day per circle.
create table if not exists circle_mornings (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  word text not null check (word in ('GO', 'MAYBE', 'STAY')),
  note text check (note is null or length(note) <= 140),
  spot text check (spot is null or length(spot) <= 80),
  created_at timestamptz default now(),
  unique (circle_id, user_id, date)
);
create index if not exists circle_mornings_circle_date on circle_mornings (circle_id, date);

-- Membership check that bypasses RLS, so policies on circle_members can ask about circle_members without recursing.
create or replace function public.is_circle_member(p_circle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from circle_members m where m.circle_id = p_circle and m.user_id = auth.uid());
$$;

-- Creates a circle and puts the caller in it, in one step.
create or replace function public.create_circle(p_name text) returns circles
language plpgsql volatile security definer set search_path = public as $$
declare
  c circles;
  attempts int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in to create a circle.'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Give the circle a name.'; end if;
  loop
    begin
      insert into circles (name, owner_id) values (left(trim(p_name), 60), auth.uid()) returning * into c;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts >= 5 then raise exception 'Could not make an invite code. Try again.'; end if;
    end;
  end loop;
  insert into circle_members (circle_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

-- Joins by invite code. Runs with the function owner's rights so the client never needs read access to codes
-- it does not know; a wrong code just fails, and there is no way to list codes.
create or replace function public.join_circle(p_code text) returns circles
language plpgsql volatile security definer set search_path = public as $$
declare
  c circles;
begin
  if auth.uid() is null then raise exception 'Sign in to join a circle.'; end if;
  select * into c from circles where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception 'No circle has that code. Check it and try again.'; end if;
  insert into circle_members (circle_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return c;
end $$;

revoke all on function public.new_invite_code() from public;
revoke all on function public.is_circle_member(uuid) from public;
revoke all on function public.create_circle(text) from public;
revoke all on function public.join_circle(text) from public;
grant execute on function public.is_circle_member(uuid) to authenticated;
grant execute on function public.create_circle(text) to authenticated;
grant execute on function public.join_circle(text) to authenticated;

-- Row-level security: members read their circles; owners delete theirs; nobody inserts memberships directly.
alter table circles enable row level security;
alter table circle_members enable row level security;
alter table circle_mornings enable row level security;

drop policy if exists "circles member read" on circles;
create policy "circles member read" on circles for select using (public.is_circle_member(id));
drop policy if exists "circles owner delete" on circles;
create policy "circles owner delete" on circles for delete using (auth.uid() = owner_id);
drop policy if exists "circles owner update" on circles;
create policy "circles owner update" on circles for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "members read" on circle_members;
create policy "members read" on circle_members for select using (public.is_circle_member(circle_id));
drop policy if exists "members leave" on circle_members;
create policy "members leave" on circle_members for delete using (auth.uid() = user_id);

drop policy if exists "mornings read" on circle_mornings;
create policy "mornings read" on circle_mornings for select using (public.is_circle_member(circle_id));
drop policy if exists "mornings insert" on circle_mornings;
create policy "mornings insert" on circle_mornings for insert with check (auth.uid() = user_id and public.is_circle_member(circle_id));
drop policy if exists "mornings update own" on circle_mornings;
create policy "mornings update own" on circle_mornings for update using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_circle_member(circle_id));
drop policy if exists "mornings delete own" on circle_mornings;
create policy "mornings delete own" on circle_mornings for delete using (auth.uid() = user_id);
