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
  it("returns existing records of the same building and utility whose period overlaps (monthly record vs. reading-period bill)", () => {
    const ex = existing({ periodStart: "2026-06-01", periodEnd: "2026-06-30" });
    const inc = incoming({ periodStart: "2026-06-04", periodEnd: "2026-07-06" });
    expect(findPeriodOverlaps([inc], [ex])).toEqual([{ incoming: inc, existing: ex }]);
  });

  it("does not treat a different building or utility as an overlap", () => {
    const inc = incoming({});
    expect(findPeriodOverlaps([inc], [existing({ buildingId: "b2" })])).toEqual([]);
    expect(findPeriodOverlaps([inc], [existing({ utility: "water" })])).toEqual([]);
  });

  it("treats an identical period as a duplicate (skip/overwrite), not an overlap", () => {
    const inc = incoming({ periodStart: "2026-06-04", periodEnd: "2026-07-06" });
    expect(findPeriodOverlaps([inc], [existing({ periodStart: "2026-06-04", periodEnd: "2026-07-06" })])).toEqual([]);
  });

  it("does not overlap when one period ends on the day the next begins", () => {
    const earlier = { periodStart: "2026-06-04", periodEnd: "2026-07-06" };
    const later = { periodStart: "2026-07-06", periodEnd: "2026-08-06" };
    expect(findPeriodOverlaps([incoming(later)], [existing(earlier)])).toEqual([]);
    expect(findPeriodOverlaps([incoming(earlier)], [existing(later)])).toEqual([]);
  });

  it("does not overlap for separate periods", () => {
    const june = { periodStart: "2026-06-01", periodEnd: "2026-06-30" };
    const august = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };
    expect(findPeriodOverlaps([incoming(august)], [existing(june)])).toEqual([]);
    expect(findPeriodOverlaps([incoming(june)], [existing(august)])).toEqual([]);
  });
});
