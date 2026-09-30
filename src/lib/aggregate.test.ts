import { describe, it, expect } from "vitest";
import type { Reading } from "./domain";
import {
  monthKeyOf,
  monthLabel,
  daysPerMonth,
  toMonthlySeries,
  trimIncompleteEnds,
  mergeIntervals,
  monthCovered,
  monthOverlaps,
  unitPrice,
  usageSeriesFor,
  yearOverYear,
  refLabelSides,
  yoyTotals,
  seasonalAverages,
  summarize,
  missingUtilities,
  periodStats,
  utilityShares,
  totalMetric,
  amountMetric,
  type MonthlyBucket,
} from "./aggregate";

function reading(p: Partial<Reading>): Reading {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    utility: p.utility ?? "electricity",
    buildingId: p.buildingId ?? "b1",
    provider: p.provider ?? "TEPCO",
    periodStart: p.periodStart ?? "2026-06-01",
    periodEnd: p.periodEnd ?? "2026-06-30",
    amountYen: p.amountYen ?? 3000,
    usageValue: "usageValue" in p ? (p.usageValue as number | null) : 100,
    usageUnit: p.usageUnit ?? "kWh",
    note: p.note ?? null,
    source: p.source ?? "manual",
  };
}

function bucket(month: string, total: number, parts?: Partial<MonthlyBucket>): MonthlyBucket {
  return {
    month,
    electricity: parts?.electricity ?? total,
    gas: parts?.gas ?? 0,
    water: parts?.water ?? 0,
    total,
    usage: parts?.usage ?? { electricity: 0, gas: 0, water: 0 },
    complete: parts?.complete ?? true,
  };
}

describe("date helpers", () => {
  it("monthKeyOf extracts YYYY-MM", () => {
    expect(monthKeyOf("2026-06-19")).toBe("2026-06");
  });
  it("monthLabel uses the Japanese-style label", () => {
    expect(monthLabel("2026-06")).toBe("2026年6月");
  });
});

describe("daysPerMonth", () => {
  it("returns the day count as is for a single month", () => {
    expect(daysPerMonth("2026-06-01", "2026-06-30")).toEqual({ "2026-06": 30 });
  });
  it("splits into per-month day counts for proration across months", () => {
    expect(daysPerMonth("2026-05-20", "2026-06-19")).toEqual({ "2026-05": 12, "2026-06": 19 });
  });
  it("returns empty when the end date is before the start date", () => {
    expect(daysPerMonth("2026-07-10", "2026-07-01")).toEqual({});
  });
});

