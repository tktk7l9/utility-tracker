// The heart of the visualizations. All pure functions (no side effects, deterministic input -> output), easy to unit test.
// Water is billed bimonthly, so each record's amount and usage are prorated by day across calendar months
// to normalize into a monthly series. This keeps the monthly totals of the stacked bar chart accurate.

import { UTILITY_ORDER, type Reading, type Utility } from "./domain";

const DAY_MS = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" to UTC milliseconds. */
function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** "YYYY-MM-DD" -> "YYYY-MM". */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** "YYYY-MM" -> "2026年6月". */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${y}年${m}月`;
}

/**
 * Returns how many days of the reading period [periodStart, periodEnd] (inclusive) fall in each calendar month.
 * Returns an empty object when end < start (invalid).
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
  /** "YYYY-MM". */
  month: string;
  /** Amount per utility (yen, after daily proration). */
  electricity: number;
  gas: number;
  water: number;
  /** Total amount across the three utilities (yen). */
  total: number;
  /** Usage per utility (after daily proration). */
  usage: Record<Utility, number>;
  /**
   * Whether every utility that has data covers this whole calendar month.
   * Edge months are partial (totals understated), so comparison charts drop them with trimIncompleteEnds.
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

/** Sorts date intervals (UTC ms, inclusive) and merges adjacent/overlapping ones. */
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

/** Whether the merged intervals cover the whole "YYYY-MM" month (first to last day). */
export function monthCovered(coverage: Array<[number, number]>, monthKey: string): boolean {
  const [y, m] = monthKey.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  return coverage.some(([a, b]) => a <= first && b >= last);
}

/** Whether the merged intervals overlap the "YYYY-MM" month by at least one day (partial contact included). */
export function monthOverlaps(coverage: Array<[number, number]>, monthKey: string): boolean {
  const [y, m] = monthKey.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  return coverage.some(([a, b]) => a <= last && b >= first);
}

/** The day after "YYYY-MM-DD". */
function nextDay(iso: string): string {
  const dt = new Date(toUTC(iso) + DAY_MS);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * Aggregates records into an ascending array of monthly buckets. Each period's amount and usage
 * are prorated by day across calendar months.
 */
export function toMonthlySeries(readings: Reading[]): MonthlyBucket[] {
  const map = new Map<string, MonthlyBucket>();
  // When one period's end date equals the next period's start date (bills split on the reading date, like LPIO),
  // count that day only in the earlier period. Counting it in both prorates two bills onto the boundary day and skews the monthly split.
  const periodEnds = new Set(readings.map((r) => `${r.buildingId}|${r.utility}|${r.periodEnd}`));

  for (const r of readings) {
    const sharesStart = r.periodStart < r.periodEnd && periodEnds.has(`${r.buildingId}|${r.utility}|${r.periodStart}`);
    const perMonth = daysPerMonth(sharesStart ? nextDay(r.periodStart) : r.periodStart, r.periodEnd);
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

  // Compute each utility's reading coverage as merged intervals and judge whether each month is complete.
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
  // Require full coverage only from utilities whose reading periods overlap that month.
  // Utilities with no reading yet (i.e. not overlapping that month) are treated as not-present,
  // so different billing cycles (e.g. electricity monthly / water bimonthly) do not mark the latest month incomplete and trim it.
  for (const bucket of sorted) {
    bucket.complete = [...present].every((u) => {
      const cov = coverage.get(u)!;
      return !monthOverlaps(cov, bucket.month) || monthCovered(cov, bucket.month);
    });
  }

  return sorted;
}

/**
 * Removes incomplete months from the start and end of the series (inner months are kept). Prevents
 * partial months at the edges of the data from looking understated. Comparison charts and the summary go through this.
 */
export function trimIncompleteEnds(series: MonthlyBucket[]): MonthlyBucket[] {
  let start = 0;
  let end = series.length;
  while (start < end && !series[start].complete) start++;
  while (end > start && !series[end - 1].complete) end--;
  return series.slice(start, end);
}

/** Effective unit price of a record (yen/unit). null when usage is missing or 0. */
export function unitPrice(r: Reading): number | null {
  if (r.usageValue == null || r.usageValue === 0) return null;
  return r.amountYen / r.usageValue;
}

export interface UsagePoint {
  /** Month the reading period ends, "YYYY-MM". */
  month: string;
  usage: number | null;
  amount: number;
  /** Effective unit price (yen/unit). */
  unitPrice: number | null;
}

/**
 * For one utility, returns the per-record (not prorated) usage and unit price series
 * in ascending order of period end month. Unit prices do not prorate well, so they use the record's actual amounts.
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

/** Type of a function that extracts a value from a monthly bucket. */
export type Metric = (b: MonthlyBucket) => number;

export const totalMetric: Metric = (b) => b.total;
export function amountMetric(utility: Utility): Metric {
  return (b) => b[utility];
}

export interface YoYRow {
  monthNum: number;
  label: string;
  /** Value for the base year, or null when that month has no data. */
  current: number | null;
  /** Value for the year before, or null when that month has no data. */
  previous: number | null;
  /** current - previous, only when both exist. */
  delta: number | null;
  /** delta / previous, only when both exist and previous is not zero. */
  deltaPct: number | null;
}

export interface YoYComparison {
  /** Years that have data, ascending. */
  years: string[];
  /** Base year ("this year"); null when there is no data. */
  current: string | null;
  /** The year before the base year when it has data, else null. */
  previous: string | null;
  /** Months 1..12. */
  rows: YoYRow[];
}

/**
 * Compare one year with the year before, month by month. Only two series, so the chart
 * can tell them apart by shape (filled vs outlined) rather than by shades of one hue
 * (SHIG 96). Missing months stay null so they are not drawn as a real zero.
 */
export function yearOverYear(monthly: MonthlyBucket[], metric: Metric, baseYear?: string): YoYComparison {
  const byYear = new Map<string, Array<number | null>>();
  for (const b of monthly) {
    const year = b.month.slice(0, 4);
    const mn = Number(b.month.slice(5, 7));
    let slots = byYear.get(year);
    if (!slots) {
      slots = Array.from({ length: 12 }, () => null);
      byYear.set(year, slots);
    }
    slots[mn - 1] = (slots[mn - 1] ?? 0) + metric(b);
  }
  const years = Array.from(byYear.keys()).sort();
  const current = baseYear && byYear.has(baseYear) ? baseYear : (years[years.length - 1] ?? null);
  const prevKey = current ? String(Number(current) - 1) : null;
  const previous = prevKey && byYear.has(prevKey) ? prevKey : null;
  const cur = current ? byYear.get(current) : undefined;
  const prev = previous ? byYear.get(previous) : undefined;

  const rows: YoYRow[] = [];
  for (let i = 0; i < 12; i++) {
    const c = cur?.[i] ?? null;
    const p = prev?.[i] ?? null;
    const delta = c !== null && p !== null ? c - p : null;
    rows.push({
      monthNum: i + 1,
      label: `${i + 1}月`,
      current: c,
      previous: p,
      delta,
      deltaPct: delta !== null && p ? delta / p : null,
    });
  }
  return { years, current, previous, rows };
}

export interface YoYTotals {
  /** Number of months that have data in both years. */
  months: number;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
}

/** Totals over the months both years share, for a one-line text summary. Null when none. */
export function yoyTotals(rows: YoYRow[]): YoYTotals | null {
  const both = rows.filter((r) => r.delta !== null);
  if (both.length === 0) return null;
  const current = both.reduce((s, r) => s + (r.current as number), 0);
  const previous = both.reduce((s, r) => s + (r.previous as number), 0);
  const delta = current - previous;
  return { months: both.length, current, previous, delta, deltaPct: previous ? delta / previous : null };
}

/**
 * Where to put the labels of two horizontal reference lines so they never overlap:
 * the higher line's label goes above it, the lower one's below it (SHIG 75).
 */
export function refLabelSides(a: number, b: number): ["above" | "below", "above" | "below"] {
  return a >= b ? ["above", "below"] : ["below", "above"];
}

export interface SeasonalPoint {
  monthNum: number;
  label: string;
  /** Average across years for this month number. */
  average: number;
  /** Number of samples used for the average. */
  count: number;
}

/** Average per month number (seasonality). Months without data have average=0, count=0. */
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
  /** Bucket for the same month last year (null if none). */
  prevYearSameMonth: MonthlyBucket | null;
  /** latest.total - same month last year's total (null if there is no such month). */
  yoyDelta: number | null;
  /** yoyDelta / same month last year's total (null if that month is 0 or missing). */
  yoyPct: number | null;
}

export interface PeriodStats {
  /** Number of months covered. */
  months: number;
  /** Total spending over the period (yen). */
  total: number;
  /** Average monthly spending (yen; 0 when there are no months). */
  average: number;
  /** Month with the highest total. */
  maxMonth: MonthlyBucket | null;
  /** Month with the lowest total. */
  minMonth: MonthlyBucket | null;
}

/** Summarizes the total, monthly average, and highest/lowest months for the whole period. */
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
  /** This utility's total over the period (yen). */
  total: number;
  /** Share of total spending (0..1; 0 when the total is 0). */
  share: number;
}

/** Period total and share per utility (for the donut and legend). */
export function utilityShares(monthly: MonthlyBucket[]): UtilityShare[] {
  const totals: Record<Utility, number> = { electricity: 0, gas: 0, water: 0 };
  let grand = 0;
  for (const b of monthly) {
    for (const u of UTILITY_ORDER) totals[u] += b[u];
    grand += b.total;
  }
  return UTILITY_ORDER.map((u) => ({ utility: u, total: totals[u], share: grand ? totals[u] / grand : 0 }));
}

/** Returns the latest month's total with the year-over-year delta and rate of change. */
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
