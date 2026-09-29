import { describe, it, expect, vi } from "vitest";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { MonthlyBucket } from "@/lib/aggregate";
import type { Reading } from "@/lib/domain";

// jsdom has no layout, so ResponsiveContainer measures 0x0 and draws nothing.
// Give the chart a fixed size so the SVG (axes, reference-line labels, legend) is rendered.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children) ? cloneElement(children as React.ReactElement<{ width: number; height: number }>, { width: 800, height: 360 }) : null,
  };
});

import { CostChart } from "./CostChart";
import { UsageChart } from "./UsageChart";
import { CompositionCard } from "./CompositionCard";
import { ChartTooltip, RefLineLabel } from "./ChartTooltip";
import { ProviderLinks } from "./ProviderLinks";

function bucket(month: string, electricity: number, gas: number, water: number): MonthlyBucket {
  return {
    month,
    electricity,
    gas,
    water,
    total: electricity + gas + water,
    usage: { electricity: 0, gas: 0, water: 0 },
    complete: true,
  };
}

function reading(over: Partial<Reading>): Reading {
  return {
    id: "r",
    utility: "electricity",
    provider: "TEPCO",
    buildingId: "b1",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    amountYen: 6000,
    usageValue: 200,
    usageUnit: "kWh",
    source: "csv",
    ...over,
  };
}

describe("CostChart", () => {
  it("says there is no data yet", () => {
    render(<CostChart data={[]} />);
    expect(screen.getByText("まだデータがありません。")).toBeTruthy();
  });

  it("labels both reference lines in words, draws month ticks and the legend in total-first order", () => {
    const { container } = render(<CostChart data={[bucket("2026-05", 14000, 6000, 4000), bucket("2026-06", 16000, 6000, 4000)]} />);
    expect(screen.getByText("一般家庭の目安 22,000円")).toBeTruthy();
    expect(screen.getByText("この期間の平均 25,000円")).toBeTruthy();
    expect(screen.getByText("26/05")).toBeTruthy();
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["合計", "電気", "ガス", "水道"]);
  });
});

describe("UsageChart", () => {
  const readings = [
    reading({ id: "a" }),
    reading({ id: "b", periodStart: "2026-06-01", periodEnd: "2026-06-30", amountYen: 7000, usageValue: 250 }),
    reading({ id: "c", utility: "gas", provider: "LPIO", amountYen: 4000, usageValue: 20, usageUnit: "m³" }),
  ];

  it("shows the average unit price for the chosen utility and switches with the chips", async () => {
    const user = userEvent.setup();
    render(<UsageChart readings={readings} />);
    // (6,000 / 200 + 7,000 / 250) / 2 = 29 yen per kWh.
    expect(screen.getByText("平均単価 ¥29")).toBeTruthy();
    expect(screen.getByText("使用量(kWh)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "ガス" }));
    expect(screen.getByRole("button", { name: "ガス" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("使用量(m³)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "水道" }));
    expect(screen.getByText("水道のデータがありません。")).toBeTruthy();
    expect(screen.queryByText(/引っ越し月/)).toBeNull();
  });

  it("omits the average line when no month has a unit price", () => {
    render(<UsageChart readings={[reading({ usageValue: null, usageUnit: null })]} />);
    expect(screen.queryByText(/平均単価/)).toBeNull();
  });
});

describe("CompositionCard", () => {
  it("renders nothing without any cost", () => {
    const { container } = render(<CompositionCard data={[bucket("2026-05", 0, 0, 0)]} />);
    expect(container.textContent).toBe("");
  });

  it("lists each utility's share of the period", () => {
    render(<CompositionCard data={[bucket("2026-05", 6000, 3000, 1000)]} />);
    expect(screen.getByText("期間の内訳（構成比）")).toBeTruthy();
    expect(screen.getByText("6,000円")).toBeTruthy();
    expect(screen.getByText("60.0%")).toBeTruthy();
    expect(screen.getByText("10,000円")).toBeTruthy();
  });
});

describe("ChartTooltip", () => {
  const payload = [
    { name: "電気", value: 6000, color: "#f00", dataKey: "electricity" },
    { name: "合計", value: 9000, color: "#000", dataKey: "total" },
  ];

  it("renders nothing while inactive or empty", () => {
    const { container, rerender } = render(<ChartTooltip active={false} payload={payload} label="2026-05" />);
    expect(container.textContent).toBe("");
    rerender(<ChartTooltip active payload={[]} label="2026-05" />);
    expect(container.textContent).toBe("");
  });

  it("formats the label and values and hides the requested series", () => {
    render(
      <ChartTooltip
        active
        payload={payload}
        label="2026-05"
        labelFormatter={(l) => `${l} 月`}
        valueFormatter={(v) => `${v} 円`}
        hideKeys={["total"]}
      />
    );
    expect(screen.getByText("2026-05 月")).toBeTruthy();
    expect(screen.getByText("6000 円")).toBeTruthy();
    expect(screen.queryByText("合計")).toBeNull();
  });

  it("falls back to the raw label and values", () => {
    render(<ChartTooltip active payload={payload} label={5} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("9000")).toBeTruthy();
  });
});

describe("RefLineLabel", () => {
  const viewBox = { x: 10, y: 50, width: 200, height: 0 };

  it("draws nothing until recharts gives it a position", () => {
    const { container } = render(
      <svg>
        <RefLineLabel text="平均" />
      </svg>
    );
    expect(container.querySelector("text")).toBeNull();
  });

  it("anchors the text at the chosen end, above or below the line", () => {
    const { container } = render(
      <svg>
        <RefLineLabel viewBox={viewBox} text="右上" />
        <RefLineLabel viewBox={viewBox} text="左下" align="left" side="below" />
      </svg>
    );
    const [right, left] = Array.from(container.querySelectorAll("text"));
    expect([right.textContent, right.getAttribute("text-anchor"), right.getAttribute("x"), right.getAttribute("y")]).toEqual(["右上", "end", "206", "45"]);
    expect([left.textContent, left.getAttribute("text-anchor"), left.getAttribute("x"), left.getAttribute("y")]).toEqual(["左下", "start", "14", "63"]);
  });
});

describe("ProviderLinks", () => {
  it("opens each provider's billing page in a new tab safely", () => {
    render(<ProviderLinks />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["電気（TEPCO）", "ガス（LPIO）", "水道（東京都水道局）"]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});
