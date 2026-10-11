import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { BEACON_SRC, BEACON_TOKEN } from "@/lib/analytics";
import { Analytics } from "./Analytics";

function beacons() {
  return document.querySelectorAll<HTMLScriptElement>(`script[src="${BEACON_SRC}"]`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const el of beacons()) el.remove();
});

describe("Analytics", () => {
  it("appends the beacon after hydration in production, without integrity", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = render(<Analytics />);

    expect(container.innerHTML).toBe("");
    const [beacon, ...rest] = beacons();
    expect(rest).toHaveLength(0);
    expect(beacon.parentElement).toBe(document.body);
    expect(beacon.type).toBe("module");
    expect(JSON.parse(beacon.dataset.cfBeacon ?? "")).toEqual({ token: BEACON_TOKEN });
    // Cloudflare swaps the content behind the unversioned URL; a pinned hash would block it.
    expect(beacon.hasAttribute("integrity")).toBe(false);
  });

  it("adds the beacon only once across remounts", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<Analytics />).unmount();
    render(<Analytics />);
    expect(beacons()).toHaveLength(1);
  });

  it("stays out of dev and tests so local visits are not counted", () => {
    render(<Analytics />);
    vi.stubEnv("NODE_ENV", "development");
    render(<Analytics />);
    expect(beacons()).toHaveLength(0);
  });
});
