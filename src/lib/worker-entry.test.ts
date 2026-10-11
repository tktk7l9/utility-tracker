// Guards the wiring that makes the per-request nonce reach production. Nothing else fails if it
// breaks: with "main" pointed back at .open-next/worker.js, or with HTML served straight from
// Workers Assets, pages still render, just with script-src 'unsafe-inline' again.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

/** Minimal JSONC reader: drops comments outside strings and trailing commas. */
function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = i;
      const literal = end.exec(text)![0];
      out += literal;
      i += literal.length - 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("Worker entry", () => {
  const wrangler = parseJsonc(readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8"));
  const entry = readFileSync(path.join(ROOT, "worker.ts"), "utf8");

  it("wrangler.jsonc runs worker.ts, not the bare OpenNext worker", () => {
    expect(wrangler.main).toBe("worker.ts");
  });

  it("worker.ts wraps the OpenNext worker with the nonce rewriter", () => {
    expect(entry).toMatch(/^import openNextWorker from "\.\/\.open-next\/worker\.js";$/m);
    expect(entry).toMatch(/^export default withScriptNonceWorker\(openNextWorker as FetchWorker\);$/m);
  });

  it("serves no HTML as a static asset, which would skip worker.ts", () => {
    // OpenNext fills .open-next/assets with public/ and the hashed /_next/static build output;
    // prerendered pages stay in its cache and are served by the Worker.
    expect((wrangler.assets as { directory?: string }).directory).toBe(".open-next/assets");
    const html = filesUnder(path.join(ROOT, "public")).filter((file) => /\.html?$/i.test(file));
    expect(html).toEqual([]);
  });
});
