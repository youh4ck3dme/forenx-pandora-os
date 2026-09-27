import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_CHUNK_BYTES = 10 * 1024 * 1024;
const MAX_CONCURRENT_READS = 3;
const TOKEN_TTL_MS = 15 * 60 * 1000;

export type FileTokenDescriptor = {
  readonly tokenId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
};

type TokenMetadata = FileTokenDescriptor & {
  readonly realPath: string;
  readonly ownerWebContentsId: number;
  readonly caseId: string;
  readonly expiresAt: number;
};

export type VaultReadResult =
  | { readonly ok: true; readonly dataBase64: string; readonly bytesRead: number }
  | { readonly ok: false; readonly code: "ACCESS_DENIED" | "TOKEN_EXPIRED" | "INVALID_RANGE" | "READ_FAILED" };

export class VaultTokenManager {
  private readonly tokens = new Map<string, TokenMetadata>();
  private activeReads = 0;
  private readonly queue: (() => void)[] = [];

  async register(
    realPath: string,
    caseId: string,
    ownerWebContentsId: number,
  ): Promise<FileTokenDescriptor> {
    const resolvedPath = path.resolve(realPath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) throw new Error("Vybraný objekt nie je súbor.");
    const descriptor: FileTokenDescriptor = {
      tokenId: crypto.randomUUID(),
      fileName: path.basename(resolvedPath),
      sizeBytes: stats.size,
    };
    this.tokens.set(descriptor.tokenId, {
      ...descriptor,
      realPath: resolvedPath,
      ownerWebContentsId,
      caseId,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return descriptor;
  }

  async read(
    tokenId: string,
    ownerWebContentsId: number,
    offset: number,
    length: number,
  ): Promise<VaultReadResult> {
    const token = this.tokens.get(tokenId);
    if (!token || token.ownerWebContentsId !== ownerWebContentsId) {
      return { ok: false, code: "ACCESS_DENIED" };
    }
    if (Date.now() >= token.expiresAt) {
      this.tokens.delete(tokenId);
      return { ok: false, code: "TOKEN_EXPIRED" };
    }
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      length > MAX_CHUNK_BYTES ||
      offset >= token.sizeBytes
    ) {
      return { ok: false, code: "INVALID_RANGE" };
    }

    await this.acquire();
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(token.realPath, "r");
      const buffer = Buffer.allocUnsafe(Math.min(length, token.sizeBytes - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      return {
        ok: true,
        dataBase64: buffer.subarray(0, bytesRead).toString("base64"),
        bytesRead,
      };
    } catch {
      return { ok: false, code: "READ_FAILED" };
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        this.release();
      }
    }
  }

  revokeOwner(ownerWebContentsId: number): void {
    for (const [tokenId, token] of this.tokens) {
      if (token.ownerWebContentsId === ownerWebContentsId) this.tokens.delete(tokenId);
    }
  }

  revokeCase(caseId: string): void {
    for (const [tokenId, token] of this.tokens) {
      if (token.caseId === caseId) this.tokens.delete(tokenId);
    }
  }

  private acquire(): Promise<void> {
    if (this.activeReads < MAX_CONCURRENT_READS) {
      this.activeReads += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeReads += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.activeReads -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
