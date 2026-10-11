"use client";

import { useEffect } from "react";
import { BEACON_SRC, BEACON_TOKEN } from "@/lib/analytics";

/**
 * Cloudflare Web Analytics. The beacon is appended after hydration instead of being a
 * <script src> in the HTML: Cloudflare updates beacon.min.js in place behind an unversioned URL,
 * so it cannot carry Subresource Integrity, and an external script without `integrity` in the
 * markup costs the Observatory SRI test. Never add `integrity` to it: the next silent update
 * would stop the beacon. The CSP still allows its origin (src/lib/csp.ts).
 */
export function Analytics() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (document.querySelector(`script[src="${BEACON_SRC}"]`)) return;
    const beacon = document.createElement("script");
    beacon.type = "module";
    beacon.src = BEACON_SRC;
    beacon.dataset.cfBeacon = JSON.stringify({ token: BEACON_TOKEN });
    document.body.appendChild(beacon);
  }, []);
  return null;
}
