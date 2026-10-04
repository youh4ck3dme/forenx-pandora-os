// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { uploadEvidenceDirect, type PresignData } from "../storage/vault-upload-client";

const SHA = "ab".repeat(32);
const presign: PresignData = {
  uploadUrl: "https://hel1.your-objectstorage.com/forenx-vault-sk/cases/c1/evidence/x.pdf?X-Amz-Signature=s",
  storageKey: `cases/c1/evidence/${SHA}-x.pdf`,
  bucket: "forenx-vault-sk",
  requiredHeaders: {
    "Content-Type": "application/pdf",
    "x-amz-content-sha256": SHA,
    "x-amz-meta-sha256-checksum": SHA,
    "x-amz-meta-uploaded-by": "user-1",
    "x-amz-meta-case-id": "c1",
  },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function run(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof uploadEvidenceDirect>[0]> = {}) {
  return uploadEvidenceDirect({
    file: new Blob(["%PDF-1.7 dôkaz"], { type: "application/pdf" }),
    fileName: "x.pdf",
    caseId: "c1",
    sha256Hash: SHA,
    presign,
    token: "jwt-token",
    fetchImpl,
    ...overrides,
  });
}

describe("uploadEvidenceDirect", () => {
  it("PUTs with every signed header, then commits to the ledger", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://")) return new Response(null, { status: 200 });
      return json(201, { persisted: true, evidenceId: "ev-1", integrityStatus: "checking" });
    }) as unknown as typeof fetch;

    const result = await run(fetchImpl);
    expect(result).toEqual({ ok: true, evidenceId: "ev-1", persisted: true, integrityStatus: "checking" });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const [putUrl, putInit] = calls[0] as [string, RequestInit];
    expect(putUrl).toBe(presign.uploadUrl);
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toEqual(presign.requiredHeaders);

    const [commitUrl, commitInit] = calls[1] as [string, RequestInit];
    expect(commitUrl).toBe("/api/vault/commit");
    expect((commitInit.headers as Record<string, string>).authorization).toBe("Bearer jwt-token");
    expect(JSON.parse(String(commitInit.body))).toEqual({
      caseId: "c1",
      storageKey: presign.storageKey,
      fileName: "x.pdf",
      fileSizeBytes: new Blob(["%PDF-1.7 dôkaz"]).size,
      mimeType: "application/pdf",
      sha256Hash: SHA,
    });
  });

  it("never reports success when S3 rejects the PUT, and does not commit", async () => {
    const fetchImpl = vi.fn(async () => new Response("SignatureDoesNotMatch", { status: 403 })) as unknown as typeof fetch;
    expect(await run(fetchImpl)).toEqual({
      ok: false,
      stage: "s3_put",
      status: 403,
      error: "S3 odmietlo upload (HTTP 403).",
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("reports a ledger failure after a successful PUT (object is in S3 but unregistered)", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith("https://")
        ? new Response(null, { status: 200 })
        : json(403, { error: "Nemáte oprávnenie zapisovať dôkazy do tohto spisu." }),
    ) as unknown as typeof fetch;
    expect(await run(fetchImpl)).toEqual({
      ok: false,
      stage: "ledger_commit",
      status: 403,
      error: "Nemáte oprávnenie zapisovať dôkazy do tohto spisu.",
    });
  });

  it("handles network errors and aborts without throwing", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await run(network)).toMatchObject({ ok: false, stage: "s3_put", status: 0, error: "S3 nie je dostupné." });

    const abort = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    expect(await run(abort)).toMatchObject({ ok: false, error: "Upload bol prerušený." });
  });

  it("skips the PUT for the development fallback URL but still commits", async () => {
    const fetchImpl = vi.fn(async () => json(200, { persisted: false, evidenceId: null, integrityStatus: "checking" })) as unknown as typeof fetch;
    const result = await run(fetchImpl, {
      presign: { ...presign, uploadUrl: "https://hel1.your-objectstorage.com/k?vault_mode=fallback_put&sig=x" },
    });
    expect(result).toEqual({ ok: true, evidenceId: null, persisted: false, integrityStatus: "checking" });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("/api/vault/commit");
  });

  it("defaults to 'checking' — never 'verified' — when the server omits a status", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith("https://") ? new Response(null, { status: 200 }) : json(200, {}),
    ) as unknown as typeof fetch;
    expect(await run(fetchImpl)).toMatchObject({ ok: true, integrityStatus: "checking" });
  });
});
