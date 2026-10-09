import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    // live timing needed a paid F1TV login; the page is now replay-only
    return [{ source: "/live", destination: "/replay", permanent: true }];
  },
};

export default nextConfig;
