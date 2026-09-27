import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultTokenManager } from "../vault-token-manager";

const temporaryDirectories: string[] = [];

async function createEvidenceFile(contents: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pandora-vault-test-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "evidence.txt");
  await fs.writeFile(filePath, contents);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("vault token manager", () => {
  it("reads only through a token bound to its originating renderer", async () => {
    const manager = new VaultTokenManager();
    const filePath = await createEvidenceFile("forensic evidence");
    const descriptor = await manager.register(
      filePath,
      "11111111-1111-4111-8111-111111111111",
      42,
    );

    await expect(manager.read(descriptor.tokenId, 99, 0, 8)).resolves.toEqual({
      ok: false,
      code: "ACCESS_DENIED",
    });
    await expect(manager.read(descriptor.tokenId, 42, 0, 8)).resolves.toMatchObject({
      ok: true,
      bytesRead: 8,
    });
  });

  it("revokes all file capabilities for a case", async () => {
    const manager = new VaultTokenManager();
    const filePath = await createEvidenceFile("forensic evidence");
    const descriptor = await manager.register(
      filePath,
      "11111111-1111-4111-8111-111111111111",
      42,
    );

    manager.revokeCase("11111111-1111-4111-8111-111111111111");

    await expect(manager.read(descriptor.tokenId, 42, 0, 8)).resolves.toEqual({
      ok: false,
      code: "ACCESS_DENIED",
    });
  });
});
