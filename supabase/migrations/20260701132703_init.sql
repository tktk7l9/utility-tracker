-- utility-tracker 初期スキーマ + RLS
-- (supabase/schema.sql と supabase/rls.sql を統合。supabase db push で適用)

-- utility-tracker: readings テーブル定義。
-- Supabase Dashboard → SQL Editor で実行する（rls.sql より先に実行）。

create table if not exists public.readings (
  id           uuid primary key default gen_random_uuid(),
  utility      text not null check (utility in ('electricity','gas','water')),
  provider     text not null,                  -- 'TEPCO' | 'LPIO' | 'TokyoWaterworks' 等
  period_start date not null,
  period_end   date not null,
  amount_yen   integer not null,               -- 税込請求額（円）
  usage_value  numeric,                        -- kWh / m³（金額のみ既知なら null）
  usage_unit   text,                           -- 'kWh' | 'm3' | '㎥'
  note         text,
  source       text not null default 'manual', -- 'manual' | 'csv'
  created_at   timestamptz not null default now(),
  -- CSV の再取込・重複入力を冪等にするためのユニーク制約（bulkUpsert の onConflict 先）。
  unique (utility, period_start, period_end)
);

-- 期間終了日での並び替え・絞り込みを高速化。
create index if not exists readings_period_end_idx on public.readings (period_end);

-- utility-tracker: readings テーブルを認証済みユーザーのみに制限する。
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

-- 認証済みユーザーのみ全操作を許可（単一ユーザー前提のため uid 制限は不要）。
drop policy if exists "authenticated full access" on public.readings;
create policy "authenticated full access"
  on public.readings
  for all
  to authenticated
  using (true)
  with check (true);
