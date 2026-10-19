import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // SSE must flush small frames through the same-origin proxy immediately.
  compress: false,
  async rewrites() {
    return [{
      source: "/api/v1/:path*",
      destination: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001"}/api/v1/:path*`,
    }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default config;
