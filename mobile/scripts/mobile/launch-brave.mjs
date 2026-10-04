import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const isMobile = process.argv.includes("--mobile");
const targetUrl = process.argv.find((a) => a.startsWith("http")) || "http://localhost:3000";

const possibleBravePaths = [
  path.join(os.homedir(), "AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe"),
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

const braveExe = possibleBravePaths.find((p) => fs.existsSync(p));

if (!braveExe) {
  console.error("[brave-dev] Could not find brave.exe in standard paths.");
  process.exit(1);
}

const profileDir = path.join(os.homedir(), ".pandora-brave-dev-profile");
if (!fs.existsSync(profileDir)) {
  fs.mkdirSync(profileDir, { recursive: true });
}

// Prepare Dev preferences if not present
const defaultPrefDir = path.join(profileDir, "Default");
if (!fs.existsSync(defaultPrefDir)) {
  fs.mkdirSync(defaultPrefDir, { recursive: true });
}

const preferencesFile = path.join(defaultPrefDir, "Preferences");
if (!fs.existsSync(preferencesFile)) {
  const initialPrefs = {
    devtools: {
      preferences: {
        currentDockState: '"right"',
        uiTheme: '"darkSkin"',
      },
    },
  };
  fs.writeFileSync(preferencesFile, JSON.stringify(initialPrefs, null, 2), "utf8");
}

const args = [
  `--user-data-dir=${profileDir}`,
  "--remote-debugging-port=9222",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=Translate",
  "--auto-open-devtools-for-tabs",
];

if (isMobile) {
  // Mobile viewport dimensions (e.g. 412x915)
  args.push("--window-size=430,932");
  args.push(`--user-agent=Mozilla/5.0 (Linux; Android 14; Mobile; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 PandoraMobile/1.0`);
} else {
  args.push("--window-size=1400,900");
}

// Open Dev target URL + mobile inspection page
args.push(targetUrl);
args.push("chrome://inspect/#devices");

console.log(`[brave-dev] Launching Brave Developer Profile...`);
console.log(`[brave-dev] Profile path: ${profileDir}`);
console.log(`[brave-dev] Mode: ${isMobile ? "Mobile Emulation (430x932)" : "Desktop Dev"}`);
console.log(`[brave-dev] Remote debugging: http://127.0.0.1:9222`);
console.log(`[brave-dev] Dev URL: ${targetUrl}`);

const child = spawn(braveExe, args, {
  detached: true,
  stdio: "ignore",
});
child.unref();

console.log(`[brave-dev] Brave started successfully.`);
