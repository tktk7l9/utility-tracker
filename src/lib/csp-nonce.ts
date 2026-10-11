// Per-request script nonce for HTML responses, applied by the Worker entry (worker.ts).
//
// next.config.ts headers() serve the static CSP from src/lib/csp.ts, whose script-src has
// 'unsafe-inline' because Next writes its bootstrap and RSC payload as inline <script>
// (self.__next_f.push). Next 16's proxy cannot issue a nonce on OpenNext (it runs only on the
// Node runtime), but every HTML response does pass through the Worker. So the Worker swaps
// 'unsafe-inline' in script-src for a fresh nonce and stamps that nonce on each inline <script>
// with HTMLRewriter (streaming, no buffering).
//
// 'strict-dynamic' is deliberately NOT added: 'self' keeps allowing the /_next/static chunks and
// the host source keeps allowing the Cloudflare Web Analytics beacon. External scripts are left
// unstamped for the same reason: 'self' and the host allowlist already cover them, and stamping
// every <script src> would let an injected external script skip that allowlist.
//
// Responses that are not HTML (RSC, JSON, the icon) keep the static header unchanged; they run
// no inline script. `next dev` / `next start` never reach this code and keep the static CSP.

export const CSP_HEADER = "Content-Security-Policy";

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Replaces 'unsafe-inline' in the script-src directive with 'nonce-<nonce>'.
 * Returns null when script-src has no 'unsafe-inline' (nothing to tighten), so the caller
 * leaves the response untouched instead of stamping nonces nobody checks.
 */
export function withScriptNonce(policy: string, nonce: string): string | null {
  let replaced = false;
  const directives = policy.split(";").map((directive) => {
    const tokens = directive.trim().split(/\s+/);
    if (tokens[0] !== "script-src" || !tokens.includes("'unsafe-inline'")) return directive;
    replaced = true;
    const rewritten = tokens.map((t) => (t === "'unsafe-inline'" ? `'nonce-${nonce}'` : t)).join(" ");
    // Keep the original leading space so the joined policy reads the same as the input.
    return directive.startsWith(" ") ? ` ${rewritten}` : rewritten;
  });
  return replaced ? directives.join(";") : null;
}

/** The subset of Cloudflare's HTMLRewriter used here (no workers-types dependency). */
export interface ScriptElement {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): unknown;
}
export interface Rewriter {
  on(selector: string, handlers: { element(el: ScriptElement): void }): Rewriter;
  transform(response: Response): Response;
}

function workersRewriter(): Rewriter {
  const ctor = (globalThis as { HTMLRewriter?: new () => Rewriter }).HTMLRewriter;
  if (!ctor) throw new Error("HTMLRewriter is not available outside the Workers runtime");
  return new ctor();
}

export interface NonceOptions {
  nonce?: string;
  rewriter?: () => Rewriter;
}

/**
 * Tightens the CSP of an HTML response to a per-request nonce and stamps that nonce on every
 * inline <script>. External scripts are left alone ('self' / host sources allow them).
 * Exactly one CSP header is kept: the static one is replaced, never appended to (two CSP headers
 * would both be enforced).
 */
export function applyScriptNonce(
  response: Response,
  { nonce = createNonce(), rewriter = workersRewriter }: NonceOptions = {},
): Response {
  if (!response.body) return response;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
    return response;
  }
  const policy = response.headers.get(CSP_HEADER);
  const tightened = policy === null ? null : withScriptNonce(policy, nonce);
  if (tightened === null) return response;

  const headers = new Headers(response.headers);
  headers.set(CSP_HEADER, tightened);
  // The body now differs per request: a validator would let a 304 pair an old body
  // (old nonce) with a new header (new nonce) and block every inline script.
  headers.delete("etag");
  headers.delete("content-length");

  const rewritten = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return rewriter()
    .on("script", {
      element(el) {
        if (!el.hasAttribute("src")) el.setAttribute("nonce", nonce);
      },
    })
    .transform(rewritten);
}

/** The fetch handler shape of the OpenNext worker (.open-next/worker.js). */
export interface FetchWorker {
  fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response>;
}

/**
 * Wraps a Worker so each of its responses goes through applyScriptNonce (a fresh nonce per
 * request). worker.ts uses it around the OpenNext worker.
 */
export function withScriptNonceWorker(worker: FetchWorker, options: Omit<NonceOptions, "nonce"> = {}): FetchWorker {
  return {
    async fetch(request, env, ctx) {
      return applyScriptNonce(await worker.fetch(request, env, ctx), options);
    },
  };
}
