import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy } from "./csp";
import {
  applyScriptNonce,
  createNonce,
  CSP_HEADER,
  isInlineJavaScript,
  type Rewriter,
  type ScriptElement,
  withScriptNonce,
  withScriptNonceWorker,
} from "./csp-nonce";

const STATIC_CSP = contentSecurityPolicy();
const NONCE_FORMAT = /^[A-Za-z0-9+/]{22}==$/;

/** Records the handler so tests can feed it fake <script> elements. */
function fakeRewriter() {
  const calls: { selector: string; handler: (el: ScriptElement) => void }[] = [];
  const transformed: Response[] = [];
  const rewriter: Rewriter = {
    on(selector, handlers) {
      calls.push({ selector, handler: handlers.element });
      return rewriter;
    },
    transform(response) {
      transformed.push(response);
      return response;
    },
  };
  return { rewriter: () => rewriter, calls, transformed };
}

/** A fake <script>. Names are lowercase, as HTMLRewriter reports them. */
function script(attrs: Record<string, string>) {
  return {
    attrs,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name: string) => name in attrs,
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
  };
}

function html(headers: Record<string, string> = {}) {
  return new Response("<html><script>1</script></html>", {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/html; charset=utf-8", [CSP_HEADER]: STATIC_CSP, ...headers },
  });
}

function nonceOf(response: Response): string | undefined {
  return response.headers.get(CSP_HEADER)?.match(/'nonce-([^']+)'/)?.[1];
}

describe("createNonce", () => {
  it("returns 128 random bits as base64", () => {
    expect(createNonce()).toMatch(NONCE_FORMAT);
    expect(atob(createNonce())).toHaveLength(16);
  });

  it("never repeats", () => {
    const nonces = new Set(Array.from({ length: 1000 }, createNonce));
    expect(nonces.size).toBe(1000);
  });
});

