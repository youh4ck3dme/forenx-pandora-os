import { APP_VERSION } from "../version";
import { CANONICAL_VERSION, canonicalJson, canonicalSha256 } from "./canonical";
import { sha256Hex } from "./sha256";

/**
 * Reprodukovateľný manifest reportu.
 *
 * Rozlišujeme tri veci:
 * 1. file integrity hash — SHA-256 bajtov/textu vygenerovaného reportu,
 * 2. evidence manifest — tento objekt; jeho kanonický hash viaže report na
 *    konkrétne vstupy (snapshoty zdrojov, verzie parserov, pravidiel, buildu),
 * 3. kryptografický podpis/pečať — NIE JE implementovaný. Samotný SHA-256
 *    nie je elektronický podpis ani pečať a report sa tak nesmie označovať.
 */
export const MANIFEST_VERSION = "forenx-report-manifest-v1";
export const SIGNATURE_STATUS = "unsigned" as const;

export type ReportManifest = {
  manifest_version: typeof MANIFEST_VERSION;
  canonicalization: typeof CANONICAL_VERSION;
  subject_id: string;
  generated_at: string;
  app_version: string;
  ruleset_version: string;
  parser_versions: string[];
  report_sha256: string;
  content_sha256: string;
  source_snapshot_hashes: string[];
  signature: typeof SIGNATURE_STATUS;
};

export function buildReportManifest(input: {
  subjectId: string;
  reportText: string;
  content: unknown;
  rulesetVersion: string;
  parserVersions?: string[];
  sourceSnapshotHashes?: string[];
  generatedAt?: Date;
}): { manifest: ReportManifest; manifestSha256: string } {
  const manifest: ReportManifest = {
    manifest_version: MANIFEST_VERSION,
    canonicalization: CANONICAL_VERSION,
    subject_id: input.subjectId,
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    app_version: APP_VERSION,
    ruleset_version: input.rulesetVersion,
    parser_versions: [...new Set(input.parserVersions ?? [])].sort(),
    report_sha256: sha256Hex(input.reportText),
    content_sha256: canonicalSha256(input.content),
    source_snapshot_hashes: [...new Set(input.sourceSnapshotHashes ?? [])].sort(),
    signature: SIGNATURE_STATUS,
  };
  return { manifest, manifestSha256: canonicalSha256(manifest) };
}

/** Overí, či report a obsah zodpovedajú manifestu (detekcia manipulácie). */
export function verifyReportManifest(
  manifest: ReportManifest,
  manifestSha256: string,
  reportText: string,
  content: unknown,
): { ok: true } | { ok: false; reason: "manifest" | "report" | "content" } {
  if (canonicalSha256(manifest) !== manifestSha256) return { ok: false, reason: "manifest" };
  if (sha256Hex(reportText) !== manifest.report_sha256) return { ok: false, reason: "report" };
  if (canonicalSha256(content) !== manifest.content_sha256) return { ok: false, reason: "content" };
  return { ok: true };
}

export function manifestToJson(manifest: ReportManifest): string {
  return canonicalJson(manifest);
}
