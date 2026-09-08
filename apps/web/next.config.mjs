/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig = {
  transpilePackages: ["@remember/shared"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/v1/:path*", destination: `${API_URL}/v1/:path*` },
    ];
  },
};

export default nextConfig;
