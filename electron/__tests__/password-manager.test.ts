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
import { PasswordManager } from "../password-manager";

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

describe("MAX_PASSWORD_ID_LENGTH consistency", () => {
  it("ipc-contract MAX_PASSWORD_ID_LENGTH covers max base64(url:username)", async () => {
    const { MAX_PASSWORD_ID_LENGTH } = await import("../ipc-contract");
    // Worst case: url=2048 ASCII + ':' + username=320 × 4 bytes UTF-8 = 3329 bytes → ceil(3329/3)*4 = 4440
    const maxInputBytes = 2048 + 1 + 320 * 4;
    const maxBase64Chars = Math.ceil(maxInputBytes / 3) * 4;
    expect(MAX_PASSWORD_ID_LENGTH).toBeGreaterThanOrEqual(maxBase64Chars);
  });
});
