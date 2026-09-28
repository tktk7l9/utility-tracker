-- utility-tracker initial schema + RLS
-- (combines supabase/schema.sql and supabase/rls.sql; applied with supabase db push)

-- utility-tracker: readings table definition.
-- Run in Supabase Dashboard → SQL Editor (before rls.sql).

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
  created_at   timestamptz not null default now(),
  -- Unique constraint that makes CSV re-imports and duplicate entries idempotent (the target of bulkUpsert's onConflict).
  unique (utility, period_start, period_end)
);

-- Speeds up sorting and filtering by period end date.
create index if not exists readings_period_end_idx on public.readings (period_end);

-- utility-tracker: restricts the readings table to authenticated users only.
--
-- ⚠️ Important: until this runs, anyone can read and write with the anon key. Always run it.
--    (lesson from plant-ledger, where forgetting to run rls.sql left anonymous access open)
--
-- How to apply (Supabase Dashboard → SQL Editor):
--   1. Run schema.sql to create the tables.
--   2. Enable Email under Authentication → Providers and
--      turn "Allow new users to sign up" OFF (single-user operation).
--   3. Create your own account under Authentication → Users → Add user.
--   4. Run this SQL.
--   5. Open the app and sign in with your account from the login screen.

alter table public.readings enable row level security;

-- Drop any leftover policies that allow anonymous access.
-- (names differ per project; check with the query below and drop them)
--   select policyname from pg_policies where tablename = 'readings';
drop policy if exists "Enable read access for all users" on public.readings;
drop policy if exists "Enable insert for all users" on public.readings;
drop policy if exists "Enable update for all users" on public.readings;
drop policy if exists "Enable delete for all users" on public.readings;
drop policy if exists "anon full access" on public.readings;

-- Allow all operations to authenticated users only (single-user setup, so no uid restriction needed).
drop policy if exists "authenticated full access" on public.readings;
create policy "authenticated full access"
  on public.readings
  for all
  to authenticated
  using (true)
  with check (true);
