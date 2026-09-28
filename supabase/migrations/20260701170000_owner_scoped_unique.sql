-- Replaces the readings unique constraint with an owner-scoped one.
--
-- The previous unique(utility, period_start, period_end) is globally unique, so
-- once multiple users are allowed it collides with other users' rows for the same period. Also bulkUpsert's
-- ON CONFLICT may fail trying to update another user's row that RLS hides.
-- Change it to unique per owner by including user_id (effectively no change for single-user operation).
--
-- Note: bulkUpsert's onConflict must also match "user_id,utility,period_start,period_end"
--       (src/lib/supabase.ts).

-- Drop the auto-named constraint created by the unique(...) written in the column list of the init migration.
alter table public.readings
  drop constraint if exists readings_utility_period_start_period_end_key;

-- Just in case (if it was created under another name).
alter table public.readings
  drop constraint if exists readings_owner_period_key;

alter table public.readings
  add constraint readings_owner_period_key
  unique (user_id, utility, period_start, period_end);
