import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Only the Docker image needs the self-contained server; `next start` (used by the CLI) does not support it.
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
