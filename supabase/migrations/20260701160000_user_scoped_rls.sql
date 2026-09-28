-- Scopes readings to their owner (defense in depth).
-- Replaces the previous "allow all authenticated" with user_id = auth.uid() only,
-- so other users' data stays hidden even if sign-up is ever reopened.
-- Existing rows are backfilled to the only authenticated user (assumes single-user operation with signup OFF).

alter table public.readings
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

-- Assign existing rows (user_id NULL) to the oldest user, i.e. the owner.
update public.readings
   set user_id = (select id from auth.users order by created_at asc limit 1)
 where user_id is null;

-- Later inserts are filled by default auth.uid(), so enforce NOT NULL.
alter table public.readings alter column user_id set not null;

-- Replace "allow all authenticated users" with own rows only.
drop policy if exists "authenticated full access" on public.readings;
drop policy if exists "own rows" on public.readings;
create policy "own rows"
  on public.readings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Check the result via NOTICE (every row should have a user_id).
do $$
declare total int; withuid int;
begin
  select count(*), count(user_id) into total, withuid from public.readings;
  raise notice 'readings total=% with_user_id=%', total, withuid;
end $$;
