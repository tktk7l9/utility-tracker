// 建物（住まい）まわりの純関数。検針期間と居住期間の重なりから建物を推定し、
// 手入力・CSV 取込のデフォルト建物選択に使う。すべて副作用なしでテスト容易。

import type { Building } from "./domain";

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" を UTC ミリ秒に。 */
function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * 検針期間 [periodStart, periodEnd]（両端含む）と建物の居住期間の重なり日数。
 * movedOutOn が null（現住）は periodEnd まで居住しているとみなす。
 * 重なりなし・期間逆転は 0。
 */
export function overlapDays(b: Building, periodStart: string, periodEnd: string): number {
  const start = toUTC(periodStart);
  const end = toUTC(periodEnd);
  if (end < start) return 0;
  const from = Math.max(start, toUTC(b.movedInOn));
  const to = Math.min(end, b.movedOutOn != null ? toUTC(b.movedOutOn) : end);
  if (to < from) return 0;
  return Math.round((to - from) / DAY_MS) + 1;
}

/**
 * 検針期間との重なり日数が最大の建物を返す。重なりが1件もなければ null。
 * 同数タイは入居日が新しい方（引っ越し当日をまたぐ期間は新居を優先）。
 */
export function inferBuilding(
  buildings: Building[],
  periodStart: string,
  periodEnd: string
): Building | null {
  let best: Building | null = null;
  let bestDays = 0;
  for (const b of buildings) {
    const days = overlapDays(b, periodStart, periodEnd);
    if (days === 0) continue;
    if (days > bestDays || (days === bestDays && best != null && b.movedInOn > best.movedInOn)) {
      best = b;
      bestDays = days;
    }
  }
  return best;
}

/** 入居日昇順（同日は name 順）にソートした新配列。セレクタ・管理リストの表示順の正本。 */
export function sortBuildings(buildings: Building[]): Building[] {
  return [...buildings].sort(
    (a, b) => a.movedInOn.localeCompare(b.movedInOn) || a.name.localeCompare(b.name)
  );
}

/** 現住か（退去日が未設定）。 */
export function isCurrentResidence(b: Building): boolean {
  return b.movedOutOn === null;
}
