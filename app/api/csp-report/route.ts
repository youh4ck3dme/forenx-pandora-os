import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tracedWarn, withTraceRoute, sanitizeForLog } from "@/lib/forza/trace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

/**
 * POST /api/csp-report (P0-05)
 *
 * Collector pre Content-Security-Policy-Report-Only violácie (report-uri v
 * next.config.mjs). Reporty prechádzajú sanitizáciou (žiadne PII / tajomstvá),
 * rate limitom (20 / IP / min) a ukladajú sa do error_logs (severity
 * 'warning', source 'csp') — vstupné dáta pre nonce/hash design a neskoršie
 * vynútenie CSP bez `unsafe-inline`.
 *
 * Autentifikácia nie je potrebná: CSP reporty generuje prehliadač bez
 * credentials; prístup je čisto write-only, sanitizovaný a rate-limitovaný.
 */

import { isCspReportRateLimited, MAX_BODY_BYTES } from "./limiter";

/** Podporuje obe bežné formy: application/csp-report aj application/reports+json. */
const CspReportSchema = z.union([
  z.object({
    "csp-report": z.object({
      "document-uri": z.string().max(1000).optional(),
      "violated-directive": z.string().max(200).optional(),
      "effective-directive": z.string().max(200).optional(),
      "blocked-uri": z.string().max(1000).optional(),
      disposition: z.string().max(50).optional(),
      "source-file": z.string().max(1000).optional(),
      "line-number": z.number().optional(),
    }),
  }),
  z.object({
    body: z.object({
      documentURL: z.string().max(1000).optional(),
      effectiveDirective: z.string().max(200).optional(),
      violatedDirective: z.string().max(200).optional(),
      blockedURL: z.string().max(1000).optional(),
      disposition: z.string().max(50).optional(),
    }),
  }),
]);

type ParsedReport = {
  documentUri: string | undefined;
  directive: string | undefined;
  blockedUri: string | undefined;
  disposition: string | undefined;
};

function normalizeReport(input: unknown): ParsedReport | null {
  const parsed = CspReportSchema.safeParse(input);
  if (!parsed.success) return null;
  if ("csp-report" in parsed.data) {
    const r = parsed.data["csp-report"];
    return {
      documentUri: r["document-uri"],
      directive: r["violated-directive"] ?? r["effective-directive"],
      blockedUri: r["blocked-uri"],
      disposition: r.disposition,
    };
  }
  const b = parsed.data.body;
  return {
    documentUri: b.documentURL,
    directive: b.violatedDirective ?? b.effectiveDirective,
    blockedUri: b.blockedURL,
    disposition: b.disposition,
  };
}

async function storeCspReport(traceId: string, report: ParsedReport): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const message = `CSP ${report.disposition ?? "report"}: ${report.directive ?? "?"}` +
      ` — blocked ${sanitizeForLog(report.blockedUri ?? "?")}` +
      ` @ ${sanitizeForLog(report.documentUri ?? "?")}`;
    const { error } = await supabaseAdmin.from("error_logs").insert({
      route: report.documentUri?.slice(0, 500) ?? "csp",
      message: message.slice(0, 2000),
      severity: "warning",
      source: "csp",
    });
    if (error) {
      tracedWarn(traceId, "[CspReport] Zápis do error_logs zlyhal:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    tracedWarn(traceId, "[CspReport] Neočekávaná chyba:", err);
    return false;
  }
}

async function handlePost(
  request: NextRequest,
  traceId: string,
): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (isCspReportRateLimited(ip)) {
    return new NextResponse(null, { status: 429 });
  }

  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Prázdny alebo príliš veľký report." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Report nie je platný JSON." }, { status: 400 });
  }

  // Report Report-Only rozhrania príde aj ako pole (application/reports+json).
  const reports = Array.isArray(body) ? body : [body];
  let stored = 0;
  for (const entry of reports.slice(0, 5)) {
    const report = normalizeReport(entry);
    if (report && (await storeCspReport(traceId, report))) stored += 1;
  }

  // Violácie sa vždy príjmu s 204 (browser report-uri nečaká telo),
  // aj keď sa zápis nepodaril — log na serveri už zachytil detail.
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handlePost(request, traceId));
}
