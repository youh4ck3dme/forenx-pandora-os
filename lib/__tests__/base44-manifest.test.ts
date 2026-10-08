// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const names = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
];

describe("Base44 root manifest", () => {
  it("describes the web app and keeps the Electron entry only for packaging", () => {
    expect(pkg.main).toBeUndefined();
    expect(pkg.build.extraMetadata.main).toBe("dist-electron/main.mjs");
    expect(pkg.build.appId).toBe("com.pandora.browser");
    expect(pkg.scripts["electron:dev"]).toContain("electron dist-electron/main.mjs");
  });

  it("keeps Next.js runtime in production dependencies", () => {
    for (const name of ["next", "react", "react-dom"]) {
      expect(pkg.dependencies[name], name).toBeTruthy();
      expect(pkg.devDependencies[name]).toBeUndefined();
    }
  });

  it("does not pull Capacitor, Expo, or React Native into the root manifest", () => {
    const forbidden = names.filter(
      (name) =>
        name.startsWith("@capacitor/") ||
        name === "expo" ||
        name.startsWith("expo-") ||
        name.startsWith("@expo/") ||
        name === "react-native" ||
        name.startsWith("react-native-"),
    );
    expect(forbidden).toEqual([]);
  });
});
