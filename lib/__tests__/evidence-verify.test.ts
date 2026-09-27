// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isAuthorizedCronRequest,
  sha256OfStream,
  verifyEvidenceItem,
  type ObjectSource,
  type VerificationResult,
} from "../storage/evidence-verify";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const CONTENT = "forenzný spis — strana 1";
const SHA = createHash("sha256").update(CONTENT).digest("hex");
const SIZE = Buffer.byteLength(CONTENT);
const item = { id: "e1", s3_object_key: "cases/c1/spis.pdf", sha256_hash: SHA, file_size: SIZE };

async function run(openObject: ObjectSource, overrides: Partial<typeof item> = {}) {
  const recorded: VerificationResult[] = [];
  const result = await verifyEvidenceItem({ ...item, ...overrides }, {
    openObject,
    record: async (r) => {
      recorded.push(r);
    },
  });
  return { result, recorded };
}

describe("sha256OfStream", () => {
  it("hashes chunked streams identically to a single buffer", async () => {
    const { sha256, size } = await sha256OfStream(streamOf("forenzný ", "spis — ", "strana 1"));
    expect(sha256).toBe(SHA);
    expect(size).toBe(SIZE);
  });
});

describe("verifyEvidenceItem", () => {
  it("marks a matching object as verified and records it", async () => {
    const { result, recorded } = await run(async () => ({ ok: true, body: streamOf(CONTENT) }));
    expect(result).toEqual({ id: "e1", status: "verified", sha256: SHA, size: SIZE, error: null });
    expect(recorded).toEqual([result]);
  });

  it("detects a tampered object", async () => {
    const { result } = await run(async () => ({ ok: true, body: streamOf(CONTENT + "!") }));
    expect(result.status).toBe("mismatch");
    expect(result.sha256).not.toBe(SHA);
  });

  it("detects a ledger hash that does not describe the stored object", async () => {
    const { result } = await run(async () => ({ ok: true, body: streamOf(CONTENT) }), {
      sha256_hash: "f".repeat(64),
    });
    expect(result.status).toBe("mismatch");
  });

  it("detects a size mismatch even with the same hash claim", async () => {
    const { result } = await run(async () => ({ ok: true, body: streamOf(CONTENT) }), {
      file_size: SIZE + 1,
    });
    expect(result.status).toBe("mismatch");
  });

  it("reports a missing object and other S3 failures", async () => {
    expect((await run(async () => ({ ok: false, status: 404 }))).result.status).toBe("object_missing");
    expect((await run(async () => ({ ok: false, status: 403 }))).result.status).toBe("error");
  });

  it("records errors without leaking the message (may contain signed URLs)", async () => {
    const { result, recorded } = await run(async () => {
      throw new TypeError("fetch failed https://s3/x?X-Amz-Signature=secret");
    });
    expect(result).toMatchObject({ status: "error", error: "TypeError" });
    expect(JSON.stringify(recorded)).not.toContain("Signature");
  });
});

describe("isAuthorizedCronRequest", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
    expect(isAuthorizedCronRequest(null, secret)).toBe(false);
  });

  it("is closed without a strong configured secret", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer short", "short")).toBe(false);
  });
});
