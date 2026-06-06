import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repona/core é distribuído como TypeScript (workspace); o Next precisa transpilá-lo.
  transpilePackages: ["@repona/core"],
};

export default nextConfig;
