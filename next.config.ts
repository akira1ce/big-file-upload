import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  transpilePackages: ["lucide-react"],
  output: 'standalone',
  // Add static file serving configuration
  async rewrites() {
    return [
      {
        source: '/files/:path*',
        destination: '/files/:path*',
      },
    ];
  },
  /* config options here */
};

export default nextConfig;
