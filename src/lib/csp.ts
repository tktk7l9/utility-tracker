// Source of truth for the Content-Security-Policy. The headers() in next.config.ts serves it on
// every response the Next server produces (HTML, RSC, the icon).
//
// script-src has 'unsafe-inline' here because Next writes its bootstrap and RSC payload as inline
// <script> (self.__next_f.push). In production every HTML response passes through worker.ts,
// which swaps that token for a per-request nonce (src/lib/csp-nonce.ts), so browsers never see
// 'unsafe-inline' in script-src on pages. `next dev` / `next start` never run the Worker and keep
// this static value. Next 16's proxy (middleware) cannot issue the nonce instead: it runs only on
// the Node runtime, which OpenNext on Cloudflare Workers does not support.
//
// Other origins:
// - Supabase REST/Auth live on <project>.supabase.co (connect-src).
// - The Cloudflare Web Analytics beacon is loaded from static.cloudflareinsights.com (script-src)
//   and POSTs measurements to cloudflareinsights.com (connect-src). If either is missing the page
//   still looks fine while only the beacon is silently blocked, so csp.test.ts pins both.
// - style-src keeps 'unsafe-inline' for the style attributes React and recharts write.
// - dev adds 'unsafe-eval' because HMR uses eval.
export function contentSecurityPolicy({ dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com${dev ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self' https://*.supabase.co https://cloudflareinsights.com",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
