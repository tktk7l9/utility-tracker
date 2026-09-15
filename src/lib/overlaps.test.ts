import { describe, it, expect } from "vitest";
import type { NewReading, Reading } from "./domain";
import { findPeriodOverlaps } from "./overlaps";

function existing(p: Partial<Reading>): Reading {
  return {
    id: p.id ?? "r1",
    utility: p.utility ?? "gas",
    buildingId: p.buildingId ?? "b1",
    provider: "LPIO",
    periodStart: p.periodStart ?? "2026-06-01",
    periodEnd: p.periodEnd ?? "2026-06-30",
    amountYen: 3000,
    usageValue: 20,
    usageUnit: "m³",
    note: null,
    source: "csv",
  };
}

function incoming(p: Partial<NewReading>): NewReading {
  return {
    utility: p.utility ?? "gas",
    buildingId: p.buildingId ?? "b1",
    provider: "LPIO",
    periodStart: p.periodStart ?? "2026-06-04",
    periodEnd: p.periodEnd ?? "2026-07-06",
    amountYen: 4954,
    usageValue: 26,
    usageUnit: "m³",
    note: null,
    source: "pdf",
  };
}

describe("findPeriodOverlaps", () => {
  it("同じ建物・光熱費で期間が重なる既存レコードを返す（年月単位の記録と検針期間の請求書）", () => {
    const ex = existing({ periodStart: "2026-06-01", periodEnd: "2026-06-30" });
    const inc = incoming({ periodStart: "2026-06-04", periodEnd: "2026-07-06" });
    expect(findPeriodOverlaps([inc], [ex])).toEqual([{ incoming: inc, existing: ex }]);
  });

  it("建物か光熱費が違えば重なりとみなさない", () => {
    const inc = incoming({});
    expect(findPeriodOverlaps([inc], [existing({ buildingId: "b2" })])).toEqual([]);
    expect(findPeriodOverlaps([inc], [existing({ utility: "water" })])).toEqual([]);
  });

  it("同一期間は重複（スキップ／上書き）として扱い、重なりには含めない", () => {
    const inc = incoming({ periodStart: "2026-06-04", periodEnd: "2026-07-06" });
    expect(findPeriodOverlaps([inc], [existing({ periodStart: "2026-06-04", periodEnd: "2026-07-06" })])).toEqual([]);
  });

  it("前の期間の終了日と次の期間の開始日が同じ日なだけなら重ならない", () => {
    const earlier = { periodStart: "2026-06-04", periodEnd: "2026-07-06" };
    const later = { periodStart: "2026-07-06", periodEnd: "2026-08-06" };
    expect(findPeriodOverlaps([incoming(later)], [existing(earlier)])).toEqual([]);
    expect(findPeriodOverlaps([incoming(earlier)], [existing(later)])).toEqual([]);
  });

  it("離れた期間は重ならない", () => {
    const june = { periodStart: "2026-06-01", periodEnd: "2026-06-30" };
    const august = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };
    expect(findPeriodOverlaps([incoming(august)], [existing(june)])).toEqual([]);
    expect(findPeriodOverlaps([incoming(june)], [existing(august)])).toEqual([]);
  });
});
