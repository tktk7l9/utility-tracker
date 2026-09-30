import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    updateBuilding: vi.fn(async (id: string, patch: Partial<NewBuilding>) => {
      const i = db.buildings.findIndex((x) => x.id === id);
      db.buildings[i] = { ...db.buildings[i], ...patch };
      return { ...db.buildings[i] };
    }),
    deleteBuilding: vi.fn(async (id: string) => {
      db.buildings = db.buildings.filter((b) => b.id !== id);
    }),
    signOut: vi.fn(),
  };
});

import { Dashboard } from "./Dashboard";
import * as supabase from "@/lib/supabase";

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

// Undo spies (window.confirm, URL object URLs, anchor clicks) so they cannot leak into later tests.
afterEach(() => vi.restoreAllMocks());

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

async function renderLoaded() {
  const user = userEvent.setup();
  render(<Dashboard />);
  await screen.findByRole("tab", { name: "記録" });
  return user;
}

function month(m: string, amountYen: number, over: Partial<Reading> = {}): Reading {
  const [y, mm] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { ...reading, id: `m${m}`, periodStart: `${m}-01`, periodEnd: `${m}-${last}`, amountYen, note: null, ...over };
}

describe("Dashboard loading", () => {
  it("shows a loading message, then the overview", async () => {
    render(<Dashboard />);
    expect(screen.getByRole("status").textContent).toBe("読み込み中…");
    expect(await screen.findByRole("tab", { name: "料金・総評", selected: true })).toBeTruthy();
  });

  it("explains a load failure and offers to sign in again", async () => {
    vi.mocked(supabase.fetchReadings).mockRejectedValueOnce(new Error("Failed to fetch"));
    const user = userEvent.setup();
    render(<Dashboard />);
    expect((await screen.findByRole("alert")).textContent).toContain("データを読み込めませんでした。");
    expect(screen.getByRole("button", { name: /再読み込み/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /ログインし直す/ }));
    expect(supabase.signOut).toHaveBeenCalled();
  });
});

describe("Dashboard overview", () => {
  it("leads an empty account straight to the import tab", async () => {
    db.readings = [];
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: /請求書を取り込む/ }));
    expect(screen.getByRole("tab", { name: "取込", selected: true })).toBeTruthy();
    expect(screen.getByText("請求書の取込（PDF・CSV）")).toBeTruthy();
  });

  it("summarises complete months and says how many partial edge months were left out", async () => {
    db.readings = [
      { ...month("2026-04", 5000), periodStart: "2026-04-15" },
      month("2026-05", 6000),
      month("2026-06", 7000),
    ];
    await renderLoaded();
    expect(screen.getByText("期間合計（2ヶ月）")).toBeTruthy();
    expect(screen.getByText("※ 最初と最後の月は日数が足りないため、グラフに含めていません（1 か月）。")).toBeTruthy();
    expect(screen.getByText("期間の内訳（構成比）")).toBeTruthy();
  });

  it("filters every view by the chosen building", async () => {
    db.buildings.push({ id: "b2", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" });
    db.readings.push({ ...reading, id: "r9", buildingId: "b2", periodStart: "2023-07-01", periodEnd: "2023-07-31" });
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "記録" }));
    expect(screen.getByText("登録済みレコード（2 件）")).toBeTruthy();

    const oldHome = screen.getByRole("button", { name: "旧居" });
    await user.click(oldHome);
    expect(oldHome.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("登録済みレコード（1 件）")).toBeTruthy();
    expect(screen.getByRole("button", { name: /電気 旧居/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "すべて（合算）" }));
    expect(screen.getByText("登録済みレコード（2 件）")).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = await renderLoaded();
    // Tab past the building selector (すべて, 自宅) into the tab list.
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "料金・総評" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "使用量・単価", selected: true })).toBeTruthy();
    expect(screen.getByText("使用量と実効単価")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("前年同月比・季節性")).toBeTruthy();
  });
});

