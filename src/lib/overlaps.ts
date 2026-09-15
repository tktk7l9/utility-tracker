// 取込候補と既存レコードの「検針期間の重なり」を検出する純関数（二重計上の警告用）。

import type { NewReading, Reading } from "./domain";
import { readingKey } from "./csv";

export interface PeriodOverlap {
  incoming: NewReading;
  existing: Reading;
}

/**
 * 同じ建物・同じ光熱費で検針期間が重なる既存レコードを列挙する。
 * 同一期間（readingKey が一致）は重複スキップ／上書きで扱うため除き、
 * 前の期間の終了日と次の期間の開始日が同じ日なだけ（エルピオの検針日区切り）も重なりとみなさない。
 */
export function findPeriodOverlaps(incoming: NewReading[], existing: Reading[]): PeriodOverlap[] {
  const overlaps: PeriodOverlap[] = [];
  for (const inc of incoming) {
    for (const ex of existing) {
      if (ex.buildingId !== inc.buildingId || ex.utility !== inc.utility) continue;
      if (readingKey(ex) === readingKey(inc)) continue;
      if (ex.periodEnd < inc.periodStart || inc.periodEnd < ex.periodStart) continue;
      if (ex.periodEnd === inc.periodStart || inc.periodEnd === ex.periodStart) continue;
      overlaps.push({ incoming: inc, existing: ex });
    }
  }
  return overlaps;
}
