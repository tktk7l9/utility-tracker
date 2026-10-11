import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase", () => ({
  isConfigured: () => false,
  getSession: vi.fn(async () => null),
  onAuthChange: () => () => {},
}));

import Home from "./page";
import RootLayout, { metadata } from "./layout";

describe("Home page", () => {
  it("shows the app title and the setup guide when Supabase is not configured", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("光熱費トラッカー");
    expect(screen.getByText("Supabase が未設定です")).toBeTruthy();
  });
});

describe("RootLayout", () => {
  it("renders a Japanese document that keeps search engines out", () => {
    const html = renderToStaticMarkup(<RootLayout>本文</RootLayout>);
    expect(html).toContain('<html lang="ja"');
    expect(html).toContain("本文");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("keeps the analytics beacon out of the HTML (it is appended after hydration)", () => {
    // An external <script> without integrity in the markup fails the Observatory SRI test,
    // and the beacon cannot carry integrity (src/components/Analytics.tsx).
    const html = renderToStaticMarkup(<RootLayout>本文</RootLayout>);
    expect(html).not.toContain("cloudflareinsights");
  });
});