describe("Dashboard entry", () => {
  it("adds a manual record and shows it in the records tab", async () => {
    db.readings = [];
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "取込" }));
    // Every card is reachable by heading navigation, the collapsed manual entry too (SHIG 59).
    await user.click(screen.getByRole("heading", { name: "手入力" }));
    fireEvent.change(screen.getByLabelText("検針期間（開始）"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("検針期間（終了）"), { target: { value: "2026-08-31" } });
    await user.type(screen.getByLabelText("請求額（円・税込）"), "7000");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByText("保存しました。")).toBeTruthy();
    expect(db.readings).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "記録" }));
    expect(screen.getByText("登録済みレコード（1 件）")).toBeTruthy();
  });

  it("imports a CSV that overwrites a record and undoes the whole import", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "取込" }));
    const csv = "年月,使用量(kWh),請求額(円)\n2026/07,210,6500\n2026/08,250,7100\n";
    await user.upload(screen.getByLabelText("CSV / PDF ファイル"), new File([csv], "tepco.csv", { type: "text/csv" }));
    await user.click(screen.getByRole("checkbox", { name: /上書きする/ }));
    await user.click(await screen.findByRole("button", { name: "2 件を取り込む（上書き 1 件）" }));

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("2 件を取り込みました（うち上書き 1 件）");
    expect(db.readings.map((r) => r.amountYen).sort()).toEqual([6500, 7100]);

    await act(async () => {
      fireEvent.click(within(status).getByRole("button", { name: "元に戻す" }));
    });
    expect(db.readings.map((r) => r.amountYen)).toEqual([6200]);
  });

  it("files imported rows under the building chosen in the selector", async () => {
    db.readings = [];
    db.buildings.push({ id: "b2", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" });
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "旧居" }));
    await user.click(screen.getByRole("tab", { name: "取込" }));
    // The period falls in 自宅's residence, but the explicit choice wins.
    const csv = "年月,請求額(円)\n2026/07,6500\n";
    await user.upload(screen.getByLabelText("CSV / PDF ファイル"), new File([csv], "tepco.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "1 件を取り込む" }));
    expect(db.readings.map((r) => r.buildingId)).toEqual(["b2"]);
  });

  it("names the import without overwrites plainly", async () => {
    db.readings = [];
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "取込" }));
    const csv = "年月,請求額(円)\n2026/07,6500\n";
    await user.upload(screen.getByLabelText("CSV / PDF ファイル"), new File([csv], "tepco.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "1 件を取り込む" }));
    expect(screen.getByRole("status").textContent).toContain("1 件を取り込みました");
    expect(screen.getByRole("status").textContent).not.toContain("上書き");
  });
});

describe("Dashboard records tab", () => {
  it("renames a building and shows the new name in the selector", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "記録" }));
    await user.click(screen.getByRole("button", { name: "自宅 を編集" }));
    const name = screen.getByLabelText("名前");
    await user.clear(name);
    await user.type(name, "座間の家");
    await user.click(screen.getAllByRole("button", { name: "保存" })[0]);
    expect(screen.getByRole("button", { name: "座間の家 を編集" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^座間の家/, pressed: false })).toBeTruthy();
  });

  it("adds a building", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "記録" }));
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    await user.type(screen.getByLabelText("名前"), "新居");
    fireEvent.change(screen.getByLabelText("入居日"), { target: { value: "2027-03-01" } });
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("button", { name: "新居 を編集" })).toBeTruthy();
  });

  it("falls back to all buildings when the selected building is deleted", async () => {
    db.readings = [];
    db.buildings.push({ id: "b2", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" });
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "旧居" }));
    await user.click(screen.getByRole("tab", { name: "記録" }));
    await user.click(screen.getByRole("button", { name: "旧居 を編集" }));
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("button", { name: "すべて（合算）" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("downloads the records as JSON and CSV, and disables export without records", async () => {
    // jsdom has no object URLs; spy on them (restored in afterEach) instead of replacing the global URL.
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "記録" }));
    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "CSV" }));
    expect(clicked).toHaveLength(2);
    expect(clicked[0]).toMatch(/^utility-tracker_\d{4}-\d{2}-\d{2}\.json$/);
    expect(clicked[1]).toMatch(/\.csv$/);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("disables export when there is nothing to export", async () => {
    db.readings = [];
    const user = await renderLoaded();
    await user.click(screen.getByRole("tab", { name: "記録" }));
    expect(screen.getByRole("button", { name: "JSON" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "CSV" }).hasAttribute("disabled")).toBe(true);
  });
});
