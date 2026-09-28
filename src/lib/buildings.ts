// Pure functions for buildings (homes). Infers the building from the overlap between reading and residence periods,
// used as the default building for manual entry and CSV import. All side-effect free and easy to test.

import type { Building } from "./domain";

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" to UTC milliseconds. */
function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Number of days the reading period [periodStart, periodEnd] (inclusive) overlaps the building's residence period.
 * A null movedOutOn (current home) counts as living there through periodEnd.
 * No overlap or a reversed period gives 0.
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
 * Returns the building with the most days overlapping the reading period, or null if none overlaps.
 * Ties go to the later move-in date (a period spanning the move date prefers the new home).
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

/** New array sorted by move-in date ascending (same day by name). The source of truth for the order in the selector and management list. */
export function sortBuildings(buildings: Building[]): Building[] {
  return [...buildings].sort(
    (a, b) => a.movedInOn.localeCompare(b.movedInOn) || a.name.localeCompare(b.name)
  );
}

/** Whether this is the current home (no move-out date). */
export function isCurrentResidence(b: Building): boolean {
  return b.movedOutOn === null;
}
