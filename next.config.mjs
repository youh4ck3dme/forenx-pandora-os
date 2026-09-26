import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // Potrebné pre Capacitor static build - Disabled for preview with API routes
  trailingSlash: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "three"],
  },
  compiler: {
    removeConsole: {
      exclude: ['error'],
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tanstack/react-start/server': path.resolve(__dirname, 'lib/tanstack-start-shim.ts'),
      '@tanstack/react-start': path.resolve(__dirname, 'lib/tanstack-start-shim.ts'),
      '@/forensic': path.resolve(__dirname, 'lib/forza/forensic'),
    };

    if (!isServer) {
      const emptyShim = path.resolve(__dirname, 'lib/empty-shim.ts');
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:fs/promises': emptyShim,
        'node:fs': emptyShim,
        'node:path': emptyShim,
        'node:crypto': emptyShim,
        'node:async_hooks': emptyShim,
      };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
        crypto: false,
        stream: false,
        os: false,
      };
    }

    return config;
  },
  // async headers() {
  //   return [
  //     {
  //       source: "/:path*",
  //       headers: [
  //         { key: "X-DNS-Prefetch-Control", value: "on" },
  //         { key: "X-Frame-Options", value: "SAMEORIGIN" },
  //         { key: "X-Content-Type-Options", value: "nosniff" },
  //         { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  //         { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  //       ],
  //     },
  //   ]
  // },
}


// import withPWAInit from 'next-pwa';
//
// const withPWA = withPWAInit({
//   dest: 'public',
//   disable: process.env.NODE_ENV === 'development',
//   register: true,
//   skipWaiting: true,
// });
//
// export default withPWA(nextConfig);
export default nextConfig;

