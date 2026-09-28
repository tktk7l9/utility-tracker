import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { UndoToast } from "./UndoToast";

afterEach(() => vi.useRealTimers());

describe("UndoToast", () => {
  it("shows the message with an undo button and runs undo when pressed", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<UndoToast notice={{ id: 1, message: "削除しました", undo }} onClose={onClose} />);

    expect(screen.getByRole("status").textContent).toContain("削除しました");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes by itself after 8 seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast notice={{ id: 1, message: "削除しました", undo: vi.fn() }} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(7999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the notice open and explains when undo fails", async () => {
    const undo = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onClose = vi.fn();
    render(<UndoToast notice={{ id: 1, message: "削除しました", undo }} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("通信できませんでした");
  });

  it("can be dismissed", () => {
    const onClose = vi.fn();
    render(<UndoToast notice={{ id: 1, message: "削除しました", undo: vi.fn() }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a notice", () => {
    const { container } = render(<UndoToast notice={null} onClose={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
