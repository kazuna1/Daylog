import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Old names for the configuration page.
    return [
      { source: "/types", destination: "/configuration", permanent: true },
      { source: "/settings", destination: "/configuration", permanent: true },
    ];
  },
};

export default nextConfig;
