import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

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
  const libPrefix = toPosix(path.resolve(__dirname, "lib"));
  return {
    name: "ts-paths-resolver",
    enforce: "pre",
    resolveId(id: string) {
      const normalizedId = toPosix(id);
      if (normalizedId.startsWith("@/lib/")) {
        const sub = normalizedId.slice("@/lib/".length);
        const forzaPath = path.resolve(__dirname, "lib/forza", sub);
        const resolvedForza = resolveFile(forzaPath);
        if (resolvedForza) return resolvedForza;
        const libPath = path.resolve(__dirname, "lib", sub);
        return resolveFile(libPath);
      }
      if (normalizedId.startsWith(libPrefix + "/")) {
        const sub = normalizedId.slice(libPrefix.length + 1);
        if (!sub.startsWith("forza/")) {
          const forzaPath = path.resolve(__dirname, "lib/forza", sub);
          const resolvedForza = resolveFile(forzaPath);
          if (resolvedForza) return resolvedForza;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), tsPathsPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/scratch/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    alias: {
      "@tanstack/react-start/server": toPosix(
        path.resolve(__dirname, "lib/tanstack-start-shim.ts"),
      ),
      "@tanstack/react-start": toPosix(
        path.resolve(__dirname, "lib/tanstack-start-shim.ts"),
      ),
      "@/forensic": toPosix(path.resolve(__dirname, "lib/forza/forensic")),
      "@/hooks": toPosix(path.resolve(__dirname, "lib/hooks")),
      "@": toPosix(path.resolve(__dirname)),
    },
  },
});
