/**
 * Schéma odpovede forenzného autopilota.
 * Chráni pred halucináciou, ktorá je síce platný JSON, ale nemá správnu štruktúru.
 */
import { z } from "zod";
import { repairTruncatedJson, stripCodeFences } from "@/lib/ai/parse-json";

export { repairTruncatedJson, stripCodeFences };

const loose = z.record(z.unknown());

export const forensicDossierSchema = z.object({
  caseId: z.string().optional(),
  caseTitle: z.string().optional(),
  defendabilityIndex: z.number().optional(),
  generatedAt: z.string().optional(),
  facts: z.object({
    timeline: z.array(loose),
    traces: z.array(loose).optional(),
  }).passthrough(),
  defenseAttack: z.object({
    overallRisk: z.string().optional(),
    attacks: z.array(loose).optional(),
  }).passthrough(),
  evidenceStrength: z.object({
    traces: z.array(loose).optional(),
    paragraphs: z.array(loose).optional(),
  }).passthrough(),
  judgeReadyText: z.union([z.string(), z.record(z.unknown())]),
}).passthrough();

export type ParsedForensicDossier = z.infer<typeof forensicDossierSchema>;

export const DOSSIER_SCHEMA_ERROR =
  "AI nevrátila kompletnú forenznú štruktúru (fakty, obhajoba, sila dôkazov). Skúste analýzu spustiť znova.";

/** Rozparsuje a overí odpoveď AI. Vyhodí chybu so slovenskou hláškou. */
export function parseForensicDossier(content: string): ParsedForensicDossier {
  const cleaned = stripCodeFences(content);
  const start = cleaned.indexOf("{");
  const candidate = start > 0 ? cleaned.slice(start) : cleaned;

  let raw: unknown;
  const tryParse = (text: string): boolean => {
    try {
      raw = JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  let wasRepaired = false;
  if (!tryParse(candidate)) {
    const repaired = repairTruncatedJson(candidate);
    if (!repaired || !tryParse(repaired)) {
      throw new Error("Odpoveď AI nebola platným JSON.");
    }
    wasRepaired = true;
  }
  // Po oprave useknutej odpovede môžu chýbať celé sekcie – doplníme prázdne.
  if (wasRepaired && raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const facts = (obj["facts"] ?? {}) as Record<string, unknown>;
    if (!Array.isArray(facts["timeline"])) facts["timeline"] = [];
    obj["facts"] = facts;
    if (
      typeof obj["defenseAttack"] !== "object" ||
      obj["defenseAttack"] === null
    )
      obj["defenseAttack"] = {};
    if (
      typeof obj["evidenceStrength"] !== "object" ||
      obj["evidenceStrength"] === null
    )
      obj["evidenceStrength"] = {};
    if (obj["judgeReadyText"] === undefined) obj["judgeReadyText"] = "";
  }

  const result = forensicDossierSchema.safeParse(raw);
  if (!result.success) throw new Error(DOSSIER_SCHEMA_ERROR);
  return result.data;
}
