import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MonthlyBucket } from "@/lib/aggregate";
import { SummaryCards } from "./SummaryCards";

function bucket(month: string, electricity: number, gas = 0, water = 0, kwh = 0): MonthlyBucket {
  return {
    month,
    electricity,
    gas,
    water,
    total: electricity + gas + water,
    usage: { electricity: kwh, gas: 0, water: 0 },
    complete: true,
  };
}

describe("SummaryCards", () => {
  it("invites an empty account to import its first bill", async () => {
    const onStartImport = vi.fn();
    const user = userEvent.setup();
    render(<SummaryCards monthly={[]} onStartImport={onStartImport} />);
    await user.click(screen.getByRole("button", { name: /請求書を取り込む/ }));
    expect(onStartImport).toHaveBeenCalledTimes(1);
  });

  it("shows the latest month with the year-over-year rise, month-over-month change and per-day cost", () => {
    render(
      <SummaryCards
        monthly={[bucket("2025-06", 6000), bucket("2026-05", 7000), bucket("2026-06", 6000, 2000, 1000, 210.25)]}
        onStartImport={() => {}}
      />
    );
    expect(screen.getByText("2026年6月の合計")).toBeTruthy();
    expect(screen.getByText("9,000円")).toBeTruthy();
    expect(screen.getByText(/前年同月比 \+3,000円/)).toBeTruthy();
    expect(screen.getByText("（+50.0%）")).toBeTruthy();
    expect(screen.getByText("+2,000円")).toBeTruthy();
    expect(screen.getByText("300円")).toBeTruthy();
    // Each utility's share and the latest usage with its unit.
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("210.3 kWh")).toBeTruthy();
  });

  it("treats an unchanged total as flat and leaves out a percentage it cannot compute", () => {
    render(<SummaryCards monthly={[bucket("2025-06", 0), bucket("2026-06", 0)]} onStartImport={() => {}} />);
    expect(screen.getByText(/前年同月比 0円/)).toBeTruthy();
    expect(screen.queryByText(/%）/)).toBeNull();
  });

  it("shows a dash when there is no previous month", () => {
    render(<SummaryCards monthly={[bucket("2026-06", 5000)]} onStartImport={() => {}} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/前年同月比/)).toBeNull();
  });

  it("marks a decrease", () => {
    render(<SummaryCards monthly={[bucket("2025-06", 8000), bucket("2026-06", 6000)]} onStartImport={() => {}} />);
    expect(screen.getByText(/前年同月比 -2,000円/)).toBeTruthy();
  });
});
