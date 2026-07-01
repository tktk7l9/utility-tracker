// 可視化の心臓部。すべて純関数（副作用なし・入力→出力が決定的）でユニットテスト容易。
// 水道は隔月請求のため、各レコードの金額・使用量をカレンダー月へ「日割り按分」して
// 月次系列に正規化する。これにより積み上げ棒グラフの月合計が正確になる。

import { UTILITY_ORDER, type Reading, type Utility } from "./domain";

const DAY_MS = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" を UTC ミリ秒に。 */
function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "YYYY-MM-DD" → "YYYY-MM"。 */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** "YYYY-MM" → "2026年6月"。 */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${y}年${m}月`;
}

/**
 * 検針期間 [periodStart, periodEnd]（両端含む）が各カレンダー月に何日属するかを返す。
 * end < start（不正）なら空オブジェクト。
 */
export function daysPerMonth(periodStart: string, periodEnd: string): Record<string, number> {
  const start = toUTC(periodStart);
  const end = toUTC(periodEnd);
  const out: Record<string, number> = {};
  if (end < start) return out;
  for (let t = start; t <= end; t += DAY_MS) {
    const dt = new Date(t);
    const key = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export interface MonthlyBucket {
  /** "YYYY-MM"。 */
  month: string;
  /** 各光熱費の金額（円・日割り按分後）。 */
  electricity: number;
  gas: number;
  water: number;
  /** 3社合計金額（円）。 */
  total: number;
  /** 各光熱費の使用量（日割り按分後）。 */
  usage: Record<Utility, number>;
  /**
   * データが存在する全光熱費について、この月がカレンダー全体をカバーしているか。
   * 端の月は部分月（合計が過小）になるため、比較グラフでは trimIncompleteEnds で除ける。
   */
  complete: boolean;
}

function emptyBucket(month: string): MonthlyBucket {
  return {
    month,
    electricity: 0,
    gas: 0,
    water: 0,
    total: 0,
    usage: { electricity: 0, gas: 0, water: 0 },
    complete: true,
  };
}

/** 日付区間（UTCミリ秒・両端含む）をソート＋隣接/重複を結合して返す。 */
export function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + DAY_MS) {
      last[1] = Math.max(last[1], iv[1]);
    } else {
      out.push([iv[0], iv[1]]);
    }
  }
  return out;
}

/** 結合済み区間が "YYYY-MM" の月全体（初日〜末日）を覆っているか。 */
export function monthCovered(coverage: Array<[number, number]>, monthKey: string): boolean {
  const [y, m] = monthKey.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  return coverage.some(([a, b]) => a <= first && b >= last);
}

/**
 * レコード群を月次バケットの昇順配列に集計する。各期間の金額・使用量は日割りで
 * カレンダー月に按分される。
 */
export function toMonthlySeries(readings: Reading[]): MonthlyBucket[] {
  const map = new Map<string, MonthlyBucket>();

  for (const r of readings) {
    const perMonth = daysPerMonth(r.periodStart, r.periodEnd);
    const totalDays = Object.values(perMonth).reduce((a, b) => a + b, 0);
    if (totalDays === 0) continue;

    for (const [month, days] of Object.entries(perMonth)) {
      const weight = days / totalDays;
      const bucket = map.get(month) ?? emptyBucket(month);
      bucket[r.utility] += r.amountYen * weight;
      bucket.total += r.amountYen * weight;
      if (r.usageValue != null) {
        bucket.usage[r.utility] += r.usageValue * weight;
      }
      map.set(month, bucket);
    }
  }

  const sorted = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));

  // 光熱費ごとの検針カバレッジを結合区間として求め、各月の完全性を判定する。
  const coverage = new Map<Utility, Array<[number, number]>>();
  const present = new Set<Utility>();
  for (const r of readings) {
    const s = toUTC(r.periodStart);
    const e = toUTC(r.periodEnd);
    if (e < s) continue;
    present.add(r.utility);
    const arr = coverage.get(r.utility);
    if (arr) arr.push([s, e]);
    else coverage.set(r.utility, [[s, e]]);
  }
  for (const [u, iv] of coverage) coverage.set(u, mergeIntervals(iv));
  for (const bucket of sorted) {
    bucket.complete = [...present].every((u) => monthCovered(coverage.get(u)!, bucket.month));
  }

  return sorted;
}

/**
 * 系列の先頭・末尾から「不完全な月」を取り除く（内側は保持）。データ範囲の端で
 * 部分月になり合計が過小に見えるのを防ぐ。比較系グラフ・総評はこれを通す。
 */
export function trimIncompleteEnds(series: MonthlyBucket[]): MonthlyBucket[] {
  let start = 0;
  let end = series.length;
  while (start < end && !series[start].complete) start++;
  while (end > start && !series[end - 1].complete) end--;
  return series.slice(start, end);
}

/** レコードの実効単価（円/単位）。使用量が未入力または 0 なら null。 */
export function unitPrice(r: Reading): number | null {
  if (r.usageValue == null || r.usageValue === 0) return null;
  return r.amountYen / r.usageValue;
}

export interface UsagePoint {
  /** 検針期間終了月 "YYYY-MM"。 */
  month: string;
  usage: number | null;
  amount: number;
  /** 実効単価（円/単位）。 */
  unitPrice: number | null;
}

/**
 * 特定の光熱費について、レコード単位（按分しない）の使用量・単価系列を
 * 期間終了月の昇順で返す。単価は按分に馴染まないためレコード実額で算出する。
 */
export function usageSeriesFor(readings: Reading[], utility: Utility): UsagePoint[] {
  return readings
    .filter((r) => r.utility === utility)
    .slice()
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .map((r) => ({
      month: monthKeyOf(r.periodEnd),
      usage: r.usageValue,
      amount: r.amountYen,
      unitPrice: unitPrice(r),
    }));
}

/** 月次バケットから値を取り出す関数の型。 */
export type Metric = (b: MonthlyBucket) => number;

export const totalMetric: Metric = (b) => b.total;
export function amountMetric(utility: Utility): Metric {
  return (b) => b[utility];
}

export interface YoYTable {
  /** 対象年（昇順）。 */
  years: string[];
  /** 1..12 月 × 各年の値。recharts のグループ棒に直接渡せる形。 */
  rows: Array<Record<string, number | string>>;
}

/** 月番号（1..12）ごとに、各年の値を横並びにした前年同月比テーブルを作る。 */
export function yoyByMonth(monthly: MonthlyBucket[], metric: Metric): YoYTable {
  const years = Array.from(new Set(monthly.map((b) => b.month.slice(0, 4)))).sort();
  const rows: Array<Record<string, number | string>> = [];
  for (let mn = 1; mn <= 12; mn++) {
    const row: Record<string, number | string> = { monthNum: mn, label: `${mn}月` };
    for (const y of years) row[y] = 0;
    rows.push(row);
  }
  for (const b of monthly) {
    const year = b.month.slice(0, 4);
    const mn = Number(b.month.slice(5, 7));
    rows[mn - 1][year] = (rows[mn - 1][year] as number) + metric(b);
  }
  return { years, rows };
}

export interface SeasonalPoint {
  monthNum: number;
  label: string;
  /** 当該月番号における年跨ぎ平均。 */
  average: number;
  /** 平均に使ったサンプル数。 */
  count: number;
}

/** 月番号ごとの平均（季節性）。データの無い月は average=0, count=0。 */
export function seasonalAverages(monthly: MonthlyBucket[], metric: Metric): SeasonalPoint[] {
  const acc = Array.from({ length: 12 }, () => ({ sum: 0, count: 0 }));
  for (const b of monthly) {
    const mn = Number(b.month.slice(5, 7));
    acc[mn - 1].sum += metric(b);
    acc[mn - 1].count += 1;
  }
  return acc.map((a, i) => ({
    monthNum: i + 1,
    label: `${i + 1}月`,
    average: a.count ? a.sum / a.count : 0,
    count: a.count,
  }));
}

export interface Summary {
  latestMonth: string | null;
  latest: MonthlyBucket | null;
  /** 前年同月のバケット（無ければ null）。 */
  prevYearSameMonth: MonthlyBucket | null;
  /** latest.total − 前年同月.total（前年同月が無ければ null）。 */
  yoyDelta: number | null;
  /** yoyDelta / 前年同月.total（前年同月が 0 または無ければ null）。 */
  yoyPct: number | null;
}

export interface PeriodStats {
  /** 対象月数。 */
  months: number;
  /** 期間の合計支出（円）。 */
  total: number;
  /** 月平均支出（円・月数0なら0）。 */
  average: number;
  /** 合計が最大の月。 */
  maxMonth: MonthlyBucket | null;
  /** 合計が最小の月。 */
  minMonth: MonthlyBucket | null;
}

/** 期間全体の合計・月平均・最高/最低月をまとめる。 */
export function periodStats(monthly: MonthlyBucket[]): PeriodStats {
  if (monthly.length === 0) {
    return { months: 0, total: 0, average: 0, maxMonth: null, minMonth: null };
  }
  let total = 0;
  let maxMonth = monthly[0];
  let minMonth = monthly[0];
  for (const b of monthly) {
    total += b.total;
    if (b.total > maxMonth.total) maxMonth = b;
    if (b.total < minMonth.total) minMonth = b;
  }
  return { months: monthly.length, total, average: total / monthly.length, maxMonth, minMonth };
}

export interface UtilityShare {
  utility: Utility;
  /** 期間の当該光熱費合計（円）。 */
  total: number;
  /** 総支出に占める割合（0..1・総額0なら0）。 */
  share: number;
}

/** 光熱費ごとの期間合計と構成比（ドーナツ・凡例用）。 */
export function utilityShares(monthly: MonthlyBucket[]): UtilityShare[] {
  const totals: Record<Utility, number> = { electricity: 0, gas: 0, water: 0 };
  let grand = 0;
  for (const b of monthly) {
    for (const u of UTILITY_ORDER) totals[u] += b[u];
    grand += b.total;
  }
  return UTILITY_ORDER.map((u) => ({ utility: u, total: totals[u], share: grand ? totals[u] / grand : 0 }));
}

/** 直近月の合計と、前年同月比デルタ・増減率を返す。 */
export function summarize(monthly: MonthlyBucket[]): Summary {
  if (monthly.length === 0) {
    return { latestMonth: null, latest: null, prevYearSameMonth: null, yoyDelta: null, yoyPct: null };
  }
  const latest = monthly[monthly.length - 1];
  const [y, m] = latest.month.split("-").map(Number);
  const prevKey = `${y - 1}-${pad2(m)}`;
  const prev = monthly.find((b) => b.month === prevKey) ?? null;

  const yoyDelta = prev ? latest.total - prev.total : null;
  const yoyPct = prev && prev.total !== 0 ? (latest.total - prev.total) / prev.total : null;

  return {
    latestMonth: latest.month,
    latest,
    prevYearSameMonth: prev,
    yoyDelta,
    yoyPct,
  };
}
