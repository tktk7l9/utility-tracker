import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Building, NewReading, Reading } from "@/lib/domain";
import { RecordList } from "./RecordList";

const home: Building = { id: "b1", name: "自宅", movedInOn: "2024-04-01", movedOutOn: null };
const oldHome: Building = { id: "b0", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" };

function reading(i: number, over: Partial<Reading> = {}): Reading {
  const month = String((i % 12) + 1).padStart(2, "0");
  const year = 2020 + Math.floor(i / 12);
  return {
    id: `r${i}`,
    utility: "gas",
    provider: "LPIO",
    buildingId: "b1",
    periodStart: `${year}-${month}-01`,
    periodEnd: `${year}-${month}-28`,
    amountYen: 1000 + i,
    usageValue: null,
    usageUnit: null,
    source: "manual",
    ...over,
  };
}

function setup(readings: Reading[], over: { onUpdate?: (id: string, p: Partial<NewReading>) => Promise<void>; onDelete?: (id: string) => Promise<void> } = {}) {
  const onUpdate = over.onUpdate ?? vi.fn<(id: string, p: Partial<NewReading>) => Promise<void>>().mockResolvedValue(undefined);
  const onDelete = over.onDelete ?? vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <RecordList
      readings={readings}
      buildings={[home, oldHome]}
      buildingNameById={new Map([["b1", "自宅"], ["b0", "旧居"]])}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  );
  return { user, onUpdate, onDelete };
}

describe("RecordList", () => {
  it("says when there are no records", () => {
    setup([]);
    expect(screen.getByText("まだレコードがありません。")).toBeTruthy();
  });

  it("lists the newest first, shows usage with its unit and pages the rest behind もっと見る", async () => {
    const many = Array.from({ length: 30 }, (_, i) => reading(i));
    many[29] = reading(29, { utility: "electricity", usageValue: 210, usageUnit: "kWh", source: "pdf" });
    const { user } = setup(many);
    const rows = () => screen.getAllByRole("button", { name: / を編集$/ });
    expect(rows()).toHaveLength(12);
    expect(rows()[0].textContent).toContain("210 kWh");
    expect(rows()[0].textContent).toContain("PDF");

    await user.click(screen.getByRole("button", { name: "もっと見る（残り 18 件）" }));
    expect(rows()).toHaveLength(30);
    expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();
  });

  it("filters by utility with the counts on the chips and resets paging (SHIG 22, 12)", async () => {
    const many = Array.from({ length: 30 }, (_, i) => reading(i));
    many[0] = reading(0, { utility: "water" });
    many[1] = reading(1, { utility: "electricity" });
    const { user } = setup(many);
    const rows = () => screen.getAllByRole("button", { name: / を編集$/ });
    expect(screen.getByRole("group", { name: "種別で絞り込む" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "すべて 30", pressed: true })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "水道 1" }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("水道");
    expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();

    // A filter with nothing behind it says so instead of showing an empty list.
    await user.click(screen.getByRole("button", { name: "ガス 28" }));
    await user.click(screen.getByRole("button", { name: "もっと見る（残り 16 件）" }));
    expect(rows()).toHaveLength(28);
    await user.click(screen.getByRole("button", { name: "電気 1" }));
    expect(rows()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "ガス 28" }));
    // Paging starts over when the filter changes.
    expect(rows()).toHaveLength(12);
  });

  it("says when the chosen utility has no records", async () => {
    const { user } = setup([reading(0)]);
    await user.click(screen.getByRole("button", { name: "電気 0" }));
    expect(screen.getByText("電気のレコードはありません。")).toBeTruthy();
    // No empty list (and its rule) is left under the message.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("falls back to the building id when the name is unknown", () => {
    setup([reading(1, { buildingId: "gone" })]);
    expect(screen.getByRole("button", { name: /^ガス gone / })).toBeTruthy();
  });

  it("moves a record to another building and changes its usage and note", async () => {
    const { user, onUpdate } = setup([reading(1)]);
    await user.click(screen.getByRole("button", { name: /ガス 自宅/ }));
    await user.selectOptions(screen.getByLabelText("建物"), "旧居");
    await user.type(screen.getByLabelText("使用量（m³）"), "12.5");
    await user.type(screen.getByLabelText("メモ"), " 検針ミス訂正 ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", {
      buildingId: "b0",
      periodStart: "2020-02-01",
      periodEnd: "2020-02-28",
      amountYen: 1001,
      usageValue: 12.5,
      usageUnit: "m³",
      note: "検針ミス訂正",
    });
  });

  it.each([
    ["金額（円）", "たくさん", "金額は0以上の数値で入力してください。"],
    ["終了", "2019-01-01", "終了日は開始日以降にしてください。"],
    ["使用量（m³）", "-1", "使用量は0以上の数値で入力してください。"],
  ])("rejects an invalid %s", async (label, value, message) => {
    const { user, onUpdate } = setup([reading(1)]);
    await user.click(screen.getByRole("button", { name: /ガス 自宅/ }));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the reason when saving or deleting fails", async () => {
    const { user } = setup([reading(1, { note: "メモ" })], {
      onUpdate: vi.fn().mockRejectedValue(new Error("保存できませんでした")),
      onDelete: vi.fn().mockRejectedValue(new Error("削除できませんでした")),
    });
    await user.click(screen.getByRole("button", { name: /ガス 自宅/ }));
    expect((screen.getByLabelText("メモ") as HTMLInputElement).value).toBe("メモ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert").textContent).toBe("保存できませんでした");
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("alert").textContent).toBe("削除できませんでした");
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(false);
  });

  it("opens the editor from the keyboard", async () => {
    const { user } = setup([reading(1)]);
    // Tab past the four filter chips into the list.
    for (let i = 0; i < 5; i++) await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /ガス 自宅/ }));
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("金額（円）")).toBeTruthy();
  });

  it("saves with Enter from any field, without tabbing to the button", async () => {
    const { user, onUpdate } = setup([reading(1)]);
    await user.click(screen.getByRole("button", { name: /ガス 自宅/ }));
    const amount = screen.getByLabelText("金額（円）");
    await user.clear(amount);
    await user.type(amount, "1,500{Enter}");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onUpdate).mock.calls[0][1].amountYen).toBe(1500);
  });

  it("does not delete or cancel on Enter inside the editor", async () => {
    const { user, onDelete } = setup([reading(1)]);
    await user.click(screen.getByRole("button", { name: /ガス 自宅/ }));
    expect(screen.getByRole("button", { name: "削除" }).getAttribute("type")).toBe("button");
    expect(screen.getByRole("button", { name: "キャンセル" }).getAttribute("type")).toBe("button");
    await user.click(screen.getByLabelText("メモ"));
    await user.keyboard("{Enter}");
    expect(onDelete).not.toHaveBeenCalled();
  });
});