describe("withScriptNonce", () => {
  it("replaces 'unsafe-inline' in script-src only, keeping 'self' and the beacon host", () => {
    const out = withScriptNonce(STATIC_CSP, "abc");
    expect(out).toContain("script-src 'self' 'nonce-abc' https://static.cloudflareinsights.com;");
    // style-src keeps 'unsafe-inline' (React / recharts style attributes), which Observatory accepts.
    expect(out).toContain("style-src 'self' 'unsafe-inline';");
    expect(out).not.toMatch(/script-src[^;]*unsafe-inline/);
    // Only the script-src token changes; every other directive is byte-identical.
    expect(out).toBe(STATIC_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'nonce-abc'"));
  });

  it("never adds 'strict-dynamic' (it would make 'self' and the beacon host be ignored)", () => {
    expect(withScriptNonce(STATIC_CSP, "abc")).not.toContain("strict-dynamic");
  });

  it("handles script-src as the first directive", () => {
    expect(withScriptNonce("script-src 'unsafe-inline'; img-src 'self'", "n")).toBe(
      "script-src 'nonce-n'; img-src 'self'",
    );
  });

  it("returns null when there is nothing to tighten", () => {
    expect(withScriptNonce("default-src 'self'; script-src 'self'", "n")).toBeNull();
    expect(withScriptNonce("style-src 'unsafe-inline'", "n")).toBeNull();
  });
});

describe("isInlineJavaScript", () => {
  it.each<[string, Record<string, string>]>([
    ["no attributes (Next's own inline scripts)", {}],
    ["an empty type", { type: "" }],
    ["text/javascript", { type: "text/javascript" }],
    ["a JavaScript MIME type in any case", { type: "Application/JavaScript" }],
    ["a legacy JavaScript MIME type", { type: "text/x-ecmascript" }],
    ["a type wrapped in ASCII whitespace", { type: " text/javascript\n" }],
    ["type=module", { type: "module" }],
    ["type=MODULE", { type: "MODULE" }],
    ["an empty type that overrides language", { type: "", language: "vbscript" }],
    ["language=javascript without a type", { language: "JavaScript" }],
    ["an empty language without a type", { language: "" }],
    ["nomodule", { nomodule: "" }],
  ])("stamps %s", (_label, attrs) => {
    expect(isInlineJavaScript(script(attrs))).toBe(true);
  });

  it.each<[string, Record<string, string>]>([
    ["an external script", { src: "/_next/static/chunks/a.js" }],
    ["an empty src", { src: "" }],
    ["an external module", { type: "module", src: "/m.js" }],
    ["an SVG <script href> (SVG 2)", { href: "https://evil.example/x.js" }],
    ["an SVG <script xlink:href> (SVG 1.1)", { "xlink:href": "https://evil.example/x.js" }],
    ["application/ld+json (a data block)", { type: "application/ld+json" }],
    ["application/json", { type: "application/json" }],
    ["text/plain", { type: "text/plain" }],
    ["importmap", { type: "importmap" }],
    ["speculationrules", { type: "speculationrules" }],
    ["a JavaScript type with parameters (not an essence match)", { type: "text/javascript; charset=utf-8" }],
    ["a type wrapped in non-ASCII whitespace", { type: "\u00a0text/javascript" }],
    ["a type spelled with a character reference (arrives raw)", { type: "text&#47;javascript" }],
    ["language=vbscript without a type", { language: "vbscript" }],
  ])("does not stamp %s", (_label, attrs) => {
    expect(isInlineJavaScript(script(attrs))).toBe(false);
  });

  it("checks each JavaScript MIME type essence of the HTML spec", () => {
    const essences = [
      "application/ecmascript",
      "application/javascript",
      "application/x-ecmascript",
      "application/x-javascript",
      "text/ecmascript",
      "text/javascript",
      "text/javascript1.0",
      "text/javascript1.1",
      "text/javascript1.2",
      "text/javascript1.3",
      "text/javascript1.4",
      "text/javascript1.5",
      "text/jscript",
      "text/livescript",
      "text/x-ecmascript",
      "text/x-javascript",
    ];
    for (const type of essences) expect(isInlineJavaScript(script({ type })), type).toBe(true);
    expect(isInlineJavaScript(script({ type: "text/javascript1.6" }))).toBe(false);
  });
});

describe("applyScriptNonce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("swaps the CSP for a nonce one and stamps every inline JavaScript script", () => {
    const fake = fakeRewriter();
    const out = applyScriptNonce(html({ etag: '"x"', "content-length": "31" }), {
      nonce: "N",
      rewriter: fake.rewriter,
    });

    expect(out.status).toBe(200);
    expect(out.statusText).toBe("OK");
    expect(out.headers.get(CSP_HEADER)).toBe(
      STATIC_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'nonce-N'"),
    );
    expect(out.headers.get("etag")).toBeNull();
    expect(out.headers.get("content-length")).toBeNull();
    expect(out.headers.get("content-type")).toBe("text/html; charset=utf-8");

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].selector).toBe("script");
    // Next's RSC payload pushes and a module script are inline JavaScript.
    const inline = [script({}), script({ type: "module" })];
    // A JSON data block never runs, so it needs no nonce.
    const data = script({ type: "application/json" });
    const external = script({ src: "/_next/static/chunks/a.js", async: "" });
    const svgExternal = script({ href: "https://evil.example/x.js" });
    for (const el of [...inline, data, external, svgExternal]) fake.calls[0].handler(el);
    for (const el of inline) expect(el.attrs.nonce).toBe("N");
    expect(data.attrs.nonce).toBeUndefined();
    // External scripts are allowed by 'self' / the host allowlist and stay unstamped.
    expect(external.attrs.nonce).toBeUndefined();
    expect(svgExternal.attrs.nonce).toBeUndefined();
  });

  it("keeps the other security headers and exactly one CSP header", () => {
    const out = applyScriptNonce(html({ "x-frame-options": "DENY" }), {
      nonce: "N",
      rewriter: fakeRewriter().rewriter,
    });
    expect(out.headers.get("x-frame-options")).toBe("DENY");
    expect(out.headers.get(CSP_HEADER)?.match(/default-src/g)).toHaveLength(1);
  });

  it("keeps the status of error pages", () => {
    const notFound = new Response("<p>404</p>", {
      status: 404,
      headers: { "content-type": "text/html", [CSP_HEADER]: STATIC_CSP },
    });
    const out = applyScriptNonce(notFound, { nonce: "N", rewriter: fakeRewriter().rewriter });
    expect(out.status).toBe(404);
    expect(nonceOf(out)).toBe("N");
  });

  it("generates a fresh nonce per call by default", () => {
    const fake = fakeRewriter();
    const a = nonceOf(applyScriptNonce(html(), { rewriter: fake.rewriter }));
    const b = nonceOf(applyScriptNonce(html(), { rewriter: fake.rewriter }));
    expect(a).toMatch(NONCE_FORMAT);
    expect(b).toMatch(NONCE_FORMAT);
    expect(a).not.toBe(b);
  });

  it.each([
    ["non-HTML", new Response("{}", { headers: { "content-type": "application/json", [CSP_HEADER]: STATIC_CSP } })],
    [
      "RSC payload",
      new Response("0:{}", { headers: { "content-type": "text/x-component", [CSP_HEADER]: STATIC_CSP } }),
    ],
    ["no content-type", new Response(new Uint8Array([120]), { headers: { [CSP_HEADER]: STATIC_CSP } })],
    ["no body", new Response(null, { status: 304, headers: { "content-type": "text/html" } })],
    ["no CSP", new Response("<p>", { headers: { "content-type": "text/html" } })],
    [
      "CSP without 'unsafe-inline'",
      new Response("<p>", { headers: { "content-type": "text/html", [CSP_HEADER]: "script-src 'self'" } }),
    ],
  ])("passes %s responses through untouched", (_label, response) => {
    const fake = fakeRewriter();
    expect(applyScriptNonce(response, { rewriter: fake.rewriter })).toBe(response);
    expect(fake.calls).toHaveLength(0);
  });

  it("needs no options for responses it leaves alone", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(applyScriptNonce(json)).toBe(json);
  });

  it("uses the Workers HTMLRewriter by default", () => {
    const fake = fakeRewriter();
    vi.stubGlobal(
      "HTMLRewriter",
      class {
        constructor() {
          return fake.rewriter();
        }
      },
    );
    applyScriptNonce(html(), { nonce: "N" });
    expect(fake.transformed).toHaveLength(1);
  });

  it("fails loudly outside the Workers runtime instead of serving a nonce nobody stamped", () => {
    expect(() => applyScriptNonce(html(), { nonce: "N" })).toThrow(/HTMLRewriter/);
  });
});

describe("withScriptNonceWorker", () => {
  it("passes request, env and ctx through and gives each HTML response its own nonce", async () => {
    const inner = { fetch: vi.fn(async () => html()) };
    const fake = fakeRewriter();
    const worker = withScriptNonceWorker(inner, { rewriter: fake.rewriter });
    const request = new Request("https://example.com/");
    const env = { ASSETS: {} };
    const ctx = { waitUntil() {} };

    const first = await worker.fetch(request, env, ctx);
    const second = await worker.fetch(request, env, ctx);

    expect(inner.fetch).toHaveBeenCalledWith(request, env, ctx);
    expect(nonceOf(first)).toMatch(NONCE_FORMAT);
    expect(nonceOf(first)).not.toBe(nonceOf(second));
    expect(fake.transformed).toHaveLength(2);
  });

  it("returns non-HTML responses from the inner worker as they are", async () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const worker = withScriptNonceWorker({ fetch: () => json });
    expect(await worker.fetch(new Request("https://example.com/api"), {}, {})).toBe(json);
  });
});
