import { describe, expect, it } from "vitest";
import { BEACON_SRC } from "./analytics";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  const prod = contentSecurityPolicy();

  it("is the exact policy production serves before the Worker adds the nonce", () => {
    expect(prod).toBe(
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
        "connect-src 'self' https://*.supabase.co https://cloudflareinsights.com",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    );
  });

  it("does not include a nonce (worker.ts adds one per HTML response, src/lib/csp-nonce.ts)", () => {
    expect(prod).not.toContain("nonce-");
  });

  it("does not include 'strict-dynamic'", () => {
    // In CSP Level 3, 'strict-dynamic' makes 'self' and host sources be ignored: the
    // /_next/static chunks and the analytics beacon would then need nonces of their own.
    expect(prod).not.toContain("strict-dynamic");
    expect(contentSecurityPolicy({ dev: true })).not.toContain("strict-dynamic");
  });

  it("does not emit 'unsafe-eval' in production", () => {
    expect(prod).not.toContain("unsafe-eval");
  });

  it("adds 'unsafe-eval' in dev for HMR", () => {
    expect(contentSecurityPolicy({ dev: true })).toContain(
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com 'unsafe-eval';",
    );
  });

  it("allows both origins the analytics beacon needs", () => {
    // If either is missing the page still looks fine while only the beacon is silently blocked.
    expect(prod).toContain(`script-src 'self' 'unsafe-inline' ${new URL(BEACON_SRC).origin};`);
    expect(prod).toContain("https://cloudflareinsights.com;");
  });

  it("keeps Supabase reachable for auth and data", () => {
    expect(prod).toContain("connect-src 'self' https://*.supabase.co ");
  });

  it("directives are separated by ; with no trailing ;", () => {
    expect(prod.endsWith(";")).toBe(false);
    expect(prod).not.toContain(";;");
  });
});
