// Undo plans for destructive data changes (SHIG 54 fail-safe / 57 act silently).

import type { NewReading, Reading } from "./domain";
import { readingKey } from "./csv";

/** Drops the database id so a deleted row can be inserted again. */
export function withoutId<T extends { id: string }>(row: T): Omit<T, "id"> {
  const { id: _id, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export interface ImportUndoPlan {
  /** Previous values of the records the import overwrites (upsert them back). */
  restore: NewReading[];
  /** Keys (see `readingKey`) of the records the import adds (delete them). */
  addedKeys: string[];
}

/** Captures what an import will change, before it runs, so it can be reverted. */
export function planImportUndo(incoming: NewReading[], existing: Reading[]): ImportUndoPlan {
  const existingByKey = new Map(existing.map((r) => [readingKey(r), r]));
  const restore: NewReading[] = [];
  const addedKeys: string[] = [];
  for (const r of incoming) {
    const key = readingKey(r);
    const before = existingByKey.get(key);
    if (before) restore.push(withoutId(before));
    else addedKeys.push(key);
  }
  return { restore, addedKeys };
}
