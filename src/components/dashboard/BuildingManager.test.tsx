import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Building, NewBuilding } from "@/lib/domain";
import { BuildingManager } from "./BuildingManager";

const home: Building = { id: "b1", name: "自宅", movedInOn: "2024-04-01", movedOutOn: null };
const oldHome: Building = { id: "b0", name: "旧居", movedInOn: "2020-04-01", movedOutOn: "2024-03-31" };

function setup(
  over: {
    buildings?: Building[];
    counts?: [string, number][];
    onAdd?: (b: NewBuilding) => Promise<void>;
    onUpdate?: (id: string, patch: Partial<NewBuilding>) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
  } = {}
) {
  const props = {
    onAdd: over.onAdd ?? vi.fn<(b: NewBuilding) => Promise<void>>().mockResolvedValue(undefined),
    onUpdate: over.onUpdate ?? vi.fn<(id: string, p: Partial<NewBuilding>) => Promise<void>>().mockResolvedValue(undefined),
    onDelete: over.onDelete ?? vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  const user = userEvent.setup();
  render(
    <BuildingManager buildings={over.buildings ?? [oldHome, home]} readingCounts={new Map(over.counts ?? [])} {...props} />
  );
  return { user, ...props };
}

describe("BuildingManager list", () => {
  it("lists buildings by move-in date with their record count and a 現住 badge on the current one", () => {
    setup({ buildings: [home, oldHome], counts: [["b1", 3]] });
    const rows = screen.getAllByRole("button", { name: / を編集$/ });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["旧居 を編集", "自宅 を編集"]);
    expect(within(rows[1]).getByText("3 件")).toBeTruthy();
    expect(within(rows[1]).getByText("現住")).toBeTruthy();
    expect(within(rows[0]).getByText("0 件")).toBeTruthy();
    expect(within(rows[0]).queryByText("現住")).toBeNull();
  });

  it("says when there are no buildings yet", () => {
    setup({ buildings: [] });
    expect(screen.getByText("まだ建物が登録されていません。")).toBeTruthy();
  });

  it("toggles the editor from the row and reports it with aria-expanded", async () => {
    const { user } = setup();
    const row = screen.getByRole("button", { name: "自宅 を編集" });
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("自宅");
    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("名前")).toBeNull();
  });
});

describe("BuildingManager editing", () => {
  it("saves trimmed changes, clears an empty move-out date to null and returns focus to the row", async () => {
    const { user, onUpdate } = setup();
    const row = screen.getByRole("button", { name: "旧居 を編集" });
    await user.click(row);
    const name = screen.getByLabelText("名前");
    await user.clear(name);
    await user.type(name, "  実家  ");
    fireEvent.change(screen.getByLabelText("退去日（空欄 = 現住）"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onUpdate).toHaveBeenCalledWith("b0", { name: "実家", movedInOn: "2020-04-01", movedOutOn: null });
    expect(document.activeElement).toBe(row);
  });

  it.each([
    ["名前", "", "名前を入力してください。"],
    ["入居日", "", "入居日を入力してください。"],
    ["退去日（空欄 = 現住）", "2019-01-01", "退去日は入居日以降にしてください。"],
  ])("rejects an invalid %s", async (label, value, message) => {
    const { user, onUpdate } = setup();
    await user.click(screen.getByRole("button", { name: "旧居 を編集" }));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the reason when saving fails", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("保存に失敗しました"));
    const { user } = setup({ onUpdate });
    await user.click(screen.getByRole("button", { name: "自宅 を編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert").textContent).toBe("保存に失敗しました");
    expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(false);
  });

  it("closes on cancel and returns focus to the row", async () => {
    const { user } = setup();
    const row = screen.getByRole("button", { name: "自宅 を編集" });
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(row);
  });

  it("deletes an empty building without asking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { user, onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "旧居 を編集" }));
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(onDelete).toHaveBeenCalledWith("b0");
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("名前")).toBeNull();
  });

  it("explains next to the button why a building with records cannot be deleted", async () => {
    const { user, onDelete } = setup({ counts: [["b1", 2]] });
    await user.click(screen.getByRole("button", { name: "自宅 を編集" }));
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("alert").textContent).toContain("記録が 2 件あるため削除できません");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("shows the reason when deleting fails", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("削除に失敗しました"));
    const { user } = setup({ onDelete });
    await user.click(screen.getByRole("button", { name: "旧居 を編集" }));
    await user.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.getByRole("alert").textContent).toBe("削除に失敗しました");
  });
});

describe("BuildingManager adding", () => {
  it("adds a building and returns focus to the add button", async () => {
    const { user, onAdd } = setup();
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    expect(screen.getByPlaceholderText("例: 座間新居")).toBeTruthy();
    await user.type(screen.getByLabelText("名前"), " 新居 ");
    fireEvent.change(screen.getByLabelText("入居日"), { target: { value: "2027-03-01" } });
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "新居", movedInOn: "2027-03-01", movedOutOn: null });
    const addButton = screen.getByRole("button", { name: "建物を追加" });
    expect(document.activeElement).toBe(addButton);
  });

  it("keeps a move-out date when one is given", async () => {
    const { user, onAdd } = setup();
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    await user.type(screen.getByLabelText("名前"), "寮");
    fireEvent.change(screen.getByLabelText("入居日"), { target: { value: "2015-04-01" } });
    fireEvent.change(screen.getByLabelText("退去日（空欄 = 現住）"), { target: { value: "2018-03-31" } });
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "寮", movedInOn: "2015-04-01", movedOutOn: "2018-03-31" });
  });

  it("validates the name, move-in date and move-out order", async () => {
    const { user, onAdd } = setup();
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    const add = screen.getByRole("button", { name: "追加する" });
    await user.click(add);
    expect(screen.getByRole("alert").textContent).toBe("名前を入力してください。");
    await user.type(screen.getByLabelText("名前"), "寮");
    await user.click(add);
    expect(screen.getByRole("alert").textContent).toBe("入居日を入力してください。");
    fireEvent.change(screen.getByLabelText("入居日"), { target: { value: "2015-04-01" } });
    fireEvent.change(screen.getByLabelText("退去日（空欄 = 現住）"), { target: { value: "2014-01-01" } });
    await user.click(add);
    expect(screen.getByRole("alert").textContent).toBe("退去日は入居日以降にしてください。");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("keeps the form and shows the reason when adding fails", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("追加に失敗しました"));
    const { user } = setup({ onAdd });
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    await user.type(screen.getByLabelText("名前"), "寮");
    fireEvent.change(screen.getByLabelText("入居日"), { target: { value: "2015-04-01" } });
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("alert").textContent).toBe("追加に失敗しました");
    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("寮");
  });

  it("cancels the add form and returns focus to the add button", async () => {
    const { user, onAdd } = setup();
    await user.click(screen.getByRole("button", { name: "建物を追加" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "建物を追加" }));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
