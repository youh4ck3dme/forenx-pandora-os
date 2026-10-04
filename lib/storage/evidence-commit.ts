import { NextResponse } from "next/server";
import {
  CommitEvidenceSchema,
  integrityStatusOf,
  registerEvidence,
  type LedgerDeps,
} from "@/lib/storage/evidence-ledger";

/**
 * POST /api/vault/commit — zápis dôkazu do ledgeru po úspešnom PUT do S3.
 * Závislosti sú injektované, aby sa dal handler testovať end-to-end (vrátane
 * reálnej DB s RLS v integračných testoch).
 */
export type CommitHandlerDeps = {
  authenticate: (request: Request) => Promise<
    { userId: string; token: string | null } | { userId: null; error: string; status: number }
  >;
  /** true = Supabase ledger je nakonfigurovaný. */
  configured: () => boolean;
  isProduction: () => boolean;
  ledgerFor: (token: string) => Promise<LedgerDeps>;
};

export async function handleCommitEvidence(
  request: Request,
  deps: CommitHandlerDeps,
): Promise<NextResponse> {
  const auth = await deps.authenticate(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error || "Neautorizovaný prístup." }, { status: auth.status || 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = CommitEvidenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Neplatné parametre zápisu dôkazu.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!deps.configured() || !auth.token) {
    // Produkcia bez ledgeru nesmie hlásiť úspech — dôkaz by nebol nikde evidovaný.
    if (deps.isProduction()) {
      return NextResponse.json({ error: "Ledger dôkazov nie je dostupný." }, { status: 503 });
    }
    return NextResponse.json({
      persisted: false,
      evidenceId: null,
      hashVerificationStatus: "pending",
      integrityStatus: "checking",
    });
  }

  try {
    const ledger = await deps.ledgerFor(auth.token);
    const result = await registerEvidence(parsed.data, auth.userId, ledger);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(
      {
        persisted: true,
        created: result.created,
        evidenceId: result.row.id,
        hashVerificationStatus: result.row.hash_verification_status,
        integrityStatus: integrityStatusOf(result.row.hash_verification_status),
        createdAt: result.row.created_at,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch {
    // Detail (kódy DB) sa klientovi nevracia.
    return NextResponse.json({ error: "Zápis dôkazu do ledgeru zlyhal." }, { status: 500 });
  }
}
