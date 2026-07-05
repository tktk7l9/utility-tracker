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
  it("検針期間が居住期間に完全包含されるなら期間全日", () => {
    const b = mk("a", "A", "2026-01-01", "2026-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(30);
  });

  it("部分的な重なりは重なった日数のみ", () => {
    const b = mk("a", "A", "2026-06-15", "2026-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(16); // 6/15〜6/30
  });

  it("重なりなしは 0", () => {
    const b = mk("a", "A", "2025-01-01", "2025-12-31");
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(0);
  });

  it("境界日（入居日=期間終了日 / 退去日=期間開始日）は 1 日", () => {
    expect(overlapDays(mk("a", "A", "2026-06-30", null), "2026-06-01", "2026-06-30")).toBe(1);
    expect(overlapDays(mk("a", "A", "2026-01-01", "2026-06-01"), "2026-06-01", "2026-06-30")).toBe(1);
  });

  it("退去日 null（現住）は期間終了日まで居住とみなす", () => {
    const b = mk("a", "A", "2026-06-10", null);
    expect(overlapDays(b, "2026-06-01", "2026-06-30")).toBe(21); // 6/10〜6/30
  });

  it("期間逆転（終了<開始）は 0", () => {
    const b = mk("a", "A", "2026-01-01", null);
    expect(overlapDays(b, "2026-06-30", "2026-06-01")).toBe(0);
  });
});

describe("inferBuilding", () => {
  const oldHome = mk("old", "旧居", "2025-01-01", "2026-06-14");
  const newHome = mk("new", "新居", "2026-06-15", null);

  it("建物なしは null", () => {
    expect(inferBuilding([], "2026-06-01", "2026-06-30")).toBeNull();
  });

  it("どの居住期間とも重ならなければ null", () => {
    expect(inferBuilding([oldHome], "2024-01-01", "2024-01-31")).toBeNull();
  });

  it("重なり日数が最大の建物を返す（引っ越しまたぎの検針期間）", () => {
    // 6/1〜6/30: 旧居 14 日・新居 16 日 → 新居
    expect(inferBuilding([oldHome, newHome], "2026-06-01", "2026-06-30")?.id).toBe("new");
    // 配列順を逆にしても同じ（少ない方が最大値を上書きしない）
    expect(inferBuilding([newHome, oldHome], "2026-06-01", "2026-06-30")?.id).toBe("new");
  });

  it("重なり同数のタイは入居日が新しい方（引っ越し当日は新居優先）", () => {
    // 6/14〜6/15: 旧居 1 日（6/14）・新居 1 日（6/15）
    expect(inferBuilding([oldHome, newHome], "2026-06-14", "2026-06-15")?.id).toBe("new");
    expect(inferBuilding([newHome, oldHome], "2026-06-14", "2026-06-15")?.id).toBe("new");
  });
});

describe("sortBuildings", () => {
  it("入居日昇順（同日は name 順）で、元配列を破壊しない", () => {
    const a = mk("a", "い", "2026-06-15");
    const b = mk("b", "あ", "2025-01-01");
    const c = mk("c", "あ", "2026-06-15");
    const input = [a, b, c];
    expect(sortBuildings(input).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]); // 非破壊
  });
});

describe("isCurrentResidence", () => {
  it("退去日 null は現住、日付ありは非現住", () => {
    expect(isCurrentResidence(mk("a", "A", "2026-01-01", null))).toBe(true);
    expect(isCurrentResidence(mk("a", "A", "2026-01-01", "2026-06-30"))).toBe(false);
  });
});
