import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FileSigningKeyProvider, parseKeyring } from "@/lib/court/signing";

const h = vi.hoisted(() => ({
  auth: { userId: "user-1", token: "trusted-token", devBypass: false } as
    | { userId: string; token: string | null; devBypass: boolean }
    | { userId: null; token: null; error: string; status: number },
  ledger: [] as Array<Record<string, unknown>>,
  courtGrade: true,
  signing: null as unknown,
  ledgerCalls: [] as Array<[string, string]>,
}));

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () => h.auth),
}));
vi.mock("@/lib/storage/evidence-ledger", () => ({
  listLedgerEvidence: vi.fn(async (token: string, caseId: string) => {
    h.ledgerCalls.push([token, caseId]);
    return h.ledger;
  }),
}));
vi.mock("@/lib/forza/case-data", () => ({
  loadCase: vi.fn(async (id: string) => ({ id, name: "Case One" })),
}));
vi.mock("@/lib/court/signing-context", () => ({
  courtGradeEnabled: () => h.courtGrade,
  getCourtSigningContext: () => h.signing,
}));
// TSA crypto is unit-tested in timestamp/gates; here we stub the network token so
// the court-grade (requireTimestamp) path can produce a pack deterministically.
vi.mock("@/lib/court/timestamp", () => ({
  requestTimestampToken: vi.fn(async () => ({ tsr: new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]), genTime: null })),
}));

const VERIFY_MJS = join(process.cwd(), "lib", "court", "verify.mjs");
const KID = "route-kid";
let tmp: string;

function ledgerRow(over: Partial<Record<string, unknown>>) {
  return {
    id: "e1",
    case_id: "case-1",
    case_name: "Case One",
    file_name: "evidence-1.bin",
    file_size: 10,
    mime_type: "application/octet-stream",
    s3_object_key: "cases/case-1/e1.bin",
    sha256_hash: "a".repeat(64),
    hash_verification_status: "verified",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "court-route-"));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyPath = join(tmp, "ed25519.pem");
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  h.signing = {
    kid: KID,
    keyRef: `file:${keyPath}`,
    keyring: parseKeyring(
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem: publicKey }]),
      "v1",
    ),
    revoked: new Set<string>(),
    provider: new FileSigningKeyProvider({ enforcePermissions: false }),
    tsaUrl: "https://tsa.test/ts", // stubbed by the timestamp mock
  };
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  h.auth = { userId: "user-1", token: "trusted-token", devBypass: false };
  h.ledger = [];
  h.courtGrade = true;
  h.ledgerCalls = [];
});

async function post(caseId: string, body?: unknown) {
  const { POST } = await import("@/app/api/cases/[id]/court-pack/route");
  const req = new NextRequest("http://localhost/api/cases/case-1/court-pack", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  return POST(req, { params: Promise.resolve({ id: caseId }) });
}

async function extract(zip: Uint8Array): Promise<Record<string, string>> {
  const archive = await JSZip.loadAsync(zip);
  const out: Record<string, string> = {};
  const dir = mkdtempSync(join(tmp, "x-"));
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const abs = join(dir, name);
    mkdirSync(dirname(abs), { recursive: true });
    const bytes = Buffer.from(await entry.async("uint8array"));
    writeFileSync(abs, bytes);
    out[name] = bytes.toString("utf8");
  }
  out.__dir = dir;
  return out;
}

describe("Gate 5 — Court Pack route provenance & E2E", () => {
  it("authenticated investigator → case → verified ledger → pack → offline verify", async () => {
    h.ledger = [ledgerRow({ file_name: "verified-a.bin", sha256_hash: "a".repeat(64) })];
    const res = await post("case-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");

    const zip = new Uint8Array(await res.arrayBuffer());
    const files = await extract(zip);
    expect(execFileSync("node", [VERIFY_MJS, files.__dir], { encoding: "utf8" })).toMatch(/VERIFIED/);
    expect(files["hashes.json"]).toContain("verified-a.bin");
    // ledger was queried server-side with the authenticated token + case id
    expect(h.ledgerCalls).toEqual([["trusted-token", "case-1"]]);
  });

  it("uses SERVER-authoritative ledger, never client-supplied evidence", async () => {
    h.ledger = [ledgerRow({ file_name: "server-truth.bin" })];
    const res = await post("case-1", { evidence: [{ fileName: "CLIENT-FAKE.txt", sha256: "f".repeat(64) }] });
    expect(res.status).toBe(200);
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    expect(files["hashes.json"]).toContain("server-truth.bin");
    expect(files["hashes.json"]).not.toContain("CLIENT-FAKE");
    expect(files["chain-of-custody.json"]).not.toContain("CLIENT-FAKE");
  });

  it("excludes unverified evidence from the report evidence set", async () => {
    h.ledger = [ledgerRow({ file_name: "ok.bin", hash_verification_status: "verified" }), ledgerRow({ id: "e2", file_name: "bad.bin", hash_verification_status: "mismatch" })];
    const res = await post("case-1");
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    const execution = JSON.parse(files["execution.json"]);
    expect(execution.evidenceCount).toBe(2);
    expect(execution.verifiedCount).toBe(1);
  });

  it("rejects an unauthenticated request (401)", async () => {
    h.auth = { userId: null, token: null, error: "no auth", status: 401 };
    const res = await post("case-1");
    expect(res.status).toBe(401);
  });

  it("rejects when not in court-grade mode (409)", async () => {
    h.courtGrade = false;
    const res = await post("case-1");
    expect(res.status).toBe(409);
  });

  it("rejects an invalid case id (400)", async () => {
    const res = await post("bad id!!");
    expect(res.status).toBe(400);
  });

  it("builds a valid (empty-evidence) pack when the case has no ledger evidence", async () => {
    h.ledger = [];
    const res = await post("case-1");
    expect(res.status).toBe(200);
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(files["execution.json"]).evidenceCount).toBe(0);
    expect(execFileSync("node", [VERIFY_MJS, files.__dir], { encoding: "utf8" })).toMatch(/VERIFIED/);
  });
});
