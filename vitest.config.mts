import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

const rootDir = import.meta.dirname;

function toPosix(p: string) {
  return p.split(path.sep).join(path.posix.sep);
}

function resolveFile(filePath: string) {
  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    "/index.ts",
    "/index.tsx",
  ];
  for (const ext of extensions) {
    const full = filePath + ext;
    if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) {
      return toPosix(full);
    }
  }
  return null;
}

function tsPathsPlugin(): Plugin {
  const libPrefix = toPosix(path.resolve(rootDir, "lib"));
  return {
    name: "ts-paths-resolver",
    enforce: "pre",
    resolveId(id: string) {
      const normalizedId = toPosix(id);
      if (normalizedId.startsWith("@/lib/")) {
        const sub = normalizedId.slice("@/lib/".length);
        const forzaPath = path.resolve(rootDir, "lib/forza", sub);
        const resolvedForza = resolveFile(forzaPath);
        if (resolvedForza) return resolvedForza;
        const libPath = path.resolve(rootDir, "lib", sub);
        return resolveFile(libPath);
      }
      if (normalizedId.startsWith(libPrefix + "/")) {
        const sub = normalizedId.slice(libPrefix.length + 1);
        if (!sub.startsWith("forza/")) {
          const forzaPath = path.resolve(rootDir, "lib/forza", sub);
          const resolvedForza = resolveFile(forzaPath);
          if (resolvedForza) return resolvedForza;
        }
      }
      return null;
    },
  };
}

const sharedTestConfig = {
  testTimeout: 15000,
  globals: true,
  setupFiles: ["./vitest.setup.ts"],
};

const sharedAliases = {
  "@tanstack/react-start/server": toPosix(
    path.resolve(rootDir, "lib/tanstack-start-shim.ts"),
  ),
  "@tanstack/react-start": toPosix(
    path.resolve(rootDir, "lib/tanstack-start-shim.ts"),
  ),
  "@/forensic": toPosix(path.resolve(rootDir, "lib/forza/forensic")),
  "@/hooks": toPosix(path.resolve(rootDir, "lib/hooks")),
  "@": toPosix(path.resolve(rootDir)),
};

export default defineConfig({
  plugins: [react(), tsPathsPlugin()],
  test: {
    ...sharedTestConfig,
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/scratch/**",
      "**/.next/**",
      "**/db/cleanroom/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    alias: sharedAliases,
    projects: [
      {
        plugins: [react(), tsPathsPlugin()],
        test: {
          ...sharedTestConfig,
          name: "main",
          environment: "jsdom",
          include: ["**/*.test.{ts,tsx}"],
          exclude: [
            "**/node_modules/**",
            "**/scratch/**",
            "**/.next/**",
            "**/db/cleanroom/**",
            "**/e2e/**",
            "**/supabase/tests/**",
          ],
          maxWorkers: 2,
          alias: sharedAliases,
        },
      },
      {
        plugins: [tsPathsPlugin()],
        test: {
          ...sharedTestConfig,
          name: "cleanroom",
          environment: "node",
          include: ["db/cleanroom/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/e2e/**", "**/.next/**"],
          pool: "forks",
          maxWorkers: 1,
          minWorkers: 1,
          alias: sharedAliases,
        },
      },
      {
        plugins: [tsPathsPlugin()],
        test: {
          ...sharedTestConfig,
          name: "supabase-db",
          environment: "node",
          include: ["supabase/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
          pool: "forks",
          maxWorkers: 1,
          minWorkers: 1,
          alias: sharedAliases,
        },
      },
    ],
  },
});
