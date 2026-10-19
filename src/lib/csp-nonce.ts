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
// Only inline JavaScript gets the nonce (isInlineJavaScript): an SVG <script> has no `src` and
// loads its file from `href`, so it is left unstamped like any external script, and data blocks
// never run, so they need none.
//
// Trust boundary: HTMLRewriter cannot tell Next's own inline scripts from injected ones, so ANY
// inline <script> that reaches the HTML is stamped. The CSP still blocks injected event handlers,
// javascript: URLs and scripts inserted through the DOM, but not a <script> element that is
// already in the server-rendered HTML. The nonce is therefore safe only while the server never
// emits untrusted HTML: React escapes everything it renders (meter readings and CSV/PDF imports
// included), and no file sets raw HTML. src/lib/trust-boundary.test.ts enforces this: it fails
// as soon as dangerouslySetInnerHTML appears outside its allowlist, which is empty.
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
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): unknown;
}

// The JavaScript MIME type essences. A <script> whose type is one of them (ASCII
// case-insensitive, surrounding whitespace stripped, no parameters) runs as a classic script;
// "module" runs as a module script; the browser runs no other type.
// https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
// https://mimesniff.spec.whatwg.org/#javascript-mime-type
const JAVASCRIPT_TYPES = new Set([
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
]);

/** The script's type string, derived from `type` / `language` as the HTML spec does. */
function scriptType(el: ScriptElement): string {
  const type = el.getAttribute("type");
  const language = el.getAttribute("language");
  if (type === "" || (type === null && !language)) return "text/javascript";
  if (type !== null) return type.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
  return `text/${language}`;
}

/**
 * True only for inline classic or module JavaScript, the one kind of <script> that needs the
 * nonce. Left unstamped:
 * - `src`: an external script. 'self' and the host sources decide whether it loads; a nonce
 *   would let it load from anywhere.
 * - `href` / `xlink:href`: an SVG <script> loads its file from these (it has no `src`), so a
 *   nonce would let an off-allowlist script load.
 * - any other type: data blocks such as application/ld+json never run; importmap and
 *   speculationrules are not used here and stay blocked.
 * HTMLRewriter hands over attribute values raw (character references are not decoded), so a
 * type spelled with one never matches and that script stays blocked: errors fall on the
 * blocking side.
 */
export function isInlineJavaScript(el: ScriptElement): boolean {
  if (el.hasAttribute("src") || el.hasAttribute("href") || el.hasAttribute("xlink:href")) {
    return false;
  }
  const type = scriptType(el).toLowerCase();
  return type === "module" || JAVASCRIPT_TYPES.has(type);
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
 * inline JavaScript <script> (isInlineJavaScript). External scripts are left alone ('self' /
 * host sources allow them), and so are data blocks.
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
        if (isInlineJavaScript(el)) el.setAttribute("nonce", nonce);
      },
    })
    .transform(rewritten);
}

// Next and OpenNext mark prerendered pages and their RSC payloads `s-maxage=31536000,
// stale-while-revalidate=2592000`, a header meant for a CDN: Vercel rewrites it for browsers,
// Workers passes it through. Chrome then serves old RSC payloads from its disk cache for up to
// 30 days, and after a deploy they name chunk files that no longer exist (404, unstyled page,
// broken navigation). Browsers get Vercel's value instead: revalidate on every use.
const CACHE_CONTROL_HEADER = "Cache-Control";
const BROWSER_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const SHARED_MAX_AGE = /(^|,)\s*s-maxage\s*=/i;

/**
 * The Cache-Control a browser should get: a value with the s-maxage directive (a CDN header)
 * becomes "public, max-age=0, must-revalidate". Every other value is returned unchanged, so
 * private/no-store responses and the immutable static assets keep theirs; null stays null.
 */
export function browserCacheControl(value: string | null): string | null {
  return value !== null && SHARED_MAX_AGE.test(value) ? BROWSER_CACHE_CONTROL : value;
}

/**
 * Applies browserCacheControl to a response. The header is written only when its value changes:
 * a response without Cache-Control gets none, and an unchanged one is returned as it is.
 */
export function applyBrowserCacheControl(response: Response): Response {
  const value = response.headers.get(CACHE_CONTROL_HEADER);
  const browser = browserCacheControl(value);
  if (browser === null || browser === value) return response;

  const headers = new Headers(response.headers);
  headers.set(CACHE_CONTROL_HEADER, browser);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The fetch handler shape of the OpenNext worker (.open-next/worker.js). */
export interface FetchWorker {
  fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response>;
}

/**
 * Wraps a Worker so every one of its responses (HTML, RSC payloads, route handlers) gets a
 * browser Cache-Control (applyBrowserCacheControl) and then goes through applyScriptNonce (a
 * fresh nonce per request for HTML). worker.ts uses it around the OpenNext worker.
 */
export function withScriptNonceWorker(worker: FetchWorker, options: Omit<NonceOptions, "nonce"> = {}): FetchWorker {
  return {
    async fetch(request, env, ctx) {
      return applyScriptNonce(applyBrowserCacheControl(await worker.fetch(request, env, ctx)), options);
    },
  };
}
