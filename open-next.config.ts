import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// キャッシュは既定のまま。ISR も on-demand revalidate も使っていない。
// https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig();
