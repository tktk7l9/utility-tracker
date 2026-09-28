import { describe, it, expect } from "vitest";
import type { Building } from "./domain";
import { overlapDays, inferBuilding, sortBuildings, isCurrentResidence } from "./buildings";

const mk = (id: string, name: string, movedInOn: string, movedOutOn: string | null = null): Building => ({
  id,
  name,
  movedInOn,
  movedOutOn,
});

describe("overlapDays", () => {
  it("counts every day of the period when the reading period lies fully inside the residence", () => {
    const b = mk("a", "A", "2026-01-01", "2026-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(30);
  });

  it("counts only the overlapping days for a partial overlap", () => {
    const b = mk("a", "A", "2026-06-15", "2026-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(16); // 6/15-6/30
  });

  it("returns 0 when there is no overlap", () => {
    const b = mk("a", "A", "2025-01-01", "2025-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(0);
  });

  it("counts 1 day on the boundary (move-in = period end / move-out = period start)", () => {
    expect(overlapDays(mk("a", "A", "2026-06-30", null), "2026-06-01", "2026-06-30")).toBe(1);
    expect(overlapDays(mk("a", "A", "2026-01-01", "2026-06-01"), "2026-06-01", "2026-06-30")).toBe(1);
  });

  it("treats a null move-out date (current home) as living there until the period end", () => {
    const b = mk("a", "A", "2026-06-10", null);
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(21); // 6/10-6/30
  });

  it("returns 0 for a reversed period (end < start)", () => {
    const b = mk("a", "A", "2026-01-01", null);
    expect(overlapDays(b, "2026-06-30", "2026-06-01")).toBe(0);
  });
});

describe("inferBuilding", () => {
  const oldHome = mk("old", "旧居", "2025-01-01", "2026-06-14");
  const newHome = mk("new", "新居", "2026-06-15", null);

  it("returns null when there are no buildings", () => {
    expect(inferBuilding([], "2026-06-01", "2026-06-30")).toBeNull();
  });

  it("returns null when no residence period overlaps", () => {
    expect(inferBuilding([oldHome], "2024-01-01", "2024-01-31")).toBeNull();
  });

  it("returns the building with the most overlapping days (reading period spanning a move)", () => {
    // 6/1-6/30: 14 days at the old home, 16 at the new one -> new home
    expect(inferBuilding([oldHome, newHome], "2026-06-01", "2026-06-30")?.id).toBe("new");
    // Same result with the array reversed (the smaller overlap never overwrites the maximum)
    expect(inferBuilding([newHome, oldHome], "2026-06-01", "2026-06-30")?.id).toBe("new");
  });

  it("breaks a tie by the newer move-in date (the new home wins on moving day)", () => {
    // 6/14-6/15: 1 day at the old home (6/14), 1 day at the new one (6/15)
    expect(inferBuilding([oldHome, newHome], "2026-06-14", "2026-06-15")?.id).toBe("new");
    expect(inferBuilding([newHome, oldHome], "2026-06-14", "2026-06-15")?.id).toBe("new");
  });
});

describe("sortBuildings", () => {
  it("sorts by move-in date ascending (name on the same day) without mutating the input", () => {
    const a = mk("a", "い", "2026-06-15");
    const b = mk("b", "あ", "2025-01-01");
    const c = mk("c", "あ", "2026-06-15");
    const input = [a, b, c];
    expect(sortBuildings(input).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]); // Non-destructive
  });
});

describe("isCurrentResidence", () => {
  it("treats a null move-out date as current and a dated one as not current", () => {
    expect(isCurrentResidence(mk("a", "A", "2026-01-01", null))).toBe(true);
    expect(isCurrentResidence(mk("a", "A", "2026-01-01", "2026-06-30"))).toBe(false);
  });
});
