import { NextRequest, NextResponse } from "next/server";
import { withTraceRoute } from "@/lib/forza/trace";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { handleCommitEvidence } from "@/lib/storage/evidence-commit";
import { ledgerConfigured, supabaseLedgerDeps } from "@/lib/storage/evidence-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

/**
 * POST /api/vault/commit
 * Po úspešnom priamom PUT do S3 zapíše dôkaz do ledgeru `evidence_items`
 * (stav `pending`; overenie hashu robí serverový worker /api/vault/verify).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, () =>
    handleCommitEvidence(request, {
      authenticate: (req) => authenticateVaultRequest(req as NextRequest),
      configured: ledgerConfigured,
      isProduction: () => process.env.NODE_ENV === "production",
      ledgerFor: supabaseLedgerDeps,
    }),
  );
}
