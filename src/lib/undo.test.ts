import { describe, it, expect } from "vitest";
import { planImportUndo, withoutId } from "./undo";
import type { NewReading, Reading } from "./domain";

const base: NewReading = {
  utility: "electricity",
  provider: "TEPCO",
  buildingId: "b1",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  amountYen: 6200,
  usageValue: 200,
  usageUnit: "kWh",
  note: null,
  source: "csv",
};

describe("withoutId", () => {
  it("drops the id and keeps every other field", () => {
    expect(withoutId({ id: "x", ...base })).toEqual(base);
  });
});

describe("planImportUndo", () => {
  it("keeps the previous values of overwritten records and the keys of new ones", () => {
    const existing: Reading[] = [{ id: "r1", ...base, amountYen: 5000 }];
    const incoming: NewReading[] = [
      { ...base, amountYen: 6200 },
      { ...base, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
    ];
    expect(planImportUndo(incoming, existing)).toEqual({
      restore: [{ ...base, amountYen: 5000 }],
      addedKeys: ["b1|electricity|2026-09-01|2026-09-30"],
    });
  });

  it("returns empty plans for an empty import", () => {
    expect(planImportUndo([], [])).toEqual({ restore: [], addedKeys: [] });
  });
});
