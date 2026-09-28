// Default billing period for manual entry (SHIG 14 precomputation / 42 good defaults).
// Pure date arithmetic on YYYY-MM-DD strings (UTC, so no DST/timezone drift).

import type { Reading } from "./domain";

export interface Period {
  periodStart: string;
  periodEnd: string;
}

type PeriodLike = Pick<Reading, "utility" | "periodStart" | "periodEnd" | "buildingId">;

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Last day of month `month0` (may overflow into later years) as a UTC timestamp. */
function lastDayOf(year: number, month0: number): number {
  return Date.UTC(year, month0 + 1, 0);
}

/** First to last day of the month containing `today` (local date). */
export function currentMonthPeriod(today: Date): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  return { periodStart: toIso(Date.UTC(y, m, 1)), periodEnd: toIso(lastDayOf(y, m)) };
}

/**
 * Suggests the next billing period for a utility: it starts the day after the latest
 * record ends (or on that day when the bills share boundary days) and has the same
 * length. Calendar-month records keep their month count (water is billed every two
 * months). Without a prior record, the current month.
 */
export function suggestPeriod(
  readings: PeriodLike[],
  utility: PeriodLike["utility"],
  today: Date,
  buildingId?: string | null
): Period {
  const own = readings
    .filter((r) => r.utility === utility && (!buildingId || r.buildingId === buildingId))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const latest = own.at(-1);
  if (!latest) return currentMonthPeriod(today);

  const start = new Date(toUtc(latest.periodStart));
  const end = new Date(toUtc(latest.periodEnd));
  const nextStart = end.getTime() + DAY_MS;
  const isCalendarMonths =
    start.getUTCDate() === 1 && nextStart === Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1);
  if (isCalendarMonths) {
    const months =
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
    const next = new Date(nextStart);
    return {
      periodStart: toIso(nextStart),
      periodEnd: toIso(lastDayOf(next.getUTCFullYear(), next.getUTCMonth() + months - 1)),
    };
  }
  // Bills split by meter-reading date share the boundary day (06-04〜07-06, 07-06〜08-06).
  const sharesBoundary = own.at(-2)?.periodEnd === latest.periodStart;
  const from = sharesBoundary ? end.getTime() : nextStart;
  return { periodStart: toIso(from), periodEnd: toIso(from + (end.getTime() - start.getTime())) };
}
