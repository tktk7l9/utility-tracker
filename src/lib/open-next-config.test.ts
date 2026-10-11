// open-next.config.ts decides whether the Worker serves the prerendered page or re-renders it
// on every request. Reverting it keeps the site working (every request still answers 200), so
// nothing but this test notices that each request costs a full render again.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "../../open-next.config.ts"), "utf8");

describe("open-next.config.ts", () => {
  it("reads prerendered pages from the static assets incremental cache", () => {
    expect(source).toMatch(
      /^import staticAssetsIncrementalCache from "@opennextjs\/cloudflare\/overrides\/incremental-cache\/static-assets-incremental-cache";$/m,
    );
    expect(source).toMatch(/^\s*incrementalCache: staticAssetsIncrementalCache,$/m);
  });

  it("answers cached routes before the Next server loads", () => {
    expect(source).toMatch(/^\s*enableCacheInterception: true,$/m);
  });
});
