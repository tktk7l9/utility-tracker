-- readings の一意制約を所有者スコープへ差し替える。
--
-- これまでの unique(utility, period_start, period_end) はグローバル一意のため、
-- 複数ユーザーを許した場合に他人の同一期間行と衝突する。さらに bulkUpsert の
-- ON CONFLICT が RLS で不可視な他人の行を更新しようとして失敗しうる。
-- user_id を含めた「所有者ごとの一意」に変更する（単一ユーザー運用では実質無変更）。
--
-- 注意: bulkUpsert の onConflict も "user_id,utility,period_start,period_end" に合わせること
--       （src/lib/supabase.ts）。

-- init マイグレーションでインラインの unique(...) が付けた自動命名の制約を落とす。
alter table public.readings
  drop constraint if exists readings_utility_period_start_period_end_key;

-- 念のため（別名で作られていた場合）。
alter table public.readings
  drop constraint if exists readings_owner_period_key;

alter table public.readings
  add constraint readings_owner_period_key
  unique (user_id, utility, period_start, period_end);
