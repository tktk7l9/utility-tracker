-- 建物（住まい）ごとの管理を導入する。
--
-- buildings テーブル（名前＋居住期間）を追加し、readings を building_id で
-- 建物スコープ化する。既存レコードはユーザーごとにデフォルト建物
-- 「アルカサーノ永山102（現在）」を作成して backfill する（名前は UI で変更可能）。
--
-- 注意: bulkUpsert の onConflict も "user_id,building_id,utility,period_start,period_end"
--       に合わせること（src/lib/supabase.ts）。

-- 1) buildings テーブル
create table if not exists public.buildings (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  moved_in_on  date not null,                 -- 入居日
  moved_out_on date,                          -- 退去日（null = 現住）
  user_id      uuid not null references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint buildings_period_check check (moved_out_on is null or moved_out_on >= moved_in_on)
);

-- 新規テーブルは明示 GRANT がないと Data API から見えないことがあるため付与する。
grant select, insert, update, delete on public.buildings to authenticated;

-- 2) RLS（readings と同じ own rows 方針）
alter table public.buildings enable row level security;
drop policy if exists "own rows" on public.buildings;
create policy "own rows"
  on public.buildings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) readings.building_id（レコードが残る建物は削除禁止 = restrict）
alter table public.readings
  add column if not exists building_id uuid references public.buildings(id) on delete restrict;

-- 4) backfill: ユーザーごとにデフォルト建物を作成（再実行しても重複しないようガード）。
--    入居日は既存最古の検針開始日（無ければ今日）。後から UI で編集可能。
insert into public.buildings (name, moved_in_on, user_id)
select 'アルカサーノ永山102（現在）',
       coalesce(min(r.period_start), current_date),
       u.id
  from auth.users u
  left join public.readings r on r.user_id = u.id
 where not exists (select 1 from public.buildings b where b.user_id = u.id)
 group by u.id;

-- 5) 既存 readings を紐付け → NOT NULL 化
update public.readings r
   set building_id = b.id
  from public.buildings b
 where r.building_id is null
   and b.user_id = r.user_id;

alter table public.readings alter column building_id set not null;

-- 6) 一意制約を建物込みへ差し替え
alter table public.readings drop constraint if exists readings_owner_period_key;
alter table public.readings drop constraint if exists readings_owner_building_period_key;
alter table public.readings
  add constraint readings_owner_building_period_key
  unique (user_id, building_id, utility, period_start, period_end);

-- 7) 建物フィルタ・FK チェック用インデックス
create index if not exists readings_building_id_idx on public.readings (building_id);

-- 8) 検証（backfill 漏れがないことを NOTICE で確認）
do $$
declare total int; linked int; bcount int;
begin
  select count(*), count(building_id) into total, linked from public.readings;
  select count(*) into bcount from public.buildings;
  raise notice 'readings total=% linked=% buildings=%', total, linked, bcount;
end $$;
