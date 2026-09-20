import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "@browserbasehq/sdk"],
  images: { unoptimized: true },
};

export default nextConfig;
