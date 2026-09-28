import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Building, NewReading, Reading } from "@/lib/domain";
import { EntryForm } from "./EntryForm";

const home: Building = { id: "b1", name: "自宅", movedInOn: "2024-04-01", movedOutOn: null };
const oldHome: Building = { id: "b0", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" };

function setup(
  over: { buildings?: Building[]; readings?: Reading[]; defaultBuildingId?: string | null; onAdd?: (r: NewReading) => Promise<void> } = {}
) {
  const onAdd = over.onAdd ?? vi.fn<(r: NewReading) => Promise<void>>().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <EntryForm
      buildings={over.buildings ?? [home, oldHome]}
      readings={over.readings ?? []}
      defaultBuildingId={over.defaultBuildingId ?? null}
      onAdd={onAdd}
    />
  );
  return { user, onAdd };
}

function setPeriod(start: string, end: string) {
  fireEvent.change(screen.getByLabelText("検針期間（開始）"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("検針期間（終了）"), { target: { value: end } });
}

describe("EntryForm", () => {
  it("adds a bill with a lenient amount, infers the building from the period and moves on to the next period", async () => {
    const { user, onAdd } = setup();
    setPeriod("2026-07-01", "2026-07-31");
    expect(screen.getByRole("option", { name: "自動（推定: 自宅）" })).toBeTruthy();

    await user.type(screen.getByLabelText("請求額（円・税込）"), "¥6,200");
    await user.type(screen.getByLabelText("使用量（kWh・任意）"), "210");
    await user.type(screen.getByLabelText("メモ（任意）"), "  エアコン  ");
    await user.click(screen.getByRole("button", { name: "追加する" }));

    expect(onAdd).toHaveBeenCalledWith({
      utility: "electricity",
      buildingId: "b1",
      provider: "TEPCO",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      amountYen: 6200,
      usageValue: 210,
      usageUnit: "kWh",
      note: "エアコン",
      source: "manual",
    });
    expect(screen.getByText("保存しました。")).toBeTruthy();
    // The fields are cleared and the period moves past the one just saved.
    expect((screen.getByLabelText("請求額（円・税込）") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("検針期間（開始）") as HTMLInputElement).value > "2026-07-31").toBe(true);
  });

  it("sends a null usage and note when they are left empty", async () => {
    const { user, onAdd } = setup({ defaultBuildingId: "b0" });
    setPeriod("2023-01-01", "2023-01-31");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "5000");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ buildingId: "b0", usageValue: null, usageUnit: null, note: null })
    );
  });

  it("rejects an amount that is not a number", async () => {
    const { user, onAdd } = setup();
    await user.type(screen.getByLabelText("請求額（円・税込）"), "abc");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).toBe("金額は0以上の数値で入力してください。");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("rejects a period that ends before it starts", async () => {
    const { user, onAdd } = setup();
    setPeriod("2026-07-31", "2026-07-01");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).toBe("期間の終了日は開始日以降にしてください。");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("rejects a negative usage", async () => {
    const { user, onAdd } = setup();
    setPeriod("2026-07-01", "2026-07-31");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100");
    await user.type(screen.getByLabelText("使用量（kWh・任意）"), "-3");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).toBe("使用量は0以上の数値で入力してください。");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("asks for a building when none covers the period", async () => {
    const { user, onAdd } = setup();
    setPeriod("2010-01-01", "2010-01-31");
    expect(screen.getByRole("option", { name: "自動（推定: 該当なし）" })).toBeTruthy();
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).toBe("建物を選択してください。");
    expect(onAdd).not.toHaveBeenCalled();

    // Picking the building by hand resolves it.
    await user.selectOptions(screen.getByLabelText("建物"), "旧居");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ buildingId: "b0" }));
  });

  it("switches the unit and shows the bimonthly hint for water", async () => {
    const { user, onAdd } = setup();
    await user.click(screen.getByRole("button", { name: "水道" }));
    expect(screen.getByRole("button", { name: "水道" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/水道は2か月ごとの請求です/)).toBeTruthy();
    expect(screen.getByLabelText("使用量（m³・任意）")).toBeTruthy();

    setPeriod("2026-05-01", "2026-06-30");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "8000");
    await user.type(screen.getByLabelText("使用量（m³・任意）"), "30");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ utility: "water", usageUnit: "m³", usageValue: 30 }));

    await user.click(screen.getByRole("button", { name: "ガス" }));
    expect(screen.queryByText(/水道は2か月ごとの請求です/)).toBeNull();
  });

  it("starts after the last record of the chosen utility", async () => {
    const last: Reading = {
      id: "r1",
      utility: "gas",
      provider: "LPIO",
      buildingId: "b1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      amountYen: 4000,
      usageValue: null,
      usageUnit: null,
      source: "csv",
    };
    const { user } = setup({ readings: [last] });
    await user.click(screen.getByRole("button", { name: "ガス" }));
    expect((screen.getByLabelText("検針期間（開始）") as HTMLInputElement).value).toBe("2026-07-01");
  });

  it("shows a friendly message when saving fails and keeps the input", async () => {
    const onAdd = vi.fn<(r: NewReading) => Promise<void>>().mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    const { user } = setup({ onAdd });
    setPeriod("2026-07-01", "2026-07-31");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect((screen.getByLabelText("請求額（円・税込）") as HTMLInputElement).value).toBe("100");
    expect(screen.queryByText("保存しました。")).toBeNull();
    expect(screen.getByRole("button", { name: "追加する" }).hasAttribute("disabled")).toBe(false);
  });

  it("disables the button while saving", async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { user } = setup({ onAdd });
    setPeriod("2026-07-01", "2026-07-31");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    const busy = screen.getByRole("button", { name: "保存中…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    resolve();
    expect(await screen.findByText("保存しました。")).toBeTruthy();
  });

  it("submits with the Enter key", async () => {
    const { user, onAdd } = setup();
    setPeriod("2026-07-01", "2026-07-31");
    await user.type(screen.getByLabelText("請求額（円・税込）"), "100{Enter}");
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
