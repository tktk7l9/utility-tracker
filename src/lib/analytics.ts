// Cloudflare Web Analytics beacon, appended after hydration by src/components/Analytics.tsx.
// The CSP allows this script origin in script-src and the measurement endpoint
// (cloudflareinsights.com) in connect-src (src/lib/csp.ts; csp.test.ts keeps them in sync).
export const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/**
 * Site token. It is an identifier meant to be public (it is sent with every page view), not a
 * secret. gitleaks flags a 32-digit hex as generic-api-key, so gitleaks:allow on the line
 * suppresses it; a .gitleaks.toml would replace the whole default ruleset instead.
 */
export const BEACON_TOKEN = "cd156fbf0fd24da0a12e58fdb4e63828"; // gitleaks:allow
