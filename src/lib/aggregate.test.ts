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
  unitPrice,
  usageSeriesFor,
  yoyByMonth,
  seasonalAverages,
  summarize,
  totalMetric,
  amountMetric,
  type MonthlyBucket,
} from "./aggregate";

function reading(p: Partial<Reading>): Reading {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    utility: p.utility ?? "electricity",
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
  it("monthKeyOf は YYYY-MM を取り出す", () => {
    expect(monthKeyOf("2026-06-19")).toBe("2026-06");
  });
  it("monthLabel は和暦風の表示にする", () => {
    expect(monthLabel("2026-06")).toBe("2026年6月");
  });
});

describe("daysPerMonth", () => {
  it("単一月は日数をそのまま返す", () => {
    expect(daysPerMonth("2026-06-01", "2026-06-30")).toEqual({ "2026-06": 30 });
  });
  it("月をまたぐと按分用の日数に割れる", () => {
    expect(daysPerMonth("2026-05-20", "2026-06-19")).toEqual({ "2026-05": 12, "2026-06": 19 });
  });
  it("終了日が開始日より前なら空", () => {
    expect(daysPerMonth("2026-07-10", "2026-07-01")).toEqual({});
  });
});

describe("toMonthlySeries", () => {
  it("空配列は空系列", () => {
    expect(toMonthlySeries([])).toEqual([]);
  });

  it("単一月レコードは按分なしで満額計上", () => {
    const series = toMonthlySeries([reading({ amountYen: 3000, usageValue: 100 })]);
    expect(series).toHaveLength(1);
    expect(series[0].month).toBe("2026-06");
    expect(series[0].electricity).toBe(3000);
    expect(series[0].total).toBe(3000);
    expect(series[0].usage.electricity).toBe(100);
  });

  it("隔月レコードを日割りで各月に按分し、月ごとに合算する", () => {
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

  it("使用量 null は金額だけ計上し使用量は 0 のまま", () => {
    const series = toMonthlySeries([
      reading({ periodStart: "2026-08-01", periodEnd: "2026-08-31", amountYen: 2000, usageValue: null }),
    ]);
    expect(series[0].electricity).toBe(2000);
    expect(series[0].usage.electricity).toBe(0);
  });

  it("不正な期間（終了<開始）のレコードは無視する", () => {
    const series = toMonthlySeries([
      reading({ utility: "gas", periodStart: "2026-07-10", periodEnd: "2026-07-01", amountYen: 1000, usageValue: 5 }),
    ]);
    expect(series).toEqual([]);
  });
});

describe("mergeIntervals", () => {
  const D = 86_400_000;
  it("空は空", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
  it("単一はそのまま", () => {
    expect(mergeIntervals([[0, 10]])).toEqual([[0, 10]]);
  });
  it("未ソート＋重複を結合", () => {
    expect(mergeIntervals([[5, 15], [0, 10]])).toEqual([[0, 15]]);
  });
  it("隣接（1日差）は結合", () => {
    expect(mergeIntervals([[0, D], [2 * D, 3 * D]])).toEqual([[0, 3 * D]]);
  });
  it("間隔が空くと分離", () => {
    expect(mergeIntervals([[0, D], [3 * D, 4 * D]])).toEqual([[0, D], [3 * D, 4 * D]]);
  });
});

describe("monthCovered", () => {
  const cov: Array<[number, number]> = [[Date.UTC(2025, 5, 17), Date.UTC(2025, 7, 18)]]; // 6/17〜8/18
  it("月全体が覆われていれば true", () => {
    expect(monthCovered(cov, "2025-07")).toBe(true);
  });
  it("部分月は false", () => {
    expect(monthCovered(cov, "2025-06")).toBe(false);
    expect(monthCovered(cov, "2025-08")).toBe(false);
  });
  it("カバレッジ空は false", () => {
    expect(monthCovered([], "2025-07")).toBe(false);
  });
});

describe("完全性 (complete) と trimIncompleteEnds", () => {
  it("端の部分月を incomplete、内側を complete に判定する", () => {
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

  it("全て complete ならトリムしない・空はそのまま", () => {
    const full = toMonthlySeries([reading({ periodStart: "2025-07-01", periodEnd: "2025-07-31" })]);
    expect(full[0].complete).toBe(true);
    expect(trimIncompleteEnds(full)).toHaveLength(1);
    expect(trimIncompleteEnds([])).toEqual([]);
  });
});

describe("unitPrice", () => {
  it("金額÷使用量", () => {
    expect(unitPrice(reading({ amountYen: 3000, usageValue: 100 }))).toBe(30);
  });
  it("使用量 null は null", () => {
    expect(unitPrice(reading({ usageValue: null }))).toBeNull();
  });
  it("使用量 0 は null（ゼロ割回避）", () => {
    expect(unitPrice(reading({ usageValue: 0 }))).toBeNull();
  });
});

describe("usageSeriesFor", () => {
  it("対象光熱費のみ・期間終了月の昇順・単価付き", () => {
    const readings = [
      reading({ utility: "gas", periodEnd: "2026-06-30", amountYen: 5000, usageValue: 20 }),
      reading({ utility: "electricity", periodEnd: "2026-07-31", amountYen: 4000, usageValue: 100 }),
      reading({ utility: "electricity", periodEnd: "2026-05-31", amountYen: 3000, usageValue: 120 }),
      reading({ utility: "electricity", periodEnd: "2026-05-31", amountYen: 3100, usageValue: null }),
    ];
    const points = usageSeriesFor(readings, "electricity");
    expect(points.map((p) => p.month)).toEqual(["2026-05", "2026-05", "2026-07"]);
    expect(points[2].unitPrice).toBe(40);
    // usage null のレコードは単価 null
    expect(points.some((p) => p.unitPrice === null)).toBe(true);
  });
});

describe("yoyByMonth", () => {
  const monthly = [bucket("2025-06", 5000), bucket("2026-06", 6000), bucket("2026-07", 3000)];

  it("月番号×年のテーブルを作る（total）", () => {
    const table = yoyByMonth(monthly, totalMetric);
    expect(table.years).toEqual(["2025", "2026"]);
    expect(table.rows).toHaveLength(12);
    const june = table.rows[5];
    expect(june).toMatchObject({ monthNum: 6, label: "6月", "2025": 5000, "2026": 6000 });
    const july = table.rows[6];
    expect(july).toMatchObject({ "2025": 0, "2026": 3000 });
    // データの無い月は 0
    expect(table.rows[0]["2026"]).toBe(0);
  });

  it("amountMetric で光熱費別に集計できる", () => {
    const table = yoyByMonth([bucket("2026-06", 6000, { electricity: 6000 })], amountMetric("electricity"));
    expect(table.rows[5]["2026"]).toBe(6000);
  });
});

describe("seasonalAverages", () => {
  it("月番号ごとの年跨ぎ平均（データ無しは 0）", () => {
    const monthly = [bucket("2025-06", 5000), bucket("2026-06", 6000), bucket("2026-07", 3000)];
    const seasonal = seasonalAverages(monthly, totalMetric);
    expect(seasonal[5]).toMatchObject({ monthNum: 6, average: 5500, count: 2 });
    expect(seasonal[6]).toMatchObject({ average: 3000, count: 1 });
    expect(seasonal[0]).toMatchObject({ average: 0, count: 0 });
  });
});

describe("summarize", () => {
  it("空は全て null", () => {
    expect(summarize([])).toEqual({
      latestMonth: null,
      latest: null,
      prevYearSameMonth: null,
      yoyDelta: null,
      yoyPct: null,
    });
  });

  it("前年同月があればデルタと増減率を出す", () => {
    const s = summarize([bucket("2025-06", 5000), bucket("2026-06", 6000)]);
    expect(s.latestMonth).toBe("2026-06");
    expect(s.yoyDelta).toBe(1000);
    expect(s.yoyPct).toBeCloseTo(0.2, 6);
  });

  it("前年同月が 0 円なら増減率は null（デルタは算出）", () => {
    const s = summarize([bucket("2025-06", 0), bucket("2026-06", 6000)]);
    expect(s.yoyDelta).toBe(6000);
    expect(s.yoyPct).toBeNull();
  });

  it("前年同月が無ければデルタ・増減率とも null", () => {
    const s = summarize([bucket("2026-06", 6000)]);
    expect(s.yoyDelta).toBeNull();
    expect(s.yoyPct).toBeNull();
  });
});
