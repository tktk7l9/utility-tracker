import { describe, it, expect } from "vitest";
import { currentMonthPeriod, suggestPeriod } from "./period";
import type { Utility } from "./domain";

const r = (utility: Utility, periodStart: string, periodEnd: string, buildingId = "b1") => ({
  utility,
  periodStart,
  periodEnd,
  buildingId,
});

const today = new Date(2026, 8, 28); // 2026-09-28 local

describe("currentMonthPeriod", () => {
  it("returns the first and last day of the month", () => {
    expect(currentMonthPeriod(today)).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(currentMonthPeriod(new Date(2028, 1, 10))).toEqual({ periodStart: "2028-02-01", periodEnd: "2028-02-29" });
  });
});

describe("suggestPeriod", () => {
  it("falls back to the current month when there is no record of that utility", () => {
    expect(suggestPeriod([r("gas", "2026-08-01", "2026-08-31")], "electricity", today)).toEqual({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
  });

  it("continues a calendar-month record with the next calendar month", () => {
    const readings = [r("electricity", "2026-07-01", "2026-07-31"), r("electricity", "2026-08-01", "2026-08-31")];
    expect(suggestPeriod(readings, "electricity", today)).toEqual({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
  });

  it("keeps the number of months for bimonthly calendar-month records (water)", () => {
    const readings = [r("water", "2026-07-01", "2026-08-31")];
    expect(suggestPeriod(readings, "water", today)).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-10-31" });
  });

  it("crosses the year boundary", () => {
    const readings = [r("water", "2026-11-01", "2026-12-31")];
    expect(suggestPeriod(readings, "water", today)).toEqual({ periodStart: "2027-01-01", periodEnd: "2027-02-28" });
  });

  it("continues a meter-reading period with the same length, starting the day after", () => {
    const readings = [r("gas", "2026-07-15", "2026-08-13")];
    expect(suggestPeriod(readings, "gas", today)).toEqual({ periodStart: "2026-08-14", periodEnd: "2026-09-12" });
  });

  it("repeats a shared boundary day when the bills overlap by one day (meter-reading date)", () => {
    const readings = [r("gas", "2026-06-04", "2026-07-06"), r("gas", "2026-07-06", "2026-08-06")];
    expect(suggestPeriod(readings, "gas", today)).toEqual({ periodStart: "2026-08-06", periodEnd: "2026-09-06" });
  });

  it("only looks at the given building when one is chosen", () => {
    const readings = [r("electricity", "2026-08-01", "2026-08-31", "b1"), r("electricity", "2025-02-01", "2025-02-28", "b2")];
    expect(suggestPeriod(readings, "electricity", today, "b2")).toEqual({
      periodStart: "2025-03-01",
      periodEnd: "2025-03-31",
    });
    expect(suggestPeriod(readings, "electricity", today, null).periodStart).toBe("2026-09-01");
  });
});
