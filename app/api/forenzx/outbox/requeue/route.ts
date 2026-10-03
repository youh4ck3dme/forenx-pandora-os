import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/forenzx/outbox/requeue
 *
 * Resets a dead-letter (status='failed') outbox row back to pending so the
 * drain worker will retry it. Requires the calling user to be authenticated
 * and to have ownership of (or admin access to) the affected case.
 *
 * Security invariants:
 *  - Only rows with status = 'failed' can be requeued.
 *  - The user must own the case (cases.user_id) or hold role='admin'.
 *  - Every requeue is recorded in case_audit_log.
 *  - The update uses .eq("status","failed") as a double-guard at DB level.
 */

const BodySchema = z.union([
  z.object({ outbox_id: z.string().uuid() }),
  z.object({ case_id: z.string().min(1).max(128) }),
]);

async function resolveUserId(request: NextRequest): Promise<string | null> {
  // Read the Supabase access token from Bearer header or sb-access-token cookie
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : request.cookies.get("sb-access-token")?.value ?? "";

  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

async function assertCaseAccess(userId: string, caseId: string): Promise<boolean> {
  // Allow if user owns the case
  const { data: caseRow } = await supabaseAdmin
    .from("cases")
    .select("id, user_id")
    .eq("id", caseId)
    .maybeSingle();

  if (caseRow?.user_id === userId) return true;

  // Fallback: admin role
  const { data: roleRow } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  return roleRow?.role === "admin";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide either outbox_id (UUID) or case_id.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // ── Fetch failed rows ─────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from("forenzx_dispatch_outbox")
    .select("id, case_id, status, attempts")
    .eq("status", "failed");

  if ("outbox_id" in input) {
    query = query.eq("id", input.outbox_id);
  } else {
    query = query.eq("case_id", input.case_id);
  }

  const { data: rows, error: fetchError } = await query;
  if (fetchError) {
    return NextResponse.json({ error: "Database lookup failed." }, { status: 503 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { error: "No failed outbox rows found for the given selector." },
      { status: 404 },
    );
  }

  // ── Assert access for each affected case ──────────────────────────────────
  const caseIds = [...new Set(rows.map((r) => r.case_id).filter((c): c is string => !!c))];
  for (const cid of caseIds) {
    const allowed = await assertCaseAccess(userId, cid);
    if (!allowed) {
      return NextResponse.json({ error: `Access denied for case ${cid}.` }, { status: 403 });
    }
  }

  // ── Reset: status → pending, attempts → 0, next_attempt_at → now ─────────
  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);

  const { error: updateError } = await supabaseAdmin
    .from("forenzx_dispatch_outbox")
    .update({ status: "pending", attempts: 0, next_attempt_at: now, updated_at: now })
    .in("id", ids)
    .eq("status", "failed"); // double-guard

  if (updateError) {
    return NextResponse.json({ error: "Requeue update failed." }, { status: 500 });
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await supabaseAdmin.from("case_audit_log").insert({
    user_id: userId,
    case_id: caseIds[0] ?? null,
    action: "forenzx_outbox_requeue",
    table_name: "forenzx_dispatch_outbox",
    record_id: ids[0] ?? null,
    changes: {
      requeued_ids: ids,
      requeued_count: ids.length,
      requeued_by: userId,
      requeued_at: now,
    },
  });

  return NextResponse.json({ ok: true, requeued: ids.length, outbox_ids: ids });
}
