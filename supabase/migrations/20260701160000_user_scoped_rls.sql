-- readings を所有者スコープ化する（多重防御）。
-- これまでの「authenticated 全許可」から user_id = auth.uid() 限定に差し替え、
-- 万一サインアップを再度開けても他人のデータが見えないようにする。
-- 既存行は唯一の認証ユーザーへ backfill する（signup OFF の単一ユーザー運用前提）。

alter table public.readings
  add column if not exists user_id uuid references auth.users(id) default auth.uid();

-- 既存行（user_id が NULL）を最古＝本人のユーザーに割り当てる。
update public.readings
   set user_id = (select id from auth.users order by created_at asc limit 1)
 where user_id is null;

-- 以降の insert は default auth.uid() で自動設定されるため NOT NULL を課す。
alter table public.readings alter column user_id set not null;

-- 認証ユーザー全許可 → 自分の行のみに差し替え。
drop policy if exists "authenticated full access" on public.readings;
drop policy if exists "own rows" on public.readings;
create policy "own rows"
  on public.readings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 適用結果を NOTICE で確認（全行が user_id を持つはず）。
do $$
declare total int; withuid int;
begin
  select count(*), count(user_id) into total, withuid from public.readings;
  raise notice 'readings total=% with_user_id=%', total, withuid;
end $$;
