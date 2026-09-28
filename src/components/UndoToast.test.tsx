import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { UndoToast, type UndoNotice } from "./UndoToast";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** jsdom has no focus-visible heuristics; decide whether focus counts as keyboard focus. */
function stubFocusVisible(value: boolean) {
  const matches = Element.prototype.matches;
  return vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? value : matches.call(this, selector);
  });
}

const notice = (over: Partial<UndoNotice> = {}): UndoNotice => ({
  id: 1,
  message: "削除しました",
  undo: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe("UndoToast", () => {
  it("shows the message with an undo button and runs undo when pressed", async () => {
    const n = notice();
    const onClose = vi.fn();
    render(<UndoToast notice={n} onClose={onClose} />);

    expect(screen.getByRole("status").textContent).toContain("削除しました");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(n.undo).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes by itself after 8 seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(7999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close while undo is still running", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    const undo = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    render(<UndoToast notice={notice({ undo })} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(7000));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    expect(screen.getByRole("button", { name: "戻しています…" })).toHaveProperty("disabled", true);
    act(() => vi.advanceTimersByTime(20_000));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed undo on screen with the reason until it is dismissed", async () => {
    vi.useFakeTimers();
    const undo = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onClose = vi.fn();
    render(<UndoToast notice={notice({ undo })} onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("元に戻せませんでした。通信できませんでした");
    // It can be retried.
    expect(screen.getByRole("button", { name: "元に戻す" })).toHaveProperty("disabled", false);
  });

  it("shows a new notice without the previous notice's error", async () => {
    const undo = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { rerender } = render(<UndoToast notice={notice({ undo })} onClose={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    });
    rerender(<UndoToast notice={notice({ id: 2, message: "建物を削除しました" })} onClose={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("建物を削除しました");
    expect(screen.getByRole("status").textContent).not.toContain("元に戻せませんでした");
  });

  it("pauses the timer while the pointer is on it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    fireEvent.mouseEnter(screen.getByTestId("undo-toast"));
    act(() => vi.advanceTimersByTime(30_000));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByTestId("undo-toast"));
    act(() => vi.advanceTimersByTime(8000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses the timer while keyboard focus is inside it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "閉じる" });
    stubFocusVisible(true);
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(30_000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => outside.focus());
    act(() => vi.advanceTimersByTime(8000));
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it("does not pause for focus that did not come from the keyboard", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "閉じる" });
    stubFocusVisible(false);
    act(() => close.focus());
    act(() => vi.advanceTimersByTime(8000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "元に戻す" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to undo when the focused element was removed by the action", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    render(<UndoToast notice={notice()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "元に戻す" }));
  });

  it("does not steal focus from an element that still has it", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    render(<UndoToast notice={notice()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("can be dismissed", () => {
    const onClose = vi.fn();
    render(<UndoToast notice={notice()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty live region mounted without a notice so later notices are announced", () => {
    render(<UndoToast notice={null} onClose={vi.fn()} />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});
