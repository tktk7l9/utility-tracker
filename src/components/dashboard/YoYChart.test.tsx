import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { MonthlyBucket } from "@/lib/aggregate";
import { YoYChart } from "./YoYChart";

function bucket(month: string, total: number): MonthlyBucket {
  return {
    month,
    electricity: total,
    gas: 0,
    water: 0,
    total,
    usage: { electricity: 0, gas: 0, water: 0 },
    complete: true,
  };
}

const data = [bucket("2024-06", 4000), bucket("2025-06", 5000), bucket("2026-06", 6000)];

describe("YoYChart", () => {
  it("compares this year with last year and says the difference in words", () => {
    render(<YoYChart data={data} />);
    expect(screen.getByText(/2026年は、2025年と比べられる 1 か月の合計で/)).toBeTruthy();
    expect(screen.getByText("+1,000円")).toBeTruthy();
    expect(screen.getByText(/増えました/)).toBeTruthy();
    expect(screen.getByText("2026年（塗り）")).toBeTruthy();
    expect(screen.getByText("2025年（点線の枠）")).toBeTruthy();
  });

  it("marks the selected chips with aria-pressed and lets an older pair be compared", () => {
    render(<YoYChart data={data} />);
    expect(screen.getByRole("button", { name: "合計" }).getAttribute("aria-pressed")).toBe("true");
    const older = screen.getByRole("button", { name: "2025年 と 2024年" });
    expect(older.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(older);
    expect(older.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/2025年は、2024年と比べられる 1 か月の合計で/)).toBeTruthy();
  });

  it("explains when there is no previous year to compare with", () => {
    render(<YoYChart data={[bucket("2026-06", 6000)]} />);
    expect(screen.getByText("2026年の前年の記録がないため、比べられる月がありません。")).toBeTruthy();
    expect(screen.queryByText(/点線の枠/)).toBeNull();
    expect(screen.queryByRole("group", { name: "比べる年" })).toBeNull();
  });

  it("shows an empty message without data", () => {
    render(<YoYChart data={[]} />);
    expect(screen.getByText("データがありません。")).toBeTruthy();
  });
});