describe("toMonthlySeries", () => {
  it("returns an empty series for an empty array", () => {
    expect(toMonthlySeries([])).toEqual([]);
  });

  it("books a single-month record in full without proration", () => {
    const series = toMonthlySeries([reading({ amountYen: 3000, usageValue: 100 })]);
    expect(series).toHaveLength(1);
    expect(series[0].month).toBe("2026-06");
    expect(series[0].electricity).toBe(3000);
    expect(series[0].total).toBe(3000);
    expect(series[0].usage.electricity).toBe(100);
  });

  it("prorates bimonthly records by day and sums per month", () => {
    const series = toMonthlySeries([
      reading({ utility: "electricity", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountYen: 3000, usageValue: 100 }),
      reading({ utility: "water", periodStart: "2026-05-20", periodEnd: "2026-06-19", amountYen: 6200, usageValue: 24, usageUnit: "m³" }),
    ]);
    expect(series.map((b) => b.month)).toEqual(["2026-05", "2026-06"]);

    const may = series[0];
    expect(may.water).toBeCloseTo(2400, 6); // 6200 * 12/31
    expect(may.electricity).toBe(0);
    expect(may.total).toBeCloseTo(2400, 6);
    expect(may.usage.water).toBeCloseTo((24 * 12) / 31, 6);

    const jun = series[1];
    expect(jun.electricity).toBe(3000);
    expect(jun.water).toBeCloseTo(3800, 6); // 6200 * 19/31
    expect(jun.total).toBeCloseTo(6800, 6);
    expect(jun.usage.electricity).toBe(100);
  });

  it("books only the amount when usage is null and keeps usage at 0", () => {
    const series = toMonthlySeries([
      reading({ periodStart: "2026-08-01", periodEnd: "2026-08-31", amountYen: 2000, usageValue: null }),
    ]);
    expect(series[0].electricity).toBe(2000);
    expect(series[0].usage.electricity).toBe(0);
  });

  it("ignores records with an invalid period (end < start)", () => {
    const series = toMonthlySeries([
      reading({ utility: "gas", periodStart: "2026-07-10", periodEnd: "2026-07-01", amountYen: 1000, usageValue: 5 }),
    ]);
    expect(series).toEqual([]);
  });

  it("counts a shared boundary day only in the earlier period (the amount is preserved)", () => {
    const series = toMonthlySeries([
      reading({ utility: "gas", periodStart: "2026-06-04", periodEnd: "2026-07-06", amountYen: 3300, usageValue: 33, usageUnit: "m³" }),
      reading({ utility: "gas", periodStart: "2026-07-06", periodEnd: "2026-08-06", amountYen: 3100, usageValue: 31, usageUnit: "m³" }),
    ]);
    expect(series.map((b) => b.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    // Before: 33 days 6/4-7/6 (27 in June, 6 in July). After: 31 days 7/7-8/6 excluding the boundary day 7/6 (25 in July, 6 in August).
    expect(series[0].gas).toBeCloseTo(2700, 6); // 3300 * 27/33
    expect(series[1].gas).toBeCloseTo(3100, 6); // 3300 * 6/33 + 3100 * 25/31
    expect(series[2].gas).toBeCloseTo(600, 6); // 3100 * 6/31
    expect(series[1].usage.gas).toBeCloseTo(31, 6); // 33 * 6/33 + 31 * 25/31
    expect(series.reduce((sum, b) => sum + b.gas, 0)).toBeCloseTo(6400, 6);
  });

  it("counts each period as is when the boundary day is shared but the building or utility differs", () => {
    const series = toMonthlySeries([
      reading({ utility: "gas", buildingId: "b1", periodStart: "2026-06-04", periodEnd: "2026-07-06", amountYen: 3300 }),
      reading({ utility: "gas", buildingId: "b2", periodStart: "2026-07-06", periodEnd: "2026-08-06", amountYen: 3200 }),
      reading({ utility: "water", buildingId: "b1", periodStart: "2026-07-06", periodEnd: "2026-08-06", amountYen: 3200 }),
    ]);
    // Prorated over the 32 days 7/6-8/6 (26 in July, 6 in August).
    expect(series[2].gas).toBeCloseTo(600, 6); // 3200 * 6/32
    expect(series[2].water).toBeCloseTo(600, 6);
  });

  it("keeps a one-day period even on a shared boundary (so its amount is not lost)", () => {
    const series = toMonthlySeries([
      reading({ utility: "gas", periodStart: "2026-07-01", periodEnd: "2026-07-06", amountYen: 600 }),
      reading({ utility: "gas", periodStart: "2026-07-06", periodEnd: "2026-07-06", amountYen: 100 }),
    ]);
    expect(series[0].gas).toBeCloseTo(700, 6);
  });
});

describe("mergeIntervals", () => {
  const D = 86_400_000;
  it("returns empty for empty", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
  it("returns a single interval as is", () => {
    expect(mergeIntervals([[0, 10]])).toEqual([[0, 10]]);
  });
  it("merges unsorted and overlapping intervals", () => {
    expect(mergeIntervals([[5, 15], [0, 10]])).toEqual([[0, 15]]);
  });
  it("merges adjacent intervals (1-day gap)", () => {
    expect(mergeIntervals([[0, D], [2 * D, 3 * D]])).toEqual([[0, 3 * D]]);
  });
  it("keeps intervals apart when there is a gap", () => {
    expect(mergeIntervals([[0, D], [3 * D, 4 * D]])).toEqual([[0, D], [3 * D, 4 * D]]);
  });
});

describe("monthCovered", () => {
  const cov: Array<[number, number]> = [[Date.UTC(2025, 5, 17), Date.UTC(2025, 7, 18)]]; // 6/17-8/18
  it("is true when the whole month is covered", () => {
    expect(monthCovered(cov, "2025-07")).toBe(true);
  });
  it("is false for a partial month", () => {
    expect(monthCovered(cov, "2025-06")).toBe(false);
    expect(monthCovered(cov, "2025-08")).toBe(false);
  });
  it("is false for empty coverage", () => {
    expect(monthCovered([], "2025-07")).toBe(false);
  });
});

describe("monthOverlaps", () => {
  const cov: Array<[number, number]> = [[Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 30)]]; // 3/1-4/30
  it("is true when even one day overlaps", () => {
    expect(monthOverlaps(cov, "2026-03")).toBe(true);
    expect(monthOverlaps(cov, "2026-04")).toBe(true);
  });
  it("is false for a month with no overlap", () => {
    expect(monthOverlaps(cov, "2026-02")).toBe(false);
    expect(monthOverlaps(cov, "2026-05")).toBe(false);
  });
  it("is false for empty coverage", () => {
    expect(monthOverlaps([], "2026-03")).toBe(false);
  });
});

describe("completeness (complete) and trimIncompleteEnds", () => {
  it("marks partial months at the ends incomplete and inner months complete", () => {
    const readings = [
      reading({ utility: "electricity", periodStart: "2025-06-17", periodEnd: "2025-07-16", amountYen: 1000, usageValue: 100 }),
      reading({ utility: "electricity", periodStart: "2025-07-17", periodEnd: "2025-08-18", amountYen: 1000, usageValue: 100 }),
    ];
    const series = toMonthlySeries(readings);
    expect(series.map((b) => [b.month, b.complete])).toEqual([
      ["2025-06", false],
      ["2025-07", true],
      ["2025-08", false],
    ]);
    expect(trimIncompleteEnds(series).map((b) => b.month)).toEqual(["2025-07"]);
  });

  it("treats a month as complete when a utility with a different cadence does not touch it", () => {
    const readings = [
      // Electricity fully covers every month (May, June).
      reading({ utility: "electricity", periodStart: "2026-05-01", periodEnd: "2026-05-31", amountYen: 3000, usageValue: 100 }),
      reading({ utility: "electricity", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountYen: 3200, usageValue: 105 }),
      // Water is bimonthly, up to March-April (May and June not yet read).
      reading({ utility: "water", periodStart: "2026-03-01", periodEnd: "2026-04-30", amountYen: 6000, usageValue: 24, usageUnit: "m³" }),
    ];
    const series = toMonthlySeries(readings);
    const jun = series.find((b) => b.month === "2026-06")!;
    // The old logic returned false because water was not covered -> the latest month was trimmed away.
    expect(jun.complete).toBe(true);
    expect(series.every((b) => b.complete)).toBe(true);
    expect(trimIncompleteEnds(series).some((b) => b.month === "2026-06")).toBe(true);
  });

  it("keeps a partial end month incomplete when that utility touches but does not cover it", () => {
    // Electricity starts mid-month -> it overlaps that month but does not cover it, so incomplete.
    const series = toMonthlySeries([
      reading({ utility: "electricity", periodStart: "2026-06-15", periodEnd: "2026-07-31", amountYen: 3000, usageValue: 100 }),
    ]);
    expect(series.find((b) => b.month === "2026-06")!.complete).toBe(false);
    expect(series.find((b) => b.month === "2026-07")!.complete).toBe(true);
  });

  it("does not trim when all are complete; leaves empty as is", () => {
    const full = toMonthlySeries([reading({ periodStart: "2025-07-01", periodEnd: "2025-07-31" })]);
    expect(full[0].complete).toBe(true);
    expect(trimIncompleteEnds(full)).toHaveLength(1);
    expect(trimIncompleteEnds([])).toEqual([]);
  });

  it("\"all (combined)\" view: sums amounts and usage across buildings, and a move-month overlap does not break complete", () => {
    // Readings split into 6/1-6/14 at the old home and 6/15-6/30 at the new one (contiguous at the move date, no overlap).
    const series = toMonthlySeries([
      reading({ buildingId: "old", periodStart: "2026-06-01", periodEnd: "2026-06-14", amountYen: 1000, usageValue: 40 }),
      reading({ buildingId: "new", periodStart: "2026-06-15", periodEnd: "2026-06-30", amountYen: 1200, usageValue: 60 }),
    ]);
    const jun = series.find((b) => b.month === "2026-06")!;
    expect(jun.electricity).toBe(2200); // 1000 + 1200
    expect(jun.usage.electricity).toBe(100); // 40 + 60
    expect(jun.complete).toBe(true); // mergeIntervals joins them as one contiguous interval covering the whole month
  });
});

describe("unitPrice", () => {
  it("divides amount by usage", () => {
    expect(unitPrice(reading({ amountYen: 3000, usageValue: 100 }))).toBe(30);
  });
  it("returns null when usage is null", () => {
    expect(unitPrice(reading({ usageValue: null }))).toBeNull();
  });
  it("returns null when usage is 0 (avoids division by zero)", () => {
    expect(unitPrice(reading({ usageValue: 0 }))).toBeNull();
  });
});

describe("usageSeriesFor", () => {
  it("only the target utility, sorted by period-end month, with unit prices", () => {
    const readings = [
      reading({ utility: "gas", periodEnd: "2026-06-30", amountYen: 5000, usageValue: 20 }),
      reading({ utility: "electricity", periodEnd: "2026-07-31", amountYen: 4000, usageValue: 100 }),
      reading({ utility: "electricity", periodEnd: "2026-05-31", amountYen: 3000, usageValue: 120 }),
      reading({ utility: "electricity", periodEnd: "2026-05-31", amountYen: 3100, usageValue: null }),
    ];
    const points = usageSeriesFor(readings, "electricity");
    expect(points.map((p) => p.month)).toEqual(["2026-05", "2026-05", "2026-07"]);
    expect(points[2].unitPrice).toBe(40);
    // A record with null usage has a null unit price
    expect(points.some((p) => p.unitPrice === null)).toBe(true);
  });
});

describe("yearOverYear", () => {
  const monthly = [
    bucket("2024-06", 4000),
    bucket("2025-06", 5000),
    bucket("2025-07", 2000),
    bucket("2026-06", 6000),
    bucket("2026-07", 3000),
  ];

  it("compares the latest year with the year before by default", () => {
    const t = yearOverYear(monthly, totalMetric);
    expect(t.years).toEqual(["2024", "2025", "2026"]);
    expect(t.current).toBe("2026");
    expect(t.previous).toBe("2025");
    expect(t.rows).toHaveLength(12);
    expect(t.rows[5]).toEqual({
      monthNum: 6,
      label: "6月",
      current: 6000,
      previous: 5000,
      delta: 1000,
      deltaPct: 0.2,
    });
  });

  it("keeps months without data as null instead of zero", () => {
    const t = yearOverYear(monthly, totalMetric);
    expect(t.rows[0]).toMatchObject({ current: null, previous: null, delta: null, deltaPct: null });
  });

  it("lets the caller pick an older year as the base", () => {
    const t = yearOverYear(monthly, totalMetric, "2025");
    expect(t.current).toBe("2025");
    expect(t.previous).toBe("2024");
    expect(t.rows[5]).toMatchObject({ current: 5000, previous: 4000, delta: 1000 });
    // 2024-07 is missing, so there is nothing to compare against
    expect(t.rows[6]).toMatchObject({ current: 2000, previous: null, delta: null, deltaPct: null });
  });

  it("falls back to the latest year when the requested year has no data", () => {
    expect(yearOverYear(monthly, totalMetric, "2019").current).toBe("2026");
  });

  it("has no previous year when only one year exists", () => {
    const t = yearOverYear([bucket("2026-06", 6000)], totalMetric);
    expect(t.current).toBe("2026");
    expect(t.previous).toBeNull();
    expect(t.rows[5]).toMatchObject({ current: 6000, previous: null, delta: null });
  });

  it("returns an empty table for no data", () => {
    const t = yearOverYear([], totalMetric);
    expect(t).toMatchObject({ years: [], current: null, previous: null });
    expect(t.rows.every((r) => r.current === null && r.previous === null)).toBe(true);
  });

  it("leaves the percentage null when last year was zero", () => {
    const t = yearOverYear([bucket("2025-06", 0), bucket("2026-06", 500)], totalMetric);
    expect(t.rows[5]).toMatchObject({ delta: 500, deltaPct: null });
  });

  it("sums per utility with amountMetric", () => {
    const t = yearOverYear([bucket("2026-06", 6000, { electricity: 4500 })], amountMetric("electricity"));
    expect(t.rows[5].current).toBe(4500);
  });
});

describe("yoyTotals", () => {
  it("sums only the months that exist in both years", () => {
    const t = yearOverYear(
      [bucket("2025-06", 5000), bucket("2025-08", 9999), bucket("2026-06", 6000), bucket("2026-07", 3000)],
      totalMetric
    );
    expect(yoyTotals(t.rows)).toEqual({ months: 1, current: 6000, previous: 5000, delta: 1000, deltaPct: 0.2 });
  });

  it("returns null when no month can be compared", () => {
    expect(yoyTotals(yearOverYear([bucket("2026-06", 6000)], totalMetric).rows)).toBeNull();
  });

  it("leaves the percentage null when last year's total was zero", () => {
    const t = yearOverYear([bucket("2025-06", 0), bucket("2026-06", 500)], totalMetric);
    expect(yoyTotals(t.rows)).toMatchObject({ delta: 500, deltaPct: null });
  });
});

describe("refLabelSides", () => {
  it("puts the higher line's label above and the lower one's below", () => {
    expect(refLabelSides(22000, 23235)).toEqual(["below", "above"]);
    expect(refLabelSides(25000, 20000)).toEqual(["above", "below"]);
  });

  it("splits equal values too so the labels never share a row", () => {
    expect(refLabelSides(1000, 1000)).toEqual(["above", "below"]);
  });
});

describe("seasonalAverages", () => {
  it("averages each month number across years (0 when no data)", () => {
    const monthly = [bucket("2025-06", 5000), bucket("2026-06", 6000), bucket("2026-07", 3000)];
    const seasonal = seasonalAverages(monthly, totalMetric);
    expect(seasonal[5]).toMatchObject({ monthNum: 6, average: 5500, count: 2 });
    expect(seasonal[6]).toMatchObject({ average: 3000, count: 1 });
    expect(seasonal[0]).toMatchObject({ average: 0, count: 0 });
  });
});

describe("periodStats", () => {
  it("returns zeros and nulls for empty", () => {
    expect(periodStats([])).toEqual({ months: 0, total: 0, average: 0, maxMonth: null, minMonth: null });
  });
  it("computes total, monthly average and highest/lowest months", () => {
    const monthly = [bucket("2025-06", 5000), bucket("2025-07", 3000), bucket("2025-08", 8000)];
    const s = periodStats(monthly);
    expect(s.months).toBe(3);
    expect(s.total).toBe(16000);
    expect(s.average).toBeCloseTo(16000 / 3, 6);
    expect(s.maxMonth?.month).toBe("2025-08");
    expect(s.minMonth?.month).toBe("2025-07");
  });
});

describe("utilityShares", () => {
  it("computes per-utility totals and shares (share 0 when the total is 0)", () => {
    expect(utilityShares([]).every((x) => x.total === 0 && x.share === 0)).toBe(true);
    const shares = utilityShares([bucket("2026-06", 10000, { electricity: 6000, gas: 3000, water: 1000 })]);
    expect(shares).toEqual([
      { utility: "electricity", total: 6000, share: 0.6 },
      { utility: "gas", total: 3000, share: 0.3 },
      { utility: "water", total: 1000, share: 0.1 },
    ]);
  });
});

describe("summarize", () => {
  it("returns all nulls for empty", () => {
    expect(summarize([])).toEqual({
      latestMonth: null,
      latest: null,
      prevYearSameMonth: null,
      yoyDelta: null,
      yoyPct: null,
    });
  });

  it("gives the delta and rate when the same month last year exists", () => {
    const s = summarize([bucket("2025-06", 5000), bucket("2026-06", 6000)]);
    expect(s.latestMonth).toBe("2026-06");
    expect(s.yoyDelta).toBe(1000);
    expect(s.yoyPct).toBeCloseTo(0.2, 6);
  });

  it("leaves the rate null when last year's month was 0 yen (delta still computed)", () => {
    const s = summarize([bucket("2025-06", 0), bucket("2026-06", 6000)]);
    expect(s.yoyDelta).toBe(6000);
    expect(s.yoyPct).toBeNull();
  });

  it("leaves delta and rate null when there is no same month last year", () => {
    const s = summarize([bucket("2026-06", 6000)]);
    expect(s.yoyDelta).toBeNull();
    expect(s.yoyPct).toBeNull();
  });
});

describe("missingUtilities", () => {
  it("names the utilities recorded in other months but absent from the given month", () => {
    const series = [
      bucket("2026-06", 9000, { electricity: 6000, gas: 2000, water: 1000 }),
      bucket("2026-07", 3000, { electricity: 0, gas: 2000, water: 1000 }),
    ];
    expect(missingUtilities(series, series[1])).toEqual(["electricity"]);
  });

  it("keeps the display order when several are missing", () => {
    const series = [
      bucket("2026-06", 9000, { electricity: 6000, gas: 2000, water: 1000 }),
      bucket("2026-07", 2000, { electricity: 0, gas: 2000, water: 0 }),
    ];
    expect(missingUtilities(series, series[1])).toEqual(["electricity", "water"]);
  });

  it("ignores utilities that were never recorded (different billing cycles are not gaps)", () => {
    const series = [bucket("2026-06", 6000), bucket("2026-07", 6000)];
    expect(missingUtilities(series, series[1])).toEqual([]);
  });
});
