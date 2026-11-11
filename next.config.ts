import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // A stale worker would keep serving old pages, so the browser must always re-check it.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      },
      {
        // The Android app: phones recognise it as an app to install, saved under a friendly name.
        // Short caching so a new release reaches people quickly.
        source: "/download/solar-switch.apk",
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="Solar-Switch.apk"' },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" }
        ]
      }
    ];
  }
};

export default nextConfig;
