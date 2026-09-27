import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { tracedError, withTraceRoute } from "@/lib/forza/trace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

/**
 * Právny základ prístupu vyšetrovateľa k spisu (P1-04):
 * § 119 ods. 2 Trestného poriadku (spracúvanie PÚ v trestnom konaní) a
 * GDPR čl. 6(1)(e) + čl. 9(2)(f) (verejný záujem / právne nároky).
 */
// Not exported: Next.js route modules may only export HTTP handlers and route config.
const DEFAULT_LEGAL_BASIS =
  "§ 119 ods. 2 Trestného poriadku; GDPR čl. 6(1)(e), čl. 9(2)(f)";

const AccessRequestSchema = z.object({
  caseId: z.string().uuid("Neplatný identifikátor prípadu."),
  action: z.enum(["view", "export"]),
  legalBasis: z.string().trim().max(500).optional(),
});

/**
 * POST /api/audit/access
 * Zapíše štruktúrovaný, nezmeniteľný záznam o prístupe k spisu/dôkazu
 * (actor, timestamp, právny základ, source IP, user agent) do auditného
 * ledgeri. Zlyhanie auditu nikdy nesmie zablokovať samotný prístup, preto
 * klient volá best-effort.
 */
async function handlePost(request: NextRequest, traceId: string): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== "production";

  const rawBody: unknown = await request.json().catch(() => null);
  const validation = AccessRequestSchema.safeParse(rawBody);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Neplatné parametre prístupového auditu.", details: validation.error.issues },
      { status: 400 },
    );
  }
  const { caseId, action } = validation.data;
  const legalBasis = validation.data.legalBasis?.trim() || DEFAULT_LEGAL_BASIS;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!token || token.split(".").length !== 3 || !supabaseUrl || !supabaseAnonKey) {
    // Bez identity nie je čo auditovať; v dev režime bežíme bez auditu.
    if (!isDev) {
      return NextResponse.json(
        { error: "Neautorizovaný prístup: audit vyžaduje reláciu vyšetrovateľa." },
        { status: 401 },
      );
    }
    return NextResponse.json({ success: true, logged: false });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Neplatná relácia vyšetrovateľa." },
        { status: 401 },
      );
    }

    const sourceIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "";
    const userAgent = request.headers.get("user-agent") || "";

    const { error } = await supabase.rpc("log_case_access", {
      _case_id: caseId,
      _action: action,
      _legal_basis: legalBasis,
      _source_ip: sourceIp,
      _user_agent: userAgent,
    });

    if (error) {
      tracedError(traceId, "[AccessAudit] Záznam prístupu sa nepodarilo zapísať:", error.message);
      return NextResponse.json(
        { error: "Záznam prístupu sa nepodarilo zapísať." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, logged: true });
  } catch (err: unknown) {
    tracedError(traceId, "[AccessAudit] Neočekávaná chyba:", err);
    return NextResponse.json(
      { error: "Záznam prístupu sa nepodarilo zapísať." },
      { status: 500 },
    );
  }
}
// P0-04: korelačné trace id (x-trace-id, UUIDv4) v hlavičke odpovede.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handlePost(request, traceId));
}
