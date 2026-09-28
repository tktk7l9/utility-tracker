// Pure functions that detect reading-period overlaps between import candidates and existing records (for double-counting warnings).

import type { NewReading, Reading } from "./domain";
import { readingKey } from "./csv";

export interface PeriodOverlap {
  incoming: NewReading;
  existing: Reading;
}

/**
 * Lists existing records of the same building and utility whose reading periods overlap.
 * Identical periods (matching readingKey) are excluded because duplicate skip/overwrite handles them,
 * and one period ending on the day the next begins (LPIO's split on the reading date) is not an overlap either.
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
