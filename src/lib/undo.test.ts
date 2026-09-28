import { describe, it, expect } from "vitest";
import { planImportUndo, undoImport, withoutId, type ImportUndoApi } from "./undo";
import { readingKey } from "./csv";
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

/** In-memory store with the same upsert semantics as the readings table (unique key, id kept). */
function fakeStore(initial: Reading[]) {
  let rows = initial.map((r) => ({ ...r }));
  let nextId = 100;
  const api: ImportUndoApi = {
    fetchReadings: async () => rows.map((r) => ({ ...r })),
    deleteReadings: async (ids) => {
      rows = rows.filter((r) => !ids.includes(r.id));
    },
    bulkUpsert: async (incoming) => {
      for (const r of incoming) {
        const i = rows.findIndex((x) => readingKey(x) === readingKey(r));
        if (i >= 0) rows[i] = { ...r, id: rows[i].id };
        else rows.push({ ...r, id: `n${nextId++}` });
      }
    },
  };
  return { api, rows: () => rows };
}

describe("undoImport", () => {
  it("restores the store to exactly what it was before the import", async () => {
    const before: Reading[] = [
      { id: "r1", ...base, amountYen: 5000, note: "訂正前" },
      { id: "r2", ...base, utility: "gas", provider: "LPIO", usageUnit: "m3" },
    ];
    const incoming: NewReading[] = [
      { ...base, amountYen: 6200 }, // overwrites r1
      { ...base, periodStart: "2026-09-01", periodEnd: "2026-09-30" }, // new
    ];
    const store = fakeStore(before);
    const plan = planImportUndo(incoming, await store.api.fetchReadings());
    await store.api.bulkUpsert(incoming);
    expect(store.rows()).toHaveLength(3);

    const after = await undoImport(plan, store.api);
    expect(after).toEqual(before);
  });

  it("leaves records that were already there before an import without overwrites", async () => {
    const before: Reading[] = [{ id: "r1", ...base }];
    const incoming: NewReading[] = [{ ...base, periodStart: "2026-09-01", periodEnd: "2026-09-30" }];
    const store = fakeStore(before);
    const plan = planImportUndo(incoming, before);
    await store.api.bulkUpsert(incoming);
    expect(await undoImport(plan, store.api)).toEqual(before);
  });
});
