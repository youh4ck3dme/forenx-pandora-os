// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "11111111-1111-4111-8111-111111111111";
const CASE_UUID = "22222222-2222-4222-8222-222222222222";
const REAL_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REAL_S3_KEY = `cases/${CASE_UUID}/evidence/real-dump.tar.gz`;

let mockAuthUser: string | null = TEST_USER_ID;
let mockEvidenceRow: Record<string, unknown> | null = null;
let mockExistingJob: { id: string; hub_job_id: string; status: string } | null =
  null;
let mockInsertError: { message: string } | null = null;
let mockStartResult = {
  job_id: "hub-job-999",
  status: "queued",
  deduplicated: false,
};

const { startForenZXAnalysisMock } = vi.hoisted(() => ({
  startForenZXAnalysisMock: vi.fn(),
}));
const mockAuditInserts: Record<string, unknown>[] = [];

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () => {
    if (!mockAuthUser) {
      return { userId: null, error: "Unauthorized", status: 401 };
    }
    return { userId: mockAuthUser, error: null, status: 200 };
  }),
}));

vi.mock("@/lib/forza/forenzx-mcp.server", () => ({
  startForenZXAnalysis: (...args: unknown[]) =>
    startForenZXAnalysisMock(...args),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "case_audit_log") {
        return {
          insert: vi.fn(async (payload) => {
            mockAuditInserts.push(payload);
            return { error: null };
          }),
        };
      }
      if (table === "evidence_items") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: mockEvidenceRow,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "forenzx_analysis_jobs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: mockExistingJob,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (mockInsertError)
                  return { data: null, error: mockInsertError };
                return { data: { id: "job-row-1", ...payload }, error: null };
              },
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      return {};
    },
  },
}));

describe("POST /api/forenzx/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditInserts.length = 0;
    mockAuthUser = TEST_USER_ID;
    mockEvidenceRow = {
      id: EVIDENCE_ID,
      case_id: CASE_UUID,
      investigator_id: TEST_USER_ID,
      case_name: "Vyšetrovanie prípadu X",
      file_name: "real-dump.tar.gz",
      file_size: 1048576,
      mime_type: "application/gzip",
      s3_object_key: REAL_S3_KEY,
      sha256_hash: REAL_HASH,
      hash_verification_status: "verified",
    };
    mockExistingJob = null;
    mockInsertError = null;
    startForenZXAnalysisMock.mockReset();
    startForenZXAnalysisMock.mockResolvedValue(mockStartResult);
  });

  it("strictly ignores spoofed s3ObjectKey and sha256 from request body and uses verified DB ledger row", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    const spoofedKey = "cases/attacker-evil/evidence/trojan.bin";
    const spoofedSha =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
        packId: "mobile_compromise",
        s3ObjectKey: spoofedKey,
        sha256: spoofedSha,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { jobId: string };
    expect(body.jobId).toBe("hub-job-999");

    // Invariant verification: startForenZXAnalysis must receive LEDGER values, NOT spoofed values
    expect(startForenZXAnalysisMock).toHaveBeenCalledTimes(1);
    const calledArgs = startForenZXAnalysisMock.mock.calls[0][0];

    expect(calledArgs.s3Key).toBe(REAL_S3_KEY);
    expect(calledArgs.s3Key).not.toBe(spoofedKey);

    expect(calledArgs.sha256).toBe(REAL_HASH);
    expect(calledArgs.sha256).not.toBe(spoofedSha);

    expect(calledArgs.caseId).toBe(CASE_UUID);
    expect(calledArgs.evidenceId).toBe(EVIDENCE_ID);
    expect(calledArgs.idempotencyKey).toBe(
      `pandora:evidence:${EVIDENCE_ID}:${REAL_HASH}`,
    );
  });

  it("rejects unverified evidence with HTTP 403 when hash_verification_status is 'checking'", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockEvidenceRow = {
      ...mockEvidenceRow,
      hash_verification_status: "checking",
    };

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
        packId: "mobile_compromise",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("verified");
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("rejects unverified evidence with HTTP 403 when hash_verification_status is 'tampered'", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockEvidenceRow = {
      ...mockEvidenceRow,
      hash_verification_status: "tampered",
    };

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
        packId: "mobile_compromise",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("returns 404 if evidence row is missing or belongs to another investigator", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockEvidenceRow = null;

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
        packId: "mobile_compromise",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("returns 401 when request is unauthenticated", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockAuthUser = null;

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("returns 400 when request body fails validation (missing evidenceId)", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("deduplicates requests if an active job already exists", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockExistingJob = {
      id: "job-123",
      hub_job_id: "hub-existing-555",
      status: "running",
    };

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      jobId: string;
      deduplicated: boolean;
    };
    expect(body.jobId).toBe("hub-existing-555");
    expect(body.deduplicated).toBe(true);

    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("rejects request with HTTP 403 when evidence row does not yield a valid UUID caseId", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    mockEvidenceRow = {
      ...mockEvidenceRow,
      case_id: null,
      s3_object_key: "cases/non-uuid-case-folder/evidence/dump.tar.gz",
    };

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("UUID caseId");
    expect(startForenZXAnalysisMock).not.toHaveBeenCalled();
  });

  it("accepts evidence row with valid UUID in case_id field directly", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");

    const directCaseUuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    mockEvidenceRow = {
      ...mockEvidenceRow,
      case_id: directCaseUuid,
      s3_object_key: `cases/${CASE_UUID}/evidence/dump.tar.gz`,
    };

    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(startForenZXAnalysisMock).toHaveBeenCalledTimes(1);
    const calledArgs = startForenZXAnalysisMock.mock.calls[0][0];
    expect(calledArgs.caseId).toBe(directCaseUuid);
  });

  it("validates request schema correctly from lib schema module", async () => {
    const { ForenzxStartRequestSchema } =
      await import("../forenzx-start.schema");
    const valid = ForenzxStartRequestSchema.safeParse({
      evidenceId: EVIDENCE_ID,
      inputType: "ios_backup",
      packId: "mobile_compromise",
    });
    expect(valid.success).toBe(true);

    const invalid = ForenzxStartRequestSchema.safeParse({
      evidenceId: "not-a-uuid",
      inputType: "",
    });
    expect(invalid.success).toBe(false);
  });

  it("records server-authoritative evidence provenance in case_audit_log upon start", async () => {
    const { POST } = await import("../../../app/api/forenzx/start/route");
    const request = new NextRequest("http://localhost/api/forenzx/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidenceId: EVIDENCE_ID,
        inputType: "ios_backup",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockAuditInserts.length).toBe(1);
    const auditRecord = mockAuditInserts[0];
    expect(auditRecord.action).toBe("forenzx_analysis_started");
    expect(auditRecord.case_id).toBe(CASE_UUID);
    expect(auditRecord.changes).toMatchObject({
      job_id: "hub-job-999",
      evidence_id: EVIDENCE_ID,
      s3_object_key: REAL_S3_KEY,
      sha256_hash: REAL_HASH,
      file_size: 1048576,
    });
  });
});
