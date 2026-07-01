# 光熱費トラッカー · utility-tracker

[![Keyway Secrets](https://www.keyway.sh/badge.svg?repo=tktk7l9/utility-tracker)](https://www.keyway.sh/vaults/tktk7l9/utility-tracker)

電気 (TEPCO)・ガス (LPIO)・水道 (東京都水道局) の**料金と使用量**を1か所に集約し、
月別推移・使用量/実効単価・前年同月比をグラフで可視化する個人用ダッシュボード。
CSV 取込＋手入力で登録し、Supabase にクラウド同期（PC/スマホから閲覧・入力）。

> メール自動取得は不可（TEPCO の通知メールに金額が載らず、ガス・水道はメール自体が届かない）ため、
> 入力は **CSV 取込 + 手入力** を主軸にしている。

## スタック

Next.js 16 (App Router) / React 19 / TypeScript / Tailwind 4 / shadcn(Radix) /
recharts / Supabase (Postgres + Auth) / Vitest。デプロイは Vercel（`X-Robots-Tag: noindex`）。

## セットアップ

1. 依存インストール

   ```bash
   npm install
   ```

2. Supabase プロジェクトを作成し、Dashboard → SQL Editor で以下を順に実行

   1. `supabase/schema.sql` — `readings` テーブル作成
   2. Authentication → Providers で **Email を有効化**し、「Allow new users to sign up」を **OFF**
   3. Authentication → Users → Add user で自分のアカウントを作成
   4. `supabase/rls.sql` — RLS を有効化（**実行するまで匿名で誰でも読み書き可能**。必須）

3. 環境変数（`.env.local`。Vercel では Project env に設定）

   ```bash
   cp .env.example .env.local
   # NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を記入
   ```

4. 起動

   ```bash
   npm run dev       # http://localhost:3000
   ```

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバ |
| `npm run build` | 本番ビルド（型チェック込み） |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run test:coverage` | カバレッジ（`src/lib/**` は 100% ゲート） |

## データモデル（`readings`）

1行 = 1社・1検針期間の請求。水道は隔月請求のため `period_start`〜`period_end` を保持し、
月次グラフではカレンダー月へ**日割り按分**して合算する。`unique(utility, period_start, period_end)`
により CSV の再取込・重複入力は冪等（`bulkUpsert` が上書きマージ）。

| 列 | 説明 |
| --- | --- |
| `utility` | `electricity` / `gas` / `water` |
| `provider` | 事業者名（種別から既定） |
| `period_start` / `period_end` | 検針期間 |
| `amount_yen` | 税込請求額（円） |
| `usage_value` / `usage_unit` | 使用量（kWh / m³）・単位 |
| `source` | `manual` / `csv` |

## CSV 取込

「入力・管理」タブから CSV をアップロード（文字コードは UTF-8 / Shift_JIS を選択可）。
1行目ヘッダの有無、検針日/期間・金額・使用量の列をマッピングしてプレビュー→取込。
既存と重複する期間は自動でスキップする。主に TEPCO の CSV を想定しているが、
列マッピングにより任意フォーマットに対応できる。ガス・水道は手入力が既定。
