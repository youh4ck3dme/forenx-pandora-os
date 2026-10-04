// @vitest-environment node
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
}));

import { app, safeStorage } from "electron";
import { PasswordManager, createPasswordIpcHandlers } from "../password-manager";
import { MAX_PASSWORD_ID_LENGTH } from "../ipc-contract";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pandora-pw-test-"));
  vi.mocked(app.getPath).mockReturnValue(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PasswordManager", () => {
  it("listMasked returns entries without password field", async () => {
    const pm = new PasswordManager();
    await pm.savePassword({ url: "https://example.com", username: "test-user-not-a-secret", password: "test-value-not-a-secret" });
    const list = pm.listMasked();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("password");
    expect(list[0]).toMatchObject({ url: "https://example.com", username: "test-user-not-a-secret" });
  });

  it("revealPassword returns plaintext for known id", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({ url: "https://example.com", username: "test-user-not-a-secret", password: "test-value-not-a-secret" });
    const entry = pm.revealPassword(id as string);
    expect(entry).not.toBeNull();
    expect(entry?.password).toBe("test-value-not-a-secret");
    expect(entry?.id).toBe(id);
  });

  it("revealPassword returns null for unknown id", () => {
    const pm = new PasswordManager();
    expect(pm.revealPassword("test-nonexistent-id-not-a-secret")).toBeNull();
  });

  it("revealPassword returns null when encryption unavailable", async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false);
    const pm = new PasswordManager();
    expect(pm.revealPassword("test-id-not-a-secret")).toBeNull();
  });

  it("deletePassword removes entry from listMasked", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({ url: "https://example.com", username: "test-user-not-a-secret", password: "test-value-not-a-secret" });
    pm.deletePassword(id as string);
    expect(pm.listMasked()).toHaveLength(0);
  });
});

