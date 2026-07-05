-- utility-tracker: buildings / readings テーブルを認証済みユーザーのみに制限する。
--
-- ⚠️ 重要: これを実行するまで anon キーで誰でも読み書き可能。必ず実行すること。
--    （plant-ledger では rls.sql の実行を忘れて匿名アクセスが空いていた教訓）
--
-- 適用手順 (Supabase Dashboard → SQL Editor):
--   1. schema.sql を実行してテーブルを作成する。
--   2. Authentication → Providers で Email を有効化し、
--      「Allow new users to sign up」を OFF にする（単一ユーザー運用）。
--   3. Authentication → Users → Add user で自分のアカウントを作成する。
--   4. この SQL を実行する。
--   5. アプリを開き、ログイン画面から自分のアカウントでサインインする。

alter table public.readings enable row level security;

-- 既存の匿名許可ポリシーが残っていれば削除する。
-- (名前はプロジェクトにより異なる。以下で確認して drop する)
--   select policyname from pg_policies where tablename = 'readings';
drop policy if exists "Enable read access for all users" on public.readings;
drop policy if exists "Enable insert for all users" on public.readings;
drop policy if exists "Enable update for all users" on public.readings;
drop policy if exists "Enable delete for all users" on public.readings;
drop policy if exists "anon full access" on public.readings;

-- 自分の行（user_id = auth.uid()）のみ全操作を許可（多重防御）。
-- user_id は schema.sql の default auth.uid() で挿入時に自動設定される。
drop policy if exists "authenticated full access" on public.readings;
drop policy if exists "own rows" on public.readings;
create policy "own rows"
  on public.readings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- buildings も同じ own rows 方針（建物は同一ユーザーの子リソース）。
alter table public.buildings enable row level security;

drop policy if exists "own rows" on public.buildings;
create policy "own rows"
  on public.buildings
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
