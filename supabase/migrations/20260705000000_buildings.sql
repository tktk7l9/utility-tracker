-- Introduces management per building (home).
--
-- Adds the buildings table (name + residence period) and scopes readings
-- to a building via building_id. Existing records are backfilled by creating a default building
-- 「サンプルハイツ101（現在）」 per user (the name can be changed in the UI).
--
-- Note: bulkUpsert's onConflict must also match "user_id,building_id,utility,period_start,period_end"
--       (src/lib/supabase.ts).

-- 1) buildings table
create table if not exists public.buildings (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  moved_in_on  date not null,                 -- move-in date
  moved_out_on date,                          -- move-out date (null = current home)
  user_id      uuid not null references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint buildings_period_check check (moved_out_on is null or moved_out_on >= moved_in_on)
);

-- New tables may not be exposed to the Data API without an explicit GRANT, so grant it.
grant select, insert, update, delete on public.buildings to authenticated;

-- 2) RLS (same own-rows policy as readings)
alter table public.buildings enable row level security;
drop policy if exists "own rows" on public.buildings;
create policy "own rows"
  on public.buildings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) readings.building_id (a building that still has records cannot be deleted = restrict)
alter table public.readings
  add column if not exists building_id uuid references public.buildings(id) on delete restrict;

-- 4) backfill: create a default building per user (guarded so re-running does not duplicate it).
--    The move-in date is the oldest existing reading start date (today if none). Editable later in the UI.
insert into public.buildings (name, moved_in_on, user_id)
select 'サンプルハイツ101（現在）',
       coalesce(min(r.period_start), current_date),
       u.id
  from auth.users u
  left join public.readings r on r.user_id = u.id
 where not exists (select 1 from public.buildings b where b.user_id = u.id)
 group by u.id;

-- 5) Link existing readings -> make it NOT NULL
update public.readings r
   set building_id = b.id
  from public.buildings b
 where r.building_id is null
   and b.user_id = r.user_id;

alter table public.readings alter column building_id set not null;

-- 6) Replace the unique constraint with one that includes the building
alter table public.readings drop constraint if exists readings_owner_period_key;
alter table public.readings drop constraint if exists readings_owner_building_period_key;
alter table public.readings
  add constraint readings_owner_building_period_key
  unique (user_id, building_id, utility, period_start, period_end);

-- 7) Index for building filters and FK checks
create index if not exists readings_building_id_idx on public.readings (building_id);

-- 8) Verify (check via NOTICE that nothing was missed by the backfill)
do $$
declare total int; linked int; bcount int;
begin
  select count(*), count(building_id) into total, linked from public.readings;
  select count(*) into bcount from public.buildings;
  raise notice 'readings total=% linked=% buildings=%', total, linked, bcount;
end $$;