describe("Password IPC Handlers & Sender Authorization", () => {
  const mainWindowId = 42;
  const browserViewSenderId = 100;
  const isMainWindowSender = (event: { sender: { id: number } }) => {
    return event.sender.id === mainWindowId;
  };

  it("password:get allows mainWindow and returns masked list without password field", async () => {
    const pm = new PasswordManager();
    await pm.savePassword({
      url: "https://secure.example.com",
      username: "alice",
      password: "secret-password-123",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };
    const result = await handlers.handleGet(authorizedEvent);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("password");
    expect(result[0]).toMatchObject({
      url: "https://secure.example.com",
      username: "alice",
    });
  });

  it("password:get returns FORBIDDEN for unauthorized sender (BrowserView crosstalk)", async () => {
    const pm = new PasswordManager();
    await pm.savePassword({
      url: "https://secure.example.com",
      username: "alice",
      password: "secret-password-123",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const unauthorizedEvent = { sender: { id: browserViewSenderId } };
    const result = await handlers.handleGet(unauthorizedEvent);

    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("password:get returns empty array when passwordManager is not initialized", async () => {
    const handlers = createPasswordIpcHandlers(() => null, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };
    const result = await handlers.handleGet(authorizedEvent);

    expect(result).toEqual([]);
  });

  it("password:reveal allows mainWindow and returns plaintext for valid known id", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({
      url: "https://secure.example.com",
      username: "alice",
      password: "secret-password-123",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };
    const result = await handlers.handleReveal(authorizedEvent, id);

    expect(result).toEqual({
      ok: true,
      entry: expect.objectContaining({
        id,
        url: "https://secure.example.com",
        username: "alice",
        password: "secret-password-123",
      }),
    });
  });

  it("password:reveal returns NOT_FOUND for unknown id", async () => {
    const pm = new PasswordManager();
    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };
    const result = await handlers.handleReveal(authorizedEvent, "unknown-id-123");

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("password:reveal returns VALIDATION_ERROR for empty, non-string, or oversized id", async () => {
    const pm = new PasswordManager();
    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };

    expect(await handlers.handleReveal(authorizedEvent, "")).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(await handlers.handleReveal(authorizedEvent, 12345)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(await handlers.handleReveal(authorizedEvent, null)).toEqual({ ok: false, code: "VALIDATION_ERROR" });

    // ID exceeding MAX_PASSWORD_ID_LENGTH
    const oversizedId = "a".repeat(MAX_PASSWORD_ID_LENGTH + 1);
    expect(await handlers.handleReveal(authorizedEvent, oversizedId)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("password:reveal accepts valid generated IDs exceeding 128 characters (Copilot fix)", async () => {
    const pm = new PasswordManager();
    // A long URL and standard username generates base64 ID > 128 chars
    const longUrl = "https://example.com/very/long/path/with/deep/nesting/to/ensure/base64/encoded/id/exceeds/the/old/one/hundred/and/twenty/eight/chars";
    const username = "investigator-case-42@agency.jurisdiction.internal";
    const id = await pm.savePassword({
      url: longUrl,
      username,
      password: "deep-investigation-password",
    });

    expect(typeof id).toBe("string");
    expect((id as string).length).toBeGreaterThan(128);
    expect((id as string).length).toBeLessThanOrEqual(MAX_PASSWORD_ID_LENGTH);

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };
    const result = await handlers.handleReveal(authorizedEvent, id);

    expect(result).toEqual({
      ok: true,
      entry: expect.objectContaining({
        id,
        url: longUrl,
        username,
        password: "deep-investigation-password",
      }),
    });
  });

  it("password:reveal returns FORBIDDEN for unauthorized sender", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({
      url: "https://example.com",
      username: "alice",
      password: "secret-password",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const unauthorizedEvent = { sender: { id: browserViewSenderId } };
    const result = await handlers.handleReveal(unauthorizedEvent, id);

    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("password:save allows mainWindow and stores entry", async () => {
    const pm = new PasswordManager();
    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };

    const id = await handlers.handleSave(authorizedEvent, {
      url: "https://portal.bank.example",
      username: "finance-officer",
      password: "strong-secret-key",
    });

    expect(typeof id).toBe("string");
    expect(pm.listMasked()).toHaveLength(1);
    expect(pm.revealPassword(id as string)?.password).toBe("strong-secret-key");
  });

  it("password:save returns FORBIDDEN for unauthorized sender and does not store entry", async () => {
    const pm = new PasswordManager();
    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const unauthorizedEvent = { sender: { id: browserViewSenderId } };

    const result = await handlers.handleSave(unauthorizedEvent, {
      url: "https://malicious-attempt.example",
      username: "attacker",
      password: "hacked-password",
    });

    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(pm.listMasked()).toHaveLength(0);
  });

  it("password:delete allows mainWindow and removes entry", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({
      url: "https://delete-me.example",
      username: "temp-user",
      password: "temp-password",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const authorizedEvent = { sender: { id: mainWindowId } };

    const result = await handlers.handleDelete(authorizedEvent, id as string);
    expect(result).toBe(true);
    expect(pm.listMasked()).toHaveLength(0);
  });

  it("password:delete returns FORBIDDEN for unauthorized sender and does not delete entry", async () => {
    const pm = new PasswordManager();
    const id = await pm.savePassword({
      url: "https://keep-me.example",
      username: "important-user",
      password: "important-password",
    });

    const handlers = createPasswordIpcHandlers(() => pm, isMainWindowSender);
    const unauthorizedEvent = { sender: { id: browserViewSenderId } };

    const result = await handlers.handleDelete(unauthorizedEvent, id as string);
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(pm.listMasked()).toHaveLength(1);
  });
});

describe("Password Manager IPC Invariants & Schema Bounds (Static Invariants)", () => {
  it("verifies electron/main.mts gates all password channels with isMainWindowSender", () => {
    const mainPath = path.resolve(__dirname, "../main.mts");
    const mainSrc = fs.readFileSync(mainPath, "utf8");

    // Must define and use isMainWindowSender
    expect(mainSrc).toContain("function isMainWindowSender(event: Electron.IpcMainInvokeEvent): boolean");
    expect(mainSrc).toContain("ipcMain.handle('password:get'");
    expect(mainSrc).toContain("ipcMain.handle('password:reveal'");
    expect(mainSrc).toContain("ipcMain.handle('password:save'");
    expect(mainSrc).toContain("ipcMain.handle('password:delete'");

    // Must wire passwordIpcHandlers with isMainWindowSender
    expect(mainSrc).toContain("createPasswordIpcHandlers");
    expect(mainSrc).toContain("isMainWindowSender");
  });

  it("verifies electron/preload.ts aligns password ID bounds with MAX_PASSWORD_ID_LENGTH", () => {
    const preloadPath = path.resolve(__dirname, "../preload.ts");
    const preloadSrc = fs.readFileSync(preloadPath, "utf8");

    // Must not have hardcoded max(128) for password:reveal or password:delete
    expect(preloadSrc).not.toMatch(/"password:reveal":\s*z\.string\(\)\.min\(1\)\.max\(128\)/);
    expect(preloadSrc).not.toMatch(/"password:delete":\s*z\.string\(\)\.min\(1\)\.max\(128\)/);

    // Must use MAX_PASSWORD_ID_LENGTH
    expect(preloadSrc).toMatch(/"password:reveal":\s*z\.string\(\)\.min\(1\)\.max\(MAX_PASSWORD_ID_LENGTH\)/);
    expect(preloadSrc).toMatch(/"password:delete":\s*z\.string\(\)\.min\(1\)\.max\(MAX_PASSWORD_ID_LENGTH\)/);

    // MAX_PASSWORD_ID_LENGTH must cover max generated ID (ceil(4/3*(2048+1+320)) = 3160)
    expect(MAX_PASSWORD_ID_LENGTH).toBeGreaterThanOrEqual(3160);
  });
});

