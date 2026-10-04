import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const configPath = path.join(rootDir, "mobile", "capacitor.config.json");

const profile = process.argv[2] || "local";

const baseConfig = {
  appId: "com.pandora.browser",
  appName: "PANDORA Forensic OS",
  webDir: "../out",
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#000000",
      showSpinner: false,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#000000",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
  ios: {
    contentInset: "automatic",
    scheme: "PANDORA",
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

const profiles = {
  local: {
    ...baseConfig,
    appName: "PANDORA OS (Local Dev)",
    server: {
      url: "http://100.70.1.16:3000",
      androidScheme: "http",
      cleartext: true,
    },
  },
  staging: {
    ...baseConfig,
    appName: "PANDORA OS (Staging)",
    server: {
      url: "https://pandora.whoiswho.at",
      androidScheme: "https",
      cleartext: false,
    },
  },
  production: {
    ...baseConfig,
    appName: "PANDORA Forensic OS",
    server: {
      androidScheme: "https",
      cleartext: false,
    },
  },
};

const selected = profiles[profile];
if (!selected) {
  console.error(`[mobile-profile] Unknown profile "${profile}". Valid: local, staging, production`);
  process.exit(1);
}

fs.writeFileSync(configPath, JSON.stringify(selected, null, 2) + "\n", "utf8");
console.log(`[mobile-profile] Successfully applied mobile profile: "${profile}"`);
console.log(`[mobile-profile] Target URL: ${selected.server?.url || "bundled (out/)"}`);
console.log(`[mobile-profile] Web debugging enabled: ${selected.android.webContentsDebuggingEnabled}`);
