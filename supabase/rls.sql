-- utility-tracker: restricts the buildings / readings tables to authenticated users only.
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

-- Allow all operations only on your own rows (user_id = auth.uid()) (defense in depth).
-- user_id is set automatically on insert by default auth.uid() in schema.sql.
drop policy if exists "authenticated full access" on public.readings;
drop policy if exists "own rows" on public.readings;
create policy "own rows"
  on public.readings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- buildings follows the same own-rows policy (a building is a child resource of the same user).
alter table public.buildings enable row level security;

drop policy if exists "own rows" on public.buildings;
create policy "own rows"
  on public.buildings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
