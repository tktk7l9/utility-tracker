import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Caching stays at the defaults. Neither ISR nor on-demand revalidation is used.
// https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig();
