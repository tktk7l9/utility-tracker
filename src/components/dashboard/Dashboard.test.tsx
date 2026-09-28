import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { Building, NewBuilding, NewReading, Reading } from "@/lib/domain";

// In-memory stand-in for the Supabase layer (same upsert key as the readings table).
const db = vi.hoisted(() => ({
  readings: [] as Reading[],
  buildings: [] as Building[],
  seq: 0,
}));

vi.mock("@/lib/supabase", async () => {
  const { readingKey } = await import("@/lib/csv");
  const copy = <T,>(rows: T[]) => rows.map((r) => ({ ...r }));
  return {
    fetchReadings: vi.fn(async () => copy(db.readings)),
    fetchBuildings: vi.fn(async () => copy(db.buildings)),
    insertReading: vi.fn(async (r: NewReading) => {
      const row = { ...r, id: `r${++db.seq}` };
      db.readings.push(row);
      return { ...row };
    }),
    bulkUpsert: vi.fn(async (rows: NewReading[]) => {
      for (const r of rows) {
        const i = db.readings.findIndex((x) => readingKey(x) === readingKey(r));
        if (i >= 0) db.readings[i] = { ...r, id: db.readings[i].id };
        else db.readings.push({ ...r, id: `r${++db.seq}` });
      }
    }),
    updateReading: vi.fn(async (id: string, patch: Partial<NewReading>) => {
      const i = db.readings.findIndex((x) => x.id === id);
      db.readings[i] = { ...db.readings[i], ...patch };
      return { ...db.readings[i] };
    }),
    deleteReading: vi.fn(async (id: string) => {
      db.readings = db.readings.filter((r) => r.id !== id);
    }),
    deleteReadings: vi.fn(async (ids: string[]) => {
      db.readings = db.readings.filter((r) => !ids.includes(r.id));
    }),
    insertBuilding: vi.fn(async (b: NewBuilding) => {
      const row = { ...b, id: `b${++db.seq}` };
      db.buildings.push(row);
      return { ...row };
    }),
    updateBuilding: vi.fn(),
    deleteBuilding: vi.fn(async (id: string) => {
      db.buildings = db.buildings.filter((b) => b.id !== id);
    }),
    signOut: vi.fn(),
  };
});

import { Dashboard } from "./Dashboard";

const home: Building = { id: "b1", name: "自宅", movedInOn: "2024-04-01", movedOutOn: null };
const reading: Reading = {
  id: "r0",
  utility: "electricity",
  provider: "TEPCO",
  buildingId: "b1",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  amountYen: 6200,
  usageValue: 210,
  usageUnit: "kWh",
  note: "エアコン",
  source: "csv",
};

async function openRecordsTab() {
  render(<Dashboard />);
  await screen.findByRole("tab", { name: "記録" });
  const tab = screen.getByRole("tab", { name: "記録" });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  await screen.findByText(/登録済みレコード/);
}

beforeEach(() => {
  db.readings = [{ ...reading }];
  db.buildings = [{ ...home }];
  db.seq = 0;
});

describe("Dashboard delete and undo", () => {
  it("deletes a record without a confirm dialog and puts every field back on undo", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await openRecordsTab();
    expect(screen.getByText("登録済みレコード（1 件）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /電気 自宅 .* を編集/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除" }));
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(db.readings).toHaveLength(0);
    expect(screen.getByText("登録済みレコード（0 件）")).toBeTruthy();
    // The deleted row took the focus with it; the undo button receives it.
    const undo = within(screen.getByRole("status")).getByRole("button", { name: "元に戻す" });
    expect(document.activeElement).toBe(undo);

    await act(async () => {
      fireEvent.click(undo);
    });
    expect(db.readings).toHaveLength(1);
    const { id: _id, ...restored } = db.readings[0]; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { id: _orig, ...original } = reading; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(restored).toEqual(original);
    expect(screen.getByText("登録済みレコード（1 件）")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("deletes an empty building and brings it back on undo", async () => {
    db.readings = [];
    db.buildings.push({ id: "b2", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" });
    await openRecordsTab();

    fireEvent.click(screen.getByRole("button", { name: "旧居 を編集" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除" }));
    });
    expect(db.buildings.map((b) => b.name)).toEqual(["自宅"]);
    expect(screen.getByRole("status").textContent).toContain("建物「旧居」を削除しました");

    await act(async () => {
      fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "元に戻す" }));
    });
    expect(db.buildings.map((b) => [b.name, b.movedInOn, b.movedOutOn])).toContainEqual(["旧居", "2020-04-01", "2024-03-31"]);
    expect(screen.getByRole("button", { name: "旧居 を編集" })).toBeTruthy();
  });

  it("refuses to delete a building that still has records and says why", async () => {
    await openRecordsTab();
    fireEvent.click(screen.getByRole("button", { name: "自宅 を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("alert").textContent).toContain("記録が 1 件あるため削除できません");
    expect(db.buildings).toHaveLength(1);
  });
});

describe("Dashboard record editor", () => {
  it("returns focus to the row after cancelling", async () => {
    await openRecordsTab();
    const row = screen.getByRole("button", { name: /電気 自宅 .* を編集/ });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: /キャンセル/ }));
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(row);
  });

  it("asks for the dates instead of sending an empty date to the database", async () => {
    await openRecordsTab();
    fireEvent.click(screen.getByRole("button", { name: /電気 自宅 .* を編集/ }));
    fireEvent.change(screen.getByLabelText("開始"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    });
    expect(screen.getByRole("alert").textContent).toBe("開始日と終了日を入力してください。");
    expect(db.readings[0].periodStart).toBe("2026-07-01");
  });

  it("saves lenient amounts like ¥6,500 and returns focus to the row", async () => {
    await openRecordsTab();
    const row = screen.getByRole("button", { name: /電気 自宅 .* を編集/ });
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText("金額（円）"), { target: { value: "¥６,５００" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    });
    expect(db.readings[0].amountYen).toBe(6500);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /電気 自宅 .* を編集/ }));
  });
});
