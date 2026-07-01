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
  user_id      uuid not null references auth.users(id) default auth.uid(), -- 所有者（RLS）
  created_at   timestamptz not null default now(),
  -- CSV の再取込・重複入力を冪等にするためのユニーク制約（bulkUpsert の onConflict 先）。
  -- user_id を含めて「所有者ごとの一意」にする（グローバル一意だと複数ユーザー時に
  -- 他人の同一期間行と衝突し、upsert が RLS 不可視の行を更新しようとして失敗する）。
  constraint readings_owner_period_key unique (user_id, utility, period_start, period_end)
);

-- 期間終了日での並び替え・絞り込みを高速化。
create index if not exists readings_period_end_idx on public.readings (period_end);
