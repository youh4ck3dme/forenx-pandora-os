import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mainSrc = fs.readFileSync(path.resolve(__dirname, "../main.mts"), "utf8");

function handlerBody(channel: string): string {
  const token = `'${channel}'`;
  const start = mainSrc.indexOf(token);
  expect(start).toBeGreaterThan(-1);
  const next = mainSrc.indexOf("ipcMain.", start + token.length);
  return mainSrc.slice(start, next === -1 ? undefined : next);
}

describe("main-window IPC sender guards", () => {
  for (const channel of [
    "shield:toggle", "shield:getStats", "shield:getLogs", "proxy:set",
    "system:open-external-safe", "tab:create", "tab:switch", "tab:close",
    "tab:update", "search:suggestions", "tab:getContent", "extension:list",
    "reader:toggle", "devtools:toggle", "vault:select-evidence", "vault:read-chunk",
    "nav:back", "nav:forward", "nav:reload", "ai:chat", "ai:generate-image",
    "updater:check", "updater:install", "session:clear-data", "history:search",
    "history:getContent", "extension:load", "capture:page", "capture:acquireAsEvidence",
    "dialog:openFile", "dialog:saveFile",
  ]) {
    it(`gates ${channel} with isMainWindowSender`, () => {
      expect(handlerBody(channel)).toContain("isMainWindowSender");
    });
  }
});
