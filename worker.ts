// Worker entry (wrangler.jsonc "main"). Wraps the OpenNext worker so every HTML response gets
// a per-request script nonce instead of script-src 'unsafe-inline' (src/lib/csp-nonce.ts).
// Static assets (/_next/static/*) are served by Workers Assets before this runs; no HTML is
// served that way (src/lib/worker-entry.test.ts checks public/ for it).
// https://opennext.js.org/cloudflare/howtos/custom-worker

// The file exists only after `opennextjs-cloudflare build`; wrangler resolves it when bundling.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- missing in CI typecheck (no build yet), present locally after a build
import openNextWorker from "./.open-next/worker.js";
import { type FetchWorker, withScriptNonceWorker } from "./src/lib/csp-nonce";

export default withScriptNonceWorker(openNextWorker as FetchWorker);
