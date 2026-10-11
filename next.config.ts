import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/csp";

// src/lib/csp.ts is the source of truth for the CSP. In production worker.ts replaces its
// script-src 'unsafe-inline' with a per-request nonce on every HTML response.
const csp = contentSecurityPolicy({ dev: process.env.NODE_ENV === "development" });

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // No window.open / cross-origin popups are used, so a separate browsing-context group is free
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  compress: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react", "@radix-ui/react-tabs"],
  },
};

export default nextConfig;
