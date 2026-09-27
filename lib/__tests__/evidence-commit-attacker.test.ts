// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleCommitEvidence } from "@/lib/storage/evidence-commit";
import type { LedgerDeps, LedgerRow } from "@/lib/storage/evidence-ledger";
import { CommitEvidenceSchema } from "@/lib/storage/evidence-ledger";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ATTACKER = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "header.payload.signature";
const SHA = "a".repeat(64);

function commitRequest(body: unknown, token?: string): Request {
  return new Request("http://localhost:3000/api/vault/commit", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify(body),
  });
}

function validBody(caseId = CASE_ID) {
  return {
    caseId,
    storageKey: `cases/${caseId}/evidence/${SHA}-zmluva.pdf`,
    fileName: "zmluva.pdf",
    fileSizeBytes: 1024,
    mimeType: "application/pdf",
    sha256Hash: SHA,
  };
}

function row(overrides?: Partial<LedgerRow>): LedgerRow {
  return {
    id: "ledger-row-1",
    case_name: "Case A",
    file_name: "zmluva.pdf",
    file_size: 1024,
    mime_type: "application/pdf",
    s3_object_key: `cases/${CASE_ID}/evidence/${SHA}-zmluva.pdf`,
    sha256_hash: SHA,
    hash_verification_status: "pending",
    created_at: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}

type LedgerDepsOverrides = Partial<LedgerDeps> & {
  caseOwner?: string | null;
  existingRow?: LedgerRow | null;
  insertImpl?: (input: Record<string, unknown>) => Promise<LedgerRow>;
};

function makeDeps(overrides: LedgerDepsOverrides = {}): LedgerDeps {
  const {
    caseOwner = OWNER,
    existingRow = null,
    insertImpl,
    ...rest
  } = overrides;
  let findByKeyCalls = 0;
  const deps: LedgerDeps = {
    caseOf: async () =>
      caseOwner === null
        ? { ok: false, reason: "not_found" as const }
        : { ok: true, userId: caseOwner, name: "Case A" },
    findByKey: rest.findByKey ?? (async () => {
      findByKeyCalls += 1;
      return existingRow;
    }),
    insert:
      insertImpl ??
      (async () => {
        throw new Error("ledger_insert_failed:23505");
      }),
    ...rest,
  };
  return deps;
}

function handlerDeps(
  ledger: LedgerDeps,
  options?: { authenticated?: boolean; configured?: boolean; production?: boolean },
) {
  return {
    authenticate: async () =>
      options?.authenticated === false
        ? { userId: null, token: null, error: "Neautorizovaný prístup.", status: 401 }
        : { userId: ATTACKER, token: TOKEN },
    configured: () => options?.configured ?? true,
    isProduction: () => options?.production ?? true,
    ledgerFor: async () => ledger,
  };
}

describe("P0-03 — authenticated attacker tests (POST /api/vault/commit)", () => {
  it("bez autentifikácie → 401, ledger sa ani nezíska", async () => {
    const ledgerFor = vi.fn(async () => makeDeps());
    const res = await handleCommitEvidence(commitRequest(validBody()), {
      authenticate: async () => ({
        userId: null,
        token: null,
        error: "Neautorizovaný prístup.",
        status: 401,
      }),
      configured: () => true,
      isProduction: () => true,
      ledgerFor,
    });
    expect(res.status).toBe(401);
    expect(ledgerFor).not.toHaveBeenCalled();
  });

  it("cudzí vyšetrovateľ (authenticated attacker) → 403 a žiadny zápis", async () => {
    const insert = vi.fn(async () => row());
    const ledger = makeDeps({ caseOwner: OWNER, insertImpl: insert });
    const res = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(ledger),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Nemáte oprávnenie");
    expect(insert).not.toHaveBeenCalled();
  });

  it("storage kľúč vydaný pre iný prípad/hash/súbor → 400 bez zápisu", async () => {
    const insert = vi.fn(async () => row());
    const ledger = makeDeps({ insertImpl: insert });
    const body = validBody();
    body.storageKey = `cases/${CASE_ID}/evidence/${"b".repeat(64)}-iny-subor.pdf`;
    const res = await handleCommitEvidence(commitRequest(body), handlerDeps(ledger));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("neexistujúci prípad → 404 bez zápisu", async () => {
    const insert = vi.fn(async () => row());
    const ledger = makeDeps({ caseOwner: null, insertImpl: insert });
    const res = await handleCommitEvidence(commitRequest(validBody()), handlerDeps(ledger));
    expect(res.status).toBe(404);
    expect(insert).not.toHaveBeenCalled();
  });

  it("vlastník: úspešný zápis → 201, created: true", async () => {
    const ledger = makeDeps({
      caseOwner: ATTACKER,
      insertImpl: async () => row(),
    });
    const res = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(ledger),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.persisted).toBe(true);
    expect(json.created).toBe(true);
    expect(json.integrityStatus).toBe("checking");
  });

  it("idempotencia: už existujúci objekt → 200, created: false", async () => {
    const ledger = makeDeps({
      caseOwner: ATTACKER,
      existingRow: row(),
      insertImpl: async () => {
        throw new Error("must not be called");
      },
    });
    const res = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(ledger),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(false);
  });

  it("P0-03 race: konkurenčný duplicitný zápis (23505) → fallback na existujúci riadok", async () => {
    let inserted = false;
    const ledger = makeDeps({
      caseOwner: ATTACKER,
      insertImpl: async () => {
        if (inserted) throw new Error("ledger_insert_failed:23505");
        inserted = true;
        return row();
      },
      findByKey: async () => (inserted ? row() : null),
    });
    // Druhé volanie toho istého objektu — insert zlyhá na unique indexe,
    // registerEvidence prevezme riadok z prvého commitu (idempotentne).
    const first = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(ledger),
    );
    const second = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(ledger),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const json = await second.json();
    expect(json.created).toBe(false);
    expect(json.evidenceId).toBe("ledger-row-1");
  });

  it("produkcia bez ledgeru → fail-closed 503 (žiadny falošný úspech)", async () => {
    const res = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(makeDeps(), { configured: false, production: true }),
    );
    expect(res.status).toBe(503);
  });

  it("dev bez ledgeru → persisted: false (okamžitá odozva)", async () => {
    const res = await handleCommitEvidence(
      commitRequest(validBody()),
      handlerDeps(makeDeps(), { configured: false, production: false }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.persisted).toBe(false);
  });

  it("neplatný payload neprejde schémou → 400", () => {
    expect(CommitEvidenceSchema.safeParse({ ...validBody(), sha256Hash: "xyz" }).success).toBe(false);
  });
});
