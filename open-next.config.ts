import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Every route is prerendered at build time (○ in the `next build` route table). The page is a
// static shell: sign-in and every read/write happen in the browser through supabase-js
// (session in localStorage, RLS on the Supabase side), so nothing on the server depends on the
// visitor. Neither ISR nor on-demand revalidation is used.
//
// An incremental cache is still required to *serve* that output: with the "dummy" default
// OpenNext cannot read it, so the Worker re-rendered the page on every request
// (`x-nextjs-cache: MISS`).
//
// The static assets cache serves the build output instead: `opennextjs-cloudflare deploy` /
// `preview` copy it under cdn-cgi/_next_cache/ (reachable only from the Worker). It is
// read-only, which fits a site with no revalidation. Cache interception answers cached routes
// in the routing layer, without loading the Next server or rendering React; the HTML still
// leaves through worker.ts, so each response gets its own nonce. It does not work with PPR.
// If a route ever needs the request on the server (cookies, auth), it must become dynamic (ƒ)
// and will then bypass this cache by itself.
// src/lib/open-next-config.test.ts keeps both settings.
// https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
