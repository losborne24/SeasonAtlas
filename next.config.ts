import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  headers() {
    return [
      { source: "/weather/:atlas/:day/:z/:x/:tile.png", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/weather/:atlas/:hour/:day/:z/:x/:tile.png", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/weather/manifest.json", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
