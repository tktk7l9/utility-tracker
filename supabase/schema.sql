-- utility-tracker: buildings / readings table definitions.
-- Run in Supabase Dashboard → SQL Editor (before rls.sql).
-- Create buildings before readings (readings references buildings).

-- Buildings (homes). The residence period (moved_in_on to moved_out_on) doubles as the moving record.
create table if not exists public.buildings (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  moved_in_on  date not null,                 -- move-in date
  moved_out_on date,                          -- move-out date (null = current home)
  user_id      uuid not null references auth.users(id) default auth.uid(), -- owner (RLS)
  created_at   timestamptz not null default now(),
  constraint buildings_period_check check (moved_out_on is null or moved_out_on >= moved_in_on)
);

-- New tables may not be exposed to the Data API without an explicit GRANT, so grant it.
grant select, insert, update, delete on public.buildings to authenticated;

create table if not exists public.readings (
  id           uuid primary key default gen_random_uuid(),
  utility      text not null check (utility in ('electricity','gas','water')),
  provider     text not null,                  -- 'TEPCO' | 'LPIO' | 'TokyoWaterworks' etc.
  period_start date not null,
  period_end   date not null,
  amount_yen   integer not null,               -- billed amount including tax (yen)
  usage_value  numeric,                        -- kWh / m³ (null when only the amount is known)
  usage_unit   text,                           -- 'kWh' | 'm3' | '㎥'
  note         text,
  source       text not null default 'manual', -- 'manual' | 'csv'
  -- Building scope. A building that still has records cannot be deleted (restrict).
  building_id  uuid not null references public.buildings(id) on delete restrict,
  user_id      uuid not null references auth.users(id) default auth.uid(), -- owner (RLS)
  created_at   timestamptz not null default now(),
  -- Unique constraint that makes CSV re-imports and duplicate entries idempotent (the target of bulkUpsert's onConflict).
  -- Including user_id makes it unique per owner (a global unique key would, with multiple users,
  -- collide with other users' rows for the same period, and upsert would fail trying to update rows hidden by RLS).
  -- Including building_id makes it unique per building (different buildings can share the same period).
  constraint readings_owner_building_period_key
    unique (user_id, building_id, utility, period_start, period_end)
);

-- Speeds up sorting and filtering by period end date.
create index if not exists readings_period_end_idx on public.readings (period_end);
-- Speeds up building filters and FK checks.
create index if not exists readings_building_id_idx on public.readings (building_id);
