import path from "node:path";
import { fileURLToPath } from "node:url";
import { withWorkflow } from "workflow/next";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.CAPACITOR_BUILD === 'true' 
    ? 'export' 
    : (process.env.STANDALONE === 'true' || process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined),
  trailingSlash: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", "100.70.1.16"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      // Supabase storage (own project)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // Hetzner S3 object vault
      { protocol: "https", hostname: "*.your-objectstorage.com" },
      { protocol: "https", hostname: "*.hetzner.com" },
      // Avatars / identity providers used in auth
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
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
  webpack: (config, { isServer, webpack }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@tanstack/react-start/server': path.resolve(__dirname, 'lib/tanstack-start-shim.ts'),
      '@tanstack/react-start': path.resolve(__dirname, 'lib/tanstack-start-shim.ts'),
      '@/forensic': path.resolve(__dirname, 'lib/forza/forensic'),
    };

    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        })
      );

      const emptyShim = path.resolve(__dirname, 'lib/empty-shim.ts');
      config.resolve.alias = {
        ...config.resolve.alias,
        'fs/promises': emptyShim,
        fs: emptyShim,
        path: emptyShim,
        crypto: emptyShim,
        async_hooks: emptyShim,
        // Workflow API is loaded only inside authenticated server handlers.
        // The client bundle must not resolve the local Workflow World (Node-only).
        'workflow/api': emptyShim,
        workflow: emptyShim,
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (ako vo vercel.json): vstavaný PANDORA browser framuje
          // interné forensic aplikácie (/forza/*, pandora://) same-origin;
          // cross-origin framing zostáva zablokovaný.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Content-Security-Policy is set dynamically in middleware.ts with a
          // per-request nonce (buildCsp). Do not add a static CSP here — it
          // would override the nonce-bearing header that middleware sets.
        ],
      },
    ];
  },
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
export default withWorkflow(nextConfig);
