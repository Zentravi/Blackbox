import type { NextConfig } from "next";

const securityHeaders = [
  // Never let other sites frame the app (clickjacking) — DENY works everywhere,
  // including the authenticated settings surfaces.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // HSTS is ignored by browsers over plain http (local dev), enforced when the
  // deployment terminates TLS.
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  // The app is fully self-contained (geist fonts, same-origin fetches, inline
  // styles for the motion library). No third-party script/style origins.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
