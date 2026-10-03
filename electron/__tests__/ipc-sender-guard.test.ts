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
  for (const channel of ["shield:toggle", "shield:getStats", "shield:getLogs", "proxy:set"]) {
    it(`gates ${channel} with isMainWindowSender`, () => {
      expect(handlerBody(channel)).toContain("isMainWindowSender");
    });
  }
});
