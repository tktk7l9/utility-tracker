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
