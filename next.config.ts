import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required headers for ONNX Runtime Web (SharedArrayBuffer)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "credentialless",
          },
        ],
      },
    ];
  },

  // Turbopack configuration (Next.js 16 default bundler)
  turbopack: {},
};

export default nextConfig;

