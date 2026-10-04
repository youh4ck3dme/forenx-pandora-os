/**
 * POST /api/cases/[id]/court-pack
 *
 * Builds a signed, self-verifying Court Pack ZIP for a case. Court-grade only:
 * the signing context is resolved fail-closed from the environment. Evidence
 * integrity flows through the existing ledger (authoritative server-side
 * SHA-256) — this route never trusts client-supplied hashes.
 *
 * Integration status: the crypto/assembly core (lib/court/*) is unit-tested;
 * this route's live data wiring (Supabase ledger + auth) is covered by
 * integration/E2E, not unit tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { listLedgerEvidence, loadOwnedCaseSummary } from "@/lib/storage/evidence-ledger";
import { buildCourtPack } from "@/lib/court/pack-builder";
import { getCourtSigningContext, courtGradeEnabled } from "@/lib/court/signing-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.token) {
    return NextResponse.json({ error: "Court Pack vyžaduje autentifikáciu platným tokenom." }, { status: 401 });
  }

  const { id: caseId } = await params;
  if (!/^[A-Za-z0-9-]{1,128}$/.test(caseId)) {
    return NextResponse.json({ error: "Neplatné ID prípadu." }, { status: 400 });
  }

  if (!courtGradeEnabled()) {
    return NextResponse.json(
      { error: "Court Pack je dostupný iba v court-grade režime (FORENZX_COURT_GRADE=true)." },
      { status: 409 },
    );
  }

  let signing;
  try {
    signing = getCourtSigningContext();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  try {
    const [ownedCase, ledger] = await Promise.all([
      loadOwnedCaseSummary(auth.token, auth.userId, caseId),
      listLedgerEvidence(auth.token, caseId),
    ]);
    if (!ownedCase) {
      return NextResponse.json(
        { error: "Prípad sa nenašiel alebo k nemu nemáte prístup." },
        { status: 404 },
      );
    }

    const verified = ledger.filter((row) => row.hash_verification_status === "verified");
    const evidence = verified.map((row) => ({ path: row.file_name, sha256: row.sha256_hash }));

    const chainOfCustody = {
      caseId,
      caseName: ownedCase.name,
      generatedBy: auth.userId,
      ledger: ledger.map((row) => ({
        id: row.id,
        fileName: row.file_name,
        sha256: row.sha256_hash,
        bytes: row.file_size,
        mimeType: row.mime_type,
        s3ObjectKey: row.s3_object_key,
        status: row.hash_verification_status,
        createdAt: row.created_at,
      })),
    };

    const hashes = {
      algorithm: "SHA-256",
      evidence: ledger.map((row) => ({ fileName: row.file_name, sha256: row.sha256_hash, status: row.hash_verification_status })),
    };

    const now = new Date();
    const execution = {
      packVersion: 1,
      caseId,
      signingKid: signing.kid,
      keyringVersion: signing.keyring.version,
      generatedAt: now.toISOString(),
      evidenceCount: ledger.length,
      verifiedCount: verified.length,
    };

    const verifyMjsSource = readFileSync(join(process.cwd(), "lib", "court", "verify.mjs"), "utf8");

    const pack = await buildCourtPack({
      caseId,
      report: {
        caseId,
        title: `Court Pack — ${ownedCase.name || caseId}`,
        generatedAtIso: now.toISOString(),
        summary: `Signed evidence package for case ${caseId}. ${verified.length} of ${ledger.length} evidence item(s) are hash-verified.`,
        findings: [],
        evidence,
      },
      chainOfCustody,
      hashes,
      execution,
      signing: {
        kid: signing.kid,
        keyRef: signing.keyRef,
        keyring: signing.keyring,
        revoked: signing.revoked,
        provider: signing.provider,
      },
      verifyMjsSource,
      tsaUrl: signing.tsaUrl,
      trustedTsaCerts: signing.trustedTsaCerts,
      requireTimestamp: true, // court-grade: fail-closed if no TSA (INV-031)
      now,
    });

    return new NextResponse(pack.zip as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="court-pack-${caseId}.zip"`,
        "X-Court-Pack-Merkle-Root": pack.merkleRoot,
        "X-Court-Pack-Kid": signing.kid,
        "X-Court-Pack-Timestamped": String(pack.timestamped),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: `Court Pack build failed: ${(error as Error).message}` }, { status: 500 });
  }
}
